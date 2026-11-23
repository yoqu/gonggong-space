/**
 * Dragging section rows in the Grid and Canvas views. A press on a section
 * label that travels a few pixels picks up the selected sections (or the
 * pressed one) with their slides; the drop lands them, in order, at the gap
 * between rows nearest the pointer. Escape cancels.
 *
 * Rows carry `data-section-row="<row index>"` and `data-section-key` (empty
 * for the opening run) inside a `[data-section-rows]` container; the views
 * draw the insertion line from {@link useSectionDrag}.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { useView } from '../../state/view.ts';
import { canChange, moveSections } from '../../services/commands.ts';

/** A section drag in progress. */
export interface SectionDragState {
  /** The sections being moved, in outline order. */
  keys: string[];
  /** The gap between rows (0 = before the first row) the drop would land in. */
  gap: number | null;
}

interface SectionDragStore {
  drag: SectionDragState | null;
}

/** The section drag, while one is in progress. */
export const useSectionDrag = create<SectionDragStore>()(() => ({ drag: null }));

/** Screen pixels the pointer travels before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/** The gap between rows nearest a client y (rows are stacked top to bottom). */
export function rowGapAt(container: Element, clientY: number): number {
  const rows = [...container.querySelectorAll<HTMLElement>('[data-section-row]')];
  let gap = rows.length;
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) {
      gap = Number(row.dataset.sectionRow);
      break;
    }
  }
  return gap;
}

/**
 * Starts following a press on the label of section `key` (the label's own
 * pointerdown has already updated the section selection).
 */
export function startSectionDrag(event: ReactPointerEvent<HTMLElement>, key: string): void {
  if (event.button !== 0 || !canChange()) return;
  const container = event.currentTarget.closest('[data-section-rows]');
  if (!container) return;
  const rowKeys = [...container.querySelectorAll<HTMLElement>('[data-section-row]')].map((row) => row.dataset.sectionKey || null);
  const startX = event.clientX;
  const startY = event.clientY;
  let moving = false;

  const keysToMove = (): string[] => {
    const selected = useView.getState().sectionSelection;
    const keys = selected.includes(key) ? selected : [key];
    // In outline order; the opening run (no section) never moves.
    return rowKeys.filter((k): k is string => k !== null && keys.includes(k));
  };

  const move = (e: PointerEvent): void => {
    if (!moving) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      moving = true;
      document.body.style.cursor = 'grabbing';
    }
    useSectionDrag.setState({ drag: { keys: keysToMove(), gap: rowGapAt(container, e.clientY) } });
    // Scroll a scrolling container near its edges.
    const box = container.closest<HTMLElement>('[data-section-scroll]');
    if (box) {
      const r = box.getBoundingClientRect();
      if (e.clientY < r.top + 32) box.scrollBy(0, -12);
      else if (e.clientY > r.bottom - 32) box.scrollBy(0, 12);
    }
  };
  const finish = (commit: boolean): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key_, true);
    document.body.style.cursor = '';
    const drag = useSectionDrag.getState().drag;
    useSectionDrag.setState({ drag: null });
    // A plain click inside a multi-selection selects just this section.
    if (!moving) {
      if (commit && useView.getState().sectionSelection.length > 1) useView.getState().selectSections([key]);
      return;
    }
    if (commit && drag && drag.gap !== null && drag.keys.length) moveSections(drag.keys, drag.gap);
  };
  const up = (): void => finish(true);
  const cancel = (): void => finish(false);
  const key_ = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !moving) return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key_, true);
}
