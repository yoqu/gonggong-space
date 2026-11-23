import type { Film } from '../film/decode.ts';
import { parseJsonRecord } from '../json.ts';
import { SCENES_MODULE } from '../names.ts';
import { PALETTE_COLOR_PATTERN, type RecoloredColor, type RecoloredRecord } from '../records/recolored.ts';
import { GRAY_COLOR_CHROMA } from './hue-groups.ts';
import { hexToOklch } from '../recolor/color.ts';
import { readBaseCssPalette } from '../recolor/film-palette.ts';
import { filmSources, type FilmSource } from '../retype/sources.ts';
import { hasUnsafePaletteSources } from './unsafe.ts';

/** The most palettes `scenes.json` may offer. */
export const MAX_SCENE_PALETTES = 5;

/**
 * A palette a person can pick: the color pairs it writes into `recolored.json` and the bars its card shows. A
 * palette `scenes.json` offers has a `role`; one made by turning the film's hues has none.
 */
export interface PaletteChoice {
  pairs: RecoloredColor[];
  bars: string[];
  /** `theirs`: the person asked for this palette. */
  role?: { theirs: boolean };
}

/** The palettes `scenes.json` offers, each `[ground, main, second, accent]`; the first `theirs` are the person's. */
export interface ScenePaletteOptions {
  options: string[][];
  theirs: number;
}

/** The palettes `scenes.json` offers: 1 to 5 of four `#rrggbb` colors each; `null` otherwise. */
export function parseScenePaletteOptions(text: string | null | undefined): ScenePaletteOptions | null {
  const scenes = parseJsonRecord(text);
  const palettes = scenes?.palettes;
  if (scenes === null || !Array.isArray(palettes) || palettes.length < 1 || palettes.length > MAX_SCENE_PALETTES) return null;
  const options: string[][] = [];
  for (const palette of palettes as unknown[]) {
    if (!Array.isArray(palette) || palette.length !== 4) return null;
    const colors: string[] = [];
    for (const color of palette as unknown[]) {
      if (typeof color !== 'string' || !PALETTE_COLOR_PATTERN.test(color)) return null;
      colors.push(color.toLowerCase());
    }
    options.push(colors);
  }
  const theirs = scenes.theirs;
  return { options, theirs: typeof theirs === 'number' && Number.isInteger(theirs) && theirs >= 0 && theirs <= palettes.length ? theirs : 0 };
}

/**
 * The pairs that turn the film's own palette into `palette`, role by role; `null` when two roles share a color the
 * new palette tells apart.
 */
export function paletteReplacementPairs(own: readonly string[], palette: readonly string[]): RecoloredColor[] | null {
  const pairs: RecoloredColor[] = [];
  for (const [index, color] of own.entries()) {
    const first = own.indexOf(color);
    if (first < index && palette[first] !== palette[index]) return null;
    if (first === index && color !== palette[index]) pairs.push({ was: color, v: palette[index]! });
  }
  return pairs;
}

/** The record that turns the film's own palette (`base.css`) into `palette`, or `null` when it cannot. */
export function paletteRecolor(own: readonly string[], palette: readonly string[]): RecoloredRecord | null {
  const pairs = paletteReplacementPairs(own, palette);
  return pairs === null ? null : { colors: pairs };
}

/** A color dark enough to be a dark film's ground. */
export const isDarkPaletteColor = (hex: string): boolean => hexToOklch(hex).L < 0.55;

/** Whether a palette makes a light film dark, or a dark one light. */
export const paletteChangesBackgroundTone = (own: readonly string[], palette: readonly string[]): boolean =>
  isDarkPaletteColor(own[0]!) !== isDarkPaletteColor(palette[0]!);

/** The color that tells a palette apart: its main, accent or second color, whichever first is not gray. */
export const paletteAccentColor = (bars: readonly string[]): string =>
  [bars[1]!, bars[3]!, bars[2]!].find((hex) => hexToOklch(hex).C >= GRAY_COLOR_CHROMA) ?? bars[1]!;

/** The film's own palette and the palettes `scenes.json` offers for it. */
export interface ScenePalettes {
  own: PaletteChoice;
  options: PaletteChoice[];
}

/**
 * The palettes `scenes.json` offers, as choices over the film's own (`base.css`). A palette is left out when it
 * cannot be written as pairs, its ground matches its main or second color, or (unless the person asked for it) it
 * turns the film dark or light while the code writes colors a palette could miss. Palettes the same as another (or
 * as the film's own) count once, the person's mark kept. `null` without both palettes.
 */
export function readScenePalettes(sources: readonly FilmSource[]): ScenePalettes | null {
  const offered = parseScenePaletteOptions(sources.find((source) => source.name === SCENES_MODULE && source.kind === 'json')?.text);
  const own = readBaseCssPalette(sources);
  if (offered === null || own === null) return null;
  const unsafe = hasUnsafePaletteSources(sources, own);
  const ownChoice: PaletteChoice = { pairs: [], bars: [...own], role: { theirs: false } };
  const options: PaletteChoice[] = [];
  for (const [index, palette] of offered.options.entries()) {
    const pairs = paletteReplacementPairs(own, palette);
    const theirs = index < offered.theirs;
    if (pairs === null || palette[0] === palette[1] || palette[0] === palette[2] || (!theirs && unsafe && paletteChangesBackgroundTone(own, palette))) continue;
    const same = pairs.length === 0 ? ownChoice : options.find((option) => option.bars.join() === palette.join());
    if (same !== undefined) same.role = { theirs: (same.role?.theirs ?? false) || theirs };
    else options.push({ pairs, bars: [...palette], role: { theirs } });
  }
  return { own: ownChoice, options };
}

/** The palettes `scenes.json` offers for a film. */
export const filmScenePalettes = (film: Pick<Film, 'script' | 'modules'>): ScenePalettes | null => readScenePalettes(filmSources(film));
