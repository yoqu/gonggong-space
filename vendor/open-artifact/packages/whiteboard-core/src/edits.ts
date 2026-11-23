/**
 * Board edits: pure functions from board content to the next content.
 *
 * Every edit returns the same content object when nothing changes, so a
 * caller can skip history steps and saves by identity. Edits keep the other
 * content fields (timer, inks, claims) as they are and only replace
 * `elements`. Copies (duplicate, paste) get fresh ids, lose authorship and
 * locks, carry the arrows whose ends were copied too, keep stickers on their
 * copied hosts and stay within {@link MAX_BOARD_ELEMENTS}.
 */

import { carriedArrowEnds, findStickerHost, gridArrangePositions, type CarriedArrowEnds } from './attachments.ts';
import { normalizeElementOrKeep } from './derived.ts';
import { elementsBounds, rotatedBoundingBox, type Box, type ElementMeasures, type Point } from './geometry.ts';
import { copiedGroupFate, everyArrowEndId, groupBoundsCells, remapCopiedGroups } from './groups.ts';
import { clampElementText } from './image-source.ts';
import { escapedJsonByteLength } from './json.ts';
import { normalizeArtifactAddress } from './links.ts';
import { parseBoardContent, pickAuthorshipFields } from './normalize.ts';
import {
  FACE_STICKER_ART,
  MAX_BOARD_ELEMENTS,
  TEXT_SIZE_STYLES,
  arrowHeadFields,
  copyableElementFields,
  createElementId,
  elementTurn,
  noteColorForAuthor,
  offsetArrowEnd,
  omitAuthorshipFields,
  sameArrowEnd,
  type ArrowBends,
  type ArrowElement,
  type ArrowEnd,
  type ArrowHeadKind,
  type ArrowSide,
  type BoardContent,
  type BoardElement,
  type ElementId,
  type LinkElement,
  type NoteElement,
  type ShapeElement,
  type StickerElement,
  type TableElement,
  type TextElement,
} from './schema.ts';
import { defaultShapeSize } from './shape-paths.ts';
import { TABLE_LIMITS, exceedsTableCellLimit, mergeTableEdit, parseTsvGrid, pinColumnWidths, tableFromGrid } from './table.ts';
import { escapeInlineMarkdown } from './text/inline-markdown.ts';
import { truncateAuthorName } from './text-limits.ts';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Length of an arrow drawn with a click (no drag) of the arrow tool. */
export const DEFAULT_ARROW_LENGTH = 160;

/** Default offset of a duplicate from its original. */
export const DUPLICATE_OFFSET = 24;

/** The message shown when an attached arrow is copied or cut without its ends. */
export function arrowNeedsEndsMessage(verb: string): string {
  return 'To ' + verb + ' an arrow, select what it is attached to as well.';
}

/** The stored size of a table's cells, columns, fills and heat maps (what {@link TABLE_LIMITS}.bytes bounds). */
export function tableContentBytes(table: Pick<TableElement, 'cols' | 'rows' | 'fills' | 'heat'>): number {
  return escapedJsonByteLength({ cols: table.cols, rows: table.rows, ...(table.fills !== undefined ? { fills: table.fills } : {}), ...(table.heat !== undefined ? { heat: table.heat } : {}) });
}

/** A new table (at the origin, header row on, white header) from pasted cell text. */
export function createPastedTable(grid: readonly (readonly string[])[]): TableElement {
  return normalizeElementOrKeep<TableElement>({ type: 'table', id: createElementId(), x: 0, y: 0, ...tableFromGrid(grid), head: true, color: 'white' });
}

/** True when pasted text reads as a table: tab-separated, at least two rows. */
export function isPastedTable(text: string): boolean {
  return (parseTsvGrid(text)?.length ?? 0) >= 2;
}

/* -------------------------------------------------------------------------- */
/* Whole-content edits                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Content as the board would normalize it on load. The same object comes
 * back when it is already normal, and elements normalization left equal keep
 * their objects.
 */
export function normalizeBoardContent(content: BoardContent): BoardContent {
  const normalized = parseBoardContent(content);
  if (JSON.stringify(normalized) === JSON.stringify(content)) return content;
  const previousById = new Map(content.elements.map((element) => [element.id, element]));
  return {
    ...normalized,
    elements: normalized.elements.map((element) => {
      const previous = previousById.get(element.id);
      return previous !== undefined && JSON.stringify(previous) === JSON.stringify(element) ? previous : element;
    }),
  };
}

