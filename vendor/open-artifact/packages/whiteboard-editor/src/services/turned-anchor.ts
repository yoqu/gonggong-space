/**
 * Keeps a turned note's or text's anchor corner in place when a format
 * change (size, alignment, marks across items) makes it bigger or smaller
 * (see `keepTurnedAnchor`). Typing, moves, turns and resizes are left
 * alone. Texts are sized by the page, so the correction waits for the new
 * measure, then joins the change's undo step.
 */

import { elementLayoutBox, elementTurn, keepTurnedAnchor, type BoardElement, type Box, type ElementId } from '@open-artifact/whiteboard-core';
import { editCoalesceKey } from '../elements/TextEditor.tsx';
import { textAlignOf } from '../export/look.ts';
import { onLocalChange, useBoard, type ChangeOptions } from '../state/board.ts';
import { currentMeasures, useMeasures } from '../state/measures.ts';
import { patchElements } from './actions.ts';

/** How long a change waits for the measure that shows its new size. */
const SETTLE_MS = 1000;

/** Fields whose change is not a format change (the item moved, turned or was resized). */
const PLACEMENT_FIELDS: ReadonlySet<string> = new Set(['x', 'y', 'w', 'wrap', 'turn', 'tilt']);

interface Waiting {
  /** The box before the change. */
  box: Box;
  /** How the change was recorded (one kept out of the history keeps its correction out too). */
  options: ChangeOptions;
  at: number;
}

const waiting = new Map<ElementId, Waiting>();

/** The angle an item is drawn at (a note's tilt included). */
function drawnDegrees(element: BoardElement): number {
  return elementTurn(element) + (element.type === 'note' ? element.tilt : 0);
}

function isFormatChange(before: BoardElement, after: BoardElement): boolean {
  if (before.type !== after.type) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = false;
  for (const key of keys) {
    if (Reflect.get(before, key) === Reflect.get(after, key)) continue;
    if (PLACEMENT_FIELDS.has(key)) return false;
    changed = true;
  }
  return changed;
}

/** Moves the waiting items whose size now differs so their anchor corners stay put. */
function settle(): void {
  if (waiting.size === 0) return;
  const now = Date.now();
  const { byId } = useBoard.getState();
  const measures = currentMeasures();
  for (const [id, wait] of waiting) {
    const element = byId.get(id);
    if ((element?.type !== 'note' && element?.type !== 'text') || now - wait.at > SETTLE_MS || element.x !== wait.box.x || element.y !== wait.box.y) {
      waiting.delete(id);
      continue;
    }
    const box = elementLayoutBox(element, measures);
    if (box === undefined || (box.w === wait.box.w && box.h === wait.box.h)) continue;
    waiting.delete(id);
    const at = keepTurnedAnchor(wait.box, drawnDegrees(element), box.w, box.h, textAlignOf(element));
    const dx = at.x - box.x;
    const dy = at.y - box.y;
    if (dx === 0 && dy === 0) continue;
    const options: ChangeOptions = wait.options.history === false ? { history: false } : { follows: true };
    patchElements([id], (next) => (next.type === 'note' || next.type === 'text' ? { ...next, x: next.x + dx, y: next.y + dy } : next), options);
  }
}

/** Starts keeping turned items' corners in place; returns a function that stops. */
export function startTurnedAnchors(): () => void {
  const offChange = onLocalChange((next, previous, options) => {
    if (next.content === previous.content) return;
    const before = new Map(previous.content.elements.map((element) => [element.id, element]));
    const measures = currentMeasures();
    let found = false;
    for (const element of next.content.elements) {
      if (element.type !== 'note' && element.type !== 'text') continue;
      const old = before.get(element.id);
      if (old === undefined || old === element || drawnDegrees(element) % 360 === 0) continue;
      if (options.coalesce === editCoalesceKey(element.id) || !isFormatChange(old, element)) continue;
      const box = elementLayoutBox(old, measures);
      if (box === undefined) continue;
      waiting.set(element.id, { box, options, at: Date.now() });
      found = true;
    }
    // A note's new height can already be in the change itself.
    if (found) queueMicrotask(settle);
  });
  const offMeasures = useMeasures.subscribe(settle);
  return () => {
    offChange();
    offMeasures();
    waiting.clear();
  };
}
