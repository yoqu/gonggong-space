import { isPlainObject } from '../json.ts';

/** What the page fetches from Google Fonts for a film, at most. */
export const GOOGLE_FONT_LIMITS = {
  weights: 4,
  files: 12,
  fileBytes: 153_600,
  filmBytes: 409_600,
  sheetChars: 131_072,
  blocks: 256,
  ranges: 64,
  points: 1000,
  shownChars: 2_097_152,
} as const;

export const DEFAULT_FONT_WEIGHTS: readonly number[] = [400, 700];
export const ALLOWED_FONT_LICENCES = ['OFL-1.1', 'OFL-1.0', 'Apache-2.0', 'UFL-1.0'] as const;
export type FontLicence = (typeof ALLOWED_FONT_LICENCES)[number];
export const MAX_FONT_NOTICE_CHARS = 16_384;

export const GOOGLE_FONT_FILE_URL_PATTERN =
  /^https:\/\/fonts\.gstatic\.com\/s\/[a-z0-9]{1,64}\/v[0-9]{1,4}\/[A-Za-z0-9_-]{1,256}(?:\.[0-9]{1,3})?\.woff2$/;
const FONT_FAMILY_NAME_PATTERN = /^[\x20-\x7e]{1,64}$/;

/** A family wanted from Google Fonts and the weights wanted of it (at most four, whole hundreds). */
export interface FontRequest {
  family: string;
  weights: number[];
}

/** A family name compared loosely: lower case, letters and digits only. */
export const normalizeFontFamilyKey = (input: string): string => input.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Up to four weights, whole hundreds from 100 to 900, the ones nearest 400 and 700 and the ends kept first. */
export function selectFontWeights(weights: readonly number[]): number[] {
  const distinct = [...new Set(weights.map((weight) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100))))].sort((a, b) => a - b);
  if (distinct.length <= GOOGLE_FONT_LIMITS.weights) return distinct;
  const nearest = (weight: number): number => distinct.reduce((best, item) => (Math.abs(item - weight) < Math.abs(best - weight) ? item : best));
  return [...new Set([nearest(400), nearest(700), distinct[0]!, distinct.at(-1)!, ...distinct])]
    .slice(0, GOOGLE_FONT_LIMITS.weights)
    .sort((a, b) => a - b);
}

/**
 * A slot's family as a request (a family name, or `{family, weights}`), by its name's shape only: telling a family
 * Google Fonts has from one it lacks needs the family catalog, which the page holds.
 */
export function parseFontRequest(input: unknown): FontRequest | null {
  const family = isPlainObject(input) ? input.family : input;
  if (typeof family !== 'string' || !FONT_FAMILY_NAME_PATTERN.test(family) || family.trim() === '') return null;
  const given = isPlainObject(input) && Array.isArray(input.weights) ? input.weights.slice(0, 16) : [];
  const weights = given.filter((weight): weight is number => typeof weight === 'number' && weight >= 1 && weight <= 1000);
  return { family, weights: selectFontWeights(weights.length > 0 ? weights : DEFAULT_FONT_WEIGHTS) };
}

/** A unicode-range (`U+0000-00FF,U+0131`) as sorted ranges, or `null` when it is not one. */
export function parseUnicodeRanges(text: string): Array<[number, number]> | null {
  const ranges: Array<[number, number]> = [];
  for (const item of text.split(',', GOOGLE_FONT_LIMITS.ranges + 1)) {
    const match = /^\s*U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(item);
    if (match === null) return null;
    const from = parseInt(match[1]!, 16);
    const to = parseInt(match[2] ?? match[1]!, 16);
    if (from > to || to > 0x10ffff) return null;
    ranges.push([from, to]);
  }
  return ranges.length > GOOGLE_FONT_LIMITS.ranges ? null : ranges.sort((a, b) => a[0] - b[0]);
}

const unicodeHex = (code: number): string => code.toString(16).toUpperCase();

export function formatUnicodeRanges(ranges: ReadonlyArray<readonly [number, number]>): string {
  return ranges.map(([from, to]) => `U+${unicodeHex(from)}${to === from ? '' : `-${unicodeHex(to)}`}`).join(',');
}