/** True when adding `adding` elements would go over {@link MAX_BOARD_ELEMENTS}. */
export function wouldExceedElementLimit(content: BoardContent, adding = 1): boolean {
  return content.elements.length + adding > MAX_BOARD_ELEMENTS;
}

/** Adds an element on top (no change when the board is full). */
export function appendElement<T extends BoardContent>(content: T, element: BoardElement): T {
  if (content.elements.length >= MAX_BOARD_ELEMENTS) return content;
  return { ...content, elements: [...content.elements, element] };
}

/** Removes elements, and the arrows attached to any of them. */
export function removeElements<T extends BoardContent>(content: T, removedIds: ReadonlySet<ElementId>): T {
  return {
    ...content,
    elements: content.elements.filter(
      (element) => !removedIds.has(element.id) && (element.type !== 'arrow' || everyArrowEndId(element, (endId) => !removedIds.has(endId))),
    ),
  };
}

/**
 * The element with the position and size of `source` (an earlier version of
 * it): an arrow's ends, a drawing's points and width, a table's column
 * widths, a text's wrap width, or a box's x/y/w/h.
 */
export function takeElementGeometry<T extends BoardElement>(element: T, source: BoardElement): T {
  const el: BoardElement = element;
  if (el.type === 'arrow') return (source.type === 'arrow' ? { ...el, from: source.from, to: source.to } : el) as T;
  if (el.type === 'stroke')
    return (source.type === 'stroke' ? { ...el, x: source.x, y: source.y, points: source.points, width: source.width } : el) as T;
  if (source.type !== el.type || !('x' in source)) return element;
  if (el.type === 'table' && source.type === 'table') return { ...el, cols: mergeTableEdit(source, el, el).cols, x: source.x, y: source.y } as T;
  if (el.type === 'text' && source.type === 'text') {
    const { wrap: _wrap, ...withoutWrap } = el;
    return normalizeElementOrKeep<TextElement>({ ...withoutWrap, x: source.x, y: source.y, ...(source.wrap !== undefined ? { wrap: source.wrap } : {}) }) as T;
  }
  return ('w' in el && 'w' in source ? { ...el, x: source.x, y: source.y, w: source.w, h: source.h } : { ...el, x: source.x, y: source.y }) as T;
}

/** Puts back the geometry the elements `ids` had in `source` (see {@link takeElementGeometry}). */
export function restoreGeometryFrom<T extends BoardContent>(content: T, source: BoardContent, ids: Iterable<ElementId>): T {
  const sourceById = new Map(source.elements.map((element) => [element.id, element]));
  const restoring = new Set(ids);
  return {
    ...content,
    elements: content.elements.map((element) => {
      const saved = restoring.has(element.id) ? sourceById.get(element.id) : undefined;
      return saved ? takeElementGeometry(element, saved) : element;
    }),
  };
}

/** Fields an edit may set on an element (its type and id never change). */
export type ElementPatch = Partial<BoardElement>;

/** Sets fields of one element (type and id stay); the same content when no element has that id. */
export function patchElement<T extends BoardContent>(content: T, id: ElementId, patch: ElementPatch): T {
  let changed = false;
  const elements = content.elements.map((element) => {
    if (element.id !== id) return element;
    changed = true;
    return { ...element, ...patch, type: element.type, id: element.id } as BoardElement;
  });
  return changed ? { ...content, elements } : content;
}

/** Keeps each web embed's saved state from `previous` (undo and remote edits never rewind an embed's own state). */
export function keepEmbedStatesFrom<T extends BoardContent>(content: T, previous: BoardContent): T {
  if (content === previous || !content.elements.some((element) => element.type === 'html')) return content;
  const previousById = new Map(previous.elements.map((element) => [element.id, element]));
  let changed = false;
  const elements = content.elements.map((element): BoardElement => {
    const previousElement = previousById.get(element.id);
    if (element.type !== 'html' || previousElement?.type !== 'html' || previousElement.state === element.state) return element;
    changed = true;
    const { state: _state, ...withoutState } = element;
    return previousElement.state === undefined ? withoutState : { ...withoutState, state: previousElement.state };
  });
  return changed ? { ...content, elements } : content;
}

/**
 * Gives the elements `ids` that have a color the new color. Colors compare
 * by `resolveColor` (for example to a hex value), case-insensitively.
 * Returns `null` when no element changes.
 */
