/**
 * The page's own records as the store holds them right now. The decoded film catches up a moment later (its decode
 * waits for writes to settle), so a change made just after another one, or an undo, reads and writes here.
 */

import { toast } from '@open-artifact/ui';
import { isModuleDocument, moduleDocumentPath, recordVersion } from '@open-artifact/motion-core';
import { filmSource, writeFilmDocument } from '../host/live-film.ts';
import { LATER_RECORD, SAVE_REFUSED } from './words.ts';

/** The record module's text, or `null` when the film has none. */
export function recordText(name: string): string | null {
  const document = filmSource.documents().get(moduleDocumentPath(name));
  return isModuleDocument(document) ? document.text : null;
}

/** The record parsed; a module that does not read as JSON parses as nothing. */
export function readRecord<R>(name: string, parse: (input: unknown) => R): R {
  const text = recordText(name);
  if (text === null) return parse(undefined);
  try {
    return parse(JSON.parse(text) as unknown);
  } catch {
    return parse(undefined);
  }
}

/**
 * True, with a toast, when a newer page wrote the record: this page cannot read all of it, so it must not write it
 * over. `key` is the record's list (`lines`, `scenes`).
 */
export function refusesLaterRecord(name: string, key: string): boolean {
  if (recordVersion(recordText(name), key) !== 'later') return false;
  toast.add({ title: LATER_RECORD });
  return true;
}

/** Writes the record's text, or deletes the module for `null`; a toast says so when the page may not write now. */
export function writeRecord(name: string, text: string | null): boolean {
  const written = writeFilmDocument(moduleDocumentPath(name), text === null ? null : { kind: 'json', text });
  if (!written) toast.add({ title: SAVE_REFUSED });
  return written;
}
