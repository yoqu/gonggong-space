/**
 * The board's document layout: how a board splits into store documents and
 * how documents compose back into a board.
 *
 * ```
 * board/meta            {v: 1, title, order: [id…]}   drawing order, back to front
 * elements/<id>         one element, without its id
 * board/claim-<key>     an agent claim: {x, y, w, h} and/or {ids}
 * board/timer           the shared timer (always replaced whole)
 * board/inks            custom ink colors {colors: {"rrggbb": at}}
 * ```
 *
 * One document per element lets people edit different elements at once
 * without conflicts; the order list lives in one small document.
 */

import type { DocumentMap, DocumentValue } from '@open-artifact/live-store/engine';
import { ELEMENT_ID_PATTERN, MAX_BOARD_ELEMENTS, type Board, type BoardContent, type BoardElement, type BoardInk, type ClaimedArea, type ElementId, type HexColor, type StoredElement, type TimerFields } from './schema.ts';
import { persistedElementOf } from './derived.ts';
import { EMPTY_SVG_DATA_URL, normalizeImageSource } from './image-source.ts';
import { canonicalValuesEqual, escapedJsonByteLength, jsonValueDepth } from './json.ts';

/** The meta document: title and drawing order. */
export const BOARD_META_PATH = 'board/meta';
/** The collection of element documents. */
export const ELEMENTS_COLLECTION = 'elements';
/** The shared timer document. */
export const BOARD_TIMER_PATH = 'board/timer';
/** The custom inks document. */
export const BOARD_INKS_PATH = 'board/inks';
/** Prefix of agent claim documents (`board/claim-<key>`). */
export const BOARD_CLAIM_PREFIX = 'board/claim-';
/** Collections the board reads. */
export const BOARD_COLLECTIONS = [ELEMENTS_COLLECTION, 'board'] as const;
/** Largest single document the page writes. */
export const MAX_SYNC_RECORD_BYTES = 204_800;
/** Deepest document the page writes. */
export const MAX_SYNC_RECORD_DEPTH = 8;
/** Largest whole board the page keeps syncing. */
export const MAX_SYNC_BOARD_BYTES = 2_097_152;

export type { DocumentMap, DocumentValue };

/** The meta document. */
export interface BoardMetaRecord {
  v: number;
  title: string;
  order: ElementId[];
}

/** The inks document. */
export interface BoardInksRecord {
  colors: Record<string, number>;
}

/**
 * Where dangling order entries go: an id listed in `board/meta` whose
 * element document is missing (not yet arrived, or deleted elsewhere) is
 * remembered with the id it followed, so the next write keeps its slot.
 */
export interface OrderCarry {
  after: Record<ElementId, ElementId | null>;
}

/** A composed board plus what the codec noticed. */
export interface ComposedBoard extends Board {
  /** Order slots of missing elements. */
  carry: OrderCarry;
  /** Element paths the order lists but the store lacks. */
  dangling: string[];
}

/** The element document path of an id. */
export function elementPath(id: ElementId): string {
  return `${ELEMENTS_COLLECTION}/${id}`;
}

/** The element id of an element document path, if it is one. */
export function elementIdOfPath(path: string): ElementId | undefined {
  if (!path.startsWith(`${ELEMENTS_COLLECTION}/`)) return undefined;
  const id = path.slice(ELEMENTS_COLLECTION.length + 1);
  return ELEMENT_ID_PATTERN.test(id) ? id : undefined;
}

/** The claim document path of a claim key. */
export function claimPath(key: string): string {
  return BOARD_CLAIM_PREFIX + key;
}

/** The element without its id. */
export function withoutElementId(element: BoardElement): StoredElement {
  const { id: _id, ...rest } = element;
  return rest as StoredElement;
}

const storedElementCache = new WeakMap<BoardElement, StoredElement>();

/**
 * The stored form of an element (cached per element object). A derived
 * element (a sticker that followed its host for display) stores its
 * persisted twin instead.
 */
export function toStoredElement(element: BoardElement): StoredElement {
  let stored = storedElementCache.get(element);
  if (stored === undefined) storedElementCache.set(element, (stored = withoutElementId(persistedElementOf(element))));
  return stored;
}