export function recolorElements<T extends BoardContent>(
  content: T,
  ids: Iterable<ElementId>,
  color: string,
  resolveColor: (color: string) => string = (value) => value,
): T | null {
  const idSet = new Set(ids);
  const colorKey = (value: string): string => resolveColor(value).toLowerCase();
  const targetKey = colorKey(color);
  let next = content;
  for (const element of content.elements)
    if (idSet.has(element.id) && 'color' in element && colorKey(element.color) !== targetKey)
      next = patchElement(next, element.id, { color } as ElementPatch);
  return next === content ? null : next;
}

/* -------------------------------------------------------------------------- */
/* Moving                                                                     */
/* -------------------------------------------------------------------------- */

/** Arrow ends to move: the recorded free point of each end. */
export type ArrowEndMoves = { from?: ArrowEnd; to?: ArrowEnd };

/** Moves an arrow's recorded free ends by (dx, dy); the arrow itself when the ends would meet. */
export function offsetArrowEnds(arrow: ArrowElement, ends: ArrowEndMoves, dx: number, dy: number): ArrowElement {
  return mapArrowEnds(arrow, ends, ([x, y]) => [x + dx, y + dy]);
}

/** Maps an arrow's recorded free ends through `mapPoint`; the arrow itself when the ends would meet. */
export function mapArrowEnds(arrow: ArrowElement, ends: ArrowEndMoves, mapPoint: (point: readonly [number, number]) => readonly [number, number]): ArrowElement {
  const map = (end: ArrowEnd): ArrowEnd => (typeof end === 'string' ? end : mapPoint(end));
  const next: ArrowElement = {
    ...arrow,
    ...(ends.from ? { from: map(ends.from) } : {}),
    ...(ends.to ? { to: map(ends.to) } : {}),
  };
  return sameArrowEnd(next.from, next.to) ? arrow : next;
}

/**
 * Moves the elements `ids` by (dx, dy), with the free arrow ends they carry:
 * the free ends of selected arrows and free ends inside the moving section
 * `frames` (unless `accept` refuses one).
 */
export function moveElements<T extends BoardContent>(
  content: T,
  ids: ReadonlySet<ElementId>,
  dx: number,
  dy: number,
  frames: readonly Box[] = [],
  accept?: (arrowId: ElementId, end: 'from' | 'to', box: Box) => boolean,
): T {
  return dx === 0 && dy === 0 ? content : translateElements(content, ids, carriedArrowEnds(content.elements, ids, frames, accept), dx, dy);
}

/** Moves the elements `ids` and the given arrow ends by (dx, dy). */
export function translateElements<T extends BoardContent>(content: T, ids: ReadonlySet<ElementId>, arrowEnds: CarriedArrowEnds, dx: number, dy: number): T {
  return {
    ...content,
    elements: content.elements.map((element): BoardElement => {
      if (element.type !== 'arrow') return ids.has(element.id) ? { ...element, x: element.x + dx, y: element.y + dy } : element;
      const ends = arrowEnds.get(element.id);
      return ends === undefined ? element : offsetArrowEnds(element, ends, dx, dy);
    }),
  };
}

/** {@link moveElements}, with every element id the move touched (moved elements and carried arrows). */
export function moveElementsWithScope<T extends BoardContent>(
  content: T,
  ids: ReadonlySet<ElementId>,
  dx: number,
  dy: number,
  frames: readonly Box[] = [],
): { after: T; scope: Set<ElementId> } {
  return {
    after: moveElements(content, ids, dx, dy, frames),
    scope: new Set([...ids, ...carriedArrowEnds(content.elements, ids, frames).keys()]),
  };
}

/** Moves elements to new top-left positions (arrows keep their ends). */
export function moveElementsTo<T extends BoardContent>(content: T, positions: ReadonlyMap<ElementId, Point>): T {
  return {
    ...content,
    elements: content.elements.map((element): BoardElement => {
      const position = positions.get(element.id);
      return position && element.type !== 'arrow' ? { ...element, x: position.x, y: position.y } : element;
    }),
  };
}

/**
 * Tidies a selection into a grid (see {@link gridArrangePositions}): groups
 * move as units, notes lose their tilt. Returns the new content and the
 * ids the edit touched, or `undefined` when nothing can be arranged.
 */
