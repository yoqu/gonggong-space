/**
 * Selecting and dragging slide thumbnails (rail, grid and canvas share it).
 *
 * - Click: show the slide (and select it alone); Shift-click: select the
 *   range from the last clicked slide; ⌘/Ctrl-click: toggle.
 * - Drag (past a few pixels): moves the selected slides (or the dragged one)
 *   to the gap under the pointer, or into an empty section dropped on.
 *
 * Thumbnails carry `data-slide-index` (their place in the deck order); empty
 * section headers carry `data-empty-section` (their key).
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useView } from '../state/view.ts';
import { setClipboardRegion } from '../services/clipboard.ts';
import { canChange, moveSlidesIntoSection, moveSlidesToGap, order } from '../services/commands.ts';
import { setDraggedSlides } from '../services/live.ts';

/** How thumbnails are laid out. */
export type DragAxis = 'y' | 'grid';

/** The slide last clicked (the anchor of Shift-click ranges). */
let anchor: string | null = null;

/** The drop gap (index into the order) at a point. */
export function gapAt(container: HTMLElement, x: number, y: number, axis: DragAxis): number {
  const thumbs = [...container.querySelectorAll<HTMLElement>('[data-slide-index]')];
  if (thumbs.length === 0) return 0;
  let best: { el: HTMLElement; d: number } | null = null;
  for (const el of thumbs) {
    const r = el.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    // In a grid, rows matter more than columns.
    const d = axis === 'grid' ? dy * 4 + dx : dy;
    if (!best || d < best.d) best = { el, d };
  }
  const r = best!.el.getBoundingClientRect();
  const index = Number(best!.el.dataset.slideIndex);
  const after = axis === 'grid' ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
  return index + (after ? 1 : 0);
}

/**
 * Applies a press on slide `id` to the slide selection, as a click in the
 * rail, grid or canvas does: Shift extends a range from the last clicked
 * slide, ⌘/Ctrl toggles, a plain press shows the slide (keeping a selection
 * it belongs to, so the selection can be dragged). Returns true for a plain
 * press, which may go on to drag.
 */
export function pressSlide(id: string, mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  setClipboardRegion('slides');
  const view = useView.getState();
  const all = order();
  const selected = view.slideSelection.includes(id);
  if (mods.shiftKey && anchor && all.includes(anchor)) {
    const a = all.indexOf(anchor);
    const b = all.indexOf(id);
    const range = all.slice(Math.min(a, b), Math.max(a, b) + 1);
    view.selectSlides(range);
    if (view.current !== id) view.showSlide(id, { keepSelection: true });
    useView.getState().selectSlides(range);
    return false;
  }
  if (mods.metaKey || mods.ctrlKey) {
    const next = selected ? view.slideSelection.filter((s) => s !== id) : [...view.slideSelection, id];
    view.selectSlides(next.length ? next : [id]);
    anchor = id;
    return false;
  }
  anchor = id;
  if (!selected) view.showSlide(id);
  else if (view.current !== id) {
    const keep = view.slideSelection;
    view.showSlide(id);
    useView.getState().selectSlides(keep);
  }
  return true;
}

/** Drag state shown by the caller. */
export interface SlideDragState {
  /** Slides being dragged. */
  ids: string[];
  /** Empty section under the pointer. */
  section: string | null;
}

/** Pointer handling for slide thumbnails inside `container`. */
export function useSlideDrag(container: RefObject<HTMLElement | null>, axis: DragAxis) {
  const [drag, setDrag] = useState<SlideDragState | null>(null);
  const live = useRef<SlideDragState | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0) return;
      const selected = useView.getState().slideSelection.includes(id);
      if (!pressSlide(id, event)) return;
      const all = order();
      const startX = event.clientX;
      const startY = event.clientY;
      const target = event.currentTarget;
      const pointer = event.pointerId;
      let moved = false;
      const ids = (): string[] => {
        const sel = useView.getState().slideSelection;
        return sel.includes(id) ? all.filter((s) => sel.includes(s)) : [id];
      };
      const move = (e: PointerEvent): void => {
        if (!moved) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5 || !canChange()) return;
          moved = true;
          target.setPointerCapture?.(pointer);
          live.current = { ids: ids(), section: null };
          setDrag(live.current);
          setDraggedSlides(live.current.ids);
        }
        const box = container.current;
        if (!box) return;
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-empty-section]');
        const section = over?.dataset.emptySection ?? null;
        if (section !== live.current!.section) {
          live.current = { ...live.current!, section };
          setDrag(live.current);
        }
        useView.getState().setDropGap(section ? null : gapAt(box, e.clientX, e.clientY, axis));
        // Scroll while dragging near the edges.
        const r = box.getBoundingClientRect();
        if (e.clientY < r.top + 32) box.scrollBy(0, -12);
        else if (e.clientY > r.bottom - 32) box.scrollBy(0, 12);
      };
      const finish = (commit: boolean): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key);
        const state = live.current;
        const gap = useView.getState().dropGap;
        useView.getState().setDropGap(null);
        live.current = null;
        setDrag(null);
        setDraggedSlides([]);
        if (!moved) {
          // A plain click inside a multi-selection selects just this slide.
          if (commit && selected && useView.getState().slideSelection.length > 1) useView.getState().selectSlides([id]);
          return;
        }
        if (!commit || !state) return;
        if (state.section) moveSlidesIntoSection(state.ids, state.section, 0);
        else if (gap !== null) moveSlidesToGap(state.ids, gap);
      };
      const up = (): void => finish(true);
      const cancel = (): void => finish(false);
      const key = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') finish(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key);
    },
    [axis, container],
  );

  return { drag, onPointerDown };
}
