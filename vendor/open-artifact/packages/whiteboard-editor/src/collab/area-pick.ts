/**
 * Picking an area to ask about: while the Ask panel is open (or the board
 * is empty and an agent is connected), a drag across an empty spot asks
 * about that area. Letting go opens the Ask panel scoped to it.
 *
 * The drag itself is the select tool's rubber band (`selection.marquee`),
 * already drawn like an area frame in the viewer's color (see
 * `selection/area-marquee.ts`): this module only watches it, keeps the
 * area it would pick in `useAreaPick`, and acts when it ends. Presses,
 * double-clicks and tools behave as always.
 */

import { create } from 'zustand';
import type { Rect } from '../lib/camera.ts';
import { useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { useAsk } from '../state/ask.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';

/** Screen pixels a drag must cover (each way) to pick an area. */
export const AREA_PICK_MIN_PX = 8;

interface AreaPickState {
  /** The area being dragged (board units), while it would pick an area. */
  rect: Rect | null;
}

/** The area being picked. */
export const useAreaPick = create<AreaPickState>()(() => ({ rect: null }));

/** True when a drag on an empty spot picks an area now. */
export function areaPickActive(): boolean {
  if (useTool.getState().commentMode) return false;
  if (useAsk.getState().open) return true;
  return useBoard.getState().board.content.elements.length === 0 && useAgent.getState().available && (maybeSession()?.canEdit ?? false);
}

/** True when a board rectangle is big enough on screen to pick. */
export function bigEnoughToPick(rect: Rect, zoom: number): boolean {
  return rect.w * zoom >= AREA_PICK_MIN_PX && rect.h * zoom >= AREA_PICK_MIN_PX;
}

/** Starts watching drags for area picks; returns a function that stops. */
export function startAreaPick(): () => void {
  if (!maybeSession()?.agent) return () => {};
  let picking = false;
  let cancelled = false;
  let last: Rect | null = null;
  const offMarquee = useSelection.subscribe((state, previous) => {
    if (state.marquee === previous.marquee) return;
    if (state.marquee !== null) {
      if (previous.marquee === null) {
        picking = areaPickActive();
        cancelled = false;
      }
      last = state.marquee;
      if (picking) useAreaPick.setState({ rect: state.marquee });
      return;
    }
    const rect = last;
    const pick = picking && !cancelled;
    picking = false;
    last = null;
    useAreaPick.setState({ rect: null });
    if (pick && rect && bigEnoughToPick(rect, useCamera.getState().camera.zoom)) useAsk.getState().show({ kind: 'area', rect });
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && picking) cancelled = true;
  };
  const onCancel = (): void => {
    if (picking) cancelled = true;
  };
  window.addEventListener('keydown', onKey, { capture: true });
  window.addEventListener('pointercancel', onCancel, { capture: true });
  return () => {
    offMarquee();
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('pointercancel', onCancel, { capture: true });
    useAreaPick.setState({ rect: null });
  };
}
