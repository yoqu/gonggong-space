/**
 * The rubber band of a drag-select or an ask-area drag, drawn like an area
 * frame: a light tint of the viewer's own color with a 2-pixel stroke inside
 * its edge and rounded corners. The stroke and the corner radius stay the
 * same on screen at any zoom.
 */

import type { Box } from '@open-artifact/whiteboard-core';

/** Stroke width of the frame, in screen pixels. */
export const AREA_STROKE_PX = 2;
/** Largest corner radius, in screen pixels (a third of the short side when that is less). */
export const AREA_CORNER_PX = 16;
/** Opacity of the frame's fill. */
export const AREA_FILL_OPACITY = 0.06;

/** Where to draw the frame's fill and its inner stroke, in board units. */
export interface AreaMarqueeGeometry {
  /** The fill: the box, at least as wide and tall as the stroke. */
  fill: Box & { r: number };
  /** The stroke's center line: the fill inset by half the stroke. */
  edge: Box & { r: number };
}

/**
 * The frame for a box at a zoom: the fill covers the box (grown to the
 * stroke width when the drag is thinner), with corners of
 * `min(16px, short side / 3)`; the stroke runs half its width inside.
 */
export function areaMarqueeGeometry(box: Box, zoom: number): AreaMarqueeGeometry {
  const scale = zoom > 0 ? zoom : 1;
  const stroke = AREA_STROKE_PX / scale;
  const w = Math.max(box.w, stroke);
  const h = Math.max(box.h, stroke);
  const r = Math.min(AREA_CORNER_PX / scale, Math.min(w, h) / 3);
  const half = stroke / 2;
  return {
    fill: { x: box.x, y: box.y, w, h, r },
    edge: { x: box.x + half, y: box.y + half, w: w - stroke, h: h - stroke, r: Math.max(0, r - half) },
  };
}
