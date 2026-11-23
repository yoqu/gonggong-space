/**
 * Side dots: where each dot sits on the board, how much room it needs, and
 * what its tooltip says. A dot shows only on a side with room around it
 * (core's `sideDotHasRoom`); a click on it adds a note or shape beside the
 * item when one fits there, and a drag draws an arrow.
 */

import { sideDotHasRoom, type ArrowSide, type BoardElement, type Box, type ElementMeasures } from '@open-artifact/whiteboard-core';
import type { Point } from './camera.ts';

/** Distance of a side dot from its item's edge, screen pixels. */
export const SIDE_DOT_OFFSET_PX = 12;
/** How close (screen pixels) another item may come to a dot under a finger. */
export const SIDE_DOT_TOUCH_REACH_PX = 22;
/** Taken off the dot's offset for the room a dot needs under a mouse, screen pixels. */
export const SIDE_DOT_ROOM_SLOP_PX = 2;

/** The four sides, in dot order. */
const SIDES: readonly ArrowSide[] = ['top', 'right', 'bottom', 'left'];

/** How far (screen pixels) another item must stay from a side dot. */
export function sideDotReachPx(coarse: boolean): number {
  return coarse ? SIDE_DOT_TOUCH_REACH_PX : SIDE_DOT_OFFSET_PX - SIDE_DOT_ROOM_SLOP_PX;
}

/**
 * Where the dot on `side` of a box turned by `turn` degrees sits, board
 * units: `offset` outside the middle of that side.
 */
export function sideDotCenter(box: Box, side: ArrowSide, turn: number, offset: number): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = side === 'left' ? -box.w / 2 - offset : side === 'right' ? box.w / 2 + offset : 0;
  const dy = side === 'top' ? -box.h / 2 - offset : side === 'bottom' ? box.h / 2 + offset : 0;
  const angle = (turn * Math.PI) / 180;
  return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

/** The sides of `owner` (laid out in `box`, turned by `turn`) whose dot has room at `zoom`. */
export function sideDotsWithRoom(
  owner: BoardElement,
  box: Box,
  turn: number,
  zoom: number,
  coarse: boolean,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
): ArrowSide[] {
  const reach = sideDotReachPx(coarse) / zoom;
  return SIDES.filter((side) => {
    const dot = sideDotCenter(box, side, turn, SIDE_DOT_OFFSET_PX / zoom);
    return sideDotHasRoom(owner, dot.x, dot.y, reach, elements, measures);
  });
}

/** A side dot's tooltip: what a click adds (when something fits), then the drag. */
export function sideDotTitle(type: BoardElement['type'], adds: boolean): string {
  const drag = 'Drag to connect';
  if (!adds) return drag;
  return `${type === 'note' ? 'Click to add a sticky note' : 'Click to add a shape'}\n${drag}`;
}
