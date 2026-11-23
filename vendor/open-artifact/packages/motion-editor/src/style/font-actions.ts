/** Picking a typeface for a slot: `refaced.json` is written (or deleted when no slot is picked any more), with undo. */

import { toast } from '@open-artifact/ui';
import { FONT_PANEL_WORDS, MAX_STORED_FONT_FAMILIES, REFACED_MODULE, readFilmFontSlots, readRefacedSlotValues, type FilmFontSlots, type FontSlot } from '@open-artifact/motion-core';
import { pushUndo } from '../engine/undo.ts';
import { useFilm } from '../stores/film.ts';
import { overFamilyLimit, refacedEditable, refacedTextFor } from './font-rows.ts';
import { styleSignature } from './palette-model.ts';
import { canWrite, recordText, roomForRecord, swapRecord, takeRecordBack, writeRecord, type TakeBack } from './record-io.ts';
import { touchFontSlot } from './store.ts';
import { CANNOT_REDO, CANNOT_UNDO, FONT_UNDO_LABEL, LATER_RECORD } from './words.ts';

/** Shows `slot` in `choice` (`''`: the film's own); `false` when nothing was written. */
export function pickFont(slot: FontSlot, choice: string): boolean {
  const film = useFilm.getState().film;
  if (film === null || !canWrite()) return false;
  const from = recordText(REFACED_MODULE);
  if (!refacedEditable(from)) {
    toast.add({ title: LATER_RECORD });
    return false;
  }
  let slots: FilmFontSlots;
  try {
    slots = readFilmFontSlots(film.modules, 'film');
  } catch {
    return false;
  }
  if (overFamilyLimit(slots, readRefacedSlotValues(from), slot, choice)) {
    toast.add({ title: FONT_PANEL_WORDS.googleFamilyLimit(MAX_STORED_FONT_FAMILIES) });
    return false;
  }
  const text = refacedTextFor(from, slots, slot, choice);
  if (text === undefined || text === from) return false;
  if (text !== null && !roomForRecord(REFACED_MODULE)) return false;
  if (!writeRecord(REFACED_MODULE, text)) return false;
  touchFontSlot(styleSignature(film), slot);
  pushUndo({
    label: FONT_UNDO_LABEL,
    undo: () => void swapRecord(REFACED_MODULE, text, from, CANNOT_UNDO),
    redo: () => void swapRecord(REFACED_MODULE, from, text, CANNOT_REDO),
  });
  return true;
}

/** Takes every typeface pick back at once (Reset all changes); `null` when no slot is picked. */
export function takeAllFontsBack(): TakeBack | null {
  return takeRecordBack(REFACED_MODULE, (text) => refacedEditable(text) && Object.keys(readRefacedSlotValues(text)).length > 0, CANNOT_UNDO, CANNOT_REDO);
}
