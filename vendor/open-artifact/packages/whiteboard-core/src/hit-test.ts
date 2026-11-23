/**
 * Hit testing: which element is under a point, which elements a marquee
 * selects, and the text boxes inside shapes and notes that clicks and
 * marquees must respect.
 *
 * Rules worth knowing:
 * - A rotated element is tested in its own frame (the point is turned back).
 * - A section (container) is hit on its title or along its edges only, so
 *   clicks inside it reach the board (or its children).
 * - A hollow shape is hit near its outline or on its text, not in the middle.
 * - An arrow is hit near its line, except where the line crosses a text
 *   element (the text wins there, but not near the arrow's heads), or on its
 *   label.
 *
 * The tests run in WebAssembly (`crates/open-artifact-wb-geom/src/hit_test.rs`). Each
 * element becomes a record of numbers resolved here (layout box, arrow
 * line and label, crossed text, section titles, hollow shape text), cached
 * per element and context, so a point or marquee is tested against the
 * whole list in one call.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { kindCode } from './geom-codec.ts';
import {
  arrowPolyline,
  containerTitleBounds,
  containerTitleTextBounds,
  elementLayoutBox,
  geometryHooks,
  measuredArrowGeometry,
  measuredArrowLabelBox,
  noteAuthorBottomPadding,
  type Box,
  type GeometryHooks,
  type ElementMeasures,
  type ElementsById,
} from './geometry.ts';
import {
  FACE_STICKER_ART,
  TEXT_SIZE_STYLES,
  arrowEndIds,
  arrowHeads,
  elementTurn,
  type ArrowElement,
  type BoardElement,
  type ElementId,
  type NoteElement,
  type ShapeElement,
  type TextAlign,
  type TextElement,
} from './schema.ts';
import type { ArrowGeometry } from './arrows/layout.ts';
import { shapeTextInsets } from './shape-paths.ts';
import { PLACEHOLDER_HIT_MIN_PX, showsTextPlaceholder } from './text/placeholder.ts';

/** How far (in board units) a pointer may miss: 16 screen px for touch, 6 for a mouse. */
export function hitSlop(pointerType: string, zoom: number): number {
  return (pointerType === 'touch' ? 16 : 6) / zoom;
}

/** Squared distance from a point to a segment. */
export function distanceToSegmentSq(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  return wbGeom().distance_to_segment_sq(px, py, x1, y1, x2, y2);
}

function encodeBox(box: Box): Float64Array {
  return Float64Array.of(box.x, box.y, box.w, box.h);
}

/** True when a segment touches a box (Liang–Barsky clipping). */
export function segmentIntersectsBox(x1: number, y1: number, x2: number, y2: number, box: Box): boolean {
  return wbGeom().segment_intersects_box(x1, y1, x2, y2, encodeBox(box));
}

/** Horizontal position of aligned text within its box, as a fraction. */
export const TEXT_ALIGN_FRACTION: Readonly<Record<TextAlign, number>> = { left: 0, center: 0.5, right: 1 };

/** A text box with a little room around it (where arrows stop short of text). */
export function padTextBox(box: Box): Box {
  return { x: box.x - 4, y: box.y - 2, w: box.w + 8, h: box.h + 4 };
}

/** Elements by id, built when the caller did not pass one. */
function byIdOf(elements: readonly BoardElement[], byId?: ElementsById): ElementsById {
  return byId ?? new Map(elements.map((element) => [element.id, element]));
}

/* -------------------------------------------------------------------------- */
/* Hit records                                                                */
/* -------------------------------------------------------------------------- */

/** Record body codes (see `crates/open-artifact-wb-geom/src/wasm/hit_test.rs`). */
const BODY_OTHER = 0;
const BODY_NO_LINE = 1;
const BODY_ARROW = 2;
const BODY_STICKER = 3;
const BODY_BOX = 4;
const BODY_CONTAINER = 5;
const BODY_SHAPE = 6;
const BODY_STROKE = 7;

