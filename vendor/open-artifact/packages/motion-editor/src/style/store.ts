/**
 * What the Style tab remembers of each film while its code stays the same (keyed by {@link styleSignature}): the set
 * of hues its previews chose, the one last shown, colors a person set that no card offers, and the font slots a
 * person picked for. Also the Google families the stage could not show, which the page reports.
 */

import { create } from 'zustand';
import type { FontSlot, MissingFont, RecoloredColor } from '@open-artifact/motion-core';

/** Films whose previews are kept, at most. */
export const STYLE_CACHE_LIMIT = 20;

export interface FilmStyleMemory {
  /** The set of hues the previews chose (-1: none). */
  probed?: number;
  /** The set of hues the record's colors last came from. */
  remembered?: number;
  kept: readonly RecoloredColor[] | null;
  touched: ReadonlySet<FontSlot>;
}

interface StyleState {
  films: ReadonlyMap<string, FilmStyleMemory>;
  /** The signature whose previews are being drawn, or `null`. */
  probing: string | null;
  /** Google families the film asks for that the stage could not show. */
  missing: readonly MissingFont[];
}

const EMPTY_MEMORY: FilmStyleMemory = { kept: null, touched: new Set() };
const NO_MISSING: readonly MissingFont[] = [];

export const useStyle = create<StyleState>()(() => ({ films: new Map(), probing: null, missing: NO_MISSING }));

export const filmMemory = (films: ReadonlyMap<string, FilmStyleMemory>, signature: string): FilmStyleMemory => films.get(signature) ?? EMPTY_MEMORY;

/** Changes what is remembered of a film, which becomes the most recent; the oldest go past the limit. */
export function rememberFilm(signature: string, change: (memory: FilmStyleMemory) => FilmStyleMemory): void {
  useStyle.setState((state) => {
    const before = filmMemory(state.films, signature);
    const after = change(before);
    if (after === before && state.films.has(signature)) return state;
    const films = new Map(state.films);
    films.delete(signature);
    films.set(signature, after);
    while (films.size > STYLE_CACHE_LIMIT) {
      const oldest = films.keys().next().value;
      if (oldest === undefined) break;
      films.delete(oldest);
    }
    return { films };
  });
}

export function touchFontSlot(signature: string, slot: FontSlot): void {
  rememberFilm(signature, (memory) => (memory.touched.has(slot) ? memory : { ...memory, touched: new Set([...memory.touched, slot]) }));
}

/**
 * The Google families the film asks for that the stage could not show, as the font preparation found them; the page
 * reports each load's (`[]` when all came), and the Style tab tells a person once per family.
 */
export function reportMissingFonts(missing: readonly MissingFont[]): void {
  useStyle.setState({ missing: missing.length === 0 ? NO_MISSING : [...missing] });
}

export function resetStyle(): void {
  useStyle.setState({ films: new Map(), probing: null, missing: NO_MISSING });
}
