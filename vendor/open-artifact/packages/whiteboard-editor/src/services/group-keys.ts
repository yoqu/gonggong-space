/**
 * What Enter and ⇧Enter do to groups:
 *
 * - ⇧Enter leaves the innermost group the focus item is inside and selects
 *   that whole group. When there is none to leave but the item belongs to
 *   a group, the key is taken and nothing changes.
 * - Enter (or F2) on an item whose group is selected as a whole steps into
 *   it: the next group down, or the item itself. When that is a group, or
 *   the key would do nothing to the item, the step is all the key does;
 *   otherwise the key goes on to act on the item (edit, open, use).
 *
 * The focus item is the first selected one (the item pressed, or walked to).
 * Steps apply only to a selection that is one item or one group, so a
 * mixed selection is never cut down to one of its parts.
 *
 * Pure: unit-tested. `keyboard.ts` runs the steps.
 */

import { exitInnermostGroup, expandSelectionToGroups, groupSelectionFor, selectionGroupCells, type BoardElement, type ElementId } from '@open-artifact/whiteboard-core';

/** The key as the group step sees it. */
export interface GroupKey {
  /** Enter (else F2). */
  enter: boolean;
  /** ⇧ is down. */
  shift: boolean;
  /** The key repeats (held down). */
  repeat: boolean;
  /** The key would act on the focus item (edit, open, use or run it again). */
  acts: boolean;
}

/**
 * A group step: select `select` (when given). `done` means the key ends
 * there (`announce`: a group of that many items, or one item); otherwise it
 * goes on to act on the item now selected alone.
 */
export type GroupKeyStep =
  | { select: ReadonlySet<ElementId>; done: true; announce: 'group' | 'one' }
  | { select: ReadonlySet<ElementId>; done: false }
  | { done: true };

/** The group step of `key` on `selection` (focus item first), or `undefined` when groups play no part. */
export function groupKeyStep(elements: readonly BoardElement[], selection: readonly ElementId[], key: GroupKey): GroupKeyStep | undefined {
  const focus = selection[0];
  if (focus === undefined) return undefined;
  const inside = new Set(selection);
  if (selectionGroupCells(elements, inside).length !== 1) return undefined;
  const grouped = (): boolean => expandSelectionToGroups(elements, new Set([focus]), inside).size > 1;

  if (key.enter && key.shift) {
    const outer = key.repeat ? undefined : exitInnermostGroup(elements, focus, inside);
    if (outer !== undefined) return { select: outer, done: true, announce: 'group' };
    return grouped() ? { done: true } : undefined;
  }

  const plainEnter = key.enter && !key.repeat && !key.acts;
  if (!key.acts && !plainEnter) return undefined;
  if (!grouped()) return undefined;
  const next = groupSelectionFor(elements, focus, inside);
  if (next.size > 1) return { select: next, done: true, announce: 'group' };
  return key.acts ? { select: next, done: false } : { select: next, done: true, announce: 'one' };
}