function pushBox(out: number[], box: Box | undefined): void {
  if (box === undefined) out.push(0, 0, 0, 0, 0);
  else out.push(1, box.x, box.y, box.w, box.h);
}

/**
 * The box a press hits: the layout box, made at least
 * {@link PLACEHOLDER_HIT_MIN_PX} tall on screen (about its middle) for a
 * text showing its placeholder.
 */
function hitLayoutBox(element: BoardElement, measures: ElementMeasures | undefined, zoom: number | undefined): Box | undefined {
  const box = elementLayoutBox(element, measures);
  if (box === undefined || !showsTextPlaceholder(element)) return box;
  const least = PLACEHOLDER_HIT_MIN_PX / (zoom !== undefined && zoom > 0 ? zoom : 1);
  return box.h >= least ? box : { ...box, y: box.y - (least - box.h) / 2, h: least };
}

/** The record of an element: what testing a point against it needs. */
function buildHitRecord(element: BoardElement, measures: ElementMeasures | undefined, byId: ElementsById | undefined, zoom: number | undefined): Float64Array {
  const out: number[] = [0, BODY_OTHER, elementTurn(element)];
  pushBox(out, hitLayoutBox(element, measures, zoom));
  switch (element.type) {
    case 'arrow': {
      const line = byId === undefined ? undefined : measuredArrowGeometry(element, byId, measures);
      if (byId === undefined || line === undefined) {
        out[1] = BODY_NO_LINE;
        break;
      }
      const heads = arrowHeads(element);
      const polyline = arrowPolyline(line, heads);
      const crossed = textBoxesCrossedByArrow(element, line, byId, measures);
      out[1] = BODY_ARROW;
      out.push(line.x1, line.y1, line.x2, line.y2, heads[0] !== 'none' ? 1 : 0, heads[1] !== 'none' ? 1 : 0);
      pushBox(out, measuredArrowLabelBox(element, line, byId, measures));
      out.push(crossed.length, polyline.length);
      for (const box of crossed) out.push(box.x, box.y, box.w, box.h);
      for (const value of polyline) out.push(value);
      break;
    }
    case 'sticker':
      out[1] = BODY_STICKER;
      out.push(element.x, element.y, element.w, element.h, element.art === FACE_STICKER_ART && element.authorId !== undefined ? 1 : 0);
      break;
    case 'image':
    case 'html':
    case 'timer':
    case 'link':
    case 'note':
    case 'text':
    case 'table':
      out[1] = BODY_BOX;
      break;
    case 'container':
      out[1] = BODY_CONTAINER;
      pushBox(out, containerTitleBounds(element, measures, zoom));
      pushBox(out, containerTitleTextBounds(element, measures, zoom));
      break;
    case 'shape':
      out[1] = BODY_SHAPE;
      out.push(element.x, element.y, element.w, element.h, kindCode(element.kind), element.hollow === true ? 1 : 0, element.kind === 'ellipse' ? 1 : 0);
      pushBox(out, element.hollow === true ? shapeTextBox(element) : undefined);
      break;
    case 'stroke':
      out[1] = BODY_STROKE;
      out.push(element.x, element.y, element.width, element.points.length);
      for (const value of element.points) out.push(value);
      break;
  }
  out[0] = out.length;
  return Float64Array.from(out);
}

interface CachedHitRecord {
  measures: ElementMeasures | undefined;
  byId: ElementsById | undefined;
  zoom: number | undefined;
  hooks: GeometryHooks | undefined;
  record: Float64Array;
}

/** Records per element (elements and measures maps are replaced, never edited). */
const hitRecordCache = new WeakMap<BoardElement, CachedHitRecord>();

