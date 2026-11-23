import { create } from 'zustand';
import type { PlaySeconds } from '@open-artifact/motion-core';

/** A box in the player's own pixels (relative to the player's top-left corner). */
export interface PlayerBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type NoticeTone = 'info' | 'warning' | 'error';

/** A message that stays over the player until dismissed (toasts are for passing ones). */
export interface Notice {
  id: string;
  tone: NoticeTone;
  text: string;
  action?: { label: string; run: () => void };
}

export interface UiState {
  /** The open side panel's id (see `panels/registry.ts`), or `null`. */
  panel: string | null;
  /** The panel last open, which Mod+\ opens again. */
  lastPanel: string | null;
  /** Focus mode: the chrome steps aside while the film plays. */
  focus: boolean;
  fullscreen: boolean;
  /** The player's size, and where the film's picture sits in it (letterboxed). */
  playerSize: { width: number; height: number };
  stageBox: PlayerBox | null;
  /** The moment under the pointer on the timeline, for its preview. */
  hoverTime: PlaySeconds | null;
  notices: Notice[];
  openPanel(id: string | null): void;
  setFocus(focus: boolean): void;
  addNotice(notice: Notice): void;
  dismissNotice(id: string): void;
}

export const useUi = create<UiState>()((set) => ({
  panel: null,
  lastPanel: null,
  focus: false,
  fullscreen: false,
  playerSize: { width: 0, height: 0 },
  stageBox: null,
  hoverTime: null,
  notices: [],
  openPanel: (id) => set((state) => ({ panel: id, lastPanel: id ?? state.lastPanel })),
  setFocus: (focus) => set({ focus }),
  addNotice: (notice) => set((state) => ({ notices: [...state.notices.filter((known) => known.id !== notice.id), notice] })),
  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
}));
