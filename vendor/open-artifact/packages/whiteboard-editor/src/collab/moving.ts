/**
 * What this viewer is dragging right now, for the view context (`moving`)
 * and for issue checks (items in someone's hand are never reported).
 *
 * Watched from outside the tools: a press on an element followed by a move
 * past the drag threshold counts as moving that element (with the rest of
 * the selection when it is selected), until the press ends.
 */

import { create } from 'zustand';
import { surfaceRef } from '../canvas/BoardSurface.tsx';
import { DRAG_THRESHOLD_PX } from '../tools/gesture.ts';
import { effectiveTool } from '../state/tool.ts';
import { useSelection } from '../state/selection.ts';

interface MovingState {
  /** Ids being dragged (empty when nothing is). */
  ids: readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);

/** Ids this viewer is dragging. */
export const useMoving = create<MovingState>()(() => ({ ids: NONE }));

/** Starts watching drags; returns a function that stops. */
export function startMovingWatch(): () => void {
  let press: { pointerId: number; x: number; y: number; id: string } | null = null;
  const onDown = (event: PointerEvent): void => {
    const surface = surfaceRef.current;
    if (event.button !== 0 || !surface || !(event.target instanceof Element) || !surface.contains(event.target)) return;
    if (event.target.closest('[data-wb-chrome],[data-no-pan]') || effectiveTool() !== 'select') return;
    const id = event.target.closest('[data-wb-id]')?.getAttribute('data-wb-id');
    press = id ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id } : null;
  };
  const onMove = (event: PointerEvent): void => {
    if (!press || event.pointerId !== press.pointerId || useMoving.getState().ids.length > 0) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX) return;
    const selected = useSelection.getState().ids;
    useMoving.setState({ ids: selected.includes(press.id) ? [...selected] : [press.id] });
  };
  const onEnd = (event: PointerEvent): void => {
    if (!press || event.pointerId !== press.pointerId) return;
    press = null;
    if (useMoving.getState().ids.length > 0) useMoving.setState({ ids: NONE });
  };
  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  return () => {
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    useMoving.setState({ ids: NONE });
  };
}
