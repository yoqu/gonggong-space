/**
 * Layers later parts of the page lay over the picture (layer picking, text editing, guides). Each draws in a box
 * exactly over the film's picture, under the comment layer; it takes presses only where it draws something.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { PlayerBox } from '../stores/ui.ts';

export interface StageOverlayContext {
  /** The picture's box in the player. */
  box: PlayerBox;
  /** Film pixels to player pixels. */
  scale: number;
  filmWidth: number;
  filmHeight: number;
}

export interface StageOverlay {
  id: string;
  /** Lower draws first (under higher ones). */
  order: number;
  render: (context: StageOverlayContext) => ReactNode;
}

export const useStageOverlays = create<{ overlays: readonly StageOverlay[] }>()(() => ({ overlays: [] }));

export function registerStageOverlay(overlay: StageOverlay): () => void {
  useStageOverlays.setState((state) => ({
    overlays: [...state.overlays.filter((known) => known.id !== overlay.id), overlay].sort((a, b) => a.order - b.order),
  }));
  return () => useStageOverlays.setState((state) => ({ overlays: state.overlays.filter((known) => known !== overlay) }));
}
