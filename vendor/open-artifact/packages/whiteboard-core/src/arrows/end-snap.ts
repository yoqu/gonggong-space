/**
 * Snapping a dragged arrow end: lining it up with the other end, and
 * finding the element it attaches to (the nearest one within reach,
 * measured to the real outline of ellipses, hollow shapes and irregular
 * shapes, honoring rotation).
 *
 * The math runs in WebAssembly (`crates/open-artifact-wb-geom/src/end_snap.rs`):
 * {@link findArrowEndTarget} sends all candidates (with their layout
 * boxes, resolved here) in one call.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { SIDE_ORDER, kindCode } from '../geom-codec.ts';
import { elementTurn, type ArrowElement, type ArrowEnd, type ArrowSide, type BoardElement, type ElementId, type ShapeKind } from '../schema.ts';
import type { ArrowEndPoint, ElementLayoutBoxResolver } from './layout.ts';
import type { RouteBox } from './routing.ts';

/** How close (in screen pixels) a dragged end snaps, per pointer type. */
export const ARROW_END_SNAP_PX = { mouse: 20, touch: 28 } as const;

/** Shapes whose distance is measured to their box from outside and to their outline from inside. */
export const BOX_DISTANCE_SHAPE_KINDS: ReadonlySet<ShapeKind> = new Set<ShapeKind>(['cloud', 'parallelogram', 'person']);

/** The other end of an arrow and its side. */
export function arrowOppositeEnd(arrow: Pick<ArrowElement, 'from' | 'to' | 'fromSide' | 'toSide'>, end: 'from' | 'to'): [ArrowEnd, ArrowSide | undefined] {
  return end === 'from' ? [arrow.to, arrow.toSide] : [arrow.from, arrow.fromSide];
}

/** Numbers per element sent to {@link findArrowEndTarget}. */
const ELEMENT_STRIDE = 13;

/** Writes an element as `[type, kind, hollow, x, y, w, h, turn, hasBounds, bx, by, bw, bh]`. */
function encodeElement(element: BoardElement, bounds: RouteBox | undefined, out: Float64Array, at: number): void {
  const shape = element.type === 'shape';
  out[at] = element.type === 'container' ? 1 : shape ? 2 : 0;
  out[at + 1] = shape ? kindCode(element.kind) : 0;
  out[at + 2] = shape && element.hollow === true ? 1 : 0;
  // Elements without a box field (drawings have no w, h) send NaN, as the original arithmetic on undefined gives.
  const placed = element as Partial<RouteBox>;
  out[at + 3] = placed.x ?? NaN;
  out[at + 4] = placed.y ?? NaN;
  out[at + 5] = placed.w ?? NaN;
  out[at + 6] = placed.h ?? NaN;
  out[at + 7] = elementTurn(element);
  if (bounds) out.set([1, bounds.x, bounds.y, bounds.w, bounds.h], at + 8);
}

function encodeBox(box: RouteBox): Float64Array {
  return Float64Array.of(box.x, box.y, box.w, box.h);
}

/** Distance from a point to a box (0 inside). */
export function pointToBoxDistance(box: RouteBox, x: number, y: number): number {
  return wbGeom().point_to_box_distance(encodeBox(box), x, y);
}

/**
 * A dragged end at `x, y` lined up with the other end `from` when it is
 * within `snapPx` of level (or plumb) and the drag runs along that axis
 * (out of `side`, when the other end has one).
 */
export function alignArrowEndPoint(from: ArrowEndPoint, side: ArrowSide | undefined, x: number, y: number, snapPx: number): ArrowEndPoint {
  const index = side === undefined ? 255 : SIDE_ORDER.indexOf(side);
  const values = wbGeom().align_arrow_end_point(from.x, from.y, index < 0 ? 254 : index, x, y, snapPx);
  return { x: values[0]!, y: values[1]! };
}

/**
 * Distance from a point (in the element's unrotated frame) to where an
 * arrow end would attach: the box for most elements, the real outline of
 * ellipses and hollow shapes (a point inside a hollow shape is as far as the
 * nearest edge). 0 means the point is on (or, for filled boxes, in) the
 * element.
 */
export function arrowEndDistanceToElement(element: BoardElement, bounds: RouteBox, x: number, y: number, reach: number): number {
  const values = new Float64Array(ELEMENT_STRIDE);
  encodeElement(element, undefined, values, 0);
  return wbGeom().arrow_end_distance_to_element(values, encodeBox(bounds), x, y, reach);
}

/** The element an arrow end attaches to and the side facing the pointer. */
export interface ArrowEndTarget {
  end: ElementId;
  side: ArrowSide;
}

/**
 * The element nearest to `x, y` within `reach` that an arrow end can attach
 * to (`elements` in hit order, topmost first; stickers are skipped; ties go
 * to non-containers). A point exactly on a filled element is not a target:
 * the caller handles direct hits.
 */
export function findArrowEndTarget(elements: Iterable<BoardElement>, x: number, y: number, reach: number, layoutBox: ElementLayoutBoxResolver): ArrowEndTarget | undefined {
  const list = [...elements];
  const values = new Float64Array(list.length * ELEMENT_STRIDE);
  list.forEach((element, index) => encodeElement(element, element.type === 'sticker' ? undefined : layoutBox(element), values, index * ELEMENT_STRIDE));
  const found = wbGeom().find_arrow_end_target(values, x, y, reach);
  return found.length === 0 ? undefined : { end: list[found[0]!]!.id, side: SIDE_ORDER[found[1]!]! };
}
