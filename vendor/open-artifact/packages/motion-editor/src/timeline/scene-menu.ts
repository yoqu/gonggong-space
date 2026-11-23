/**
 * Items later parts of the page add to a scene card's menu (Tweaks: the scene's name, length and speed), between
 * "Ask for a change…" and "Delete scene…". Each renders inside the open menu, so a dialog it opens goes through
 * {@link SceneMenuContext.showDialog} to outlive the menu.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { PartSpan } from './timeline-math.ts';

export const SCENE_MENU_ORDER = { name: 10, length: 20, speed: 30 } as const;

export interface SceneMenuContext {
  span: PartSpan;
  /** Shows a dialog beside the menu until the function it is given is called. */
  showDialog(dialog: (close: () => void) => ReactNode): void;
}

export interface SceneMenuItem {
  id: string;
  order: number;
  /** It changes the film, so it is left out while the page is read-only. */
  writes?: boolean;
  render(context: SceneMenuContext): ReactNode;
}

export const useSceneMenu = create<{ items: readonly SceneMenuItem[] }>()(() => ({ items: [] }));

/** Adds an item (one with the same `id` gives way to it); returns a function that takes it away. */
export function registerSceneMenuItem(item: SceneMenuItem): () => void {
  useSceneMenu.setState((s) => ({ items: [...s.items.filter((known) => known.id !== item.id), item].sort((a, b) => a.order - b.order) }));
  return () => useSceneMenu.setState((s) => ({ items: s.items.filter((known) => known !== item) }));
}
