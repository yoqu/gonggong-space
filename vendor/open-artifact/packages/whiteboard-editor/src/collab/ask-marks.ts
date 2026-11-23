/**
 * The marks of requests waiting on the agent, drawn on this page only (they
 * are never written to the board as claims). A request about an area or a
 * selection is marked there at once; when the agent frames a claim over it
 * (the request's own, or one overlapping the mark) the mark gives way to the
 * claim, and otherwise it ends with the request.
 *
 * Also the geometry of resizing a drawn area by its corner grip.
 */

import type { Box } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';

/** A request's mark on the board. */
export interface AskMark {
  /** Unique among the marks drawn. */
  key: string;
  /** The claim key of the request (the agent's claim for it carries the same key). */
  claimKey: string;
  /** Board units. */
  box: Box;
  color: string;
}

/** A framed claim, as {@link visibleAskMarks} reads it. */
export interface ClaimArea {
  key: string;
  /** Board units. */
  frame: Box;
}

/** Whether two boxes share some area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  return !apart;
}

/** The marks still shown: those no framed claim has taken the place of. */
export function visibleAskMarks(marks: readonly AskMark[], claims: readonly ClaimArea[]): AskMark[] {
  if (claims.length === 0) return [...marks];
  const keys = new Set(claims.map((claim) => claim.key));
  return marks.filter((mark) => !keys.has(mark.claimKey) && !claims.some((claim) => boxesOverlap(mark.box, claim.frame)));
}

/** A drawn area's corner: its origin, where the outline's dot sits, or the one its grip drags. */
export type AreaCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Where a corner of a box is. */
export function areaCornerPoint(box: Box, corner: AreaCorner): Point {
  return { x: corner.endsWith('right') ? box.x + box.w : box.x, y: corner.startsWith('bottom') ? box.y + box.h : box.y };
}

/** The corner across from another. */
export function oppositeCorner(corner: AreaCorner): AreaCorner {
  const vertical = corner.startsWith('top') ? 'bottom' : 'top';
  const horizontal = corner.endsWith('left') ? 'right' : 'left';
  return `${vertical}-${horizontal}`;
}

/**
 * The area spanned by a fixed `origin` and a dragged `corner` (either way
 * round), at least `min` board units each way: a grip dragged past the
 * origin flips the area to that side.
 */
export function areaFromCorners(origin: Point, corner: Point, min = 0): Box {
  const span = (from: number, to: number): [number, number] => {
    const size = Math.max(Math.abs(to - from), min);
    return to < from ? [from - size, size] : [from, size];
  };
  const [x, w] = span(origin.x, corner.x);
  const [y, h] = span(origin.y, corner.y);
  return { x, y, w, h };
}
