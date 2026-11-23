/**
 * The Ask panel: where a person writes a request for the agent about the
 * board, a selection or an area. Opening it never starts a turn; sending does.
 */

import { create } from 'zustand';
import type { Rect } from '../lib/camera.ts';

/** What a request is about. */
export type AskScope =
  /** The whole board (the visible part is sent as context). */
  | { kind: 'board' }
  /** Selected elements. */
  | { kind: 'selection'; ids: string[] }
  /** An area dragged on the board (board coordinates). */
  | { kind: 'area'; rect: Rect };

export interface AskState {
  open: boolean;
  scope: AskScope;
  /** Draft text, kept while the panel is closed. */
  draft: string;
  /** Opens the panel (about the board unless a scope is given). */
  show(scope?: AskScope): void;
  hide(): void;
  toggle(): void;
  setDraft(text: string): void;
}

export const useAsk = create<AskState>()((set, get) => ({
  open: false,
  scope: { kind: 'board' },
  draft: '',
  show(scope) {
    set({ open: true, scope: scope ?? { kind: 'board' } });
  },
  hide() {
    set({ open: false });
  },
  toggle() {
    if (get().open) set({ open: false });
    else set({ open: true, scope: { kind: 'board' } });
  },
  setDraft(text) {
    set({ draft: text });
  },
}));
