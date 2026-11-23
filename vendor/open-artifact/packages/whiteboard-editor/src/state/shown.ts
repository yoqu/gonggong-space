/**
 * Elements drawn differently from the stored board for a moment: other
 * people's gestures in progress (see `collab/peer-hands.ts`). A note a
 * peer is dragging is drawn where their pointer has it, the arrows joined
 * to it follow, and a duplicate they are Alt-dragging is drawn before it
 * is saved.
 *
 * Only the element layer and what is drawn around elements read the
 * *shown* board ({@link useShownElement}, {@link shownBoardState}). Every
 * edit, save, tool and the undo history read the stored board
 * (`state/board.ts`), so nothing here is ever saved.
 *
 * The store also queues *settle glides*: elements whose drawn place jumped
 * (a peer's edit arriving, a peer's gesture ending away from the drag)
 * start from where they were drawn and slide into place.
 */

import { create } from 'zustand';
import type { BoardElement, ElementId } from '@open-artifact/whiteboard-core';
import { useBoard, useElement, type BoardState } from './board.ts';

/** One element sliding into place: it starts drawn `dx`, `dy` board units away from where it is. */
export interface SettleGlide {
  id: ElementId;
  dx: number;
  dy: number;
}

export interface ShownState {
  /** Elements drawn differently from the stored board: the element as drawn, or `null` for one hidden. */
  overrides: ReadonlyMap<ElementId, BoardElement | null>;
  /** Glides to start once the elements are drawn at their new places (a new array each time). */
  glides: readonly SettleGlide[];
}

const NO_OVERRIDES: ReadonlyMap<ElementId, BoardElement | null> = new Map();
const NO_GLIDES: readonly SettleGlide[] = [];

/** The shown board's differences from the stored board. */
export const useShown = create<ShownState>()(() => ({ overrides: NO_OVERRIDES, glides: NO_GLIDES }));

/** Replaces the overrides (none with an empty map) and queues `glides`, in one update. */
export function setShown(overrides: ReadonlyMap<ElementId, BoardElement | null>, glides: readonly SettleGlide[] = NO_GLIDES): void {
  const current = useShown.getState();
  const next: Partial<ShownState> = {};
  if (overrides !== current.overrides) next.overrides = overrides.size === 0 ? NO_OVERRIDES : overrides;
  if (glides.length > 0) next.glides = glides;
  if (next.overrides !== undefined || next.glides !== undefined) useShown.setState(next);
}

/* ------------------------------------------------------------------------ */
/* Reading the shown board                                                  */
/* ------------------------------------------------------------------------ */

let mergedFor: { byId: ReadonlyMap<ElementId, BoardElement>; overrides: ReadonlyMap<ElementId, BoardElement | null>; merged: ReadonlyMap<ElementId, BoardElement> } | null = null;

/** The stored elements by id with the overrides applied (the same map when there are none). */
export function shownById(byId: ReadonlyMap<ElementId, BoardElement>, overrides: ReadonlyMap<ElementId, BoardElement | null>): ReadonlyMap<ElementId, BoardElement> {
  if (overrides.size === 0) return byId;
  if (mergedFor?.byId === byId && mergedFor.overrides === overrides) return mergedFor.merged;
  const merged = new Map(byId);
  for (const [id, element] of overrides) {
    if (element === null) merged.delete(id);
    else merged.set(id, element);
  }
  mergedFor = { byId, overrides, merged };
  return merged;
}

let stateFor: { state: BoardState; overrides: ReadonlyMap<ElementId, BoardElement | null>; shown: BoardState } | null = null;

/**
 * The board state with `byId` replaced by the shown elements (the same
 * state when nothing is overridden). Its `board` stays the stored board.
 */
export function shownBoardState(state: BoardState, overrides: ReadonlyMap<ElementId, BoardElement | null> = useShown.getState().overrides): BoardState {
  if (overrides.size === 0) return state;
  if (stateFor?.state === state && stateFor.overrides === overrides) return stateFor.shown;
  const shown: BoardState = { ...state, byId: shownById(state.byId, overrides) };
  stateFor = { state, overrides, shown };
  return shown;
}

/** One element as shown, re-rendering only when it changes. */
export function useShownElement(id: ElementId): BoardElement | undefined {
  const stored = useElement(id);
  const override = useShown((state) => state.overrides.get(id));
  return override === undefined ? stored : (override ?? undefined);
}

/** The shown elements by id. */
export function useShownById(): ReadonlyMap<ElementId, BoardElement> {
  const byId = useBoard((state) => state.byId);
  const overrides = useShown((state) => state.overrides);
  return shownById(byId, overrides);
}

/** Ids of shown elements that are not on the stored board yet, in override order. */
export function useShownAdditions(): readonly ElementId[] {
  const byId = useBoard((state) => state.byId);
  const overrides = useShown((state) => state.overrides);
  return additionsOf(byId, overrides);
}

let additionsFor: { byId: ReadonlyMap<ElementId, BoardElement>; overrides: ReadonlyMap<ElementId, BoardElement | null>; ids: readonly ElementId[] } | null = null;
const NO_IDS: readonly ElementId[] = [];

function additionsOf(byId: ReadonlyMap<ElementId, BoardElement>, overrides: ReadonlyMap<ElementId, BoardElement | null>): readonly ElementId[] {
  if (overrides.size === 0) return NO_IDS;
  if (additionsFor?.byId === byId && additionsFor.overrides === overrides) return additionsFor.ids;
  const ids = [...overrides].flatMap(([id, element]) => (element !== null && !byId.has(id) ? [id] : []));
  const same = additionsFor !== null && additionsFor.ids.length === ids.length && additionsFor.ids.every((id, index) => id === ids[index]);
  additionsFor = { byId, overrides, ids: same ? additionsFor!.ids : ids.length === 0 ? NO_IDS : ids };
  return additionsFor.ids;
}
