/**
 * What the Palette section offers, free of React and the DOM: the film's sets of hues and offered palettes, the key
 * its previews are kept under, the films the previews draw, and the cards with their names and the one on show.
 */

import {
  EMPTY_RECOLORED_RECORD,
  PAGE_ONLY_RECORDS,
  STYLE_CARD_FRAME_WIDTH,
  applyRecolored,
  collectSourceColors,
  deriveHueGroups,
  filmSources,
  paletteCardNames,
  paletteCardStates,
  paletteCards,
  readScenePalettes,
  schemeForColors,
  shownRecoloredColors,
  type Film,
  type FilmModule,
  type HueScheme,
  type PaletteCard,
  type PaletteChoice,
  type RecoloredColor,
  type RecoloredRecord,
  type ScenePalettes,
} from '@open-artifact/motion-core';

const PAGE_RECORDS: ReadonlySet<string> = new Set(PAGE_ONLY_RECORDS);

/** FNV-1a over a text's UTF-16 units, continued from `seed`. */
export function hashText(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The key a film's style previews are kept under: its code and assets, the page's own records left out, so a pick
 * (which writes a record) never makes the film look new.
 */
export function styleSignature(film: Pick<Film, 'script' | 'modules' | 'assets'>): string {
  let hash = hashText(film.script);
  let second = hashText(film.script, 0x01234567);
  let code = 0;
  for (const module of film.modules) {
    if (PAGE_RECORDS.has(module.name)) continue;
    code += 1;
    const text = `\u0000${module.name}\u0000${module.kind}\u0000${module.text}`;
    hash = hashText(text, hash);
    second = hashText(text, second);
  }
  for (const asset of film.assets) {
    const text = `\u0001${asset.name}\u0000${asset.ref}`;
    hash = hashText(text, hash);
    second = hashText(text, second);
  }
  return `${hash.toString(16)}-${second.toString(16)}-${code}`;
}

/** The film drawn as its code has it: none of the page's records. */
export function ownFilm<F extends { script: string; modules: readonly FilmModule[] }>(film: F): F {
  return { ...film, modules: film.modules.filter((module) => !PAGE_RECORDS.has(module.name)) };
}

/** The film as its code has it, with color pairs swapped in. */
export function recoloredFilm<F extends { script: string; modules: readonly FilmModule[] }>(film: F, pairs: readonly RecoloredColor[]): F {
  const own = ownFilm(film);
  if (pairs.length === 0) return own;
  const recolored = applyRecolored(own, { colors: [...pairs] });
  return { ...own, script: recolored.script, modules: recolored.modules };
}

/** What the film's code offers the Palette section. */
export interface PaletteSources {
  /** Sets of the film's hues that can be turned. */
  schemes: HueScheme[];
  /** Every color the code writes. */
  written: Set<string>;
  /** The film's own palette and those `scenes.json` offers, or `null`. */
  scenes: ScenePalettes | null;
}

export const NO_PALETTE_SOURCES: PaletteSources = { schemes: [], written: new Set(), scenes: null };

/** The film's palette sources; none when its code cannot be read for colors. */
export function readPaletteSources(film: Pick<Film, 'script' | 'modules'>): PaletteSources {
  const sources = filmSources(film);
  try {
    return { schemes: deriveHueGroups(sources), written: collectSourceColors(sources), scenes: readScenePalettes(sources) };
  } catch {
    return NO_PALETTE_SOURCES;
  }
}

export interface PaletteViewInput {
  sources: PaletteSources;
  record: RecoloredRecord | null;
  /** A rough cut: no palettes are offered. */
  rough: boolean;
  /** The film's length is known. */
  timed: boolean;
  /** The set of hues the previews chose for this film (-1: none), `undefined` before they ran. */
  probed: number | undefined;
  /** The set of hues last shown for this film, while its code stayed the same. */
  remembered: number | undefined;
  /** Colors a person set that no card offers, kept from the last view of this film. */
  kept: readonly RecoloredColor[] | null;
  /** The film could not play in its palette. */
  fell: boolean;
  /** The film shows its original text and colors. */
  original: boolean;
}

export interface PaletteView {
  cards: PaletteChoice[];
  states: PaletteCard[];
  names: string[];
}

export interface PaletteViewResult {
  view: PaletteView | null;
  /** The set of hues the record's colors come from (-1: none), to remember for this film. */
  scheme: number;
  /** What to keep as `kept` for this film. */
  kept: readonly RecoloredColor[] | null;
}

/** The record's colors the code still writes. */
export const shownColors = (sources: PaletteSources, record: RecoloredRecord | null): RecoloredColor[] =>
  shownRecoloredColors(record ?? EMPTY_RECOLORED_RECORD, sources.written);

/** The Palette section's cards, their names and the one on show. */
export function paletteView(input: PaletteViewInput): PaletteViewResult {
  const colors = shownColors(input.sources, input.record);
  const direct = schemeForColors(input.sources.schemes, input.sources.scenes, colors);
  if (input.rough) return { view: null, scheme: direct, kept: input.kept };
  const scheme = direct >= 0 ? direct : (input.remembered ?? input.probed ?? -1);
  const { cards, kept } = paletteCards({
    schemes: input.sources.schemes,
    scheme,
    scenes: input.sources.scenes,
    timed: input.timed,
    colors,
    kept: input.kept,
  });
  if (cards === null || cards.length === 0) return { view: null, scheme: direct, kept };
  return {
    view: { cards, states: paletteCardStates(cards, colors, { fell: input.fell, original: input.original }), names: paletteCardNames(cards) },
    scheme: direct,
    kept,
  };
}

/** The scale a preview frame is drawn at: 480 pixels wide, and no taller than four times that. */
export const previewScale = (width: number, height: number): number =>
  Math.min(STYLE_CARD_FRAME_WIDTH / Math.max(1, width), (4 * STYLE_CARD_FRAME_WIDTH) / Math.max(1, height));

/** Whether the film's previews are worth drawing: hues to turn, the film's length, and no rough cut. */
export const wantsPalettePreviews = (sources: PaletteSources, rough: boolean, timed: boolean): boolean => !rough && timed && sources.schemes.length > 0;
