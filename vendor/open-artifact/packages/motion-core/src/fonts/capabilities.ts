import { FONT_SLOTS, isBuiltinFontRequest, type FontSlot } from './builtin.ts';
import { mergeFontRequests, parseCatalogFontRequest } from './catalog.ts';
import type { FilmFaces } from './faces.ts';
import { readFilmFontSlots, type FontModule } from './film-fonts.ts';
import type { FontRequest } from './google.ts';
import { MAX_STORED_FONT_FAMILIES } from '../records/fetched-fonts.ts';
import { findGoogleFontMetadata, getFontVariants, getKnownFontVariants, normalizeFontWeight, type FontVariant } from './variants.ts';

/** The weight ranges a loaded family's faces are declared for, and the weights its menu lists. */
export interface LoadedFontFamily {
  ranges: Array<[number, number]>;
  rows: number[];
}

/** What the style menus know of the fonts a film has loaded: each stage family, and the family each slot's text wears. */
export interface LoadedFontCapabilities {
  families: Map<string, LoadedFontFamily>;
  named: Map<FontSlot, string>;
}

export const EMPTY_FONT_CAPABILITIES: LoadedFontCapabilities = { families: new Map(), named: new Map() };

/** The system's family for each running-text slot, as the menus name it. */
export const SYSTEM_FONT_BY_GENERIC = { sans: 'ui-sans-serif', serif: 'ui-serif', mono: 'ui-monospace' } as const;

const WEIGHT_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const weightInRange = ([min, max]: readonly [number, number], weight: number): boolean => weight >= min && weight <= max;

/** A range that one variable file covers, not the open end of a static face's range. */
export const isVariableWeightRange = ([min, max]: readonly [number, number]): boolean => min !== 1 && max !== 1000 && max - min > 150;

export function findNearestWeightRange(font: Pick<LoadedFontFamily, 'ranges'>, weight: number): [number, number] | undefined {
  const distance = ([min, max]: [number, number]): number => (weight < min ? min - weight : weight > max ? weight - max : 0);
  return font.ranges.reduce<[number, number] | undefined>((best, range) => (best === undefined || distance(range) < distance(best) ? range : best), undefined);
}

/** The weights a menu lists for these ranges: every step of a variable range, else one weight per face. */
export function getRepresentativeFontWeights(ranges: ReadonlyArray<[number, number]>, weights?: readonly number[], variable = false): number[] {
  const listed = ranges.flatMap((range): number[] => {
    const [min, max] = range;
    if (variable || (weights === undefined && isVariableWeightRange(range))) return WEIGHT_STEPS.filter((step) => weightInRange(range, step));
    const asked = (weights ?? []).filter((weight) => weightInRange(range, weight));
    if (asked.length > 0) return [asked.reduce((best, weight) => (Math.abs(weight - 400) < Math.abs(best - 400) ? weight : best))];
    return [
      min === 1 && max === 1000
        ? 400
        : normalizeFontWeight(min === 1 ? Math.floor(max / 100) * 100 : max === 1000 ? Math.ceil(min / 100) * 100 : (min + max) / 2),
    ];
  });
  return [...new Set(listed)].sort((a, b) => a - b);
}

export function getNearestAllowedWeight(font: LoadedFontFamily, weight: number): number {
  const range = findNearestWeightRange(font, weight);
  const rows = range === undefined ? [] : font.rows.filter((row) => weightInRange(range, row));
  return rows.reduce((best, row) => (Math.abs(row - weight) < Math.abs(best - weight) ? row : best), rows[0] ?? normalizeFontWeight(weight));
}

/** The Google Fonts families a film's slots ask for. */
export function filmFontRequests(modules: readonly FontModule[]): FontRequest[] {
  const { other } = readFilmFontSlots(modules, 'asked');
  const requests = FONT_SLOTS.flatMap((slot) => {
    if (isBuiltinFontRequest(other[slot])) return [];
    const request = parseCatalogFontRequest(other[slot]);
    return request === null ? [] : [request];
  });
  return mergeFontRequests(requests).slice(0, MAX_STORED_FONT_FAMILIES);
}

