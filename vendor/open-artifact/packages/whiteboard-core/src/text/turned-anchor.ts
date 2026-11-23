/**
 * Keeping a turned item's anchor corner in place while its size changes.
 *
 * Items turn about their center, so a turned note or text that grows (more
 * text, a bigger size) would otherwise drift on screen. The corner the
 * person reads from stays put instead: the top edge at the side the text is
 * aligned to (top-left for left-aligned text, top-right for right-aligned,
 * the middle of the top edge for centered).
 */

import type { Box } from '../geometry.ts';
import type { TextAlign } from '../schema.ts';

/** Where along the top edge the anchor sits, as a share of the width. */
const ANCHOR_SHARE: Readonly<Record<TextAlign, number>> = { left: 0, center: 0.5, right: 1 };

/** A point of a box turned `degrees` clockwise about its center, given relative to its unturned top-left. */
function turnedPoint(box: Box, degrees: number, dx: number, dy: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rx = dx - box.w / 2;
  const ry = dy - box.h / 2;
  return { x: box.x + box.w / 2 + rx * cos - ry * sin, y: box.y + box.h / 2 + rx * sin + ry * cos };
}

/**
 * The top-left that keeps the anchor corner of `box` (turned `degrees`,
 * aligned `align`) on the same board point once the box is `w` × `h`.
 */
export function keepTurnedAnchor(box: Box, degrees: number, w: number, h: number, align: TextAlign): { x: number; y: number } {
  if (degrees % 360 === 0 && align === 'left') return { x: box.x, y: box.y };
  const share = ANCHOR_SHARE[align];
  const anchor = turnedPoint(box, degrees, share * box.w, 0);
  const moved = turnedPoint({ x: 0, y: 0, w, h }, degrees, share * w, 0);
  return { x: anchor.x - moved.x, y: anchor.y - moved.y };
}
