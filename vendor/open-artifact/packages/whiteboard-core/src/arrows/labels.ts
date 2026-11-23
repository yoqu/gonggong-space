/**
 * Arrow heads and labels: the points of arrow heads and circle caps, how a
 * label is measured and wrapped, and where it goes: on the line (with a
 * halo) when the line is long enough, else beside it, clear of the line,
 * the heads and the boxes the arrow joins.
 *
 * Word widths are injectable ({@link measureLabelWords}); the default
 * estimate needs no DOM.
 *
 * Heads, wrapping and placement run in WebAssembly
 * (`crates/open-artifact-wb-geom/src/labels.rs`): words go in as their widths and
 * come back as ranges. Measuring, the elbow placement cache and the
 * board lookups stay here.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { decodePoints, encodePoints } from '../geom-codec.ts';
import { arrowHeads, type ArrowElement, type ArrowHeadKind } from '../schema.ts';
import { drawArrowsInLines } from '../text/text-arrows.ts';
import { resolveArrowEndGeometry, type ArrowGeometry, type BoardIndex, type ElementLayoutBoxResolver } from './layout.ts';
import type { RouteBox, RoutePoint } from './routing.ts';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Height of a one-line label. */
export const ARROW_LABEL_HEIGHT = 16;
/** Width of the halo behind an on-line label. */
export const ARROW_LABEL_HALO_WIDTH = 10;
/** Halo widths of the label's layered outline. */
export const ARROW_LABEL_HALO_WIDTHS: readonly number[] = [ARROW_LABEL_HALO_WIDTH, 7, 5];
/** Gap between an off-line label and the line. */
export const ARROW_LABEL_GAP = 6;
/** Room a label leaves at a plain end. */
export const ARROW_LABEL_END_MARGIN = 12;
/** Extra room a label leaves after a head. */
export const ARROW_LABEL_HEAD_MARGIN = 5;
/** Vertical padding of a label's hit box. */
export const ARROW_LABEL_PAD_Y = 3.5;
/** How arrows are stroked. */
export const ARROW_STROKE = { width: 1.5, dash: [6, 5] as readonly number[], head: 7, wing: 0.62 } as const;
/** Half the stroke plus antialiasing. */
export const ARROW_LABEL_STROKE_CLEARANCE = 1.75;
/** Length of an arrow head. */
export const ARROW_HEAD_LENGTH = 11;
/** Half-width of an arrow head relative to its length. */
export const ARROW_HEAD_SPREAD = 0.55;
/** Radius of a circle cap. */
export const ARROW_CIRCLE_RADIUS = 5;
/** Line height of a wrapped label. */
export const ARROW_LABEL_LINE_HEIGHT = 18;
/** Most lines a wrapped label may have. */
export const ARROW_LABEL_MAX_LINES = 3;
/** Padding inside the gap a wrapped label sits in. */
export const ARROW_LABEL_GAP_PAD = 2;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** A board point. */
export interface LabelPoint {
  x: number;
  y: number;
}

/** A label's words and their widths. */
export interface LabelMeasure {
  words: string[];
  widths: number[];
  /** Width of a space. */
  space: number;
}

/** One wrapped line of a label. */
export interface LabelLine {
  text: string;
  w: number;
}

/** A placed label. */
export interface PlacedArrowLabel {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn on the line (with a halo) rather than beside it. */
  onLine: boolean;
  lines: readonly string[];
}

/** A label's box (padded for hit testing). */
export interface ArrowLabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  onLine: boolean;
}

/** A straight piece of a route or cap. */
interface Segment {
  a: RoutePoint;
  b: RoutePoint;
}

/* -------------------------------------------------------------------------- */
/* Heads and caps                                                              */
/* -------------------------------------------------------------------------- */

/** A head kind's code (0 none, 1 arrow, 2 circle). */
function headCode(kind: ArrowHeadKind): number {
  return kind === 'none' ? 0 : kind === 'arrow' ? 1 : 2;
}

function decodeLabelPoints(values: Float64Array): LabelPoint[] {
  const points: LabelPoint[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index]!, y: values[index + 1]! });
  return points;
}

/** Center of a circle cap at `tip` on a line from `from`. */
export function arrowCircleCenter(tipX: number, tipY: number, fromX: number, fromY: number): LabelPoint {
  const values = wbGeom().arrow_circle_center(tipX, tipY, fromX, fromY);
  return { x: values[0]!, y: values[1]! };
}