/** {@link buildHitRecord}, cached: only what the element's kind depends on is compared. */
function hitRecord(element: BoardElement, measures: ElementMeasures | undefined, byId: ElementsById | undefined, zoom: number | undefined): Float64Array {
  const key = {
    measures,
    byId: element.type === 'arrow' ? byId : undefined,
    zoom: element.type === 'container' || showsTextPlaceholder(element) ? zoom : undefined,
    hooks: element.type === 'shape' ? geometryHooks() : undefined,
  };
  const cached = hitRecordCache.get(element);
  if (cached && cached.measures === key.measures && cached.byId === key.byId && Object.is(cached.zoom, key.zoom) && cached.hooks === key.hooks) return cached.record;
  const record = buildHitRecord(element, measures, byId, zoom);
  hitRecordCache.set(element, { ...key, record });
  return record;
}

/** The records of a list of elements, back to back. */
function hitRecords(elements: readonly BoardElement[], measures: ElementMeasures | undefined, byId: ElementsById | undefined, zoom: number | undefined): Float64Array {
  const records = elements.map((element) => hitRecord(element, measures, byId, zoom));
  let length = 0;
  for (const record of records) length += record.length;
  const out = new Float64Array(length);
  let at = 0;
  for (const record of records) {
    out.set(record, at);
    at += record.length;
  }
  return out;
}

/**
 * True when the point hits the element (see the module notes). `byId` is
 * needed to hit arrows; `zoom` places section titles as the view draws them.
 */
export function hitTestElement(
  element: BoardElement,
  x: number,
  y: number,
  tolerance = 4,
  measures?: ElementMeasures,
  byId?: ElementsById,
  zoom?: number,
): boolean {
  const hit = wbGeom().hit_test_element(hitRecord(element, measures, byId, zoom), x, y, tolerance);
  // An unknown element type is neither hit nor missed.
  return hit === -1 ? (undefined as unknown as boolean) : hit === 1;
}

/* -------------------------------------------------------------------------- */
/* Text boxes                                                                 */
/* -------------------------------------------------------------------------- */

interface TextBoxEntry {
  id: ElementId;
  box: Box;
}

const boardTextBoxesCache = new WeakMap<ElementsById, { measures: ElementMeasures | undefined; words: TextBoxEntry[] }>();

/** Boxes of the unrotated, non-empty text elements on the board (cached per map). */
export function boardTextBoxes(byId: ElementsById, measures?: ElementMeasures): TextBoxEntry[] {
  const cached = boardTextBoxesCache.get(byId);
  if (cached && cached.measures === measures) return cached.words;
  const words = [...byId.values()].flatMap((element) =>
    element.type === 'text' && element.text.trim() !== '' && elementTurn(element) === 0 ? [{ id: element.id, box: elementLayoutBox(element, measures)! }] : [],
  );
  boardTextBoxesCache.set(byId, { measures, words });
  return words;
}

/**
 * Text elements an arrow's line passes through (not counting text the
 * arrow starts or ends in, or text that holds the whole arrow). The arrow is
 * drawn with gaps there so the text stays readable.
 */
export function textBoxesCrossedByArrow(arrow: ArrowElement, line: ArrowGeometry, byId: ElementsById, measures?: ElementMeasures): Box[] {
  const texts = boardTextBoxes(byId, measures);
  if (texts.length === 0) return [];
  const values = new Float64Array(texts.length * 6);
  texts.forEach(({ id, box }, index) =>
    values.set([box.x, box.y, box.w, box.h, typeof arrow.from !== 'string' || arrow.from === id ? 1 : 0, typeof arrow.to !== 'string' || arrow.to === id ? 1 : 0], index * 6),
  );
  const elbow = line.elbow ?? [];
  const elbowValues = new Float64Array(elbow.length * 2);
  elbow.forEach((point, index) => elbowValues.set([point[0], point[1]], index * 2));
  const crossed = wbGeom().text_boxes_crossed_by_arrow(
    Float64Array.of(line.x1, line.y1, line.x2, line.y2),
    line.elbow !== undefined,
    elbowValues,
    Float64Array.from(arrowPolyline(line, arrowHeads(arrow))),
    values,
  );
  return Array.from(crossed, (index) => texts[index]!.box);
}

