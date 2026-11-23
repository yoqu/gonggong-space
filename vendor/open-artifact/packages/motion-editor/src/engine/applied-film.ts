import {
  RECOLORED_MODULE,
  RETYPED_MODULE,
  applyRecolored,
  applyRetyped,
  filmTries,
  type FilmModule,
  type FilmRecordsHeld,
  type FilmTry,
  type RecoloredColor,
  type RetypedLine,
} from '@open-artifact/motion-core';
import type { FilmRecords } from './records.ts';

/** The film's code as the stage runs it: a person's retyped lines and colors written into its source. */
export interface AppliedFilm {
  script: string;
  modules: FilmModule[];
  /** Lines swapped in. */
  swapped: number;
  /** Colors the code writes that were swapped in. */
  met: number;
  /** `retyped.json` threw while it was applied. */
  unreadLines: boolean;
  /** Retyped lines and colors the code no longer says. */
  unmatchedLines: RetypedLine[];
  unmatchedColors: RecoloredColor[];
  /** What could not be applied, for the console. */
  warnings: string[];
}

type FilmCode = { script: string; modules: readonly FilmModule[] };

/**
 * Applies `retyped.json`, then `recolored.json` (scenes.json's background included). A record that throws while it
 * is applied is skipped, so the film still shows, as its author wrote it.
 */
export function applyFilmRecords(film: FilmCode, records: Pick<FilmRecords, 'retyped' | 'recolored'>): AppliedFilm {
  let script = film.script;
  let modules: FilmModule[] = [...film.modules];
  let swapped = 0;
  let met = 0;
  let unreadLines = false;
  let unmatchedLines: RetypedLine[] = [];
  let unmatchedColors: RecoloredColor[] = [];
  const warnings: string[] = [];
  if (records.retyped !== null) {
    try {
      const retyped = applyRetyped({ script, modules }, records.retyped);
      ({ script, modules, swapped } = retyped);
      unmatchedLines = retyped.unmatched;
    } catch {
      unreadLines = true;
      warnings.push(`A person's text (modules/${RETYPED_MODULE}) could not be swapped in, so the film shows its own.`);
    }
  }
  if (records.recolored !== null && records.recolored.colors.length > 0) {
    try {
      const recolored = applyRecolored({ script, modules }, records.recolored);
      ({ script, modules, met } = recolored);
      unmatchedColors = recolored.unmatched;
    } catch {
      warnings.push(`A person's colors (modules/${RECOLORED_MODULE}) could not be swapped in, so the film shows its own.`);
    }
  }
  return { script, modules, swapped, met, unreadLines, unmatchedLines, unmatchedColors, warnings };
}

/** What the applied records gave the film. */
export const recordsHeld = (applied: AppliedFilm): FilmRecordsHeld => ({ lines: applied.swapped > 0, colors: applied.met > 0, unreadLines: applied.unreadLines });

/** One load of the film: its code and which of a person's records it carries. */
export interface FilmTryCode extends FilmTry {
  script: string;
  modules: readonly FilmModule[];
}

/**
 * The film's code for each try (`filmTries`): with everything applied, with the lines alone, and as written. A film
 * that cannot play with a person's records then still shows.
 */
export function filmTryCodes(film: FilmCode, records: Pick<FilmRecords, 'retyped' | 'recolored'>, applied = applyFilmRecords(film, records)): FilmTryCode[] {
  return filmTries(recordsHeld(applied)).map((tried, index): FilmTryCode => {
    if (index === 0) return { ...tried, script: applied.script, modules: applied.modules };
    if (!tried.lines) return { ...tried, script: film.script, modules: film.modules };
    const lines = applyFilmRecords(film, { retyped: records.retyped, recolored: null });
    return { ...tried, script: lines.script, modules: lines.modules };
  });
}

const recordNames = (tried: FilmTry): string =>
  [...(tried.lines ? [`retyped lines (modules/${RETYPED_MODULE})`] : []), ...(tried.colors ? [`colors (modules/${RECOLORED_MODULE})`] : [])].join(' and ');

/** The console's word on a try that failed and the one tried next. */
export function failedTryNote(failed: FilmTry, next: FilmTry): string {
  const then = next.lines
    ? 'the film is now tried without the colors. If it runs, tell them to pick another palette under Style'
    : `the film now runs as written, without them. ${failed.lines ? 'Make the code work with their words, or tell them to reset the words in Tweaks' : 'Tell them to pick another palette under Style'}`;
  return `The error above came with a person's ${recordNames(failed)} swapped in; ${then}.`;
}