/** The two wing tips of an arrow head, then the midpoints of each wing. */
export function arrowHeadPoints(tipX: number, tipY: number, fromX: number, fromY: number): LabelPoint[] {
  return decodeLabelPoints(wbGeom().arrow_head_points(tipX, tipY, fromX, fromY));
}

/** Points outlining an end cap (head wings, or an octagon around a circle). */
export function arrowEndCapPoints(kind: ArrowHeadKind, tipX: number, tipY: number, fromX: number, fromY: number): LabelPoint[] {
  return decodeLabelPoints(wbGeom().arrow_end_cap_points(headCode(kind), tipX, tipY, fromX, fromY));
}

/** Line segments outlining an end cap. */
export function arrowEndCapSegments(kind: ArrowHeadKind, tip: RoutePoint, from: RoutePoint): Segment[] {
  if (kind === 'arrow') {
    const wings = wbGeom().arrow_head_points(tip[0], tip[1], from[0], from[1]);
    return [
      { a: tip, b: [wings[0]!, wings[1]!] },
      { a: tip, b: [wings[2]!, wings[3]!] },
    ];
  }
  const points = decodePoints(wbGeom().arrow_end_cap_points(headCode(kind), tip[0], tip[1], from[0], from[1]));
  return points.map((point, index) => ({ a: point, b: points[(index + 1) % points.length]! }));
}

/* -------------------------------------------------------------------------- */
/* Measuring and wrapping                                                      */
/* -------------------------------------------------------------------------- */

/** A label on one line with typed arrows drawn. */
export function normalizeArrowLabel(label: string): string {
  return drawArrowsInLines(label.replace(/\s+/g, ' ').trim());
}

/** A rough width of a word at the label font (6.5 per character). */
export function estimateLabelWordWidth(word: string): number {
  return [...word].length * 6.5;
}

/** Splits a normalized label into words and measures them. */
export function measureLabelWords(label: string, widthOf: (word: string) => number = estimateLabelWordWidth): LabelMeasure {
  const words = label === '' ? [] : label.split(' ');
  return { words, widths: words.map((word) => widthOf(word)), space: widthOf(' ') };
}

