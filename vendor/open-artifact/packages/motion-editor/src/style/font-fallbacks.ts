import { toast } from '@open-artifact/ui';
import { MAX_FONT_CARD_ROWS, REFACED_MODULE, describeFontFallbacks, readRefacedSlotValues } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { fallbacksToTell, standInName } from './font-rows.ts';
import { canWrite, recordText } from './record-io.ts';
import { useStyle } from './store.ts';
import { showsStyle } from './style-ids.ts';

/**
 * Tells a person, once per family and a few times at most in the page's life, of Google families the film shows in
 * a stand-in typeface because they could not be loaded.
 */
export function watchFontFallbacks(): () => void {
  const told = new Set<string>();
  let toasts = 0;
  return useStyle.subscribe((state, before) => {
    if (state.missing === before.missing || toasts >= MAX_FONT_CARD_ROWS) return;
    if (!canWrite() || !showsStyle(useFilm.getState())) return;
    const picks = readRefacedSlotValues(recordText(REFACED_MODULE));
    const tell = fallbacksToTell(state.missing, picks, told);
    if (tell.length === 0) return;
    toasts += 1;
    for (const font of tell) told.add(font.name);
    toast.add({ title: describeFontFallbacks(tell, (font) => standInName(font, picks)) });
  });
}
