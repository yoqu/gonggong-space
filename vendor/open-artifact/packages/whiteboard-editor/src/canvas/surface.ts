/**
 * Handles on the mounted board surface (`BoardSurface.tsx`) for code that
 * does not render it: its element, and a way to cancel the press gesture
 * it is running. Plain TypeScript, so DOM-free modules and tests can
 * import it.
 */

/** The surface element, for code that needs viewport-relative coordinates. */
export const surfaceRef: { current: HTMLDivElement | null } = { current: null };

/** Cancels the gesture in progress on the mounted surface (set while a surface is mounted). */
export const boardGestureCanceller: { current: (() => void) | null } = { current: null };

/**
 * Cancels the board gesture in progress, if any, as Escape would: for code
 * that takes over a press the active tool already started (a click on the
 * next-item offer).
 */
export function cancelBoardGesture(): void {
  boardGestureCanceller.current?.();
}
