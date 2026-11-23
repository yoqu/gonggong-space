/**
 * Words typed over a line of the film, written to `retyped.json`; the stage loads the film with them in place. Each
 * change can be undone line by line.
 */

import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { RETYPED_MODULE, parseRetypedRecord, retypeLine, serializeRetypedRecord, withRetypedLine, type RetypedRecord } from '@open-artifact/motion-core';
import { pushUndo } from '../engine/undo.ts';
import { useFilm } from '../stores/film.ts';
import { readRecord, refusesLaterRecord, writeRecord } from '../tweaks/record-documents.ts';
import { filmScan } from './text-model.ts';
import { useText } from './text-store.ts';
import * as words from './words.ts';

function writeLines(record: RetypedRecord): boolean {
  if (!writeRecord(RETYPED_MODULE, serializeRetypedRecord(record))) return false;
  useText.setState({ typed: record.lines });
  return true;
}

/** Sets one line as given (undo and redo): the words were checked when first typed. */
function putLine(was: string, v: string): void {
  if (refusesLaterRecord(RETYPED_MODULE, 'lines')) return;
  const record = readRecord(RETYPED_MODULE, parseRetypedRecord);
  if ((record.lines.find((line) => line.was === was)?.v ?? '') === v) return;
  writeLines(withRetypedLine(record, was, v));
}

/** The person typed `typed` over the line the code spells `was` (`''`: its own words again). */
export function retypeWords(was: string, typed: string): boolean {
  const film = useFilm.getState().film;
  if (film === null || refusesLaterRecord(RETYPED_MODULE, 'lines')) return false;
  const record = readRecord(RETYPED_MODULE, parseRetypedRecord);
  const outcome = retypeLine(record, was, typed, { scan: filmScan(film), cut: film.cut });
  switch (outcome.kind) {
    case 'same':
      return true;
    case 'gone':
      toast.add({ title: words.LINE_GONE });
      return false;
    case 'full':
      toast.add({ title: words.TOO_MUCH_TEXT });
      return false;
    case 'changed': {
      const before = record.lines.find((line) => line.was === was)?.v ?? '';
      if (!writeLines(outcome.record)) return false;
      const after = outcome.v;
      pushUndo({ label: words.TEXT_CHANGE, undo: () => putLine(was, before), redo: () => putLine(was, after) });
      announce(after === '' ? words.TEXT_RESET : words.TEXT_CHANGED);
      return true;
    }
    default: {
      const never: never = outcome;
      return never;
    }
  }
}
