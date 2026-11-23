/**
 * Transient UI state: which dialog or popover is open. Kept apart from the
 * view store so opening a dialog never re-renders the stage.
 */

import { create } from 'zustand';

/** The dialogs of the editor. */
export type DialogId = 'newSlide' | 'scale' | 'videoLink' | 'shortcuts' | 'table';

interface UiState {
  dialog: DialogId | null;
  open(dialog: DialogId): void;
  close(): void;
}

/** The UI store. */
export const useUi = create<UiState>()((set) => ({
  dialog: null,
  open(dialog) {
    set({ dialog });
  },
  close() {
    set({ dialog: null });
  },
}));
