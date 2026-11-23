/**
 * View-only state of the element layer, shared with the tools and the
 * collaboration layer without touching the board:
 *
 * - `frozen`: sections that must not grow to fit their contents right now
 *   (a section being resized keeps the size the person drags it to);
 * - `lifted`: elements drawn with the "picked up" look while dragged;
 * - `reading` / `readingSize`: each element's position in reading order,
 *   which the layer computes once for every view's spoken label;
 * - `backdrops`: the fill behind each free text (so its ink reads on it).
 *
 * The layer writes `reading` and `backdrops`; other areas call the setters.
 */

import { create } from 'zustand';
import type { ElementId } from '@open-artifact/whiteboard-core';

/** The element layer's view state (see the module comment). */
export interface ElementViewState {
  frozen: ReadonlySet<ElementId> | null;
  lifted: ReadonlySet<ElementId>;
  reading: ReadonlyMap<ElementId, number>;
  readingSize: number;
  backdrops: ReadonlyMap<ElementId, string>;
}

const NONE: ReadonlySet<ElementId> = new Set();

/** The element layer's view state. */
export const useElementView = create<ElementViewState>()(() => ({
  frozen: null,
  lifted: NONE,
  reading: new Map(),
  readingSize: 0,
  backdrops: new Map(),
}));

/** Freezes sections at their current size (`null` lets them grow again). */
export function setFrozenSections(ids: ReadonlySet<ElementId> | null): void {
  useElementView.setState({ frozen: ids });
}

/** Sets the elements drawn lifted (being dragged). */
export function setLiftedElements(ids: ReadonlySet<ElementId>): void {
  useElementView.setState({ lifted: ids.size === 0 ? NONE : ids });
}
