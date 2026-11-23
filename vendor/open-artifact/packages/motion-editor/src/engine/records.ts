import {
  FETCHED_FONTS_MODULE,
  RECOLORED_MODULE,
  RECUT_MODULE,
  REFACED_MODULE,
  RETOUCHED_MODULE,
  RETYPED_MODULE,
  filmModule,
  parseFetchedFontsRecord,
  parseRecoloredRecord,
  parseRecutRecord,
  parseRefacedRecord,
  parseRetouchedRecord,
  parseRetypedRecord,
  type FetchedFontsRecord,
  type Film,
  type RecoloredRecord,
  type RecutRecord,
  type RefacedRecord,
  type RetouchedRecord,
  type RetypedRecord,
} from '@open-artifact/motion-core';

/** The page's own records (changes made by hand), parsed; `null` where the film has none. */
export interface FilmRecords {
  recut: RecutRecord | null;
  retouched: RetouchedRecord | null;
  retyped: RetypedRecord | null;
  recolored: RecoloredRecord | null;
  refaced: RefacedRecord | null;
  fetchedFonts: FetchedFontsRecord | null;
}

export const NO_RECORDS: FilmRecords = { recut: null, retouched: null, retyped: null, recolored: null, refaced: null, fetchedFonts: null };

function readJson(film: Pick<Film, 'modules'>, name: string): unknown {
  const module = filmModule(film, name);
  if (module === undefined) return undefined;
  try {
    return JSON.parse(module.text) as unknown;
  } catch {
    return null;
  }
}

function read<R>(film: Pick<Film, 'modules'>, name: string, parse: (input: unknown) => R): R | null {
  const json = readJson(film, name);
  return json === undefined ? null : parse(json);
}

export function readFilmRecords(film: Pick<Film, 'modules'>): FilmRecords {
  return {
    recut: read(film, RECUT_MODULE, parseRecutRecord),
    retouched: read(film, RETOUCHED_MODULE, parseRetouchedRecord),
    retyped: read(film, RETYPED_MODULE, parseRetypedRecord),
    recolored: read(film, RECOLORED_MODULE, parseRecoloredRecord),
    refaced: read(film, REFACED_MODULE, (input) => parseRefacedRecord(input)),
    fetchedFonts: read(film, FETCHED_FONTS_MODULE, (input) => parseFetchedFontsRecord(input)),
  };
}

/** The records that hold changes by hand, as page-only record names (for the view context). */
export function recordsWithChanges(records: FilmRecords): string[] {
  const names: string[] = [];
  if (records.recut !== null && records.recut.scenes.length > 0) names.push(`modules/${RECUT_MODULE}`);
  if (records.retouched !== null) names.push(`modules/${RETOUCHED_MODULE}`);
  if (records.retyped !== null) names.push(`modules/${RETYPED_MODULE}`);
  if (records.recolored !== null) names.push(`modules/${RECOLORED_MODULE}`);
  if (records.refaced !== null) names.push(`modules/${REFACED_MODULE}`);
  return names;
}
