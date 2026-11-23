/**
 * The board store: the board as this page knows it (the live sync engine's
 * snapshot, normalized) plus a by-id index. Edits go through
 * {@link changeBoard}, which hands the next board to the sync engine and
 * records an undo step; the engine's snapshot then flows back here.
 */

import { create } from 'zustand';
import type { Board, BoardElement, ElementId } from '@open-artifact/whiteboard-core';

/**
 * Where the board stands with its store: `cached` while the store is out of
 * reach and the board shown is the saved copy on this device (edits wait).
 */
export type SyncStatus = 'loading' | 'cached' | 'ready' | 'offline' | 'error';

export interface BoardState {
  board: Board;
  /** Elements by id. */
  byId: ReadonlyMap<ElementId, BoardElement>;
  /** Index of each element in drawing order (back to front). */
  order: ReadonlyMap<ElementId, number>;
  status: SyncStatus;
  /** Why the last change could not be saved (too large, over budget), until the next good save. */
  refusal: string | null;
  /** Local changes not yet acknowledged by the store. */
  pending: number;
  /** A fatal load error. */
  error: string | null;
}

/** An empty board. */
export const EMPTY_BOARD: Board = { title: '', content: { elements: [] } };

function indexBoard(board: Board): Pick<BoardState, 'byId' | 'order'> {
  const byId = new Map<ElementId, BoardElement>();
  const order = new Map<ElementId, number>();
  board.content.elements.forEach((element, index) => {
    byId.set(element.id, element);
    order.set(element.id, index);
  });
  return { byId, order };
}

export const useBoard = create<BoardState>()(() => ({
  board: EMPTY_BOARD,
  ...indexBoard(EMPTY_BOARD),
  status: 'loading',
  refusal: null,
  pending: 0,
  error: null,
}));

/** Replaces the board (from the sync engine). Keeps identity when nothing changed. */
export function setBoardSnapshot(board: Board, status?: Partial<Pick<BoardState, 'status' | 'refusal' | 'pending' | 'error'>>): void {
  const current = useBoard.getState();
  const next: Partial<BoardState> = { ...status };
  if (board !== current.board) Object.assign(next, { board }, indexBoard(board));
  if (Object.keys(next).length) useBoard.setState(next);
}

/** Options of a change. */
export interface ChangeOptions {
  /** Short undo label, e.g. `Move`. */
  label?: string;
  /**
   * Merge with the previous undo step when it has the same key (a drag's
   * intermediate frames, typing). Omit for a step of its own.
   */
  coalesce?: string;
  /** Skip the undo history (remote-driven or cosmetic changes). */
  history?: boolean;
  /**
   * A follow-up of the change just made (a correction once the page has
   * measured it): joins that change's undo step, keeping its label.
   */
  follows?: boolean;
}

/** Receives local changes: the sync engine plus history (wired by `services/sync.ts`). */
export type BoardSink = (next: Board, previous: Board, options: ChangeOptions) => void;

let sink: BoardSink | null = null;

/** Wires the store to the sync engine. */
export function setBoardSink(next: BoardSink | null): void {
  sink = next;
}

/** Others told about local changes (after the sink), e.g. the live gesture sender. */
const localListeners = new Set<BoardSink>();

/** Calls `listener` after every local change; returns a function that stops. */
export function onLocalChange(listener: BoardSink): () => void {
  localListeners.add(listener);
  return () => {
    localListeners.delete(listener);
  };
}

/** Others told about remote changes (another page's or the agent's edit arriving), e.g. live gestures. */
const remoteListeners = new Set<(next: Board, previous: Board) => void>();

/** Calls `listener` after the board took a remote change; returns a function that stops. */
export function onRemoteChange(listener: (next: Board, previous: Board) => void): () => void {
  remoteListeners.add(listener);
  return () => {
    remoteListeners.delete(listener);
  };
}

/** Tells the remote-change listeners (the sync engine calls this once the store shows the change). */
export function tellRemoteChange(next: Board, previous: Board): void {
  if (next === previous) return;
  for (const listener of remoteListeners) listener(next, previous);
}

/**
 * Applies a local change. `recipe` returns the next board (or the same
 * board for "nothing to do"). The store updates at once (optimistic); the
 * sync engine saves it and may later merge remote edits.
 */
export function changeBoard(recipe: (board: Board) => Board, options: ChangeOptions = {}): boolean {
  const previous = useBoard.getState().board;
  const next = recipe(previous);
  if (next === previous) return false;
  setBoardSnapshot(next);
  sink?.(next, previous, options);
  for (const listener of localListeners) listener(next, previous, options);
  return true;
}

/** Changes the board's elements with a function over the element list. */
export function changeElements(recipe: (elements: readonly BoardElement[]) => readonly BoardElement[], options?: ChangeOptions): boolean {
  return changeBoard((board) => {
    const elements = recipe(board.content.elements);
    return elements === board.content.elements ? board : { ...board, content: { ...board.content, elements: [...elements] } };
  }, options);
}

/** Replaces some elements by id (`patch` returns the same object to skip one). */
export function updateElements(ids: Iterable<ElementId>, patch: (element: BoardElement) => BoardElement, options?: ChangeOptions): boolean {
  const wanted = new Set(ids);
  if (wanted.size === 0) return false;
  return changeElements((elements) => {
    let changed = false;
    const next = elements.map((element) => {
      if (!wanted.has(element.id)) return element;
      const updated = patch(element);
      if (updated !== element) changed = true;
      return updated;
    });
    return changed ? next : elements;
  }, options);
}

/** The current element of an id. */
export function elementById(id: ElementId): BoardElement | undefined {
  return useBoard.getState().byId.get(id);
}

/** Selects one element by id, re-rendering only when that element changes. */
export function useElement(id: ElementId): BoardElement | undefined {
  return useBoard((state) => state.byId.get(id));
}
