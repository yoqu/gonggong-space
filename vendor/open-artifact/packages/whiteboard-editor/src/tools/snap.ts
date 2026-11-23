/**
 * Smart guides for moves and resizes: which still items a dragged box snaps
 * to (only neighbours in view and close by), how far it snaps from, and how
 * long each matched guide is drawn.
 */

import {
  buildSiblingSnapCandidates,
  elementBounds,
  type BoardElement,
  type Box,
  type ElementId,
  type ElementMeasures,
  type SnapGuide,
} from '@open-artifact/whiteboard-core';
import type { Rect } from '../lib/camera.ts';
import type { GuideLine } from '../selection/store.ts';

/** Snap distance, screen pixels. */
export const SNAP_DISTANCE_PX = 8;
/** Larger items snap from further: this share of their longer side (board units). */
export const SNAP_DISTANCE_RATIO = 1 / 12;
/** Neighbours count within this many of the larger side, or this many screen pixels. */
export const SNAP_NEIGHBOUR_REACH = { sides: 1.5, px: 320 } as const;

/** Boxes of the items that stay put during a drag (no drawings, arrows or stickers). */
export function stillBoxes(elements: readonly BoardElement[], moving: ReadonlySet<ElementId>, measures: ElementMeasures): Box[] {
  const boxes: Box[] = [];
  for (const element of elements) {
    if (moving.has(element.id) || element.type === 'stroke' || element.type === 'arrow' || element.type === 'sticker') continue;
    const box = elementBounds(element, measures);
    if (box) boxes.push(box);
  }
  return boxes;
}

/** Gap between two boxes (negative when they overlap). */
function gapBetween(a: Box, b: Box): number {
  return Math.max(a.x - b.x - b.w, b.x - a.x - a.w, a.y - b.y - b.h, b.y - a.y - a.h);
}

/** The still boxes in view and close enough to `box` to snap to. */
export function nearbyBoxes(boxes: readonly Box[], box: Box, view: Rect, zoom: number): Box[] {
  return boxes.filter(
    (other) =>
      gapBetween(other, view) < 0 &&
      gapBetween(other, box) <= Math.max(SNAP_NEIGHBOUR_REACH.sides * Math.max(other.w, other.h, box.w, box.h), SNAP_NEIGHBOUR_REACH.px / Math.max(1, zoom)),
  );
}

/** Snap candidates (edges and centers) of the neighbours of `box`. */
export function snapCandidatesNear(boxes: readonly Box[], box: Box, view: Rect, zoom: number): SnapGuide[] {
  return buildSiblingSnapCandidates(nearbyBoxes(boxes, box, view, zoom));
}

/** How far (board units) a box snaps from at a zoom. */
export function snapDistanceFor(box: Box, zoom: number): number {
  return Math.min(SNAP_DISTANCE_PX / zoom, Math.max(SNAP_DISTANCE_PX, SNAP_DISTANCE_RATIO * Math.max(box.w, box.h)));
}

/** Matched guides with their drawn extent: from the dragged box across every neighbour on the line. */
export function guideLines(guides: readonly SnapGuide[], boxes: readonly Box[], box: Box, view: Rect, zoom: number): GuideLine[] {
  if (guides.length === 0) return [];
  const near = nearbyBoxes(boxes, box, view, zoom);
  return guides.map((guide) => {
    const vertical = guide.axis === 'x';
    const aligned = near.filter((other) =>
      (vertical ? [other.x, other.x + other.w / 2, other.x + other.w] : [other.y, other.y + other.h / 2, other.y + other.h]).some((value) => Math.abs(value - guide.pos) < 0.5),
    );
    const spanned = [box, ...aligned];
    return {
      ...guide,
      from: Math.min(...spanned.map((each) => (vertical ? each.y : each.x))),
      to: Math.max(...spanned.map((each) => (vertical ? each.y + each.h : each.x + each.w))),
    };
  });
}
