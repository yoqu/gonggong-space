/**
 * Undo availability, mirrored from the history service so buttons and
 * menus re-render when it changes.
 */

import { create } from 'zustand';

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the step undo would revert (e.g. `Move`), for tooltips. */
  undoLabel: string | undefined;
  redoLabel: string | undefined;
}

export const useHistory = create<HistoryState>()(() => ({
  canUndo: false,
  canRedo: false,
  undoLabel: undefined,
  redoLabel: undefined,
}));
