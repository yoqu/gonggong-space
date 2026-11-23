/**
 * The live board: the sync engine bound to the board codec, with helpers to
 * read and change the board's content and title.
 */

import { BOARD_RECORD_CODEC, type OrderCarry } from '../codec.ts';
import { persistedElementByDerived } from '../derived.ts';
import type { ElementMeasures } from '../geometry.ts';
import { canonicalValuesEqual } from '../json.ts';
import { parseBoardContent } from '../normalize.ts';
import type { Board, BoardContent, BoardElement } from '../schema.ts';
import { followStickerHosts, rebindStickersToHosts, unmarkFollowedStickers } from '../sticker-hosts.ts';
import { createLiveStore, type LiveCache, type LiveCodec, type LiveStore } from './engine.ts';
import { SYSTEM_TIMERS, type SyncTimers, type SyncTransport } from './transport.ts';

/**
 * After someone else moves a sticker's host, the stickers that followed it
 * on this page are written back after about this long (times 1–3, so pages
 * rarely write together).
 */
export const STICKER_FOLLOW_WRITE_DELAY_MS = 1000;

/**
 * `next` with every part that equals `previous` replaced by the previous
 * object (elements, timer, inks, claims), so renders and memoized geometry
 * keep their identity. Returns `previous` itself when nothing changed.
 */
export function shareUnchangedContent(previous: BoardContent, next: BoardContent): BoardContent {
  if (previous === next) return previous;
  const before = new Map(previous.elements.map((element) => [element.id, element]));
  let sameElements = previous.elements.length === next.elements.length;
  const elements = next.elements.map((element, index): BoardElement => {
    const old = before.get(element.id);
    // A derived element equals its old copy only when both store the same twin.
    const kept =
      old !== undefined &&
      (old === element ||
        (canonicalValuesEqual(old, element) && canonicalValuesEqual(persistedElementByDerived.get(old), persistedElementByDerived.get(element))))
        ? old
        : element;
    if (kept !== previous.elements[index]) sameElements = false;
    return kept;
  });
  const share = <V>(a: V | undefined, b: V | undefined): V | undefined => (a === b || (a !== undefined && b !== undefined && canonicalValuesEqual(a, b)) ? a : b);
  const timer = share(previous.timer, next.timer);
  const inks = share(previous.inks, next.inks);
  const claimed = share(previous.claimed, next.claimed);
  if (sameElements && timer === previous.timer && inks === previous.inks && claimed === previous.claimed) return previous;
  return {
    elements: sameElements ? previous.elements : elements,
    ...(timer !== undefined ? { timer } : {}),
    ...(inks !== undefined ? { inks } : {}),
    ...(claimed !== undefined ? { claimed } : {}),
  };
}

/** {@link shareUnchangedContent} for a whole board. */
export function shareUnchangedBoard(previous: Board, next: Board): Board {
  const content = shareUnchangedContent(previous.content, next.content);
  return content === previous.content && next.title === previous.title ? previous : { title: next.title, content };
}

/**
 * The board codec as the engine needs it. `parseContent` normalizes the
 * composed content (the editor may add steps, such as moving stickers with
 * their hosts).
 */
export function createBoardLiveCodec(parseContent: (raw: unknown) => BoardContent = parseBoardContent): LiveCodec<Board, OrderCarry> {
  return {
    collections: BOARD_RECORD_CODEC.collections,
    metaPath: BOARD_RECORD_CODEC.metaPath,
    decompose: (board, previous, carry) => BOARD_RECORD_CODEC.decompose(board, previous, carry),
    compose(documents) {
      const composed = BOARD_RECORD_CODEC.compose(documents);
      return { value: { title: composed.title, content: parseContent(composed.content) }, carry: composed.carry };
    },
    replaceOnly: BOARD_RECORD_CODEC.replaceOnly,
    refuse: BOARD_RECORD_CODEC.refuse,
    share: shareUnchangedBoard,
  };
}