export function tidyUpSelection<T extends BoardContent>(
  content: T,
  selectedIds: ReadonlySet<ElementId>,
  measures?: ElementMeasures,
): { after: T; scope: Set<ElementId> } | undefined {
  const { cells, moves } = groupBoundsCells(
    content.elements.filter((element) => selectedIds.has(element.id)),
    content.elements,
    measures,
  );
  const positions = gridArrangePositions(cells, content.elements, measures);
  if (positions.size === 0) return undefined;
  const movedByGroups = new Set([...moves.values()].flatMap((move) => [...(move?.ids ?? [])]));
  const loosePositions = new Map([...positions].filter(([id]) => !moves.has(id) && !movedByGroups.has(id)));
  let next = moveElementsTo(content, loosePositions);
  for (const cell of cells) if (cell.type === 'note' && cell.tilt !== 0) next = patchElement(next, cell.id, { tilt: 0 });
  const scope = new Set([...selectedIds, ...loosePositions.keys()]);
  for (const [cellId, move] of moves) {
    const cell = cells.find((candidate) => candidate.id === cellId);
    const target = positions.get(cellId);
    if (cell?.type !== 'shape' || target === undefined || move === undefined) continue;
    next = moveElements(next, move.ids, target.x - cell.x, target.y - cell.y, move.frames);
    for (const movedId of [...move.ids, ...carriedArrowEnds(content.elements, move.ids, move.frames).keys()]) scope.add(movedId);
  }
  return { after: next, scope };
}

/* -------------------------------------------------------------------------- */
/* Arrows                                                                     */
/* -------------------------------------------------------------------------- */

/** An arrow end being set: what it attaches to (an element id or a point) and the side it leaves from. */
export interface ArrowEndChoice {
  end: ArrowEnd;
  side?: ArrowSide;
}

/** Sets one end of an arrow (see {@link setArrowEnds}). */
export function setArrowEnd(arrow: ArrowElement, end: 'from' | 'to', value: ArrowEndChoice): ArrowElement | undefined {
  return setArrowEnds(arrow, { [end]: value });
}

/**
 * Sets an arrow's ends; an end left out keeps its target and side. Returns
 * `undefined` when both ends would be the same.
 */
export function setArrowEnds(arrow: ArrowElement, ends: { from?: ArrowEndChoice; to?: ArrowEndChoice }): ArrowElement | undefined {
  const { fromSide, toSide, ...rest } = arrow;
  const from = ends.from ?? { end: arrow.from, side: fromSide };
  const to = ends.to ?? { end: arrow.to, side: toSide };
  if (sameArrowEnd(from.end, to.end)) return undefined;
  return normalizeArrow({
    ...rest,
    from: from.end,
    to: to.end,
    ...(from.side !== undefined ? { fromSide: from.side } : {}),
    ...(to.side !== undefined ? { toSide: to.side } : {}),
  });
}

/** Sets (or, with `undefined`, clears) an arrow's manual route; the elbow jog goes either way. */
export function setArrowBends(arrow: ArrowElement, bends: ArrowBends | undefined): ArrowElement {
  const { jog: _jog, bends: _bends, ...rest } = arrow;
  return normalizeArrow({ ...rest, ...(bends !== undefined ? { bends } : {}) });
}

/** Sets an arrow's end styles. */
export function setArrowHeads(arrow: ArrowElement, heads: readonly [ArrowHeadKind, ArrowHeadKind]): ArrowElement {
  const { heads: _heads, ...rest } = arrow;
  return normalizeArrow({ ...rest, ...arrowHeadFields(heads) });
}

/** The arrow's fields in their stored order, absent optional fields dropped. */
export function normalizeArrow(arrow: ArrowElement): ArrowElement {
  const { type, id, from, to, fromSide, toSide, jog, bends, head, heads, dash, color, label, locked, groups } = arrow;
  return {
    type,
    id,
    from,
    to,
    ...(fromSide !== undefined ? { fromSide } : {}),
    ...(toSide !== undefined ? { toSide } : {}),
    ...(jog !== undefined ? { jog } : {}),
    ...(bends !== undefined ? { bends } : {}),
    head,
    ...(heads !== undefined ? { heads } : {}),
    dash,
    color,
    ...(label !== undefined ? { label } : {}),
    ...pickAuthorshipFields(arrow as unknown as Record<string, unknown>),
    ...(locked !== undefined ? { locked } : {}),
    ...(groups !== undefined ? { groups } : {}),
  };
}

/** An arrow being drawn: where the pointer went down, the end it started on, and where it was dropped. */
export interface ArrowDraft {
  start: Point;
  from: ArrowEndChoice;
  drop?: ArrowEndChoice | null;
  /** Drawn with the arrow tool (a click without a drag still makes an arrow). */
  byTool?: boolean;
}

