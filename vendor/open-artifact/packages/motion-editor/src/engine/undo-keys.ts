/**
 * The undo keys: Mod+Z undoes, Mod+Shift+Z (and Mod+Y) redoes, from the side panels too (where most changes are
 * made); in a text field the field's own undo runs instead. Shown inline (`#view-inline`) the page registers none,
 * leaving undo shortcuts to the enclosing host page.
 */

import type { KeyRegistry } from '../keyboard/registry.ts';
import { REDO, UNDO } from './words.ts';

export interface UndoKeyActions {
  undo(): void;
  redo(): void;
  /** The focus is in a field that has its own undo. */
  inTextField(): boolean;
}

/** Adds the undo keys (none inline); returns a function that takes them away. */
export function registerUndoKeys(registry: KeyRegistry, actions: UndoKeyActions, inline: boolean): () => void {
  if (inline) return () => {};
  const when = (): boolean => !actions.inTextField();
  const stops = [
    registry.register({ id: 'undo', keys: [{ key: 'z', mod: true }], label: UNDO, everywhere: true, when, run: () => actions.undo() }),
    registry.register({ id: 'redo', keys: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }], label: REDO, everywhere: true, when, run: () => actions.redo() }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
