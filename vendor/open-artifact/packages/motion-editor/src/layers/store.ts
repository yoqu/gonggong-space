/**
 * The Layers section's state: the stage's last reading of the layers, the picked and pointed-at layer, the rows the
 * list has open, the picked text's styles, what Animate has picked, and the changes by hand still being dragged.
 */

import { create } from 'zustand';
import { EMPTY_LAYER_MOTION_CHOICE, type LayerMotionChoice, type RetouchProperty } from '@open-artifact/motion-core';
import type { AskedLook, LayersReport } from '@open-artifact/motion-stage/protocol';
import type { SeenTarget } from './entry.ts';
import type { LayerStretch } from './stretch.ts';

/**
 * off: the section is not reading (the Tweaks panel is shut, the film is not ready); playing: the film plays;
 * reading: a reading is under way; read: the rows are the stretch's; failed: the stage could not read them.
 */
export type ReaderState = 'off' | 'playing' | 'reading' | 'read' | 'failed';

export interface AskedStyles {
  /** The row whose styles were asked. */
  id: string;
  seq: number;
  state: 'reading' | 'read' | 'failed';
  look: AskedLook | null;
}

export interface LayersState {
  state: ReaderState;
  /** The last reading that found rows (kept while a new one is under way). */
  report: LayersReport | null;
  /** The stretch the report is of. */
  stretch: LayerStretch | null;
  /** The film revision the report was read at. */
  revision: number;
  pickedId: string | null;
  /** The row under the pointer (on the picture or in the list). */
  nearId: string | null;
  /** Cmd or Ctrl is held: a press picks the innermost layer. */
  deep: boolean;
  /** Rows the list shows open. */
  open: ReadonlySet<string>;
  styles: AskedStyles | null;
  choice: LayerMotionChoice;
  /** Values being dragged, by `<row id> <property>`, laid on the stage and not yet written. */
  live: ReadonlyMap<string, string | number>;
  /** `<entry> <property>`: set by this page since the last reading. */
  touched: ReadonlySet<string>;
  /** Entries this page made for things of the current reading. */
  seen: readonly SeenTarget[];
}

export const INITIAL_LAYERS: Omit<LayersState, never> = {
  state: 'off',
  report: null,
  stretch: null,
  revision: -1,
  pickedId: null,
  nearId: null,
  deep: false,
  open: new Set(),
  styles: null,
  choice: EMPTY_LAYER_MOTION_CHOICE,
  live: new Map(),
  touched: new Set(),
  seen: [],
};

export const useLayers = create<LayersState>()(() => ({ ...INITIAL_LAYERS }));

export const liveKey = (rowId: string, property: RetouchProperty): string => `${rowId} ${property}`;

/** The rows of the last reading, or null. */
export const selectRows = (state: LayersState) => state.report?.rows ?? null;

export function setOpen(id: string, open: boolean): void {
  useLayers.setState((state) => {
    if (state.open.has(id) === open) return state;
    const next = new Set(state.open);
    if (open) next.add(id);
    else next.delete(id);
    return { open: next };
  });
}

export function setNear(id: string | null): void {
  if (useLayers.getState().nearId !== id) useLayers.setState({ nearId: id });
}

export function setChoice(change: Partial<LayerMotionChoice>): void {
  useLayers.setState((state) => ({ choice: { ...state.choice, ...change } }));
}

export function clearChoice(): void {
  useLayers.setState({ choice: EMPTY_LAYER_MOTION_CHOICE });
}