/** The ends of a new arrow from a draft, or `undefined` when no arrow results. */
export function newArrowEnds(draft: ArrowDraft): Pick<ArrowElement, 'from' | 'to' | 'fromSide' | 'toSide'> | undefined {
  if (!draft.drop)
    return draft.byTool
      ? { from: [draft.start.x, draft.start.y], to: [draft.start.x + DEFAULT_ARROW_LENGTH, draft.start.y] }
      : undefined;
  if (sameArrowEnd(draft.from.end, draft.drop.end)) return undefined;
  return {
    from: draft.from.end,
    to: draft.drop.end,
    ...(draft.from.side !== undefined ? { fromSide: draft.from.side } : {}),
    ...(draft.drop.side !== undefined ? { toSide: draft.drop.side } : {}),
  };
}

/**
 * A copy of an arrow whose attached ends map through `idMap` (copied
 * elements) and whose free ends move by (dx, dy); `undefined` when an
 * attached end was not copied. `keepState` keeps the lock and groups (a
 * cut-and-paste).
 */
export function copyArrowWithEnds(
  arrow: ArrowElement,
  idMap: ReadonlyMap<ElementId, ElementId>,
  dx: number,
  dy: number,
  keepState = false,
): ArrowElement | undefined {
  if (!everyArrowEndId(arrow, (id) => idMap.has(id))) return undefined;
  const mapEnd = (end: ArrowEnd): ArrowEnd => (typeof end === 'string' ? idMap.get(end)! : offsetArrowEnd(end, dx, dy));
  return { ...(keepState ? omitAuthorshipFields(arrow) : copyableElementFields(arrow)), id: createElementId(), from: mapEnd(arrow.from), to: mapEnd(arrow.to) };
}

/* -------------------------------------------------------------------------- */
/* Copies                                                                     */
/* -------------------------------------------------------------------------- */

/** Who is making a copy or a new element (either part may be unknown). */
export interface EditAuthor {
  id: string | null;
  name: string | null;
}

/** True for a face sticker that names its placer. */
function isFaceSticker(element: BoardElement): element is StickerElement & { authorId: string } {
  return element.type === 'sticker' && element.art === FACE_STICKER_ART && element.authorId !== undefined;
}

/** An author id as stored (at most 128 characters). */
function storedAuthorId(authorId: string): string {
  return [...authorId].slice(0, 128).join('');
}

/**
 * Restamps stickers being pasted or duplicated as the paster's: a face
 * sticker sitting on a host is dropped (a vote is not copied), other
 * stickers take the paster's id (a face sticker with no paster loses its
 * face art).
 */
export function restampPastedStickers(elements: readonly BoardElement[], authorId: string | null, measures?: ElementMeasures): BoardElement[] {
  return elements.flatMap((element): BoardElement[] => {
    if (element.type !== 'sticker') return [element];
    if (isFaceSticker(element) && findStickerHost(element, elements, measures) !== undefined) return [];
    const { authorId: _previousAuthorId, ...withoutAuthor } = element;
    const { art: _art, ...withoutArt } = withoutAuthor;
    return [
      {
        ...(element.art !== FACE_STICKER_ART || (isFaceSticker(element) && authorId !== null) ? withoutAuthor : withoutArt),
        ...(authorId !== null ? { authorId: storedAuthorId(authorId) } : {}),
      },
    ];
  });
}

/** True when the items are exactly what was cut and none of them is back on the board (a move by cut and paste). */
export function isPastingCutItems(items: readonly BoardElement[], cutIds: ReadonlySet<ElementId> | undefined, elements: readonly BoardElement[]): boolean {
  const existingIds = new Set(elements.map((element) => element.id));
  return cutIds !== undefined && items.length === cutIds.size && items.every((item) => cutIds.has(item.id) && !existingIds.has(item.id));
}

/** The items to paste: as they are when pasting what was cut, else restamped (see {@link restampPastedStickers}). */
export function stickersForPaste(
  items: readonly BoardElement[],
  cutIds: ReadonlySet<ElementId> | undefined,
  elements: readonly BoardElement[],
  authorId: string | null,
  measures?: ElementMeasures,
): BoardElement[] {
  return isPastingCutItems(items, cutIds, elements) ? [...items] : restampPastedStickers(items, authorId, measures);
}

/**
 * Re-hosts copied stickers on the copies of their hosts (a sticker whose
 * host was not copied, or only sits on an arrow, loses its host record).
 */
