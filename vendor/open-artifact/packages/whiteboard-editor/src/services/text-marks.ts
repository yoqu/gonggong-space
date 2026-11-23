/**
 * ⌘B / ⌘I on the selection (not while typing): bold or italic on the whole
 * text of the selected notes, shapes and texts, as one "Edit text" undo
 * step (see `elements/mark-across.ts` for which way it goes). Notes and
 * shapes grow to fit the marked text, as after typing.
 */

import { autoFitPatch, isElementLocked, TEXT_CUT_NOTICE } from '@open-artifact/whiteboard-core';
import { markDisabledReason, richTextTargets, toggleMarkAcross, type TextMark } from '../elements/mark-across.ts';
import { updateElements } from '../state/board.ts';
import { useTool } from '../state/tool.ts';
import { canEditBoard, selectedElements } from './actions.ts';
import { announce, notify } from './announce.ts';

/** Said once marked text is written. */
export const TEXT_UPDATED_MESSAGE = 'Text updated';

/**
 * Toggles a mark over the selection. Returns `true` when the selection is
 * one the shortcut belongs to (the key is then taken, even when nothing
 * changes); `false` leaves the key alone.
 */
export function toggleSelectionMark(mark: TextMark, repeat = false): boolean {
  if (!canEditBoard() || useTool.getState().commentMode) return false;
  const targets = richTextTargets(selectedElements()).filter((element) => !isElementLocked(element));
  if (targets.length === 0) return false;
  if (repeat) return true;
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    const reason = markDisabledReason(mark, only);
    if (reason !== '') {
      announce(reason);
      return true;
    }
  }
  const { texts, cut } = toggleMarkAcross(targets, mark);
  if (texts.size === 0) return true;
  const changed = updateElements(
    texts.keys(),
    (element) => {
      const text = texts.get(element.id);
      if (text === undefined) return element;
      if (element.type === 'note' || element.type === 'shape') {
        const next = { ...element, text };
        return { ...next, ...autoFitPatch(next) };
      }
      return element.type === 'text' ? { ...element, text } : element;
    },
    { label: 'Edit text' },
  );
  if (changed) announce(TEXT_UPDATED_MESSAGE);
  if (cut) notify(TEXT_CUT_NOTICE);
  return true;
}
