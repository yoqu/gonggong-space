import type { FilmModule } from '../documents.ts';
import type { Film } from '../film/decode.ts';
import { joinSplitModules } from '../film/split.ts';
import { isJsonModuleName } from '../names.ts';

/** A text the film runs: the cut (named `''`) or a module. */
export type FilmSource = Pick<FilmModule, 'name' | 'kind' | 'text'>;

/** The name the cut goes by among the sources. */
export const CUT_SOURCE_NAME = '';

/** A stretch of a source's text, `end` excluded. */
export interface TextSpan {
  start: number;
  end: number;
  /** A part of a tagged template (tag`…`). */
  tagged?: boolean;
}

/** The cut and the modules, in the order the by-hand rewriters read them. */
export function filmSources(film: Pick<Film, 'script' | 'modules'>): FilmSource[] {
  return [{ name: CUT_SOURCE_NAME, kind: 'js', text: film.script }, ...film.modules];
}

/** The sources text can be retyped in: the cut and the js and html modules. */
export function filmTextSources(film: Pick<Film, 'script' | 'modules'>): FilmSource[] {
  return filmSources(film).filter((source) => source.name === CUT_SOURCE_NAME || source.kind === 'js' || source.kind === 'html');
}

/**
 * Every text of the film a record line can still be read in: the cut, the modules as they run and each stored part
 * of a split module, never the record itself.
 */
export function filmRecordTexts(film: Pick<Film, 'script' | 'storedModules'>, record: string): string[] {
  const parts = film.storedModules.filter((module) => module.name.includes('~'));
  return [
    film.script,
    ...[...joinSplitModules(film.storedModules), ...parts].filter((module) => module.name.split('~')[0] !== record).map((module) => module.text),
  ];
}

/**
 * The modules with a record's text put in (or taken out, for `null`), sorted by name: the record is one json module
 * the page writes whole.
 */
export function replaceRecordModule(modules: readonly FilmModule[], name: string, text: string | null): FilmModule[] {
  const rest = modules.filter((module) => module.name !== name);
  if (text === null) return rest;
  return [...rest, { name, kind: 'json' as const, text }].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The text of a module of the film as the player reads it, or `null`. */
export function recordText(modules: readonly FilmSource[], name: string): string | null {
  return modules.find((module) => module.name === name)?.text ?? null;
}

/** True when a module's text is never read as code (a `.json` module). */
export const isDataSource = (source: FilmSource): boolean => source.name !== CUT_SOURCE_NAME && isJsonModuleName(source.name);