export function reattachCopiedStickers(
  copies: readonly BoardElement[],
  originals: readonly BoardElement[],
  idMap: ReadonlyMap<ElementId, ElementId>,
  measures?: ElementMeasures,
): BoardElement[] {
  const copyById = new Map(copies.map((copy) => [copy.id, copy]));
  const originalByCopy = new Map(originals.map((original) => [idMap.get(original.id), original]));
  return copies.map((copy): BoardElement => {
    if (copy.type !== 'sticker') return copy;
    const { on: _oldHost, ...unhosted } = copy;
    const original = originalByCopy.get(copy.id);
    const host = original === undefined ? undefined : copyById.get(idMap.get(findStickerHost(original, originals, measures)?.id ?? '') ?? '');
    return host === undefined || host.type === 'arrow' ? unhosted : { ...unhosted, on: [host.id, host.x, host.y, copy.x, copy.y] };
  });
}

/** Copies elements with fresh ids, moved by (dx, dy), arrows mapped onto the copies of their ends. */
function copyElements(
  source: readonly BoardElement[],
  dx: number,
  dy: number,
  copyFields: (element: BoardElement) => BoardElement,
): { copies: BoardElement[]; idMap: Map<ElementId, ElementId> } {
  const idMap = new Map<ElementId, ElementId>();
  const copies: BoardElement[] = [];
  for (const element of source) {
    if (element.type === 'arrow') continue;
    const copy = { ...copyFields(element), id: createElementId(), x: element.x + dx, y: element.y + dy } as BoardElement;
    idMap.set(element.id, copy.id);
    copies.push(copy);
  }
  return { copies, idMap };
}

/** Keeps what fits on the board, then drops arrows whose ends did not make it. */
function keepCompleteCopies(copies: readonly BoardElement[], room: number): BoardElement[] {
  const kept = copies.slice(0, Math.max(0, room));
  const keptIds = new Set(kept.map((element) => element.id));
  return kept.filter((element) => element.type !== 'arrow' || everyArrowEndId(element, (id) => keptIds.has(id)));
}

/**
 * Duplicates the selection `offset` down and right. Stickers are restamped
 * as `author`'s; copies inside a group that was copied whole share a new
 * group. Returns the content and the copies' ids (the content itself and no
 * ids when nothing fits).
 */
export function duplicateSelection<T extends BoardContent>(
  content: T,
  selectedIds: ReadonlySet<ElementId>,
  offset = DUPLICATE_OFFSET,
  author: string | null = null,
  measures?: ElementMeasures,
): { content: T; newIds: ElementId[] } {
  const room = MAX_BOARD_ELEMENTS - content.elements.length;
  const source = restampPastedStickers(
    content.elements.filter((element) => selectedIds.has(element.id)),
    author,
    measures,
  );
  const { copies, idMap } = copyElements(source, offset, offset, (element) => copyableElementFields(structuredClone(element)));
  for (const element of source) {
    if (element.type !== 'arrow') continue;
    const copy = copyArrowWithEnds(element, idMap, offset, offset);
    if (copy) copies.push(copy);
  }
  const complete = keepCompleteCopies(reattachCopiedStickers(copies, source, idMap, measures), room);
  const added = remapCopiedGroups(complete, copiedGroupFate(content.elements, selectedIds));
  if (added.length === 0) return { content, newIds: [] };
  return { content: { ...content, elements: [...content.elements, ...added] }, newIds: added.map((element) => element.id) };
}

/**
 * Pastes elements moved by (dx, dy) with fresh ids. `keepState` keeps locks
 * and groups (pasting what was cut); otherwise every copied group becomes a
 * new group. Returns the content and the pasted ids.
 */
export function pasteElements<T extends BoardContent>(
  content: T,
  elements: readonly BoardElement[],
  dx: number,
  dy: number,
  keepState = false,
): { content: T; newIds: ElementId[] } {
  const room = MAX_BOARD_ELEMENTS - content.elements.length;
  const { copies, idMap } = copyElements(elements, dx, dy, (element) => (keepState ? omitAuthorshipFields(element) : copyableElementFields(element)));
  for (const element of elements) {
    if (element.type !== 'arrow') continue;
    const copy = copyArrowWithEnds(element, idMap, dx, dy, keepState);
    if (copy) copies.push(copy);
  }
  const complete = keepCompleteCopies(reattachCopiedStickers(copies, elements, idMap), room);
  const added = remapCopiedGroups(complete, () => 'new');
  if (added.length === 0) return { content, newIds: [] };
  return { content: { ...content, elements: [...content.elements, ...added] }, newIds: added.map((element) => element.id) };
}

/**
 * A new empty note right of `note` (24 apart), in the author's color when
 * the author is known, stamped with the author's name and id.
 */