/** The padded boxes where an arrow's line is cut for text it crosses. */
export function arrowTextKnockouts(arrow: ArrowElement, line: ArrowGeometry, byId: ElementsById, measures?: ElementMeasures): Box[] {
  return textBoxesCrossedByArrow(arrow, line, byId, measures).map(padTextBox);
}

/**
 * How deep a point is inside a shape's outline (negative outside), in
 * board units: the smallest distance to any side's outline at that offset.
 */
export function shapeOutlineDepth(shape: Pick<ShapeElement, 'x' | 'y' | 'w' | 'h' | 'kind'>, x: number, y: number): number {
  return wbGeom().shape_outline_depth(kindCode(shape.kind), encodeBox(shape), x, y);
}

/**
 * Estimated box of text laid out in an area: words wrapped at the area's
 * width (0.55 em per character), aligned by the given fractions, clipped to
 * the area. `undefined` for blank text.
 */
export function estimateTextBox(text: string, px: number, box: Box, alignX: number, alignY: number): Box | undefined {
  const plain = geometryHooks().plainTextWithListPrefixes(text);
  if (plain.trim() === '') return undefined;
  const lines: number[] = [];
  for (const line of plain.split('\n')) {
    const words = line.split(/\s+/).filter((part) => part !== '');
    lines.push(words.length, ...words.map((word) => word.length));
  }
  const [x, y, w, h] = wbGeom().estimate_text_box(Float64Array.from(lines), px, encodeBox(box), alignX, alignY) as unknown as [number, number, number, number];
  return { x, y, w, h };
}

/** Estimated box of a shape's text (inside its text insets, centered vertically). */
export function shapeTextBox(shape: ShapeElement): Box | undefined {
  const insets = shapeTextInsets(shape.kind, shape.w, shape.h);
  const area = {
    x: shape.x + shape.w * insets.left,
    y: shape.y + shape.h * insets.top,
    w: shape.w * (1 - insets.left - insets.right),
    h: shape.h * (1 - insets.top - insets.bottom),
  };
  return estimateTextBox(shape.text, TEXT_SIZE_STYLES[shape.size ?? 'small'].px, area, TEXT_ALIGN_FRACTION[shape.textAlign ?? 'center'], 0.5);
}

/** Estimated box of a note's text within the note's box (top-aligned). */
export function noteTextBox(note: NoteElement, box: Box): Box | undefined {
  const area = { x: box.x + 16, y: box.y + 16, w: box.w - 32, h: box.h - 16 - (note.author !== undefined ? noteAuthorBottomPadding : 12) };
  return estimateTextBox(note.text, note.size !== undefined ? TEXT_SIZE_STYLES[note.size].px : 15, area, TEXT_ALIGN_FRACTION[note.textAlign ?? 'left'], 0);
}

/** Where a text element's ink is: its box, or (wrapped) the estimated lines; `undefined` when blank. */
export function textElementInkBox(text: TextElement, box: Box): Box | undefined {
  if (text.wrap === undefined) return text.text.trim() === '' ? undefined : box;
  return estimateTextBox(text.text, TEXT_SIZE_STYLES[text.size].px, box, TEXT_ALIGN_FRACTION[text.textAlign ?? 'left'], 0);
}

/** True when a shape's outline passes through the box (sampled along each side). */
export function outlineCrossesBox(shape: Pick<ShapeElement, 'x' | 'y' | 'w' | 'h' | 'kind'>, box: Box): boolean {
  return wbGeom().outline_crosses_box(kindCode(shape.kind), encodeBox(shape), encodeBox(box));
}

/* -------------------------------------------------------------------------- */
/* Marquee                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ids of the elements a marquee touches, in board order:
 * - boxes it overlaps (rotated boxes exactly), except a hollow shape when
 *   the marquee sits wholly inside it without touching its outline or text;
 * - sections whose title or edge band it overlaps;
 * - arrows whose two ends are both selected or whose line it crosses.
 */