/** Greedy word wrap of a measured label. */
export function wrapLabelWords(measure: LabelMeasure, maxWidth: number): LabelLine[] {
  const values = wbGeom().wrap_label_words(measure.words.length, Float64Array.from(measure.widths), measure.space, maxWidth);
  const lines: LabelLine[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) lines.push({ text: measure.words.slice(values[index]!, values[index + 1]!).join(' '), w: values[index + 2]! });
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                   */
/* -------------------------------------------------------------------------- */

/** `[has, x, y, w, h]` for each end box. */
function encodeEndBoxes(endBoxes?: readonly [RouteBox | undefined, RouteBox | undefined]): Float64Array {
  const out = new Float64Array(10);
  endBoxes?.slice(0, 2).forEach((box, index) => {
    if (box !== undefined) out.set([1, box.x, box.y, box.w, box.h], index * 5);
  });
  return out;
}

/** Places a label in WebAssembly (`elbow`: the elbow placement). */
function placeLabel(
  line: ArrowGeometry,
  heads: readonly [ArrowHeadKind, ArrowHeadKind],
  measure: LabelMeasure,
  endBoxes: readonly [RouteBox | undefined, RouteBox | undefined] | undefined,
  elbow: boolean,
): PlacedArrowLabel {
  const points = line.elbow ?? [];
  const lineValues = new Float64Array(6 + points.length * 2);
  lineValues.set([line.x1, line.y1, line.x2, line.y2, line.bent ? 1 : 0, line.elbow ? 1 : 0]);
  lineValues.set(encodePoints(points), 6);
  const values = wbGeom().place_arrow_label(lineValues, headCode(heads[0]), headCode(heads[1]), measure.words.length, Float64Array.from(measure.widths), measure.space, encodeEndBoxes(endBoxes), elbow);
  if (values.length === 0) throw new TypeError('Reduce of empty array with no initial value');
  const lines: string[] = [];
  for (let index = 0; index < values[5]!; index++) lines.push(measure.words.slice(values[6 + index * 2]!, values[7 + index * 2]!).join(' '));
  return { x: values[0]!, y: values[1]!, w: values[2]!, h: values[3]!, onLine: values[4] === 1, lines };
}

/**
 * Where a label goes. On a straight arrow: centered on the line when the
 * line leaves room for the heads, else beside it (wrapped to fit the gap
 * between the end boxes when that helps), as close as it stays clear.
 * Elbow arrows use {@link placeElbowArrowLabel}.
 */
export function placeArrowLabel(
  line: ArrowGeometry,
  heads: readonly [ArrowHeadKind, ArrowHeadKind],
  measure: LabelMeasure,
  endBoxes?: readonly [RouteBox | undefined, RouteBox | undefined],
): PlacedArrowLabel {
  if (line.elbow && line.elbow.length > 2) return placeElbowArrowLabelCached(line, heads, measure, endBoxes);
  return placeLabel(line, heads, measure, endBoxes, false);
}

const elbowLabelCache = new Map<string, PlacedArrowLabel>();

/** {@link placeElbowArrowLabel}, memoized (512 most recent placements). */
export function placeElbowArrowLabelCached(
  line: ArrowGeometry,
  heads: readonly [ArrowHeadKind, ArrowHeadKind],
  measure: LabelMeasure,
  endBoxes?: readonly [RouteBox | undefined, RouteBox | undefined],
): PlacedArrowLabel {
  const key = JSON.stringify([line.elbow, line.bent, heads, measure, endBoxes]);
  const cached = elbowLabelCache.get(key);
  if (cached) {
    elbowLabelCache.delete(key);
    elbowLabelCache.set(key, cached);
    return cached;
  }
  const placed = placeElbowArrowLabel(line, heads, measure, endBoxes);
  const frozen = Object.freeze({ ...placed, lines: Object.freeze([...placed.lines]) });
  if (elbowLabelCache.size >= 512)
    for (const oldest of elbowLabelCache.keys()) {
      elbowLabelCache.delete(oldest);
      break;
    }
  elbowLabelCache.set(key, frozen);
  return frozen;
}

/**
 * Where an elbow arrow's label goes: on its label leg when it fits there
 * with room for the heads (on a manual route, the longest leg that fits
 * strictly), else the nearest clear spot around the leg's middle, else
 * above (or below) the whole arrow.
 */
export function placeElbowArrowLabel(
  line: ArrowGeometry,
  heads: readonly [ArrowHeadKind, ArrowHeadKind],
  measure: LabelMeasure,
  endBoxes?: readonly [RouteBox | undefined, RouteBox | undefined],
): PlacedArrowLabel {
  return placeLabel(line, heads, measure, endBoxes, true);
}

/** The boxes an arrow's ends attach to (`undefined` for free points). */
export function arrowEndBoxes(arrow: Pick<ArrowElement, 'from' | 'to'>, board: BoardIndex, layoutBox: ElementLayoutBoxResolver): [RouteBox | undefined, RouteBox | undefined] {
  const boxOf = (ref: ArrowElement['from']): RouteBox | undefined => {
    const end = resolveArrowEndGeometry(ref, board, layoutBox);
    return end !== undefined && 'w' in end ? end : undefined;
  };
  return [boxOf(arrow.from), boxOf(arrow.to)];
}

/**
 * The box of an arrow's label (padded vertically), or `undefined` without a
 * label. `measure` is the label measured by the page (falls back to an
 * estimate).
 */
export function arrowLabelBox(
  arrow: Pick<ArrowElement, 'from' | 'to' | 'label' | 'head' | 'heads'>,
  line: ArrowGeometry,
  board: BoardIndex,
  layoutBox: ElementLayoutBoxResolver,
  measure?: LabelMeasure,
): ArrowLabelBox | undefined {
  const label = normalizeArrowLabel(arrow.label ?? '');
  if (label === '') return undefined;
  const placed = placeArrowLabel(line, arrowHeads(arrow), measure ?? measureLabelWords(label), arrowEndBoxes(arrow, board, layoutBox));
  return { x: placed.x, y: placed.y - ARROW_LABEL_PAD_Y, w: placed.w, h: placed.h + 2 * ARROW_LABEL_PAD_Y, onLine: placed.onLine };
}

/** {@link arrowLabelBox} when the label sits beside the line, else `undefined`. */
export function offLineArrowLabelBox(
  arrow: Pick<ArrowElement, 'from' | 'to' | 'label' | 'head' | 'heads'>,
  line: ArrowGeometry,
  board: BoardIndex,
  layoutBox: ElementLayoutBoxResolver,
  measure?: LabelMeasure,
): ArrowLabelBox | undefined {
  const box = arrowLabelBox(arrow, line, board, layoutBox, measure);
  return box === undefined || box.onLine ? undefined : box;
}