export function nextNoteBeside(note: NoteElement, author: EditAuthor, tilt: number): NoteElement {
  const { author: _author, authorId: _authorId, turn: _turn, groups: _groups, ink: _ink, ...rest } = copyableElementFields(note);
  const color = author.id !== null ? noteColorForAuthor(author.id) : note.color;
  return {
    ...rest,
    id: createElementId(),
    x: note.x + note.w + 24,
    text: '',
    tilt,
    color,
    ...(author.name !== null ? { author: truncateAuthorName(author.name) } : {}),
    ...(author.id !== null ? { authorId: storedAuthorId(author.id) } : {}),
  };
}

/**
 * A new empty shape of the same kind and style right of `shape` (48 past its
 * rotated bounds), at the kind's default size. The agent's default outline
 * is not carried over.
 */
export function nextShapeBeside(shape: ShapeElement): ShapeElement {
  const { stroke, turn: _turn, groups: _groups, ink: _ink, ...rest } = copyableElementFields(shape);
  const strokeField = stroke !== undefined && !(shape.by === 'agent' && stroke === 'terracotta') ? { stroke } : {};
  const base = { size: 'body' as const, ...rest, ...strokeField };
  const bounds = rotatedBoundingBox(shape, elementTurn(shape));
  return { ...base, ...defaultShapeSize(base.kind), id: createElementId(), x: bounds.x + bounds.w + 48, text: '' };
}

/** A new empty text in the same style below a text whose bottom edge is at `bottom`. */
export function nextTextBelow(text: TextElement, bottom: number): TextElement {
  const { turn: _turn, groups: _groups, ...rest } = copyableElementFields(text);
  return { ...rest, id: createElementId(), y: bottom + TEXT_SIZE_STYLES[text.size].px, text: '' };
}

/* -------------------------------------------------------------------------- */
/* Drawing order                                                              */
/* -------------------------------------------------------------------------- */

/** Brings the elements `ids` to the top, keeping their order. */
export function moveToFront<T extends BoardContent>(content: T, ids: ReadonlySet<ElementId>): T {
  const others = content.elements.filter((element) => !ids.has(element.id));
  const moving = content.elements.filter((element) => ids.has(element.id));
  if (moving.length === 0) return content;
  return { ...content, elements: [...others, ...moving] };
}

/** Sends the elements `ids` to the bottom, keeping their order. */
export function moveToBack<T extends BoardContent>(content: T, ids: ReadonlySet<ElementId>): T {
  const others = content.elements.filter((element) => !ids.has(element.id));
  const moving = content.elements.filter((element) => ids.has(element.id));
  if (moving.length === 0) return content;
  return { ...content, elements: [...moving, ...others] };
}

/** Where {@link reorderElements} puts elements: top, bottom, or just over or under another element. */
export type ReorderTarget = 'front' | 'back' | { over: ElementId } | { under: ElementId };

/** Moves the elements `ids` in the drawing order; the same content when the order does not change. */
export function reorderElements<T extends BoardContent>(content: T, ids: ReadonlySet<ElementId>, target: ReorderTarget): T {
  const unchanged = (elements: readonly BoardElement[]): boolean => elements.every((element, index) => element === content.elements[index]);
  if (target === 'front' || target === 'back') {
    const reordered = target === 'front' ? moveToFront(content, ids) : moveToBack(content, ids);
    return unchanged(reordered.elements) ? content : reordered;
  }
  const anchorId = 'over' in target ? target.over : target.under;
  const others = content.elements.filter((element) => !ids.has(element.id));
  const anchorIndex = others.findIndex((element) => element.id === anchorId);
  if (anchorIndex < 0) return content;
  const insertAt = 'over' in target ? anchorIndex + 1 : anchorIndex;
  const next = [...others.slice(0, insertAt), ...content.elements.filter((element) => ids.has(element.id)), ...others.slice(insertAt)];
  return unchanged(next) ? content : { ...content, elements: next };
}

/**
 * Moves the selection one step forward or backward in the drawing order,
 * past the next element in its layer (sections and other elements are
 * separate layers). Stickers ride with their hosts.
 */
