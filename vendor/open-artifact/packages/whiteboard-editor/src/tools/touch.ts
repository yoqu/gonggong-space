/**
 * One finger on the board with the Select tool, on a touch screen.
 *
 * A finger works the camera first, so a board can be explored without
 * moving things by accident:
 * - dragging pans, unless the finger pressed something already selected
 *   (that drags it, as a mouse would);
 * - holding still for {@link TOUCH_LONG_PRESS_MS} picks the item up: it is
 *   selected and drawn lifted ({@link TOUCH_LIFT_FEEDBACK}), and dragging
 *   then moves it; lifting the finger without moving opens the context
 *   menu instead (see `ui/ContextMenu.tsx`);
 * - a tap selects (or, on empty board, clears the selection); a quick one
 *   ({@link isQuickTap}) on a text showing only its placeholder also starts
 *   typing into it, as a click does.
 *
 * Two fingers always zoom and pan (`services/viewport.ts`).
 *
 * The decisions are a pure reducer ({@link reduceTouchPress}), unit-tested;
 * `tools/select.ts` runs the gestures they lead to.
 */

import type { Point } from '../lib/camera.ts';

/** A touch held this long (ms) without moving counts as a long press. */
export const TOUCH_LONG_PRESS_MS = 450;

/** How far (screen pixels, across plus down) a finger moves before it counts as moving. */
export const TOUCH_MOVE_SLOP_PX = 9;

/** The look of an item picked up by a long press (and of items dragged by touch). */
export const TOUCH_LIFT_FEEDBACK = { scale: 1.1, opacity: 0.75, ms: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const;

/** True once a finger moved past {@link TOUCH_MOVE_SLOP_PX} from `start`. */
export function movedPastTouchSlop(start: Point, point: Point): boolean {
  return Math.abs(point.x - start.x) + Math.abs(point.y - start.y) >= TOUCH_MOVE_SLOP_PX;
}

/** The longest (ms) and farthest (screen pixels) a quick tap lasts and drifts. */
export const TOUCH_QUICK_TAP = { ms: 400, px: 10 } as const;

/** True when a tap that went down at `start` (`startMs`) and lifted at `end` (`endMs`) is quick. */
export function isQuickTap(start: Point, startMs: number, end: Point, endMs: number): boolean {
  return endMs - startMs <= TOUCH_QUICK_TAP.ms && Math.hypot(end.x - start.x, end.y - start.y) <= TOUCH_QUICK_TAP.px;
}

/** A one-finger press still deciding what it is. */
export interface TouchPress {
  /** Where the finger went down, screen pixels. */
  start: Point;
  /** The finger pressed something already selected (dragging moves it). */
  selected: boolean;
  /** A long press picked the item up. */
  popped: boolean;
}

/** What happened to a press. */
export type TouchPressEvent = { kind: 'move'; at: Point } | { kind: 'hold' } | { kind: 'up' } | { kind: 'cancel' };

/**
 * What a press turns into:
 * - `pan`: move the camera from now on;
 * - `drag`: move the pressed item (and the selection it is part of);
 * - `pop`: pick the item up (select it, draw it lifted);
 * - `tap`: the finger lifted without moving or holding;
 * - `cancel`: the press was cancelled;
 * - `none`: nothing yet.
 */
export type TouchPressOutcome = 'pan' | 'drag' | 'pop' | 'tap' | 'cancel' | 'none';

/**
 * The next state of a press (`null` once it is decided) and what it
 * turned into. A picked-up item drags once the finger moves past the slop;
 * lifting a picked-up item is `none` (the context menu takes it).
 */
export function reduceTouchPress(press: TouchPress, event: TouchPressEvent): { press: TouchPress | null; outcome: TouchPressOutcome } {
  switch (event.kind) {
    case 'move':
      if (!movedPastTouchSlop(press.start, event.at)) return { press, outcome: 'none' };
      return { press: null, outcome: press.popped || press.selected ? 'drag' : 'pan' };
    case 'hold':
      return press.popped ? { press, outcome: 'none' } : { press: { ...press, popped: true }, outcome: 'pop' };
    case 'up':
      return { press: null, outcome: press.popped ? 'none' : 'tap' };
    case 'cancel':
      return { press: null, outcome: 'cancel' };
  }
}
