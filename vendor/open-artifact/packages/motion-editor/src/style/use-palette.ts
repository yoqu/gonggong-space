import { useEffect, useMemo, useRef } from 'react';
import { equalColorPairs, type Film } from '@open-artifact/motion-core';
import { useCameUp } from '../engine/came-up.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { paletteView, readPaletteSources, styleSignature, wantsPalettePreviews, type PaletteView } from './palette-model.ts';
import { runPaletteProbe } from './probe-runner.ts';
import { filmMemory, rememberFilm, useStyle } from './store.ts';

export interface PaletteState {
  view: PaletteView | null;
  /** The previews are being drawn. */
  looking: boolean;
  canEdit: boolean;
}

const NO_FILM_SIGNATURE = '';

/** The film's code key, kept stable while only the page's records change. */
export function useStyleSignature(film: Film | null): string {
  return useMemo(() => (film === null ? NO_FILM_SIGNATURE : styleSignature(film)), [film]);
}

/** The Palette section: its cards, and the previews that find which hues to offer turns of while `open`. */
export function usePalette(open: boolean): PaletteState {
  const film = useFilm((state) => state.film);
  const record = useFilm((state) => state.records.recolored);
  const rough = useFilm((state) => state.scenes?.stage === 'rough');
  const duration = useFilm((state) => state.meta?.duration ?? null);
  const working = useWorking((state) => state.activity === 'working');
  const canEdit = useWorking((state) => state.readOnlyReason === null);
  const signature = useStyleSignature(film);
  const filmRef = useRef(film);
  filmRef.current = film;
  // The sources come from the code alone, so a pick (a record) does not read them again.
  const sources = useMemo(() => (filmRef.current === null ? null : readPaletteSources(filmRef.current)), [signature]);
  const memory = useStyle((state) => filmMemory(state.films, signature));
  const fell = useCameUp((state) => state.fell);
  const original = useCameUp((state) => state.original);
  const timed = duration !== null && duration > 0;

  const result = useMemo(
    () =>
      sources === null
        ? null
        : paletteView({
            sources,
            record,
            rough,
            timed,
            probed: memory.probed,
            remembered: memory.remembered,
            kept: memory.kept,
            fell,
            original,
          }),
    [sources, record, rough, timed, memory.probed, memory.remembered, memory.kept, fell, original],
  );

  useEffect(() => {
    if (result === null || signature === NO_FILM_SIGNATURE) return;
    const scheme = result.scheme >= 0 ? result.scheme : undefined;
    const keptChanged = result.kept !== memory.kept && !(result.kept !== null && memory.kept !== null && equalColorPairs(result.kept, memory.kept));
    if ((scheme === undefined || scheme === memory.remembered) && !keptChanged) return;
    rememberFilm(signature, (before) => ({ ...before, remembered: scheme ?? before.remembered, kept: result.kept }));
  }, [result, signature, memory.kept, memory.remembered]);

  const wants = sources !== null && wantsPalettePreviews(sources, rough, timed) && memory.probed === undefined;
  useEffect(() => {
    const current = filmRef.current;
    if (!open || working || !wants || current === null || sources === null) return;
    return runPaletteProbe(current, signature, sources.schemes);
  }, [open, working, wants, signature, sources]);

  return { view: result?.view ?? null, looking: open && wants, canEdit };
}
