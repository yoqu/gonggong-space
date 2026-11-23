import type { Film } from '../film/decode.ts';
import { PALETTE_COLOR_PATTERN } from '../records/recolored.ts';
import { filmSources, type FilmSource } from '../retype/sources.ts';

/** The four colors a film's `base.css` names, in this order. */
export const PALETTE_ROLES = ['ground', 'main', 'second', 'accent'] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

/** The module that names the film's palette. */
export const BASE_CSS_MODULE = 'base.css';

/**
 * The film's own palette, `[ground, main, second, accent]` as `#rrggbb` lower case: each of `--ground`, `--main`,
 * `--second`, `--accent` set exactly once in `base.css`, to a six-digit hex color. `null` otherwise.
 */
export function readBaseCssPalette(sources: readonly FilmSource[]): string[] | null {
  const text = sources.find((source) => source.name === BASE_CSS_MODULE && source.kind === 'css')?.text;
  if (text === undefined) return null;
  const colors = PALETTE_ROLES.map((role) => {
    const found = [...text.matchAll(new RegExp(String.raw`(?<![\w-])--` + role + String.raw`\s*:\s*([^;}]*)`, 'g'))];
    const value = found.length === 1 ? found[0]![1]!.trim() : '';
    return PALETTE_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
  });
  return colors.every((color): color is string => color !== null) ? colors : null;
}

/** The film's own palette as `base.css` names it, or `null`. */
export const filmPalette = (film: Pick<Film, 'script' | 'modules'>): string[] | null => readBaseCssPalette(filmSources(film));