/** Options of {@link createLiveBoardDocument}. */
export interface LiveBoardOptions {
  transport: SyncTransport;
  /** Keeps a saved copy on the device, shown while the store is out of reach. */
  cache?: LiveCache;
  /** Viewers never write. */
  readOnly?: boolean;
  timers?: SyncTimers;
  formatTime?: (epochMs: number) => string;
  /** The board shown while loading. */
  initial?: Board;
  /** Normalizes composed content (default: `parseBoardContent`); stickers then follow their hosts. */
  parseContent?: (raw: unknown) => BoardContent;
  /** The page's measured sizes, so stickers find their hosts as drawn. */
  measures?: () => ElementMeasures | undefined;
}

/** A live board. */
export interface LiveBoardDocument extends LiveStore<Board> {
  content(): BoardContent;
  title(): string;
  /** Replaces the content (title kept). */
  setContent(content: BoardContent): boolean;
  /** Changes the content with a function of the current one. */
  updateContent(updater: (content: BoardContent) => BoardContent): boolean;
  setTitle(title: string): boolean;
}

/** An empty board. */
export const EMPTY_BOARD: Board = { title: '', content: { elements: [] } };

/** `content` with `elements`, or `content` itself when they are the same array. */
function withElements(content: BoardContent, elements: readonly BoardElement[]): BoardContent {
  return elements === content.elements ? content : { ...content, elements: [...elements] };
}

/**
 * Creates a live board and starts loading it.
 *
 * Stickers sit on hosts: when someone else moves a host, its stickers
 * follow it on load as derived elements (shown moved, stored unmoved), and
 * a writing page stores the followed positions a moment later. Local edits
 * refresh the stickers' host records.
 */
export function createLiveBoardDocument(options: LiveBoardOptions): LiveBoardDocument {
  const parse = options.parseContent ?? parseBoardContent;
  const measures = options.measures ?? (() => undefined);
  const timers = options.timers ?? SYSTEM_TIMERS;
  const store = createLiveStore<Board>({
    transport: options.transport,
    codec: createBoardLiveCodec((raw) => {
      const parsed = parse(raw);
      return withElements(parsed, followStickerHosts(parsed.elements, measures()));
    }),
    initial: options.initial ?? EMPTY_BOARD,
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
    ...(options.timers !== undefined ? { timers: options.timers } : {}),
    ...(options.formatTime !== undefined ? { formatTime: options.formatTime } : {}),
  });
  const setContent = (content: BoardContent): boolean => {
    const board = store.value();
    if (content === board.content) return store.canEdit();
    return store.commit({ title: board.title, content: withElements(content, rebindStickersToHosts(board.content.elements, content.elements, measures())) });
  };

  // Store the positions of stickers that followed a host someone else moved.
  let settleTimer: unknown;
  let firstRemoteAt: number | undefined;
  const scheduleStickerWrite = (retried = false): void => {
    timers.clearTimeout(settleTimer);
    const delay = STICKER_FOLLOW_WRITE_DELAY_MS * (1 + 2 * timers.random());
    const dueAt = timers.now() + delay;
    settleTimer = timers.setTimeout(() => {
      // The page slept through the delay: wait once more so a waking page does not write stale positions.
      if (!retried && timers.now() - dueAt >= STICKER_FOLLOW_WRITE_DELAY_MS) return scheduleStickerWrite(true);
      firstRemoteAt = undefined;
      if (store.getSnapshot().loadState !== 'live') return;
      const board = store.value();
      const elements = unmarkFollowedStickers(board.content.elements);
      if (elements !== board.content.elements) store.commit({ title: board.title, content: withElements(board.content, elements) });
    }, delay);
  };
  const unsubscribe = store.subscribe((change) => {
    if (!change.remote || !store.canEdit()) return;
    firstRemoteAt ??= timers.now();
    // A steady stream of remote edits must not postpone the write forever.
    if (timers.now() - firstRemoteAt <= 5 * STICKER_FOLLOW_WRITE_DELAY_MS) scheduleStickerWrite();
  });

  return {
    ...store,
    content: () => store.value().content,
    title: () => store.value().title,
    setContent,
    updateContent: (updater) => setContent(updater(store.value().content)),
    setTitle(title) {
      const board = store.value();
      return title === board.title ? store.canEdit() : store.commit({ title, content: board.content });
    },
    dispose() {
      unsubscribe();
      timers.clearTimeout(settleTimer);
      store.dispose();
    },
  };
}