export function elementsInMarquee(
  elements: readonly BoardElement[],
  marquee: Box,
  measures?: ElementMeasures,
  byId?: ElementsById,
  zoom?: number,
): ElementId[] {
  const board = byIdOf(elements, byId);
  const numbers = new Map<ElementId, number>();
  const numberOf = (id: ElementId): number => {
    let number = numbers.get(id);
    if (number === undefined) numbers.set(id, (number = numbers.size));
    return number;
  };
  const ids = Uint32Array.from(elements, (element) => numberOf(element.id));
  const ends = new Float64Array(elements.length * 2).fill(-1);
  elements.forEach((element, index) => {
    if (element.type !== 'arrow') return;
    const endIds = arrowEndIds(element);
    if (endIds.length === 2) ends.set([numberOf(endIds[0]!), numberOf(endIds[1]!)], index * 2);
  });
  const found = wbGeom().elements_in_marquee(hitRecords(elements, measures, board, zoom), ids, ends, encodeBox(marquee));
  return Array.from(found, (index) => elements[index]!.id);
}

/**
 * What a marquee selects: {@link elementsInMarquee}, but a section the
 * marquee only partly covers is left out when that still selects something
 * (dragging across a section picks its content, not the section).
 */
export function marqueeSelection(elements: readonly BoardElement[], marquee: Box, measures?: ElementMeasures, byId?: ElementsById, zoom?: number): ElementId[] {
  const board = byIdOf(elements, byId);
  const hits = elementsInMarquee(elements, marquee, measures, board, zoom);
  const containsBox = (box: Box | undefined): boolean =>
    box !== undefined && marquee.x <= box.x && marquee.y <= box.y && marquee.x + marquee.w >= box.x + box.w && marquee.y + marquee.h >= box.y + box.h;
  const hitIds = new Set(hits);
  const partialContainers = new Set(
    elements
      .filter((element) => element.type === 'container' && hitIds.has(element.id) && !containsBox(elementLayoutBox(element, measures)))
      .map((element) => element.id),
  );
  if (partialContainers.size === 0) return hits;
  const retry = elementsInMarquee(
    elements.filter((element) => !partialContainers.has(element.id)),
    marquee,
    measures,
    board,
    zoom,
  );
  return retry.length > 0 ? retry : hits;
}

/* -------------------------------------------------------------------------- */
/* Topmost element                                                            */
/* -------------------------------------------------------------------------- */

/**
 * When the point is on an arrow line, the arrow below it whose label is
 * under the point (a label stays clickable through lines drawn over it);
 * `undefined` when a box is in between or no label is there.
 */
export function arrowLabelBeneath(
  elements: readonly BoardElement[],
  index: number,
  x: number,
  y: number,
  tolerance: number,
  measures: ElementMeasures | undefined,
  byId: ElementsById,
): BoardElement | undefined {
  // Only the elements up to `index` are looked at.
  const found = wbGeom().arrow_label_beneath(hitRecords(elements.slice(0, index + 1), measures, byId, undefined), index, x, y, tolerance);
  return found < 0 ? undefined : elements[found];
}

/**
 * The topmost element under the point. Section title text wins first, then
 * any non-section element (front to back), then section title chips, then
 * section edges. A text showing its placeholder is hit only where nothing
 * else is.
 */
export function topElementAt(
  elements: readonly BoardElement[],
  x: number,
  y: number,
  tolerance = 4,
  measures?: ElementMeasures,
  byId?: ElementsById,
  zoom?: number,
): BoardElement | undefined {
  const lookup = byIdOf(elements, byId);
  const found = wbGeom().top_element_at(hitRecords(elements, measures, lookup, zoom), x, y, tolerance);
  const hit = found < 0 ? undefined : elements[found];
  if (hit === undefined || !showsTextPlaceholder(hit)) return hit;
  // An empty text's hint gives way to anything else under the point.
  const others = elements.filter((element) => !showsTextPlaceholder(element));
  const other = wbGeom().top_element_at(hitRecords(others, measures, lookup, zoom), x, y, tolerance);
  return other < 0 ? hit : others[other];
}