export function stepElementOrder<T extends BoardContent>(
  content: T,
  ids: ReadonlySet<ElementId>,
  direction: 'forward' | 'backward',
  measures?: ElementMeasures,
): T {
  const hostOf = new Map(
    content.elements.flatMap((element): Array<[ElementId, ElementId]> => {
      const hostId = findStickerHost(element, content.elements, measures)?.id;
      return hostId === undefined || (ids.has(element.id) && !ids.has(hostId)) ? [] : [[element.id, hostId]];
    }),
  );
  const withRiders = (test: (id: ElementId) => boolean): BoardElement[] =>
    content.elements.filter((element) => test(element.id) || test(hostOf.get(element.id) ?? ''));
  let next = content;
  for (const containers of [true, false]) {
    const layer = content.elements.filter((element) => (element.type === 'container') === containers && !hostOf.has(element.id));
    const selected = new Set(layer.flatMap((element) => (ids.has(element.id) ? [element.id] : [])));
    const neighbour =
      direction === 'forward'
        ? layer[layer.findLastIndex((element) => selected.has(element.id)) + 1]
        : layer[layer.findIndex((element) => selected.has(element.id)) - 1];
    if (selected.size === 0 || neighbour === undefined) continue;
    const moving = new Set(withRiders((id) => selected.has(id)).map((element) => element.id));
    next = reorderElements(
      next,
      moving,
      direction === 'forward' ? { over: withRiders((id) => id === neighbour.id).at(-1)!.id } : { under: neighbour.id },
    );
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Paste placement                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The offset that centers pasted elements on `center`, stepped down and
 * right (up to 40 times) while a pasted element would land within half a
 * step of an existing one.
 */
export function pastePlacementOffset(
  pasted: readonly BoardElement[],
  existing: readonly BoardElement[],
  center: Point,
  step: number,
  measures?: ElementMeasures,
): { dx: number; dy: number } {
  const box = elementsBounds(pasted, measures);
  if (box === undefined) return { dx: 0, dy: 0 };
  const anchors = (elements: readonly BoardElement[]): Point[] =>
    elements.flatMap((element) =>
      element.type !== 'arrow' ? [{ x: element.x, y: element.y }] : typeof element.from !== 'string' ? [{ x: element.from[0], y: element.from[1] }] : [],
    );
  const pastedPoints = anchors(pasted);
  const existingPoints = anchors(existing);
  let dx = center.x - (box.x + box.w / 2);
  let dy = center.y - (box.y + box.h / 2);
  const overlaps = (): boolean =>
    pastedPoints.some((point) => existingPoints.some((other) => Math.abs(other.x - (point.x + dx)) < step / 2 && Math.abs(other.y - (point.y + dy)) < step / 2));
  for (let tries = 0; tries < 40 && overlaps(); tries++) [dx, dy] = [dx + step, dy + step];
  return { dx, dy };
}

/** A link card for pasted text that is an artifact address, placed like a paste; `undefined` otherwise. */
export function linkCardFromPaste(
  text: string,
  existing: readonly BoardElement[],
  center: Point,
  step: number,
  measures?: ElementMeasures,
): LinkElement | undefined {
  const href = normalizeArtifactAddress(text.trim());
  if (href === undefined) return undefined;
  const card: LinkElement = { type: 'link', id: createElementId(), x: 0, y: 0, href };
  const { dx, dy } = pastePlacementOffset([card], existing, center, step, measures);
  return { ...card, x: Math.round(dx), y: Math.round(dy) };
}


/** Pasted cells with Markdown markers escaped and capped like element text; `cut` when a cell was cut. */
export function trimPastedTableCells(rows: readonly (readonly string[])[]): { lists: string[][]; cut: boolean } {
  const cleaned = rows.map((row) => row.map((cell) => cell.split('\n').map(escapeInlineMarkdown).join('\n')));
  const cells = cleaned.map((row) => row.map(clampElementText));
  return { lists: cells, cut: cells.some((row, rowIndex) => row.some((cell, columnIndex) => cell !== cleaned[rowIndex]?.[columnIndex])) };
}

/**
 * A table for pasted tab-separated text (two or more rows), placed like a
 * paste. `undefined` when the text is not a table; `'cells'` or `'bytes'`
 * when it is over a {@link TABLE_LIMITS} limit; else the table (`el`) and
 * whether a cell was cut.
 */
export function tableFromPaste(
  text: string,
  existing: readonly BoardElement[],
  center: Point,
  step: number,
  measures?: ElementMeasures,
): { el: TableElement; cut: boolean } | 'cells' | 'bytes' | undefined {
  const rows = parseTsvGrid(text);
  if (rows === undefined || !isPastedTable(text)) return undefined;
  if (exceedsTableCellLimit(rows.length, rows[0]?.length ?? 0)) return 'cells';
  const { lists: cells, cut } = trimPastedTableCells(rows);
  const table = createPastedTable(cells);
  if (tableContentBytes(pinColumnWidths(table)) > TABLE_LIMITS.bytes) return 'bytes';
  const { dx, dy } = pastePlacementOffset([table], existing, center, step, measures);
  return { el: { ...table, x: Math.round(dx), y: Math.round(dy) }, cut };
}