/** The meta record. */
export function createBoardMetaRecord(title: string, order: readonly ElementId[], version = 1): BoardMetaRecord {
  return { v: version, title, order: [...order] };
}

/** The inks record of a list of inks. */
export function inksToRecord(inks: readonly BoardInk[]): BoardInksRecord {
  return { colors: Object.fromEntries(inks.map((ink) => [ink.color.slice(1), ink.at])) };
}

const EMPTY_INKS_RECORD: BoardInksRecord = { colors: {} };
const INK_HEX_KEY_PATTERN = /^[0-9a-f]{6}$/;

/** Puts carried (dangling) ids back into an order list after the id they followed. */
export function applyOrderCarry(order: readonly ElementId[], carry: OrderCarry | undefined): ElementId[] {
  const result = [...order];
  if (carry === undefined) return result;
  for (const [id, after] of Object.entries(carry.after)) {
    if (result.includes(id)) continue;
    const index = after === null ? -1 : result.indexOf(after);
    result.splice(after === null ? 0 : index < 0 ? result.length : index + 1, 0, id);
  }
  return result;
}

/** The previous stored value when it equals the new one (keeps object identity). */
function reuseUnchanged(previous: DocumentMap | undefined, path: string, data: DocumentValue): DocumentValue {
  const stored = previous?.get(path);
  return stored !== undefined && (stored === data || canonicalValuesEqual(stored, data)) ? stored : data;
}

/**
 * Splits a board into documents. `previous` is the last known document map
 * (its unchanged values are reused, its timer, inks and claims are kept when
 * the board does not carry them); `carry` puts dangling order ids back.
 */
export function decomposeBoard(board: Board, previous?: DocumentMap, carry?: OrderCarry): Map<string, DocumentValue> {
  const documents = new Map<string, DocumentValue>();
  const order: ElementId[] = [];
  for (const element of board.content.elements) {
    const path = elementPath(element.id);
    if (documents.has(path)) continue;
    order.push(element.id);
    documents.set(path, reuseUnchanged(previous, path, toStoredElement(element) as DocumentValue));
  }
  const version = previous?.get(BOARD_META_PATH)?.v;
  const meta = createBoardMetaRecord(board.title, applyOrderCarry(order, carry), typeof version === 'number' && version > 1 ? version : 1);
  documents.set(BOARD_META_PATH, reuseUnchanged(previous, BOARD_META_PATH, meta as unknown as DocumentValue));
  const timer =
    board.content.timer !== undefined ? reuseUnchanged(previous, BOARD_TIMER_PATH, { ...board.content.timer }) : previous?.get(BOARD_TIMER_PATH);
  if (timer !== undefined) documents.set(BOARD_TIMER_PATH, timer);
  documents.set(
    BOARD_INKS_PATH,
    board.content.inks !== undefined
      ? reuseUnchanged(previous, BOARD_INKS_PATH, inksToRecord(board.content.inks) as unknown as DocumentValue)
      : (previous?.get(BOARD_INKS_PATH) ?? (EMPTY_INKS_RECORD as unknown as DocumentValue)),
  );
  if (board.content.claimed !== undefined) {
    for (const { key, ...area } of board.content.claimed) documents.set(claimPath(key), reuseUnchanged(previous, claimPath(key), area));
  } else {
    for (const [path, value] of previous ?? []) if (path.startsWith(BOARD_CLAIM_PREFIX)) documents.set(path, value);
  }
  return documents;
}

/**
 * Composes documents into a board (not yet normalized: pass the content
 * through `parseBoardContent`). Elements follow `board/meta`'s order;
 * elements the order does not list come last, sorted by id. An image whose
 * source is invalid shows an empty drawing instead of disappearing.
 */