const parseRange = (text: string): [number, number] => {
  const [min = 400, max] = text.split(' ').map(Number);
  return [min, max ?? min];
};

/** What the film's loaded faces offer the style menus. */
export function getLoadedFontCapabilities(film: { modules: readonly FontModule[]; faces: Pick<FilmFaces, 'fonts' | 'slots'> | null } | null): LoadedFontCapabilities {
  if (film === null) return EMPTY_FONT_CAPABILITIES;
  const upright = (film.faces?.fonts ?? []).filter((face) => face.style !== 'italic');
  const { other } = readFilmFontSlots(film.modules, 'asked');
  const requests = filmFontRequests(film.modules);
  const families = new Map(
    [...new Set(upright.map((face) => face.family))].map((family): [string, LoadedFontFamily] => {
      const faces = upright.filter((face) => face.family === family);
      const axes = [...new Set(faces.map((face) => face.axis))];
      const axis = axes.length === 1 ? axes[0] : undefined;
      const rangesOf = (texts: readonly string[]): Array<[number, number]> => [...new Set(texts)].map(parseRange).sort((a, b) => a[0] - b[0]);
      const googleFamily = faces.some((face) => face.sample !== undefined)
        ? FONT_SLOTS.flatMap((slot) => (film.faces?.slots[slot] === family ? (parseCatalogFontRequest(other[slot])?.family ?? []) : []))[0]
        : undefined;
      const request = requests.find((entry) => entry.family === googleFamily);
      const ranges = rangesOf(faces.map((face) => face.weight));
      const known = request !== undefined && ranges.length === 1 && findGoogleFontMetadata(request.family)?.wght !== undefined ? getKnownFontVariants(request.family) : undefined;
      if (known !== undefined) return [family, { ranges, rows: [...new Set(known.map((variant) => variant.weight))].sort((a, b) => a - b) }];
      const variableAxis = axis !== undefined && ranges.length === 1 && ranges[0]![0] === 1 && ranges[0]![1] === 1000 ? axis : undefined;
      const declared = variableAxis === undefined ? ranges : rangesOf([variableAxis]);
      return [family, { ranges: declared, rows: getRepresentativeFontWeights(declared, request?.weights, variableAxis !== undefined) }];
    }),
  );
  const namedOf = (slot: FontSlot): string => film.faces?.slots[slot] ?? (slot === 'display' ? namedOf('sans') : SYSTEM_FONT_BY_GENERIC[slot]);
  return { families, named: new Map(FONT_SLOTS.map((slot) => [slot, namedOf(slot)] as const)) };
}

/** True when two weights draw the same in a loaded family (they fall in one face that has a single weight). */
export function isEquivalentLoadedFontWeight(family: string, capabilities: LoadedFontCapabilities, left: number, right: number): boolean {
  const entry = capabilities.families.get(family);
  if (left === right || entry === undefined) return left === right;
  const range = findNearestWeightRange(entry, left);
  if (range === undefined || range !== findNearestWeightRange(entry, right)) return false;
  const [min, max] = range;
  return entry.rows.filter((row) => weightInRange(range, row)).length <= 1 || Math.min(Math.max(left, min), max) === Math.min(Math.max(right, min), max);
}

const weightItalicVariants = (weights: readonly number[]): FontVariant[] =>
  [...new Set(weights)]
    .sort((a, b) => a - b)
    .flatMap((weight) => [
      { weight, italic: false },
      { weight, italic: true },
    ]);

export const getLoadedFontVariants = (family: string, capabilities: LoadedFontCapabilities): FontVariant[] =>
  weightItalicVariants(capabilities.families.get(family)?.rows ?? getFontVariants(family).map((variant) => variant.weight));

export function clampLoadedFontWeight(family: string, capabilities: LoadedFontCapabilities, weight: number): number {
  const entry = capabilities.families.get(family);
  return entry === undefined ? normalizeFontWeight(weight) : getNearestAllowedWeight(entry, weight);
}
