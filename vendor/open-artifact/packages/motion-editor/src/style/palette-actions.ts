/**
 * Picking a palette: `recolored.json` is written (or deleted for the film's own palette), the pick can be undone,
 * and a palette the film cannot play in is taken back by itself.
 */

import { toast } from '@open-artifact/ui';
import { PALETTE_WORDS, RECOLORED_MODULE, paletteFallReply, recordForChoice, recordVersion, serializeRecoloredRecord, type PaletteChoice } from '@open-artifact/motion-core';
import { useCameUp, type CameUp } from '../engine/came-up.ts';
import { clearUndo, pushUndo } from '../engine/undo.ts';
import { useFilm } from '../stores/film.ts';
import { canWrite, recordText, roomForRecord, swapRecord, takeRecordBack, writeRecord, type TakeBack } from './record-io.ts';
import { CANNOT_REDO, CANNOT_UNDO, LATER_RECORD, PALETTE_UNDO_LABEL } from './words.ts';

/** The pick whose load is awaited: the record it wrote, what it replaced, and the film's revision before it. */
interface AwaitedPick {
  text: string | null;
  from: string | null;
  revision: number;
}

let awaited: AwaitedPick | null = null;

/** Whether `recolored.json` is absent or in the form this page writes. */
export const recoloredEditable = (text: string | null): boolean => recordVersion(text, 'colors') !== 'later';

/** Shows the film in `choice`'s palette; `false` when nothing was written. */
export function pickPalette(choice: Pick<PaletteChoice, 'pairs'>): boolean {
  if (!canWrite()) return false;
  // The film shows as written: no palette shows until the text it could not play with is reset.
  if (useCameUp.getState().original) {
    toast.add({ title: PALETTE_WORDS.textChangedFirst });
    return false;
  }
  const from = recordText(RECOLORED_MODULE);
  if (!recoloredEditable(from)) {
    toast.add({ title: LATER_RECORD });
    return false;
  }
  const text = serializeRecoloredRecord(recordForChoice(choice));
  if (text === from) return false;
  if (text !== null && !roomForRecord(RECOLORED_MODULE)) return false;
  if (!writeRecord(RECOLORED_MODULE, text)) return false;
  awaited = { from: awaited?.from ?? from, text, revision: useFilm.getState().revision };
  pushUndo({
    label: PALETTE_UNDO_LABEL,
    undo: () => void swapRecord(RECOLORED_MODULE, text, from, CANNOT_UNDO),
    redo: () => void swapRecord(RECOLORED_MODULE, from, text, CANNOT_REDO),
  });
  return true;
}

/** Takes every color back at once (Reset all changes); `null` when the film shows its own colors. */
export function takeAllPaletteBack(): TakeBack | null {
  awaited = null;
  return takeRecordBack(RECOLORED_MODULE, recoloredEditable, CANNOT_UNDO, CANNOT_REDO);
}

/**
 * Once a film comes up without its colors (it could not play in its palette): after a pick that still holds, the
 * colors before it are written back and a person is told; otherwise a person is told once that it shows its own.
 */
export function watchPalettePicks(): () => void {
  const look = (state: CameUp, before: CameUp): void => {
    if (state.revision === before.revision && state.fell === before.fell) return;
    const pick = awaited !== null && state.revision > awaited.revision ? awaited : null;
    if (pick !== null) awaited = null;
    if (!canWrite()) return;
    const pickFailed = pick !== null && recordText(RECOLORED_MODULE) === pick.text;
    const reply = paletteFallReply({ fell: state.fell, wasFell: before.fell, pickFailed });
    if (reply === 'undo' && pick !== null && writeFilmBack(pick.from)) {
      clearUndo();
      toast.add({ title: PALETTE_WORDS.couldNotPlayUndone });
    } else if (reply === 'tell') {
      toast.add({ title: useFilm.getState().scenes?.stage === 'rough' ? PALETTE_WORDS.cannotPlay : PALETTE_WORDS.cannotPlayPickAnother });
    }
  };
  const stop = useCameUp.subscribe(look);
  return () => {
    stop();
    awaited = null;
  };
}

function writeFilmBack(from: string | null): boolean {
  if (from !== null && !roomForRecord(RECOLORED_MODULE)) return false;
  return writeRecord(RECOLORED_MODULE, from);
}
