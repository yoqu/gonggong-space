import { useCallback, useId, type ReactElement } from 'react';
import { REFACED_MODULE, getFontRowLabel, readFilmFontSlots, readRefacedSlotValues, recordText, type FontSlot } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { pickFont } from './font-actions.ts';
import { FontMenu } from './FontMenu.tsx';
import { overFamilyLimit, type FontOption, type FontSlotRow } from './font-rows.ts';
import { FONT_SECTION, SAME_AS_BODY } from './words.ts';

function originalHint(row: FontSlotRow): string {
  if (row.asBody) return SAME_AS_BODY;
  return row.options.find((option) => option.value === '')?.name ?? '';
}

/** Whether a Google family may be picked for `slot` without going past the film's family limit. */
function useAllows(slot: FontSlot): (option: FontOption) => boolean {
  const film = useFilm((state) => state.film);
  return useCallback(
    (option: FontOption) => {
      if (!option.google || film === null) return true;
      try {
        const picks = readRefacedSlotValues(recordText(film.modules, REFACED_MODULE));
        return !overFamilyLimit(readFilmFontSlots(film.modules, 'film'), picks, slot, option.value);
      } catch {
        return true;
      }
    },
    [film, slot],
  );
}

function FontRow({ row, rows, disabled }: { row: FontSlotRow; rows: readonly FontSlotRow[]; disabled: boolean }): ReactElement {
  const label = getFontRowLabel(row, rows);
  const allows = useAllows(row.slot);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[84px] shrink-0 truncate text-[13px] text-chrome-muted">{label}</span>
      <div className="min-w-0 flex-1">
        <FontMenu
          label={label}
          value={row.value}
          options={row.options}
          originalHint={originalHint(row)}
          disabled={disabled}
          mute={row.mute}
          allows={allows}
          onPick={(choice) => void pickFont(row.slot, choice)}
        />
      </div>
    </div>
  );
}

/** The Font section: one row per slot the film sets text in. */
export function FontSection({ rows, canEdit }: { rows: readonly FontSlotRow[]; canEdit: boolean }): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[13px] leading-4 font-[520] text-chrome-fg">
        {FONT_SECTION}
      </h3>
      {rows.map((row) => (
        <FontRow key={row.slot} row={row} rows={rows} disabled={!canEdit} />
      ))}
    </section>
  );
}
