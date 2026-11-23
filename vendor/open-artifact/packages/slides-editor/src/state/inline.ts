/** The slide on screen in the inline view (see lib/inline-view.ts). */

import { create } from 'zustand';

interface InlineViewState {
  current: string | null;
  show(id: string | null): void;
}

export const useInlineView = create<InlineViewState>()((set) => ({
  current: null,
  show(current) {
    set({ current });
  },
}));
