/**
 * The heat map color this viewer picked last, which the next heat map they
 * turn on takes. Kept for this page only.
 */

import { create } from 'zustand';
import type { FillColor } from '@open-artifact/whiteboard-core';

export interface TableHeatState {
  /** The color last picked for a heat map, if any. */
  lastPicked: FillColor | undefined;
  remember(color: FillColor): void;
}

export const useTableHeat = create<TableHeatState>()((set) => ({
  lastPicked: undefined,
  remember: (color) => set({ lastPicked: color }),
}));
