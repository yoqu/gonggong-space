/**
 * Comment anchors: where on the board a comment (or an agent ask) points,
 * stored in the host's comment record as a short CSS-selector-like string,
 * so a comment survives being read by tools that only know selectors.
 *
 * Four kinds of anchor:
 * - `board`: a point on the board (`wp<x><y>:nth-of-type(1)`);
 * - `item`: a point inside an element, as fractions of its box
 *   (`#wb-<id> > wx<fx><fy>:nth-of-type(1)`);
 * - `area`: a dragged rectangle on the board, with the corner its pin sits
 *   on (`wa<x><y>:nth-of-type(1) > wz<w><h><corner>:nth-of-type(1)`);
 * - `item-area`: a rectangle relative to a section that covers it, so it
 *   moves with the section (`#wb-<id> > wo<dx><dy>… > wz…`).
 * An element id that is not a valid CSS id is written as a 12-digit hash
 * (`wi<hash>:nth-of-type(1)`) and found again among the board's ids.
 *
 * Resolving an anchor yields what to select, where to pin, and (for areas)
 * the drawn rectangle and the section part it covers; describing it yields
 * the short context line the agent reads with an ask.
 */

import { elementsWithinBox } from './attachments.ts';
import { containerTitleBounds, elementLayoutBox, geometryHooks, pointInBox, type Box, type ElementMeasures, type Point } from './geometry.ts';
import { elementsInMarquee, topElementAt } from './hit-test.ts';
import { arrowEndIds, elementPlainText, type BoardElement, type ContainerElement, type ElementId } from './schema.ts';

/* -------------------------------------------------------------------------- */
/* Label text                                                                 */
/* -------------------------------------------------------------------------- */

/** Most UTF-8 bytes in a comment's short label. */
export const COMMENT_LABEL_MAX_UTF8_BYTES = 128;

/** Most UTF-8 bytes in a comment's context line. */
export const COMMENT_DETAIL_MAX_UTF8_BYTES = 512;

/** Most characters of element text quoted in a label. */
export const COMMENT_LABEL_MAX_CODEPOINTS = 40;

const labelEncoder = new TextEncoder();

/** The UTF-8 length of a label. */
export function commentLabelByteLength(text: string): number {
  return labelEncoder.encode(text).length;
}

/** Replaces lone surrogate halves with U+FFFD (so the text encodes cleanly). */
export function replaceUnpairedSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, String.fromCharCode(65533));
}

/**
 * Label text: whitespace collapsed, double quotes turned into apostrophes,
 * cut to `maxChars` characters with an ellipsis.
 */
