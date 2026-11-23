/**
 * Undo for changes made by hand (a retyped line, a color, a typeface, a layer moved, a scene recut). Each feature
 * pushes an entry whose `undo` and `redo` write its record back; Mod+Z and Mod+Shift+Z run them and a toast says what.
 */

import { create } from 'zustand';
import { toast } from '@open-artifact/ui';
import { isInlineDisplay } from '../host/display-mode.ts';
import { TEXT_ENTRY_SELECTOR } from '../keyboard/install.ts';
import { shortcuts, type KeyRegistry } from '../keyboard/registry.ts';
import { registerUndoKeys } from './undo-keys.ts';
import { UndoStack, type UndoEntry } from './undo-stack.ts';
import { NOTHING_TO_REDO, NOTHING_TO_UNDO, redid, undid } from './words.ts';

export type { UndoEntry } from './undo-stack.ts';

const stack = new UndoStack();

/** Whether there is anything to undo or redo, for buttons. */
export const useUndo = create<{ canUndo: boolean; canRedo: boolean }>()(() => ({ canUndo: false, canRedo: false }));

const publish = (): void => useUndo.setState({ canUndo: stack.canUndo, canRedo: stack.canRedo });

/** Records a change made by hand, after it was written. */
export function pushUndo(entry: UndoEntry): void {
  stack.push(entry);
  publish();
}

function run(step: () => UndoEntry | null, said: (label: string) => string, none: string): void {
  let entry: UndoEntry | null;
  try {
    entry = step();
  } catch (error) {
    console.warn('video: undo failed', error);
    entry = null;
  }
  publish();
  toast.add({ title: entry === null ? none : said(entry.label) });
}

export function undo(): void {
  run(() => stack.undo(), undid, NOTHING_TO_UNDO);
}

export function redo(): void {
  run(() => stack.redo(), redid, NOTHING_TO_REDO);
}

/** Forgets every entry (the film was replaced). */
export function clearUndo(): void {
  stack.clear();
  publish();
}

/** The focus is in a field that has its own undo. */
const inTextField = (): boolean => typeof document !== 'undefined' && document.activeElement?.closest(TEXT_ENTRY_SELECTOR) != null;

/** The undo keys (`undo-keys.ts`); none when the page is shown inline. */
export function registerUndoShortcuts(registry: KeyRegistry = shortcuts): () => void {
  return registerUndoKeys(registry, { undo, redo, inTextField }, isInlineDisplay());
}
