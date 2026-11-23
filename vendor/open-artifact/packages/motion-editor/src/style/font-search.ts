import { GOOGLE_FONT_FAMILIES, GOOGLE_FONT_ID_PREFIX, isBuiltinFontRequest, resolveFontFamily } from '@open-artifact/motion-core';
import type { FontOption } from './font-rows.ts';

/** Catalog families a search adds, at most. */
export const MAX_CATALOG_MATCHES = 30;

const fold = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

export interface FontSearchResult {
  /** The row's own options that match, in their order (the film's own typeface always first). */
  options: FontOption[];
  /** Further Google Fonts families from the catalog that match, when the row offers Google families. */
  more: FontOption[];
}

/**
 * The options that match `query`: by name, ignoring case and spacing. A row that offers Google families also gets
 * matching catalog families it does not list, so any family can be found by name.
 */
export function searchFonts(options: readonly FontOption[], query: string, catalog: readonly string[] = GOOGLE_FONT_FAMILIES): FontSearchResult {
  const wanted = fold(query);
  if (wanted === '') return { options: [...options], more: [] };
  const matches = options.filter((option) => option.value === '' || fold(option.name).includes(wanted));
  if (!options.some((option) => option.google)) return { options: matches, more: [] };
  const listed = new Set(options.map((option) => option.value));
  const more: FontOption[] = [];
  for (const family of catalog) {
    if (more.length >= MAX_CATALOG_MATCHES) break;
    if (!fold(family).includes(wanted)) continue;
    const value = GOOGLE_FONT_ID_PREFIX + family;
    if (listed.has(value) || resolveFontFamily(family) !== undefined || isBuiltinFontRequest(family)) continue;
    more.push({ value, name: family, face: null, google: true });
  }
  return { options: matches, more };
}