export function normalizeCommentLabelText(text: string | undefined, maxChars = COMMENT_LABEL_MAX_CODEPOINTS): string {
  const chars = Array.from(
    replaceUnpairedSurrogates(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/"/g, '\u2019'),
  );
  return chars.length <= maxChars ? chars.join('') : chars.slice(0, Math.max(0, maxChars - 1)).join('').trimEnd() + '\u2026';
}

/** Cuts a label to at most `maxBytes` UTF-8 bytes, ending with an ellipsis when cut. */
export function truncateCommentLabelToBytes(text: string, maxBytes: number): string {
  if (commentLabelByteLength(text) <= maxBytes) return text;
  const chars = Array.from(text);
  let length = chars.length;
  while (length > 0 && commentLabelByteLength(chars.slice(0, length).join('').trimEnd() + '\u2026') > maxBytes) length--;
  return chars.slice(0, length).join('').trimEnd() + '\u2026';
}

/** ` "text"` for a non-empty text, else nothing. */
export function quoteCommentLabelText(text: string): string {
  return text ? ' "' + text + '"' : '';
}

/** An element's text as one spoken line: markup dropped, list markers kept, whitespace collapsed. */
export function flattenSpokenText(text: string, element?: BoardElement): string {
  return geometryHooks()
    .plainTextWithListPrefixes(text, element)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text quoted for a spoken label (“…”, at most 40 characters), or `undefined` when empty. */
export function quoteSpokenText(text: string, element?: BoardElement): string | undefined {
  const flat = flattenSpokenText(text, element);
  if (flat === '') return undefined;
  const chars = [...flat];
  return '\u201C' + (chars.length > 40 ? chars.slice(0, 37).join('') + '\u2026' : flat) + '\u201D';
}

/* -------------------------------------------------------------------------- */
/* Anchors                                                                    */
/* -------------------------------------------------------------------------- */

/** The box corner a pin sits on: bit 1 = right, bit 2 = bottom. */
export type CommentCorner = 0 | 1 | 2 | 3;

/** The corners in digit order. */
export const COMMENT_CORNERS: readonly CommentCorner[] = [0, 1, 2, 3];

/** The corner for a stored digit. */
export function commentCornerFromDigit(digit: string | undefined): CommentCorner | undefined {
  return COMMENT_CORNERS[Number(digit)];
}

/** Where a comment points (see the module notes). */
export type CommentAnchor =
  | { kind: 'board'; x: number; y: number }
  | { kind: 'item'; id: ElementId; fx: number; fy: number }
  | { kind: 'area'; x: number; y: number; w: number; h: number; corner: CommentCorner }
  | { kind: 'item-area'; id: ElementId; dx: number; dy: number; w: number; h: number; corner: CommentCorner };

/** An area anchor. */
export type CommentAreaAnchor = Extract<CommentAnchor, { kind: 'area' | 'item-area' }>;

const CSS_ID_SELECTOR_PATTERN = /^#[A-Za-z_-][A-Za-z0-9_-]{0,31}$/;
const BOARD_ID_ANCHOR_PATTERN = /^#wb-([A-Za-z0-9_-]{1,29})$/;
const HASHED_ID_ANCHOR_PATTERN = /^wi([0-9a-f]{12}):nth-of-type\(1\)$/;
const ITEM_POINT_ANCHOR_PATTERN = /^wx(\d{4})(\d{4}):nth-of-type\(([1-9][0-9]{0,3})\)$/;
const BOARD_POINT_ANCHOR_PATTERN = /^wp([01]\d{7})([01]\d{7}):nth-of-type\(([1-9][0-9]{0,3})\)$/;
const AREA_ORIGIN_ANCHOR_PATTERN = /^wa([01]\d{7})([01]\d{7}):nth-of-type\(1\)$/;
const AREA_SIZE_ANCHOR_PATTERN = /^wz(\d{7})(\d{7})([0-3]):nth-of-type\(([1-9][0-9]{0,3})\)$/;
const ITEM_OFFSET_ANCHOR_PATTERN = /^wo([01]\d{7})([01]\d{7}):nth-of-type\(1\)$/;

/** A coordinate as 8 digits: a sign digit (1 = negative) and 7 digits, clamped to ±9,999,999. */
export function encodeAnchorCoordinate(value: number): string {
  const clamped = Math.max(-9999999, Math.min(9999999, Math.round(Number.isFinite(value) ? value : 0)));
  return (clamped < 0 ? '1' : '0') + String(Math.abs(clamped)).padStart(7, '0');
}

/** Reads a coordinate written by {@link encodeAnchorCoordinate}. */
export function decodeAnchorCoordinate(digits: string): number {
  return (digits.startsWith('1') ? -1 : 1) * Number(digits.slice(1));
}

function clampUnitFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/** A fraction in [0, 1] as 4 digits (ten-thousandths of 9999). */
export function encodeAnchorFraction(value: number): string {
  return String(Math.min(9999, Math.round(clampUnitFraction(value) * 9999))).padStart(4, '0');
}

/** Reads a fraction written by {@link encodeAnchorFraction}. */
export function decodeAnchorFraction(digits: string): number {
  return Number(digits) / 9999;
}

/** A size as 7 digits, clamped to 1 – 9,999,999. */
export function encodeAnchorSize(value: number): string {
  return String(Math.max(1, Math.min(9999999, Math.round(Number.isFinite(value) ? value : 1)))).padStart(7, '0');
}

/** A 12-hex-digit hash of an element id (53-bit cyrb hash). */
export function hashCommentAnchorId(text: string): string {
  let h1 = -559038737;
  let h2 = 1103547991;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(-12);
}

/** The selector part naming an element: `#wb-<id>`, or a hashed id when that is not a valid selector. */
export function anchorElementSelector(id: ElementId): string {
  const selector = '#wb-' + id;
  return CSS_ID_SELECTOR_PATTERN.test(selector) && BOARD_ID_ANCHOR_PATTERN.test(selector) ? selector : 'wi' + hashCommentAnchorId(id) + ':nth-of-type(1)';
}

/** The stored string for an anchor. */
export function encodeCommentAnchor(anchor: CommentAnchor): string {
  const suffix = ':nth-of-type(' + String(1) + ')';
  if (anchor.kind === 'board') return 'wp' + encodeAnchorCoordinate(anchor.x) + encodeAnchorCoordinate(anchor.y) + suffix;
  if (anchor.kind === 'item') return anchorElementSelector(anchor.id) + ' > wx' + encodeAnchorFraction(anchor.fx) + encodeAnchorFraction(anchor.fy) + suffix;
  return (
    (anchor.kind === 'area'
      ? 'wa' + encodeAnchorCoordinate(anchor.x) + encodeAnchorCoordinate(anchor.y)
      : anchorElementSelector(anchor.id) + ' > wo' + encodeAnchorCoordinate(anchor.dx) + encodeAnchorCoordinate(anchor.dy)) +
    ':nth-of-type(1) > wz' +
    encodeAnchorSize(anchor.w) +
    encodeAnchorSize(anchor.h) +
    String(anchor.corner) +
    suffix
  );
}

/** The board's element ids, searchable by id or by {@link hashCommentAnchorId}. */
export interface AnchorIdLookup {
  has(id: ElementId): boolean;
  byHash(hash: string): ElementId | undefined;
}

/** An {@link AnchorIdLookup} over ids (hashes are computed on first use). */
export function createAnchorIdLookup(ids: Iterable<ElementId>): AnchorIdLookup {
  const idSet = new Set(ids);
  let byHashCache: Map<string, ElementId> | undefined;
  return {
    has: (id) => idSet.has(id),
    byHash: (hash) => {
      if (!byHashCache) {
        byHashCache = new Map();
        for (const id of idSet) byHashCache.set(hashCommentAnchorId(id), id);
      }
      return byHashCache.get(hash);
    },
  };
}

/**
 * Reads a stored anchor. `null` when it is malformed or names an element
 * the board does not have; an element anchor without a readable point
 * points at the element's center.
 */
export function decodeCommentAnchor(anchor: string, ids: AnchorIdLookup): CommentAnchor | null {
  const parts = anchor.split(' > ');
  const head = parts[0] ?? '';
  const boardMatch = parts.length === 1 ? BOARD_POINT_ANCHOR_PATTERN.exec(head) : null;
  if (boardMatch) return Number(boardMatch[3]) === 1 ? { kind: 'board', x: decodeAnchorCoordinate(boardMatch[1]!), y: decodeAnchorCoordinate(boardMatch[2]!) } : null;
  const areaMatch = parts.length === 2 ? AREA_ORIGIN_ANCHOR_PATTERN.exec(head) : null;
  if (areaMatch) {
    const sizeMatch = AREA_SIZE_ANCHOR_PATTERN.exec(parts[1]!);
    const corner = sizeMatch ? commentCornerFromDigit(sizeMatch[3]) : undefined;
    return sizeMatch && corner !== undefined && Number(sizeMatch[4]) === 1
      ? {
          kind: 'area',
          x: decodeAnchorCoordinate(areaMatch[1]!),
          y: decodeAnchorCoordinate(areaMatch[2]!),
          w: Number(sizeMatch[1]),
          h: Number(sizeMatch[2]),
          corner,
        }
      : null;
  }
  const idMatch = BOARD_ID_ANCHOR_PATTERN.exec(head);
  const hashMatch = idMatch ? null : HASHED_ID_ANCHOR_PATTERN.exec(head);
  const id = idMatch ? (ids.has(idMatch[1]!) ? idMatch[1] : undefined) : hashMatch ? ids.byHash(hashMatch[1]!) : undefined;
  if (id === undefined) return null;
  const pointMatch = parts.length === 2 ? ITEM_POINT_ANCHOR_PATTERN.exec(parts[1]!) : null;
  if (pointMatch && Number(pointMatch[3]) === 1) return { kind: 'item', id, fx: decodeAnchorFraction(pointMatch[1]!), fy: decodeAnchorFraction(pointMatch[2]!) };
  const offsetMatch = parts.length === 3 ? ITEM_OFFSET_ANCHOR_PATTERN.exec(parts[1]!) : null;
  const areaSizeMatch = offsetMatch ? AREA_SIZE_ANCHOR_PATTERN.exec(parts[2]!) : null;
  const areaCorner = areaSizeMatch ? commentCornerFromDigit(areaSizeMatch[3]) : undefined;
  if (offsetMatch && areaSizeMatch && areaCorner !== undefined && Number(areaSizeMatch[4]) === 1)
    return {
      kind: 'item-area',
      id,
      dx: decodeAnchorCoordinate(offsetMatch[1]!),
      dy: decodeAnchorCoordinate(offsetMatch[2]!),
      w: Number(areaSizeMatch[1]),
      h: Number(areaSizeMatch[2]),
      corner: areaCorner,
    };
  return { kind: 'item', id, fx: 0.5, fy: 0.5 };
}

/* -------------------------------------------------------------------------- */
/* Boxes and corners                                                          */
/* -------------------------------------------------------------------------- */

/** The box corner nearest a point. */
export function nearestCommentBoxCorner(box: Box, point: Point): CommentCorner {
  const right = point.x > box.x + box.w / 2 ? 1 : 0;
  const bottom = point.y > box.y + box.h / 2 ? 2 : 0;
  return (right + bottom) as CommentCorner;
}

/** A box corner (the center when no corner is given). */
export function commentBoxCornerPoint(box: Box, corner: CommentCorner | null | undefined): Point {
  if (corner == null) return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return { x: corner & 1 ? box.x + box.w : box.x, y: corner & 2 ? box.y + box.h : box.y };
}

/** The point an anchor's pin sits on in a box (see {@link commentBoxCornerPoint}). */
export const anchorCornerPoint = commentBoxCornerPoint;

/** A part of a box, as fractions of its width and height. */
export interface CommentBoxPart {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Names the part of a box an area covers (`left edge`, `top half`, `top
 * left`, `middle`, `part`…); empty when it covers 85% or more.
 */
export function describeCommentBoxPart(part: CommentBoxPart, coverage: number): string {
  if (coverage >= 0.85) return '';
  if (part.x1 <= 0.15) return 'left edge';
  if (part.x0 >= 0.85) return 'right edge';
  if (part.y1 <= 0.15) return 'top edge';
  if (part.y0 >= 0.85) return 'bottom edge';
  const midY = (part.y0 + part.y1) / 2;
  const midX = (part.x0 + part.x1) / 2;
  const vertical =
    part.y1 <= 0.55 && midY <= 0.35 ? 'top' : part.y0 >= 0.45 && midY >= 0.65 ? 'bottom' : part.y1 - part.y0 <= 0.5 ? 'middle' : '';
  const horizontal =
    part.x1 <= 0.55 && midX <= 0.35 ? 'left' : part.x0 >= 0.45 && midX >= 0.65 ? 'right' : part.x1 - part.x0 <= 0.5 ? 'centre' : '';
  const label = [vertical, horizontal].filter(Boolean).join(' ');
  if (label === 'top' || label === 'bottom') return label + ' half';
  return label === 'left' || label === 'right' ? label + ' side' : label || 'part';
}

/** The element itself, unless it is a section whose bottom is above `y` (a pin below it is not on it). */
export function sectionUnlessBelow<T extends BoardElement>(element: T | undefined, y: number): T | undefined {
  return element?.type === 'container' && y > element.y + element.h ? undefined : element;
}

/** A live-or-stale token for async comment work. */
export interface CommentOperation {
  /** False once a later operation began or the work was cancelled. */
  readonly live: boolean;
}

/** Tokens that let only the latest async comment operation finish. */
export interface CommentOperationToken {
  begin(): CommentOperation;
  cancel(): void;
}

/** A {@link CommentOperationToken}. */
export function createCommentOperationToken(): CommentOperationToken {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      const mine = generation;
      return {
        get live() {
          return generation === mine;
        },
      };
    },
    cancel() {
      generation += 1;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Areas                                                                      */
/* -------------------------------------------------------------------------- */

/** A section an area falls on: an area at least this share inside a section is about that section. */
export const FRAME_COVER_MIN_RATIO = 0.5;

/** A section less than this share covered (without its title or contents) is not part of the area. */
export const SECTION_PART_MAX_RATIO = 0.5;

/** The section an area is about, with its corner and the part covered. */
export interface CommentAreaFrame {
  el: ContainerElement;
  at: Point;
  part: string;
}

/** What an area covers: the section it is about (if any) and the elements in it. */
export interface CommentAreaCover {
  frame: CommentAreaFrame | null;
  items: BoardElement[];
}

/**
 * What a dragged area covers. Elements touched by the area count, except a
 * section only grazed (less than half covered, its title outside, none of
 * its contents inside) and arrows attached to the loose elements. When the
 * area lies mostly within the smallest section holding everything it
 * covers, that section is the area's frame.
 */
export function commentAreaCover(rect: Box, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): CommentAreaCover {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const insideIds = new Set(elementsInMarquee(elements, rect, measures, byId, zoom));
  const inside = elements.filter((element) => insideIds.has(element.id) && element.type !== 'arrow');
  const frames = elements.flatMap((element) => {
    const box = element.type === 'container' ? elementLayoutBox(element, measures) : undefined;
    if (element.type !== 'container' || !box || !(box.w > 0 && box.h > 0)) return [];
    const overlapW = Math.max(0, Math.min(rect.x + rect.w, box.x + box.w) - Math.max(rect.x, box.x));
    const overlapH = Math.max(0, Math.min(rect.y + rect.h, box.y + box.h) - Math.max(rect.y, box.y));
    const titleBox = containerTitleBounds(element, measures, zoom);
    const titled =
      titleBox !== undefined &&
      Math.abs(titleBox.x + titleBox.w / 2 - (rect.x + rect.w / 2)) <= rect.w / 2 &&
      Math.abs(titleBox.y + titleBox.h / 2 - (rect.y + rect.h / 2)) <= rect.h / 2;
    return [{ el: element, b: box, w: overlapW, h: overlapH, titled, carried: new Set(elementsWithinBox(box, elements, measures, element.id)) }];
  });
  const partialFrames = new Set(
    frames
      .filter((frame) => !frame.titled && frame.w * frame.h < SECTION_PART_MAX_RATIO * frame.b.w * frame.b.h && !inside.some((element) => frame.carried.has(element.id)))
      .map((frame) => frame.el.id),
  );
  const looseIds = new Set(inside.filter((element) => !partialFrames.has(element.id)).map((element) => element.id));
  const keptIds = new Set(
    elementsInMarquee(
      elements.filter((element) => !partialFrames.has(element.id)),
      rect,
      measures,
      byId,
      zoom,
    ),
  );
  const items = elements.filter(
    (element) => keptIds.has(element.id) && !(element.type === 'arrow' && arrowEndIds(element).some((id) => looseIds.has(id))),
  );
  const frame = frames
    .filter(
      (candidate) =>
        candidate.w * candidate.h > FRAME_COVER_MIN_RATIO * rect.w * rect.h &&
        items.every((element) => element.id === candidate.el.id || element.type === 'arrow' || candidate.carried.has(element.id)),
    )
    .sort((a, b) => a.b.w * a.b.h - b.b.w * b.b.h)[0];
  if (!frame) return { frame: null, items };
  const { el: frameElement, b: frameBox, w: overlapW, h: overlapH } = frame;
  const fx = (Math.max(rect.x, frameBox.x) - frameBox.x) / frameBox.w;
  const fy = (Math.max(rect.y, frameBox.y) - frameBox.y) / frameBox.h;
  const part = describeCommentBoxPart({ x0: fx, y0: fy, x1: fx + overlapW / frameBox.w, y1: fy + overlapH / frameBox.h }, (overlapW * overlapH) / (frameBox.w * frameBox.h));
  return {
    frame: { el: frameElement, at: { x: frameBox.x, y: frameBox.y }, part },
    items: items.filter((element) => element.id !== frameElement.id),
  };
}

/** The anchor for a dragged area: relative to its section when it has one, else on the board. */
export function areaAnchorFor(rect: Box, corner: CommentCorner, cover: CommentAreaCover): CommentAreaAnchor {
  const frame = cover.frame;
  return frame
    ? { kind: 'item-area', id: frame.el.id, dx: rect.x - frame.at.x, dy: rect.y - frame.at.y, w: rect.w, h: rect.h, corner }
    : { kind: 'area', x: rect.x, y: rect.y, w: rect.w, h: rect.h, corner };
}

/** The board rectangle of an area anchor, or `null` when its section is gone. */
export function anchorAreaRect(
  anchor: CommentAreaAnchor,
  elementById: (id: ElementId) => BoardElement | undefined,
  measures?: ElementMeasures,
): Box | null {
  if (anchor.kind === 'area') return { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
  const element = elementById(anchor.id);
  const box = element && element.type !== 'arrow' ? elementLayoutBox(element, measures) : undefined;
  return box ? { x: box.x + anchor.dx, y: box.y + anchor.dy, w: anchor.w, h: anchor.h } : null;
}

/** A screen rectangle (as `getBoundingClientRect` gives). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A section's screen rectangle cut to its declared height (a section drawn
 * taller to fit its contents anchors comments to its declared area).
 */
export function sectionAnchorRect<R extends ScreenRect>(rect: R, element: BoardElement | undefined, measures?: ElementMeasures): R | ScreenRect {
  return element?.type === 'container'
    ? { left: rect.left, top: rect.top, width: rect.width, height: (rect.height * element.h) / (elementLayoutBox(element, measures)?.h ?? element.h) }
    : rect;
}

/**
 * A comment's short label for an area: `Section, “title” (part) · 3 items`,
 * or `fallback` when the area is not about a section; capped at
 * {@link COMMENT_LABEL_MAX_UTF8_BYTES}.
 */
export function areaCommentLabel(cover: CommentAreaCover, fallback: string): string {
  const count = cover.items.length;
  const suffix = (cover.frame?.part ? ' (' + cover.frame.part + ')' : '') + (count === 0 ? '' : ' \u00B7 ' + String(count) + (count === 1 ? ' item' : ' items'));
  const title = cover.frame ? quoteSpokenText(cover.frame.el.text, cover.frame.el) : undefined;
  const label = cover.frame ? 'Section' + (title !== undefined ? ', ' + title : '') : fallback;
  return truncateCommentLabelToBytes(replaceUnpairedSurrogates(label), COMMENT_LABEL_MAX_UTF8_BYTES - commentLabelByteLength(suffix)) + suffix;
}

/* -------------------------------------------------------------------------- */
/* Resolving                                                                  */
/* -------------------------------------------------------------------------- */

/** What an anchor resolves to on the board now. */
export interface CommentTarget {
  /** Elements to select. */
  selected: ElementId[];
  /** Where to pin the comment: a point, or an area. */
  pin?: Point | Box;
  /** The area to draw, with the section it is about. */
  drawn?: { rect: Box; frame: CommentAreaFrame | null };
}

/** The target for a board point: the element under it (sections aside) and a pin at the point. */
export function boardPointTarget(x: number, y: number, elements: readonly BoardElement[], measures?: ElementMeasures): CommentTarget {
  const candidates = elements.filter((element) => element.type !== 'container');
  const hit = topElementAt(candidates, x, y, undefined, measures, new Map(elements.map((element) => [element.id, element])));
  return { selected: hit === undefined ? [] : [hit.id], pin: { x, y } };
}

function resolveAreaAnchor(
  anchor: CommentAreaAnchor,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
  zoom?: number,
): { r: Box; cover: CommentAreaCover } | undefined {
  const rect = anchorAreaRect(anchor, (id) => elements.find((element) => element.id === id), measures);
  return rect === null ? undefined : { r: rect, cover: commentAreaCover(rect, elements, measures, zoom) };
}

/** What a stored area anchor covers now, or `undefined` when it is not a live area anchor. */
export function areaAnchorCover(anchor: string, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): CommentAreaCover | undefined {
  const decoded = decodeCommentAnchor(anchor, createAnchorIdLookup(elements.map((element) => element.id)));
  return decoded !== null && (decoded.kind === 'area' || decoded.kind === 'item-area') ? resolveAreaAnchor(decoded, elements, measures, zoom)?.cover : undefined;
}

/**
 * What a stored anchor points at now. A `null` anchor (a comment on the
 * whole board) selects nothing; an unreadable or orphaned anchor gives
 * `undefined`. An area selects what it covers (or its section, pinned when
 * the area does not cover the whole section).
 */
export function resolveCommentAnchor(anchor: string | null, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): CommentTarget | undefined {
  if (anchor === null) return { selected: [] };
  const decoded = decodeCommentAnchor(anchor, createAnchorIdLookup(elements.map((element) => element.id)));
  if (decoded === null) return undefined;
  if (decoded.kind === 'board') return boardPointTarget(decoded.x, decoded.y, elements, measures);
  if (decoded.kind === 'item') return { selected: [decoded.id] };
  const resolved = resolveAreaAnchor(decoded, elements, measures, zoom);
  if (resolved === undefined) return undefined;
  const { r: rect, cover } = resolved;
  if (rect.w < 1 || rect.h < 1) return boardPointTarget(rect.x, rect.y, elements, measures);
  const drawn = { rect, frame: cover.frame };
  if (cover.items.length > 0) return { selected: cover.items.map((element) => element.id), drawn };
  const frame = cover.frame?.el;
  if (frame === undefined) return { selected: [], pin: rect, drawn };
  const covered = pointInBox(rect, frame.x, frame.y) && pointInBox(rect, frame.x + frame.w, frame.y + frame.h);
  return { selected: [frame.id], ...(covered ? {} : { pin: rect }), drawn };
}

/** The area an anchor draws now, if it is an area anchor. */
export function anchorDrawnRect(anchor: string | null, elements: readonly BoardElement[], measures?: ElementMeasures, zoom?: number): Box | undefined {
  return resolveCommentAnchor(anchor, elements, measures, zoom)?.drawn?.rect;
}

/** Where a view should go: an explicit selection and pin, or a stored anchor (resolved at `zoom`). */
export type CommentViewRequest = { selection: Iterable<ElementId>; pin?: Point | Box } | { anchor: string | null; zoom?: number };

/** A view to show: what to select and pin, and the viewport to restore. */
export interface CommentViewTarget<V> {
  selected: ElementId[];
  pin?: Point | Box;
  viewport: V;
}

/** The view to show for a comment, or `undefined` when its anchor no longer resolves. */
export function commentViewTarget<V>(
  elements: readonly BoardElement[],
  target: CommentViewRequest,
  viewport: V,
  measures?: ElementMeasures,
): CommentViewTarget<V> | undefined {
  if (!('anchor' in target)) return { selected: [...target.selection], ...(target.pin !== undefined ? { pin: target.pin } : {}), viewport };
  const resolved = resolveCommentAnchor(target.anchor, elements, measures, target.zoom);
  return resolved && { selected: resolved.selected, ...(resolved.pin !== undefined ? { pin: resolved.pin } : {}), viewport };
}

/* -------------------------------------------------------------------------- */
/* Describing                                                                 */
/* -------------------------------------------------------------------------- */

/** Rounds a point or rectangle to whole units. */
export function roundAnchorRect(rect: Point | Box): Point | Box {
  return { x: Math.round(rect.x), y: Math.round(rect.y), ...('w' in rect ? { w: Math.round(rect.w), h: Math.round(rect.h) } : {}) };
}

/** `x,y` or `x,y, w×h`. */
export function formatAnchorRect(rect: Point | Box): string {
  const rounded = roundAnchorRect(rect);
  return String(rounded.x) + ',' + String(rounded.y) + ('w' in rounded ? ', ' + String(rounded.w) + '\u00D7' + String(rounded.h) : '');
}

/** `elements/<id> <type> "text"`, with the text cut to `budget` characters (no text when `null`). */
export function elementAnchorLabel(element: BoardElement, budget: number | null): string {
  return (
    'elements/' +
    element.id +
    ' ' +
    element.type +
    (budget === null ? '' : quoteCommentLabelText(normalizeCommentLabelText(flattenSpokenText(elementPlainText(element), element), budget)))
  );
}

/** Text budgets tried in turn: [characters of text per element (`null` = none), elements named]. */
export const ANCHOR_DETAIL_BUDGETS: ReadonlyArray<readonly [number | null, number]> = [
  [COMMENT_LABEL_MAX_CODEPOINTS, 8],
  [16, 8],
  [null, 8],
  [null, 4],
  [null, 2],
  [null, 0],
];

/** Note added when an ask was spoken rather than typed. */
export const SPOKEN_ASK_NOTE = 'the ask was spoken: heard by the board\u2019s microphone, so it may be misheard or another person\u2019s words';

/** Note added when an ask was typed in the board's chat box. */
export const CHAT_BOX_ASK_NOTE = 'typed in the chat box on the board';

/** Note added with {@link CHAT_BOX_ASK_NOTE}. */
export const LOOKING_AT_BOARD_NOTE = 'while looking at the board';

/**
 * The context line the agent reads with an ask or comment:
 * `selected: elements/a note "…", …; area: x,y, w×h in elements/s container
 * "…" (top half)`, within {@link COMMENT_DETAIL_MAX_UTF8_BYTES}. `picked`
 * (what was selected when asking) replaces what the anchor covers;
 * `spoken` and `chatBox` add how the ask was made; `brief` names elements
 * without their text. Empty when the anchor does not resolve.
 */
export function describeAnchorForAgent(
  anchor: string | null,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
  zoom?: number,
  picked?: ReadonlySet<ElementId>,
  spoken = false,
  chatBox = false,
  brief = spoken,
): string {
  const resolved = resolveCommentAnchor(anchor, elements, measures, zoom);
  if (resolved === undefined) return '';
  const pickedIds = picked === undefined ? undefined : elements.filter((element) => picked.has(element.id)).map((element) => element.id);
  const point = resolved.drawn === undefined && resolved.pin !== undefined && !('w' in resolved.pin) ? resolved.pin : undefined;
  if (point !== undefined && picked?.size === 0 && !spoken) return 'selected: nothing; ' + CHAT_BOX_ASK_NOTE + ', with nothing picked, ' + LOOKING_AT_BOARD_NOTE;
  const target: CommentTarget =
    pickedIds === undefined
      ? resolved
      : resolved.drawn !== undefined
        ? { selected: pickedIds, ...(pickedIds.length === 0 ? { pin: resolved.drawn.rect } : {}), drawn: { rect: resolved.drawn.rect, frame: null } }
        : point !== undefined
          ? { selected: pickedIds, pin: point }
          : resolved;
  const selected = elements.filter((element) => target.selected.includes(element.id));
  const format = (names: readonly string[], budget: number | null): string => {
    const frame = target.drawn?.frame;
    const frameNote = !frame
      ? ''
      : (target.selected.includes(frame.el.id) ? '' : ' in ' + elementAnchorLabel(frame.el, budget)) + ' (' + (frame.part || 'whole') + ')';
    const place = target.drawn
      ? [(target.pin ? 'pin: ' : 'area: ') + formatAnchorRect(target.drawn.rect) + frameNote]
      : target.pin
        ? [spoken ? SPOKEN_ASK_NOTE : 'pin: ' + formatAnchorRect(target.pin)]
        : [];
    return replaceUnpairedSurrogates(
      ['selected: ' + (names.join(', ') || 'nothing'), ...place, ...(chatBox ? [CHAT_BOX_ASK_NOTE + ', ' + LOOKING_AT_BOARD_NOTE] : [])].join('; '),
    );
  };
  const overflow = (shown: number): string[] => (shown < selected.length ? ['+' + String(selected.length - shown) + ' more'] : []);
  for (const [level, limit] of brief ? ANCHOR_DETAIL_BUDGETS.filter(([chars]) => chars === null) : ANCHOR_DETAIL_BUDGETS) {
    const fits = (names: readonly string[]): boolean => commentLabelByteLength(format([...names, ...overflow(names.length)], level)) <= COMMENT_DETAIL_MAX_UTF8_BYTES;
    let names = selected.slice(0, limit).map((element) => elementAnchorLabel(element, level));
    if (!fits(names)) continue;
    let shortened = false;
    for (const element of selected.slice(names.length)) {
      const label: string | undefined = [...(shortened ? [] : [elementAnchorLabel(element, level)]), elementAnchorLabel(element, null)].find((candidate) => fits([...names, candidate]));
      if (label === undefined) break;
      shortened ||= label !== elementAnchorLabel(element, level);
      names = [...names, label];
    }
    return format([...names, ...overflow(names.length)], level);
  }
  return truncateCommentLabelToBytes(format(overflow(0), null), COMMENT_DETAIL_MAX_UTF8_BYTES);
}
