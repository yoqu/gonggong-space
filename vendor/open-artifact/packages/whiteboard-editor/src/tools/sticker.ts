/**
 * The Sticker tool: a press drops the armed sticker (an emoji, an icon from
 * the catalog, or the viewer's face as a vote) centered on the pointer,
 * with a little pop. Holding the press grows it ×1.5 every 1.2 s, up to
 * three times, while it wiggles. A sticker dropped on an item sticks to it
 * (it moves with it).
 *
 * Without an armed sticker (the picker is open) the tool acts like Select.
 * {@link placeSticker} is also what a sticker dragged from the picker (it
 * lays down from its peel instead of popping; `ui/sticker-drag.ts`), the
 * face sticker picked from the keyboard, and Enter with the tool use; a
 * vote placed that way (not by a press) lands on the one selected item, in
 * the next free spot from its bottom-right corner (`lib/votes.ts`), else in
 * the middle of the view.
 */

import {
  DEFAULT_STICKER_SIZE,
  FACE_STICKER_ART,
  canHostSticker,
  createElementId,
  stickerArtForEmoji,
  stickerGlyphForArt,
  topElementAt,
  hitSlop,
  type BoardElement,
  type ElementId,
  type StickerElement,
} from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { FACE_STICKER_GLYPH, FACE_STICKER_SIZE, createVote, voteSpotOn } from '../lib/votes.ts';
import { addedMessage, announce } from '../services/announce.ts';
import { editContent, viewerAuthor } from '../services/actions.ts';
import { useRecentStickers } from '../state/recent-stickers.ts';
import { useSelection } from '../state/selection.ts';
import { useTool, type StickerChoice } from '../state/tool.ts';
import { gestureKey, pastThreshold, type Gesture, type PointerSample } from './gesture.ts';
import { hitContext, type HitContext } from './hit.ts';
import { DOUBLE_TAP, ensureRoom } from './place.ts';
import { forgetTap, selectPress } from './select.ts';

export { FACE_STICKER_GLYPH, FACE_STICKER_INSET, FACE_STICKER_SIZE, FACE_STICKER_SPACING } from '../lib/votes.ts';
/** Hold-to-grow: each step multiplies the size by `factor`, every `everyMs`, at most `times` times. */
export const STICKER_GROW = { factor: 1.5, everyMs: 1200, times: 3 } as const;
/** Wiggle while held: starts after `delayMs`, one swing takes `swingMs`, `degrees` either way. */
export const STICKER_WIGGLE = { delayMs: 200, swingMs: 90, degrees: 3.5 } as const;
/** The pop a new or grown sticker makes. */
export const STICKER_POP = { durationMs: 200, keyframes: [1 / 1.5, 1.08, 1], offsets: [0, 0.6, 1] } as const;

/** How many grow steps a hold of `heldMs` has made. */
export function stickerGrowSteps(heldMs: number): number {
  return Math.max(0, Math.min(STICKER_GROW.times, Math.floor(heldMs / STICKER_GROW.everyMs)));
}

/** The side of a sticker of side `base` after a hold of `heldMs`. */
export function stickerSizeAfterHold(base: number, heldMs: number): number {
  return Math.round(base * STICKER_GROW.factor ** stickerGrowSteps(heldMs));
}

/** The item a sticker dropped at a point sticks to, if any. */
export function stickerHostAt(context: HitContext, point: Point): BoardElement | undefined {
  const hosts = context.elements.filter(canHostSticker);
  return topElementAt(hosts, point.x, point.y, hitSlop('mouse', context.zoom), context.measures, undefined, context.zoom);
}

/** The item a vote placed without a press lands on: the one selected item, when it can take stickers. */
export function voteHost(context: HitContext, selected: ReadonlySet<ElementId> | readonly ElementId[] = useSelection.getState().ids): BoardElement | undefined {
  const ids = [...selected];
  if (ids.length !== 1) return undefined;
  const host = context.elements.find((element) => element.id === ids[0]);
  return host !== undefined && canHostSticker(host) ? host : undefined;
}

