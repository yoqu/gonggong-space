/**
 * Painted drawing looks this page holds: the paint scale for the settled
 * zoom, and the object URL of every painted look by its key
 * (`lib/drawing-looks.ts`). The look service fills it; views select from it.
 */

import { create } from 'zustand';
import { LOOK_SCALE_RANGE } from '../lib/drawing-looks.ts';

export interface DrawingLooksState {
  /** The paint scale for the zoom the view last settled at. */
  scale: number;
  /** Object URLs of painted looks, by key. */
  painted: ReadonlyMap<string, string>;
}

export const useDrawingLooks = create<DrawingLooksState>()(() => ({ scale: LOOK_SCALE_RANGE.min, painted: new Map() }));
