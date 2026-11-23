/**
 * Snapping and resizing math shared by dragging, resizing, rotating and
 * cropping: snap guides from sibling boxes, edge-anchored resizes (free or
 * keeping the aspect ratio, rotated or not) and rotation angle snapping.
 *
 * The math runs in WebAssembly (`crates/open-artifact-wb-geom/src/snapping.rs`); this
 * module encodes the arguments and maps matched guides back to the
 * caller's own guide objects.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { edgeCode } from './geom-codec.ts';
import type { Box } from './geometry.ts';

/** A snap line: a vertical (`x`) or horizontal (`y`) line through a box edge or center. */
export interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
  kind: 'edge' | 'center';
}

/** The result of snapping: the adjustment to apply and the guides that matched. */
export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** Which edges a resize drags (`null` leaves that axis alone). */
export interface ResizeEdges {
  x: 'left' | 'right' | null;
  y: 'top' | 'bottom' | null;
}

/** A width and height limit. */
export interface SizeLimit {
  w: number;
  h: number;
}

/**
 * Snaps a moving box to the nearest guides within `threshold`: edges snap
 * to edge guides and the center to center guides (a center wins a tie).
 * `axes` limits snapping to some axes.
 */
export function snapRectToGuides(rect: Box, guides: readonly SnapGuide[], threshold: number, axes?: { x?: boolean; y?: boolean }): SnapResult {
  return decodeSnap(wbGeom().snap_rect_to_guides(encodeRect(rect), encodeGuides(guides), threshold, axes ? !!axes.x : true, axes ? !!axes.y : true), guides);
}

/**
 * The axis a straight (Shift) drag holds still: the one the pointer moved
 * less along, so `'x'` keeps the horizontal position (the drag is vertical)
 * and `'y'` keeps the vertical one.
 */
export function straightDragAxis(dx: number, dy: number): 'x' | 'y' {
  return Math.abs(dy) > Math.abs(dx) ? 'x' : 'y';
}

/**
 * {@link snapRectToGuides} for a straight drag that holds `axis` still:
 * only the free axis snaps within `threshold`, and the held axis shows the
 * guides it already sits on without moving. With no `axis` it is a plain
 * snap.
 */
export function snapRectToGuidesStraight(rect: Box, guides: readonly SnapGuide[], threshold: number, axis?: 'x' | 'y'): SnapResult {
  return decodeSnap(wbGeom().snap_rect_to_guides_straight(encodeRect(rect), encodeGuides(guides), threshold, axis === 'x' ? 0 : axis === 'y' ? 1 : 2), guides);
}

/**
 * Snaps the dragged edges of a resize to edge guides within `threshold`.
 * Returns the adjusted drag deltas.
 */
export function snapResizeEdgesToGuides(rect: Box, edges: ResizeEdges, dx: number, dy: number, guides: readonly SnapGuide[], threshold: number): SnapResult {
  return decodeSnap(wbGeom().snap_resize_edges_to_guides(encodeRect(rect), edgeCode(edges.x), edgeCode(edges.y), dx, dy, encodeGuides(guides), threshold), guides);
}

/** The guides a resized box's dragged edges now sit on (within half a unit). */
export function guidesTouchingEdges(rect: Box, edges: ResizeEdges, guides: readonly SnapGuide[]): SnapGuide[] {
  return Array.from(wbGeom().guides_touching_edges(encodeRect(rect), edgeCode(edges.x), edgeCode(edges.y), encodeGuides(guides)), (index) => guides[index]!);
}

/** Snap guides along the edges and centers of the given boxes. */
export function buildSiblingSnapCandidates(boxes: Iterable<Box>): SnapGuide[] {
  const guides: SnapGuide[] = [];
  for (const box of boxes)
    guides.push(
      { axis: 'x', pos: box.x, kind: 'edge' },
      { axis: 'x', pos: box.x + box.w / 2, kind: 'center' },
      { axis: 'x', pos: box.x + box.w, kind: 'edge' },
      { axis: 'y', pos: box.y, kind: 'edge' },
      { axis: 'y', pos: box.y + box.h / 2, kind: 'center' },
      { axis: 'y', pos: box.y + box.h, kind: 'edge' },
    );
  return guides;
}

/** Drags the given edges by `dx, dy`, clamping the size; the opposite edges stay. */
export function resizeRectFromEdges(rect: Box, edges: ResizeEdges, dx: number, dy: number, min: SizeLimit, max: SizeLimit): Box {
  return decodeRect(wbGeom().resize_rect(encodeRect(rect), edgeCode(edges.x), edgeCode(edges.y), dx, dy, Float64Array.of(min.w, min.h, max.w, max.h), 0));
}

/**
 * Like {@link resizeRectFromEdges}, keeping the aspect ratio: the axis that
 * changed more sets the scale, clamped so both sides stay within limits.
 */
export function resizeRectKeepingAspect(rect: Box, edges: ResizeEdges, dx: number, dy: number, min: SizeLimit, max: SizeLimit): Box {
  return decodeRect(wbGeom().resize_rect(encodeRect(rect), edgeCode(edges.x), edgeCode(edges.y), dx, dy, Float64Array.of(min.w, min.h, max.w, max.h), 1));
}

/**
 * Snaps a rotation: to 15° steps when `coarse`, otherwise to whole degrees
 * and to the nearest right angle within 3°. The result is in (-180, 180].
 */
export function snapRotationDegrees(degrees: number, coarse: boolean): number {
  return wbGeom().snap_rotation_degrees(degrees, coarse);
}

/** The angle in degrees of the vector from `(x1, y1)` to `(x2, y2)`. */
export function angleBetweenPoints(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

/**
 * Resizes a rotated box by a screen drag: the drag is turned into the
 * box's own axes, the box is resized there (optionally keeping its aspect
 * ratio), and the result is shifted so the opposite edges stay still on
 * screen.
 */
export function resizeRotatedRect(
  rect: Box,
  rotation: number,
  edges: ResizeEdges,
  dx: number,
  dy: number,
  min: SizeLimit,
  max: SizeLimit,
  keepAspect = false,
): Box {
  return decodeRect(
    wbGeom().resize_rotated_rect(encodeRect(rect), rotation, edgeCode(edges.x), edgeCode(edges.y), dx, dy, Float64Array.of(min.w, min.h, max.w, max.h), keepAspect),
  );
}

// Codes shared with crates/open-artifact-wb-geom/src/snapping.rs.

function encodeRect(rect: Box): Float64Array {
  return Float64Array.of(rect.x, rect.y, rect.w, rect.h);
}

function decodeRect(values: Float64Array): Box {
  return { x: values[0]!, y: values[1]!, w: values[2]!, h: values[3]! };
}

function encodeGuides(guides: readonly SnapGuide[]): Float64Array {
  const out = new Float64Array(guides.length * 3);
  for (let index = 0; index < guides.length; index++) {
    const guide = guides[index]!;
    out[index * 3] = guide.axis === 'x' ? 0 : guide.axis === 'y' ? 1 : 2;
    out[index * 3 + 1] = typeof guide.pos === 'number' ? guide.pos : NaN;
    out[index * 3 + 2] = guide.kind === 'edge' ? 0 : guide.kind === 'center' ? 1 : 2;
  }
  return out;
}

function decodeSnap(values: Float64Array, guides: readonly SnapGuide[]): SnapResult {
  const matched: SnapGuide[] = [];
  for (let index = 2; index < values.length; index++) matched.push(guides[values[index]!]!);
  return { dx: values[0]!, dy: values[1]!, guides: matched };
}

