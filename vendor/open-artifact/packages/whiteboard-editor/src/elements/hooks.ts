/**
 * Hooks the element views share:
 *
 * - {@link useBoardDerived}: a value computed from the shown board (other
 *   people's gestures in progress included, see `state/shown.ts`) and the
 *   DOM measures, re-rendering only when the value changes;
 * - {@link useMeasureNode}: reports a view's DOM size to the measures store;
 * - {@link useIsFeatured}: whether an element is hovered or the only one
 *   selected (where by-chips show);
 * - {@link useElementScreenRect}: an element's box on screen, for popovers
 *   other areas anchor to an element.
 *
 * None of them re-render on pan or zoom except the screen rect.
 */

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { elementBoundsWithTitle, type BoardElement, type ElementId, type ElementMeasures } from '@open-artifact/whiteboard-core';
import { boardToScreen, type Rect } from '../lib/camera.ts';
import { useBoard, type BoardState } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { reportMeasure, useMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { shownBoardState, useShown } from '../state/shown.ts';
import { effectiveTool, useTool } from '../state/tool.ts';

/* ------------------------------------------------------------------------ */
/* Derived values                                                           */
/* ------------------------------------------------------------------------ */

function subscribeBoardAndMeasures(listener: () => void): () => void {
  const offBoard = useBoard.subscribe(listener);
  const offShown = useShown.subscribe((state, previous) => {
    if (state.overrides !== previous.overrides) listener();
  });
  const offMeasures = useMeasures.subscribe(listener);
  return () => {
    offBoard();
    offShown();
    offMeasures();
  };
}

/**
 * A value derived from the shown board and the measures. `compute` runs
 * when either changes (or `key` does); the previous value is kept while
 * `equal` says nothing changed, so the component re-renders only on real
 * changes. `state.byId` holds the elements as drawn; `state.board` stays
 * the stored board.
 */
export function useBoardDerived<T>(compute: (state: BoardState, measures: ElementMeasures) => T, key: unknown, equal: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ board: unknown; overrides: unknown; measures: unknown; key: unknown; value: T } | null>(null);
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const equalRef = useRef(equal);
  equalRef.current = equal;
  const read = useCallback((): T => {
    const state = useBoard.getState();
    const overrides = useShown.getState().overrides;
    const measures = useMeasures.getState().measures;
    const cached = cache.current;
    if (cached && cached.board === state.board && cached.overrides === overrides && cached.measures === measures && Object.is(cached.key, key)) return cached.value;
    const next = computeRef.current(shownBoardState(state, overrides), measures);
    const value = cached && equalRef.current(cached.value, next) ? cached.value : next;
    cache.current = { board: state.board, overrides, measures, key, value };
    return value;
  }, [key]);
  return useSyncExternalStore(subscribeBoardAndMeasures, read, read);
}

/** Shallow equality of two arrays. */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
}

/* ------------------------------------------------------------------------ */
/* Measuring                                                                */
/* ------------------------------------------------------------------------ */

/**
 * What a measured node reports:
 * - `h`: its height (notes, tables);
 * - `wh`: its width and height (free text);
 * - `title`: its full text width, even when clipped (section titles).
 */
export type MeasureMode = 'h' | 'wh' | 'title';

/** Rounds a measured size to a quarter pixel (keeps reports stable). */
function quarter(value: number): number {
  return Math.round(value * 4) / 4;
}

function measureNode(id: ElementId, node: HTMLElement, mode: MeasureMode): void {
  if (!node.isConnected) return;
  if (mode === 'h') reportMeasure(id, { h: quarter(node.offsetHeight) });
  else if (mode === 'wh') reportMeasure(id, { w: quarter(node.offsetWidth), h: quarter(node.offsetHeight) });
  else reportMeasure(id, { w: quarter(Math.max(node.offsetWidth, node.scrollWidth)) });
}

/** Nodes being watched, with what they report. */
const watched = new WeakMap<Element, { id: ElementId; mode: MeasureMode }>();
let observer: ResizeObserver | null = null;

function sizeObserver(): ResizeObserver | null {
  if (observer || typeof ResizeObserver === 'undefined') return observer;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const target = watched.get(entry.target);
      if (target) measureNode(target.id, entry.target as HTMLElement, target.mode);
    }
  });
  return observer;
}

/**
 * Reports a node's size for element `id`: on mount, whenever `content`
 * changes (text, size, wrap…) and whenever the node resizes (fonts load).
 * Sizes are layout sizes, unaffected by the camera and by rotation.
 */
export function useMeasureNode<T extends HTMLElement>(id: ElementId, mode: MeasureMode, content: unknown) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node) measureNode(id, node, mode);
  }, [id, mode, content]);
  useLayoutEffect(() => {
    const node = ref.current;
    const sizes = sizeObserver();
    if (!node || !sizes) return;
    watched.set(node, { id, mode });
    sizes.observe(node);
    return () => {
      sizes.unobserve(node);
      watched.delete(node);
    };
  }, [id, mode]);
  return ref;
}

/* ------------------------------------------------------------------------ */
/* Featured elements                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Whether an element is "featured": the only one selected, or hovered with
 * the select tool. A face sticker's by-chip (who placed it) shows only then.
 */
export function useIsFeatured(id: ElementId): boolean {
  const selected = useSelection((state) => state.ids.length === 1 && state.ids[0] === id);
  const hovered = useSelection((state) => state.hover === id);
  const selecting = useTool((state) => effectiveTool(state) === 'select' && !state.commentMode);
  return selected || (hovered && selecting);
}

/* ------------------------------------------------------------------------ */
/* Screen rects                                                             */
/* ------------------------------------------------------------------------ */

/** An element's drawn box (section titles included) on screen, in surface pixels. */
export function elementScreenRect(element: BoardElement, measures: ElementMeasures): Rect | undefined {
  const box = elementBoundsWithTitle(element, measures, true);
  if (!box) return undefined;
  const camera = useCamera.getState().camera;
  const topLeft = boardToScreen(camera, { x: box.x, y: box.y });
  return { x: topLeft.x, y: topLeft.y, w: box.w * camera.zoom, h: box.h * camera.zoom };
}

function sameRect(a: Rect | undefined, b: Rect | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
}

/**
 * An element's box on screen (surface pixels), following the camera, the
 * element and its measured size; `undefined` when it is not on the board.
 * For popovers and pins anchored to an element.
 */
export function useElementScreenRect(id: ElementId | null): Rect | undefined {
  const zoomKey = useCamera((state) => `${state.camera.x},${state.camera.y},${state.camera.zoom}`);
  return useBoardDerived(
    (state, measures) => {
      const element = id === null ? undefined : state.byId.get(id);
      return element ? elementScreenRect(element, measures) : undefined;
    },
    `${id}|${zoomKey}`,
    sameRect,
  );
}
