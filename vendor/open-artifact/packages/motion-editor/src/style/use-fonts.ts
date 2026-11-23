import { useEffect, useMemo, useRef } from 'react';
import { toast } from '@open-artifact/ui';
import { REFACED_MODULE, applyRetyped, builtinFontsCoverText, normalizeOfferedFontFamilies, recordText, type FontModule } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { fontRows, refacedEditable, type FontSlotRow } from './font-rows.ts';
import { filmMemory, useStyle } from './store.ts';
import { useStyleSignature } from './use-palette.ts';

export interface FontsState {
  rows: FontSlotRow[] | null;
  canEdit: boolean;
  /** Google Fonts families can be offered. */
  fetches: boolean;
}

/** Notices said in this page's life, so each is said once. */
const said = new Set<string>();

const sourcesOf = (script: string, modules: readonly FontModule[]): FontModule[] => [{ name: '', kind: 'js', text: script }, ...modules];

/** The Font section's rows for the film on show. */
export function useFonts(): FontsState {
  const film = useFilm((state) => state.film);
  const retyped = useFilm((state) => state.records.retyped);
  const writable = useWorking((state) => state.readOnlyReason === null);
  const signature = useStyleSignature(film);
  const touched = useStyle((state) => filmMemory(state.films, signature).touched);
  const families = useMemo(() => normalizeOfferedFontFamilies(null), []);
  const filmRef = useRef(film);
  filmRef.current = film;
  const refacedText = film === null ? null : recordText(film.modules, REFACED_MODULE);
  const fetches = typeof fetch === 'function';

  const shown = useMemo(() => {
    const current = filmRef.current;
    if (current === null) return null;
    if (retyped === null || retyped.lines.length === 0) return { script: current.script, modules: current.modules, ownCovered: true };
    try {
      const applied = applyRetyped({ script: current.script, modules: current.modules }, retyped);
      return { script: applied.script, modules: applied.modules, ownCovered: builtinFontsCoverText(sourcesOf(current.script, current.modules)) };
    } catch {
      return { script: current.script, modules: current.modules, ownCovered: true };
    }
  }, [signature, retyped]);

  const model = useMemo(() => {
    const current = filmRef.current;
    if (current === null || shown === null || current.script === '' || !refacedEditable(refacedText)) return null;
    return fontRows({
      script: current.script,
      modules: current.modules,
      shown: { script: shown.script, modules: shown.modules },
      ownCovered: shown.ownCovered,
      retyped: retyped !== null && retyped.lines.length > 0,
      refacedText,
      assets: current.assets,
      families,
      fetches,
      touched,
    });
  }, [signature, shown, refacedText, retyped, families, fetches, touched]);

  const notice = writable ? (model?.notice ?? null) : null;
  useEffect(() => {
    if (notice === null || said.has(notice)) return;
    said.add(notice);
    toast.add({ title: notice });
  }, [notice]);

  return { rows: model?.rows ?? null, canEdit: writable && model !== null, fetches };
}
