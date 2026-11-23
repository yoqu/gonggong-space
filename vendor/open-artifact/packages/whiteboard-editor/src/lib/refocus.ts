/**
 * Whether a field disabled for a moment (the agent dropping off and coming
 * back) takes the focus it lost back. No DOM.
 */

/** How long a field may stay disabled and still get its focus back. */
export const REFOCUS_WINDOW_MS = 5000;

/**
 * True when a field that lost focus by being disabled at `lostAt` and is
 * enabled again `now` should take focus back: within
 * {@link REFOCUS_WINDOW_MS}, and only while nothing else has focus.
 */
export function shouldRefocus(lostAt: number | null, now: number, focusIsIdle: boolean): boolean {
  return lostAt !== null && focusIsIdle && now - lostAt >= 0 && now - lostAt <= REFOCUS_WINDOW_MS;
}
