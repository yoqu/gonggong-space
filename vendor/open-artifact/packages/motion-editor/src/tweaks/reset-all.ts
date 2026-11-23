/**
 * Takes back every change made by hand at once: retyped text, colors, typefaces, layer retouches and scene recuts,
 * in that order, as one step to undo. Undo puts back each record that is still gone; a record written again since is
 * left as it is now.
 */

import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { RECOLORED_MODULE, RECUT_MODULE, REFACED_MODULE, RETOUCHED_MODULE, RETYPED_MODULE } from '@open-artifact/motion-core';
import { pushUndo } from '../engine/undo.ts';
import { recordText, writeRecord } from './record-documents.ts';
import * as words from './words.ts';

export const RESET_RECORDS = [RETYPED_MODULE, RECOLORED_MODULE, REFACED_MODULE, RETOUCHED_MODULE, RECUT_MODULE] as const;

interface SavedRecord {
  name: string;
  text: string;
}

function deleteAll(saved: readonly SavedRecord[]): SavedRecord[] {
  const deleted: SavedRecord[] = [];
  for (const record of saved) {
    if (recordText(record.name) !== record.text) continue;
    if (!writeRecord(record.name, null)) break;
    deleted.push(record);
  }
  return deleted;
}

function putBack(saved: readonly SavedRecord[]): void {
  let refused = false;
  for (const record of saved) {
    if (recordText(record.name) !== null) continue;
    if (!writeRecord(record.name, record.text)) refused = true;
  }
  if (refused) toast.add({ title: words.UNDO_CANT_RUN });
  else announce(words.ALL_BROUGHT_BACK);
}

/** Resets every record that holds changes; `false` when there was nothing to reset or nothing could be. */
export function resetAllChanges(): boolean {
  const saved = RESET_RECORDS.flatMap((name): SavedRecord[] => {
    const text = recordText(name);
    return text === null ? [] : [{ name, text }];
  });
  const deleted = deleteAll(saved);
  if (deleted.length === 0) return false;
  pushUndo({
    label: words.RESET_ALL,
    undo: () => putBack(deleted),
    redo: () => void deleteAll(deleted),
  });
  toast.add({ title: words.ALL_RESET });
  return true;
}