/**
 * A new sticker for a choice (`undefined` for an empty choice), centered on
 * a point, or for a vote with `host`, in the next free spot on that item.
 * A face sticker names the viewer; without a known viewer it is a plain hand.
 */
export function createStickerAt(choice: StickerChoice, center: Point, context: HitContext = hitContext(), host?: BoardElement): StickerElement | undefined {
  if (choice.art === FACE_STICKER_ART) {
    const author = viewerAuthor().id;
    const size = FACE_STICKER_SIZE;
    const corner = { x: center.x - size / 2, y: center.y - size / 2 };
    if (author === null) return { type: 'sticker', id: createElementId(), ...corner, w: size, h: size, glyph: FACE_STICKER_GLYPH };
    return createVote(author, host ? voteSpotOn(host, author, context.elements, context.measures) : corner);
  }
  const glyph = (choice.art !== undefined ? stickerGlyphForArt(choice.art) : undefined) ?? choice.glyph;
  if (glyph === undefined) return undefined;
  const art = choice.art ?? stickerArtForEmoji(glyph);
  const size = DEFAULT_STICKER_SIZE;
  return {
    type: 'sticker',
    id: createElementId(),
    x: center.x - size / 2,
    y: center.y - size / 2,
    w: size,
    h: size,
    glyph,
    ...(art !== undefined ? { art } : {}),
  };
}

/* ------------------------------------------------------------------------ */
/* Motion                                                                   */
/* ------------------------------------------------------------------------ */

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The DOM node of an element's view, if it is on screen. */
function elementNode(id: ElementId): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`.wb-surface [data-wb-id="${CSS.escape(id)}"]`);
}

/**
 * Runs `then` with an element's view once it exists (within the next few
 * frames), else `otherwise` (it never showed, or there is no DOM).
 */
export function whenStickerRendered(id: ElementId, then: (node: HTMLElement) => void, otherwise?: () => void, tries = 3): void {
  if (typeof requestAnimationFrame !== 'function') {
    otherwise?.();
    return;
  }
  requestAnimationFrame(() => {
    const node = elementNode(id);
    if (node) then(node);
    else if (tries > 0) whenStickerRendered(id, then, otherwise, tries - 1);
    else otherwise?.();
  });
}

/** Runs `then` once the element's view exists (after the next frames). */
function whenRendered(id: ElementId, then: (node: HTMLElement) => void): void {
  whenStickerRendered(id, then);
}

/** The pop a sticker makes when it appears or grows. */
function pop(id: ElementId): void {
  if (prefersReducedMotion()) return;
  whenRendered(id, (node) => {
    if (typeof node.animate !== 'function') return;
    node.animate(
      STICKER_POP.keyframes.map((scale, index) => ({ scale: String(scale), offset: STICKER_POP.offsets[index] })),
      { duration: STICKER_POP.durationMs, easing: 'ease-out', composite: 'add' },
    );
  });
}

/** Starts the wiggle; returns a function that stops it. */
function wiggle(id: ElementId): () => void {
  if (prefersReducedMotion()) return () => undefined;
  let animation: Animation | null = null;
  let stopped = false;
  const timer = setTimeout(() => {
    whenRendered(id, (node) => {
      if (stopped || typeof node.animate !== 'function') return;
      const degrees = STICKER_WIGGLE.degrees;
      animation = node.animate([{ rotate: `${-degrees}deg` }, { rotate: `${degrees}deg` }], {
        duration: STICKER_WIGGLE.swingMs,
        direction: 'alternate',
        iterations: Infinity,
        easing: 'ease-in-out',
        composite: 'add',
      });
    });
  }, STICKER_WIGGLE.delayMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
    animation?.cancel();
  };
}

/* ------------------------------------------------------------------------ */
/* Placing                                                                  */
/* ------------------------------------------------------------------------ */

