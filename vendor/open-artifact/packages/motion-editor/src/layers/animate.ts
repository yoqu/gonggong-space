/**
 * Animate's choices: what a press on one of its pickers writes, when a picker's options fit side by side or go in a
 * menu, and when Ask should wait for the layers to be read again. Pure.
 */

import type { ReaderState } from './store.ts';

/** The value of "No change", the first item of a picker's menu. */
export const NO_CHANGE_ITEM = 'no-change';

/**
 * What a picker writes for a press, or undefined for nothing. Another option is written. The picked segment pressed
 * again lets the pick go (null); in the menu, "No change" does that, and the picked item again keeps it (a menu is
 * not a toggle). A picker that `holds` (a direction) always keeps a pick.
 */
export function pickerWrite<T extends string>(
  current: T | null,
  pressed: T | typeof NO_CHANGE_ITEM,
  from: 'segments' | 'menu',
  holds: boolean,
): T | null | undefined {
  if (pressed !== current && pressed !== NO_CHANGE_ITEM) return pressed;
  if (holds || current === null) return undefined;
  return pressed === NO_CHANGE_ITEM || from === 'segments' ? null : undefined;
}

export interface Span {
  left: number;
  right: number;
}

/** What a label that wraps counts as, in pixels past the box (its width cannot tell). */
export const WRAP_SPILL = 16;

/** How far a picker's segments reach past either side of the picker (`wraps`: a label wraps); 0 when they fit. */
export function spillOf(box: Span, segments: readonly Span[], wraps: boolean): number {
  return Math.max(0, ...segments.flatMap((segment) => [segment.right - box.right, box.left - segment.left]), wraps ? WRAP_SPILL : 0);
}

/** The width under which a picker shows a menu, from its segments measured at `width`; null when they fit. */
export const menuUnder = (width: number, spill: number): number | null => (spill > 0.5 ? width + spill : null);

/** Whether a picker showing its menu at `width` keeps it: the width it shows under, or null when the segments fit again. */
export const menuKept = (width: number, under: number | null): number | null => (under !== null && width >= under ? null : under);

/**
 * The layers are being read again, or were read before the film last changed: the picked layer's box and moment may
 * be old, so Ask waits.
 */
export const layersUpdating = (state: ReaderState, readAt: number, filmRevision: number): boolean => state === 'reading' || readAt !== filmRevision;
