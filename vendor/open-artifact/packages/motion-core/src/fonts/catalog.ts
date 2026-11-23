import { isPlainObject } from '../json.ts';
import { resolveFontFamily, type BuiltinFont } from './builtin.ts';
import { GOOGLE_FONT_FAMILY_LIST, GOOGLE_FONT_LICENCE_CODES } from './catalog-data.ts';
import { DEFAULT_FONT_WEIGHTS, normalizeFontFamilyKey, selectFontWeights, type FontLicence, type FontRequest } from './google.ts';

/** Every family the page may fetch from Google Fonts, sorted. */
export const GOOGLE_FONT_FAMILIES: readonly string[] = GOOGLE_FONT_FAMILY_LIST.split('|');

/** Old or alternative names of families, and the family each means now. */
export const FONT_FAMILY_ALIASES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    ['', ' Inline', ' Stencil'].flatMap((cut) => ['Display', 'Text'].map((size) => [`Big Shoulders${cut} ${size}`, `Big Shoulders${cut}`])),
  ),
  Baloo: 'Baloo 2',
  'Be Vietnam': 'Be Vietnam Pro',
  'Fredoka One': 'Fredoka',
  'HK Grotesk': 'Hanken Grotesk',
  Muli: 'Mulish',
  'Source Sans Pro': 'Source Sans 3',
  'Source Serif Pro': 'Source Serif 4',
  Spartan: 'League Spartan',
};

const LICENCE_BY_CODE: Readonly<Record<string, FontLicence>> = { o: 'OFL-1.1', O: 'OFL-1.0', a: 'Apache-2.0', u: 'UFL-1.0' };

let familiesByKey: Map<string, string> | undefined;
let licenceByFamily: Map<string, FontLicence> | undefined;

function catalogKeys(): Map<string, string> {
  familiesByKey ??= new Map(
    [...Object.entries(FONT_FAMILY_ALIASES), ...GOOGLE_FONT_FAMILIES.map((family) => [family, family] as const)].map(
      ([name, family]) => [normalizeFontFamilyKey(name), family] as const,
    ),
  );
  return familiesByKey;
}

/** The catalog family a name means (loosely: case, spaces and punctuation aside, or by an old name), else `undefined`. */
export function findCatalogFamily(name: unknown): string | undefined {
  if (typeof name !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(name)) return undefined;
  return catalogKeys().get(normalizeFontFamilyKey(name));
}

/** The licence a catalog family is under, else `undefined`. */
export function catalogFamilyLicence(family: string): FontLicence | undefined {
  licenceByFamily ??= new Map(
    GOOGLE_FONT_FAMILIES.flatMap((name, index) => {
      const licence = LICENCE_BY_CODE[GOOGLE_FONT_LICENCE_CODES[index] ?? '-'];
      return licence === undefined ? [] : [[name, licence] as const];
    }),
  );
  return licenceByFamily.get(family);
}

/**
 * A slot's family as a request (a family name, or `{family, weights}`), with the name as the catalog spells it;
 * `null` for a family the catalog lacks.
 */
export function parseCatalogFontRequest(input: unknown): FontRequest | null {
  const family = findCatalogFamily(isPlainObject(input) ? input.family : input);
  if (family === undefined) return null;
  const given = isPlainObject(input) && Array.isArray(input.weights) ? input.weights.slice(0, 16) : [];
  const weights = given.filter((weight): weight is number => typeof weight === 'number' && weight >= 1 && weight <= 1000);
  return { family, weights: selectFontWeights(weights.length > 0 ? weights : DEFAULT_FONT_WEIGHTS) };
}

/** Requests of one family joined, in the order each family first comes. */
export function mergeFontRequests(requests: readonly FontRequest[]): FontRequest[] {
  const byFamily = new Map<string, number[]>();
  for (const request of requests) byFamily.set(request.family, [...(byFamily.get(request.family) ?? []), ...request.weights]);
  return [...byFamily].map(([family, weights]) => ({ family, weights: selectFontWeights(weights) }));
}

/** A slot's value: the built-in typeface it names, else the catalog family, else `null`. */
export function resolveRequestedFont(input: unknown): BuiltinFont | string | null {
  return resolveFontFamily(input) ?? parseCatalogFontRequest(input)?.family ?? null;
}

/** A family as an id: `"Space Grotesk"` → `space-grotesk`; a built-in typeface by its slug. */
export function fontFamilySlug(input: string | Pick<BuiltinFont, 'id' | 'slug'>): string {
  return typeof input === 'string'
    ? input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : (input.slug ?? input.id);
}
