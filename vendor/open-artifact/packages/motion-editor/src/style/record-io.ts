/**
 * `recolored.json` and `refaced.json` as the store holds them right now: the decoded film catches up a moment later,
 * so a pick made just after another, an undo, or a take-back reads and writes here.
 */

import { toast } from '@open-artifact/ui';
import { MAX_MODULES, isModuleDocument, moduleDocumentPath } from '@open-artifact/motion-core';
import { filmSource, writeFilmDocument } from '../host/live-film.ts';
import { useFilm } from '../stores/film.ts';
import { agentName, useWorking } from '../stores/working.ts';
import { CANNOT_SAVE, TOO_MANY_FILES } from './words.ts';

/** The record's text, or `null` when the film has none. */
export function recordText(name: string): string | null {
  const document = filmSource.documents().get(moduleDocumentPath(name));
  return isModuleDocument(document) ? document.text : null;
}

/** The page may change the film. */
export const canWrite = (): boolean => useWorking.getState().readOnlyReason === null;

/** Whether a record the film lacks may be added; a toast says why not. */
export function roomForRecord(name: string): boolean {
  if (recordText(name) !== null) return true;
  const stored = useFilm.getState().film?.storedModules.length ?? 0;
  if (stored < MAX_MODULES) return true;
  toast.add({ title: TOO_MANY_FILES(agentName()) });
  return false;
}

/** Writes the record's text, or deletes the module for `null`; a toast says so when the page may not write now. */
export function writeRecord(name: string, text: string | null): boolean {
  const written = writeFilmDocument(moduleDocumentPath(name), text === null ? null : { kind: 'json', text });
  if (!written) toast.add({ title: CANNOT_SAVE });
  return written;
}

/**
 * Puts the record from `from` to `to`, as an undo or a redo does: only while the film still holds `from`, so a
 * change made since (by the agent, or by someone else) is never written over.
 */
export function swapRecord(name: string, from: string | null, to: string | null, refused: string): boolean {
  if (recordText(name) !== from || !canWrite()) {
    toast.add({ title: refused });
    return false;
  }
  if (to !== null && !roomForRecord(name)) return false;
  return writeRecord(name, to);
}

/** A take-back of every pick in one record at once: `back` puts them back, `again` takes them away again. */
export interface TakeBack {
  back(): boolean;
  again(): void;
  canBack(): boolean;
}

/** Deletes the record, and returns how to put it back; `null` when there is nothing to take back or it could not be. */
export function takeRecordBack(name: string, editable: (text: string) => boolean, cannotUndo: string, cannotRedo: string): TakeBack | null {
  const before = recordText(name);
  if (before === null || !editable(before) || !canWrite()) return null;
  if (!writeRecord(name, null)) return null;
  return {
    back: () => swapRecord(name, null, before, cannotUndo),
    again: () => void swapRecord(name, before, null, cannotRedo),
    canBack: () => recordText(name) === null,
  };
}