/** Adds a sticker under one coalesced undo step; `false` when the board is read-only or full. */
function writeSticker(sticker: StickerElement, key: string): boolean {
  return editContent(
    (content) =>
      content.elements.some((element) => element.id === sticker.id)
        ? { ...content, elements: content.elements.map((element) => (element.id === sticker.id ? sticker : element)) }
        : { ...content, elements: [...content.elements, sticker] },
    { label: 'Add sticker', coalesce: key },
  );
}

/** Options of {@link placeSticker}. */
export interface PlaceStickerOptions {
  /** Whether the new sticker pops (default `true`); a peeled sticker lays down instead. */
  pop?: boolean;
}

/**
 * Drops a sticker for a choice centered on a point (a picker drop, Enter
 * with the tool); a vote goes on the one selected item instead, when there
 * is one (see {@link voteHost}). Returns its id.
 */
export function placeSticker(choice: StickerChoice, center: Point, options: PlaceStickerOptions = {}): ElementId | undefined {
  if (!ensureRoom()) return undefined;
  const context = hitContext();
  const sticker = createStickerAt(choice, center, context, choice.art === FACE_STICKER_ART ? voteHost(context) : undefined);
  if (!sticker || !writeSticker(sticker, gestureKey('sticker', sticker.id))) return undefined;
  rememberUse(choice, sticker);
  if (options.pop !== false) pop(sticker.id);
  announce(addedMessage('sticker'));
  return sticker.id;
}

function rememberUse(choice: StickerChoice, sticker: StickerElement): void {
  const art = choice.art ?? sticker.art ?? sticker.glyph;
  if (art !== FACE_STICKER_ART) useRecentStickers.getState().use(art);
}

/** The last placement, so the second press of a double click does not drop a second sticker. */
let lastPlaced: { at: number; screen: Point } | null = null;

/** The Sticker tool's press. */
export function stickerPress(sample: PointerSample): Gesture | null {
  const choice = useTool.getState().sticker;
  if (choice === undefined) return selectPress(sample);
  forgetTap();
  const { event } = sample;
  if (lastPlaced && event.timeStamp - lastPlaced.at <= DOUBLE_TAP.ms && Math.hypot(sample.screen.x - lastPlaced.screen.x, sample.screen.y - lastPlaced.screen.y) <= DOUBLE_TAP.px)
    return {};
  if (!ensureRoom()) return null;
  const sticker = createStickerAt(choice, sample.board);
  if (!sticker) return null;
  const key = gestureKey('sticker', sticker.id);
  if (!writeSticker(sticker, key)) return null;
  lastPlaced = { at: event.timeStamp, screen: sample.screen };
  pop(sticker.id);
  useSelection.getState().clear();

  // Hold to grow (votes too).
  let current = sticker;
  let steps = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopWiggle: () => void = () => undefined;
  const stopHold = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    stopWiggle();
  };
  stopWiggle = wiggle(sticker.id);
  timer = setInterval(() => {
    steps += 1;
    const size = Math.round(sticker.w * STICKER_GROW.factor ** steps);
    const cx = current.x + current.w / 2;
    const cy = current.y + current.h / 2;
    current = { ...current, x: cx - size / 2, y: cy - size / 2, w: size, h: size };
    writeSticker(current, key);
    pop(sticker.id);
    if (steps >= STICKER_GROW.times) stopHold();
  }, STICKER_GROW.everyMs);
  return {
    cursor: 'copy',
    move(next) {
      if (timer !== null && pastThreshold(sample.screen, next.screen, next.event)) stopHold();
    },
    up() {
      stopHold();
      rememberUse(choice, current);
      announce(addedMessage('sticker'));
      useTool.getState().placed();
    },
    cancel() {
      stopHold();
      editContent((content) => ({ ...content, elements: content.elements.filter((element) => element.id !== sticker.id) }), { label: 'Add sticker', coalesce: key });
    },
  };
}