export function composeBoard(documents: DocumentMap): ComposedBoard {
  const meta = documents.get(BOARD_META_PATH);
  const order: ElementId[] = Array.isArray(meta?.order)
    ? meta.order.filter((id: unknown): id is string => typeof id === 'string' && ELEMENT_ID_PATTERN.test(id)).slice(0, MAX_BOARD_ELEMENTS)
    : [];
  const elements = new Map<ElementId, BoardElement>();
  for (const [path, value] of documents) {
    const id = elementIdOfPath(path);
    if (id === undefined) continue;
    const element = (value.type === 'image' && normalizeImageSource(value.src) === undefined ? { ...value, id, src: EMPTY_SVG_DATA_URL } : { ...value, id }) as BoardElement;
    elements.set(id, element);
  }
  const ordered: BoardElement[] = [];
  const seen = new Set<ElementId>();
  const after: Record<ElementId, ElementId | null> = {};
  const dangling: string[] = [];
  order.forEach((id, index) => {
    if (seen.has(id)) return;
    const element = elements.get(id);
    if (element === undefined) {
      after[id] = index === 0 ? null : (order[index - 1] ?? null);
      dangling.push(elementPath(id));
      return;
    }
    seen.add(id);
    ordered.push(element);
  });
  for (const id of [...elements.keys()].sort()) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(elements.get(id)!);
  }
  const timer = documents.get(BOARD_TIMER_PATH) as TimerFields | undefined;
  const colors = documents.get(BOARD_INKS_PATH)?.colors;
  const inks =
    typeof colors === 'object' && colors !== null
      ? Object.entries(colors).flatMap(([hex, at]): BoardInk[] => (INK_HEX_KEY_PATTERN.test(hex) ? [{ color: `#${hex}` as HexColor, at: at as number }] : []))
      : undefined;
  const claimed = [...documents].flatMap(([path, value]): ClaimedArea[] =>
    path.startsWith(BOARD_CLAIM_PREFIX) ? [{ ...value, key: path.slice(BOARD_CLAIM_PREFIX.length) } as ClaimedArea] : [],
  );
  const content: BoardContent = {
    elements: ordered,
    ...(timer !== undefined ? { timer } : {}),
    ...(inks !== undefined ? { inks } : {}),
    claimed,
  };
  return { title: typeof meta?.title === 'string' ? meta.title : '', content, carry: { after }, dangling };
}

/** True for documents that are always replaced whole (never patched). */
export function isReplaceOnlyPath(path: string): boolean {
  return path === BOARD_TIMER_PATH;
}

/**
 * Why a document may not be written, or `undefined` when it may: too many
 * bytes, too deep, or the whole board over the live-sync budget.
 */
export function refuseDocument(path: string, value: unknown, boardBytes: number): string | undefined {
  const bytes = escapedJsonByteLength(value);
  const kb = Math.ceil(bytes / 1024);
  if (bytes > MAX_SYNC_RECORD_BYTES) {
    return path.startsWith(`${ELEMENTS_COLLECTION}/`)
      ? `An element is too large to sync (${kb} KB) — shorten its text or use a smaller image.`
      : `A change is too large to sync (${kb} KB).`;
  }
  if (jsonValueDepth(value) > MAX_SYNC_RECORD_DEPTH) return 'An element is nested too deeply to sync — it may be corrupt.';
  if (boardBytes > MAX_SYNC_BOARD_BYTES) return 'This board is over the 2 MB live-sync budget — remove some inline images or web embeds, or split the board.';
  return undefined;
}

/** The codec as one object, for the sync engine. */
export interface DocumentCodec<T> {
  /** Collections to subscribe to. */
  readonly collections: readonly string[];
  /** The document that holds order and title. */
  readonly metaPath: string;
  decompose(value: T, previous?: DocumentMap, carry?: OrderCarry): Map<string, DocumentValue>;
  compose(documents: DocumentMap): ComposedBoard;
  replaceOnly(path: string): boolean;
  refuse(path: string, value: unknown, boardBytes: number): string | undefined;
}

/** The board codec. */
export const BOARD_RECORD_CODEC: DocumentCodec<Board> = {
  collections: BOARD_COLLECTIONS,
  metaPath: BOARD_META_PATH,
  decompose: decomposeBoard,
  compose: composeBoard,
  replaceOnly: isReplaceOnlyPath,
  refuse: refuseDocument,
};
