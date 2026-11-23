/**
 * Buttons later parts of the page add to the bottom toolbar. `start` items follow the playback controls; `end`
 * items sit before full screen, ordered by {@link TOOLBAR_ORDER} so Properties, Theme, Layers, Export and Comments keep
 * their places whichever registers first.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';

export const TOOLBAR_ORDER = { tweaks: 10, style: 20, layers: 30, export: 40, comments: 50 } as const;

export interface ToolbarItem {
  id: string;
  side: 'start' | 'end';
  order: number;
  render: () => ReactNode;
}

export const useToolbar = create<{ items: readonly ToolbarItem[] }>()(() => ({ items: [] }));

export function registerToolbarItem(item: ToolbarItem): () => void {
  useToolbar.setState((state) => ({ items: [...state.items.filter((known) => known.id !== item.id), item].sort((a, b) => a.order - b.order) }));
  return () => useToolbar.setState((state) => ({ items: state.items.filter((known) => known !== item) }));
}
