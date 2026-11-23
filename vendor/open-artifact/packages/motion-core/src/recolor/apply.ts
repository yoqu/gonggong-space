import type { FilmModule } from '../documents.ts';
import { parseJsonRecord } from '../json.ts';
import { SCENES_MODULE } from '../names.ts';
import type { RecoloredColor, RecoloredRecord } from '../records/recolored.ts';
import { CUT_SOURCE_NAME, type FilmSource } from '../retype/sources.ts';
import { replaceSourceColors } from './scan.ts';

export interface ColorPairsResult<M extends FilmSource> {
  /** The sources as given when no pair met a color, else each with its colors replaced. */
  sources: M[];
  /** How many of the pairs' colors the code writes. */
  met: number;
  /** The `was` of each pair the code writes. */
  found: Set<string>;
}

/** The sources with every color a pair names (`was`) written as its `v`. */
export function applyColorPairs<M extends FilmSource>(sources: readonly M[], pairs: readonly RecoloredColor[]): ColorPairsResult<M> {
  if (pairs.length === 0) return { sources: [...sources], met: 0, found: new Set() };
  const replacements = new Map(pairs.map((pair) => [pair.was, pair.v] as const));
  const found = new Set<string>();
  const recolored = sources.map((source) => {
    const text = replaceSourceColors(source, (hex) => {
      const v = replacements.get(hex);
      if (v === undefined) return hex;
      found.add(hex);
      return v;
    });
    return text === source.text ? source : { ...source, text };
  });
  return { sources: found.size === 0 ? [...sources] : recolored, met: found.size, found };
}

/** `scenes.json`'s text with its background recolored by the first pair that names it, or as it was. */
export function recolorScenesBackground(text: string, pairs: readonly RecoloredColor[]): string {
  const scenes = parseJsonRecord(text);
  const background = scenes?.background;
  const v = typeof background === 'string' ? pairs.find((pair) => pair.was === background.toLowerCase())?.v : undefined;
  return scenes === null || v === undefined ? text : JSON.stringify({ ...scenes, background: v });
}

/** The film's code with a person's colors swapped in. */
export interface RecoloredFilm<M extends FilmSource = FilmModule> {
  script: string;
  modules: M[];
  /** How many of the record's colors the code writes. */
  met: number;
  /** The record's colors the code writes, applied. */
  applied: RecoloredColor[];
  /** The record's colors the code no longer writes. */
  unmatched: RecoloredColor[];
}

/**
 * The cut and modules as the player runs them with `recolored.json` applied: every `#rrggbb(aa)` and `rgb()`/`rgba()`
 * the code writes as a color whose `was` the record names shows its `v`, and so does `scenes.json`'s background,
 * when the code writes that color elsewhere too.
 */
export function applyRecolored<M extends FilmSource>(film: { script: string; modules: readonly M[] }, record: RecoloredRecord): RecoloredFilm<M> {
  const cut: FilmSource = { name: CUT_SOURCE_NAME, kind: 'js', text: film.script };
  const { sources, met, found } = applyColorPairs<FilmSource>([cut, ...film.modules], record.colors);
  const applied = record.colors.filter((color) => found.has(color.was));
  const modules = film.modules.map((module, index) => {
    const text = sources[index + 1]!.text;
    const recolored = module.name === SCENES_MODULE ? recolorScenesBackground(text, applied) : text;
    return recolored === module.text ? module : { ...module, text: recolored };
  });
  return { script: sources[0]!.text, modules, met, applied, unmatched: record.colors.filter((color) => !found.has(color.was)) };
}
