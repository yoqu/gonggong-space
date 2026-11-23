/**
 * Push-down while typing: as an edit makes a free text taller, the items
 * right below it move down by the growth (see `planTextPush`). The moves
 * share the edit's undo step; when the edit ends with the text removed,
 * they are taken back first.
 */

import { elementLayoutBox, moveElements, planTextPush, textPushGrowth, type ElementId, type TextPushPlan } from '@open-artifact/whiteboard-core';
import { editCoalesceKey } from '../elements/TextEditor.tsx';
import { useBoard } from '../state/board.ts';
import { currentMeasures, useMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { boardElements, canEditBoard, editContent } from './actions.ts';

interface ActivePush {
  plan: TextPushPlan;
  /** How far the plan's items are pushed now. */
  applied: number;
}

const pushes = new Map<ElementId, ActivePush>();

/** Moves a push's items to `growth` below where they started. */
function pushTo(push: ActivePush, growth: number): void {
  const delta = growth - push.applied;
  if (delta === 0) return;
  const frames = push.plan.frames.map((frame) => ({ ...frame, y: frame.y + push.applied }));
  editContent((content) => moveElements(content, push.plan.ids, 0, delta, frames), { label: 'Edit text', coalesce: editCoalesceKey(push.plan.id) });
  push.applied = growth;
}

function follow(): void {
  const { byId } = useBoard.getState();
  const measures = currentMeasures();
  for (const [id, push] of pushes) {
    const text = byId.get(id);
    if (text?.type !== 'text') {
      pushes.delete(id);
      continue;
    }
    pushTo(push, textPushGrowth(push.plan, elementLayoutBox(text, measures)));
  }
}

/**
 * Ends the push of the text `id`: the moves stay with `keep`, and are taken
 * back otherwise (the text is about to be removed).
 */
export function finishTextPush(id: ElementId, keep: boolean): void {
  const push = pushes.get(id);
  if (push === undefined) return;
  if (!keep) pushTo(push, 0);
  pushes.delete(id);
}

/** Starts pushing items down while texts grow during an edit; returns a function that stops. */
export function startTextPush(): () => void {
  const offSelection = useSelection.subscribe((state, previous) => {
    const editing = state.editing;
    if (editing === previous.editing || editing?.kind !== 'element' || pushes.has(editing.id) || !canEditBoard()) return;
    const plan = planTextPush(boardElements(), editing.id, currentMeasures());
    if (plan !== undefined) pushes.set(editing.id, { plan, applied: 0 });
  });
  const offMeasures = useMeasures.subscribe(() => {
    if (pushes.size > 0) follow();
  });
  return () => {
    offSelection();
    offMeasures();
    pushes.clear();
  };
}
