/**
 * A guard for the rest of a double or triple click.
 *
 * A press that closes something (a menu row, the press outside a popover)
 * takes away what was under the pointer: the second and third clicks of
 * the same double or triple click then land on whatever is beneath, a board
 * that adds text on a double click, a row of another list. For a short
 * while after such a press, presses at the same spot are swallowed.
 */

/** How long after the closing press its follow-up clicks are swallowed. */
export const FOLLOW_UP_CLICK_MS = 500;
/** How far from the closing press a follow-up click may land, px. */
export const FOLLOW_UP_CLICK_SLOP_PX = 8;

/** Where and when the closing press happened. */
export interface PressPoint {
  x: number;
  y: number;
  /** Milliseconds, on the clock passed to the guard. */
  at: number;
}

/** The pointer fields of an event the guard reads. */
export interface PointLike {
  clientX: number;
  clientY: number;
}

/** True when a press at `point`, `now`, is part of the same multi-click as `origin`. */
export function isFollowUpPress(origin: PressPoint, point: PointLike, now: number): boolean {
  if (now < origin.at || now - origin.at > FOLLOW_UP_CLICK_MS) return false;
  return Math.hypot(point.clientX - origin.x, point.clientY - origin.y) <= FOLLOW_UP_CLICK_SLOP_PX;
}

/** The pointer and mouse events the guard swallows. */
export const FOLLOW_UP_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'] as const;
/** One of {@link FOLLOW_UP_EVENTS}. */
export type FollowUpEventType = (typeof FOLLOW_UP_EVENTS)[number];

/** The parts of an event {@link guardFollowUpClicks} reads. */
export interface FollowUpEvent extends PointLike {
  type: string;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/** The parts of a window {@link guardFollowUpClicks} listens on. */
export interface ClickGuardWindow {
  addEventListener(type: FollowUpEventType, listener: (event: FollowUpEvent) => void, capture: boolean): void;
  removeEventListener(type: FollowUpEventType, listener: (event: FollowUpEvent) => void, capture: boolean): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * Swallows, at the window, the presses that follow the closing press at
 * `origin` within {@link FOLLOW_UP_CLICK_MS} and {@link FOLLOW_UP_CLICK_SLOP_PX}.
 * A press swallowed near the end keeps the guard until its own release and
 * click have been swallowed too. Returns a function that ends it early.
 */
export function guardFollowUpClicks(win: ClickGuardWindow, origin: PressPoint, now: () => number = Date.now): () => void {
  let pressed = false;
  let ended = false;
  let timer = 0;
  const end = () => {
    if (ended) return;
    ended = true;
    win.clearTimeout(timer);
    for (const type of FOLLOW_UP_EVENTS) win.removeEventListener(type, onEvent, true);
  };
  const settle = () => {
    if (pressed) timer = win.setTimeout(settle, FOLLOW_UP_CLICK_MS);
    else end();
  };
  const onEvent = (event: FollowUpEvent) => {
    const down = event.type === 'pointerdown' || event.type === 'mousedown';
    if (!(pressed && !down) && !isFollowUpPress(origin, event, now())) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (down) pressed = true;
    else if (event.type === 'click' || event.type === 'dblclick') pressed = false;
  };
  for (const type of FOLLOW_UP_EVENTS) win.addEventListener(type, onEvent, true);
  timer = win.setTimeout(settle, Math.max(0, FOLLOW_UP_CLICK_MS - (now() - origin.at)));
  return end;
}

/** The fields of a native click (or press) the closing control passes. */
export interface ClosingClick extends PointLike {
  /** The click count: 0 for a click made with the keyboard. */
  detail: number;
  view: ClickGuardWindow | null;
}

/**
 * Starts {@link guardFollowUpClicks} on the event's window for a pointer
 * click that closed something. Keyboard clicks (`detail` 0) have no
 * follow-up and start nothing.
 */
export function swallowFollowUpClicks(click: ClosingClick): void {
  if (click.detail < 1 || !click.view) return;
  guardFollowUpClicks(click.view, { x: click.clientX, y: click.clientY, at: Date.now() });
}
