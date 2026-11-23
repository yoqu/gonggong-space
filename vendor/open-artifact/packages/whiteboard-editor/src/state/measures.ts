/**
 * Sizes the page measured in the DOM (a note's rendered height, a text's
 * width, a section title's room, an arrow label's words). Geometry falls
 * back to estimates for anything not measured yet.
 *
 * Element views report as they lay out; reports are batched into one store
 * update per microtask, and the map is replaced (never mutated) so the
 * geometry caches keyed by it stay correct.
 */

import { create } from 'zustand';
import type { ElementId, ElementMeasure, ElementMeasures } from '@open-artifact/whiteboard-core';

interface MeasuresState {
  measures: ElementMeasures;
}

/** The measured sizes store. */
export const useMeasures = create<MeasuresState>()(() => ({ measures: new Map() }));

/** The current measured sizes (outside React). */
export function currentMeasures(): ElementMeasures {
  return useMeasures.getState().measures;
}

const pending = new Map<ElementId, ElementMeasure | null>();
let scheduled = false;

function sameMeasure(a: ElementMeasure | undefined, b: ElementMeasure | null): boolean {
  if (a === undefined || b === null) return a === undefined && b === null;
  return a.w === b.w && a.h === b.h && a.sectionH === b.sectionH && a.titleMost === b.titleMost && JSON.stringify(a.label) === JSON.stringify(b.label);
}

function flush(): void {
  scheduled = false;
  const previous = currentMeasures();
  let next: Map<ElementId, ElementMeasure> | null = null;
  for (const [id, measure] of pending) {
    if (sameMeasure(previous.get(id), measure)) continue;
    next ??= new Map(previous);
    if (measure === null) next.delete(id);
    else next.set(id, measure);
  }
  pending.clear();
  if (next) useMeasures.setState({ measures: next });
}

/**
 * Reports what an element measured, merged over what it reported before;
 * `null` forgets the element (it left the board).
 */
export function reportMeasure(id: ElementId, measure: Partial<ElementMeasure> | null): void {
  if (measure === null) pending.set(id, null);
  else {
    const base = pending.get(id) ?? currentMeasures().get(id) ?? {};
    const merged: ElementMeasure = { ...base };
    for (const [key, value] of Object.entries(measure) as Array<[keyof ElementMeasure, ElementMeasure[keyof ElementMeasure]]>) {
      if (value === undefined) delete merged[key];
      else (merged as Record<string, unknown>)[key] = value;
    }
    pending.set(id, merged);
  }
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}
