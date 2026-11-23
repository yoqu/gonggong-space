import { isPlainObject } from '../json.ts';
import { builtinFontSlug, isBuiltinFontRequest, resolveBuiltinFont, resolveFontFamily, type BuiltinFont, type FontSlot } from './builtin.ts';
import { parseCatalogFontRequest } from './catalog.ts';
import { parseFontRequest } from './google.ts';
import type { MissingFont } from './prepare.ts';
import { MAX_STORED_FONT_FAMILIES } from '../records/fetched-fonts.ts';
import { COMMON_GOOGLE_FONT_NAMES } from './variants.ts';
import { FONT_FALLBACK_WORDS, FONT_PANEL_WORDS } from './words.ts';

/** A Google Fonts family's id in the Font panel: the prefix and its name. */
export const GOOGLE_FONT_ID_PREFIX = 'google:';
/** Families an offer list may name, at most. */
export const MAX_FONT_OFFERS = 60;
/** Frames a font card samples across the film. */
export const FONT_CARD_SAMPLE_COUNT = 6;
/** The share of a frame's pixels that must change for a pick to count as seen. */
export const FONT_CARD_SEEN_FRACTION = 0.005;
export const FONT_CARD_CACHE_LIMIT = 20;
/** Fallback notices a panel shows in one session, at most. */
export const MAX_FONT_CARD_ROWS = 8;
/** Built-in typefaces drawn by hand or on a grid, which never stand in for a failed pick. */
export const SKETCH_FONT_IDS: readonly string[] = ['shantell-sans', 'departure-mono'];

/** The Font panel's id for a slot's value: a built-in id, `google:<family>`, its stand-in's id, or `null`. */
export function getFontChoiceId(choice: unknown): string | null {
  const builtin = resolveBuiltinFont(choice);
  if (builtin !== undefined) return builtin.id;
  if (typeof choice !== 'string' && !isPlainObject(choice)) return null;
  const request = parseFontRequest(choice);
  if (request !== null) return GOOGLE_FONT_ID_PREFIX + request.family;
  return isPlainObject(choice) ? (resolveFontFamily(choice.or)?.id ?? null) : null;
}

/** The built-in a slot falls back to: the face it wears, else the house face for its slot and kind. */
export function getDefaultFontChoiceId(face: BuiltinFont | undefined, slot: FontSlot, serif: boolean): string {
  const fallbackId = slot === 'mono' ? 'dm-mono' : slot === 'display' ? (serif ? 'fraunces-display' : 'inter-display') : serif ? 'fraunces' : 'instrument';
  const font = face ?? resolveFontFamily(fallbackId);
  return font === undefined ? fallbackId : builtinFontSlug(font);
}

/** A panel choice as the slot's value in `refaced.json`: `null` for the original, `{family, or}` for a Google family. */
export function pickedSlotValue(choiceId: string, face: BuiltinFont | undefined, slot: FontSlot, serif: boolean): string | { family: string; or: string } | null {
  if (choiceId === '') return null;
  if (choiceId.startsWith(GOOGLE_FONT_ID_PREFIX)) return { family: choiceId.slice(GOOGLE_FONT_ID_PREFIX.length), or: getDefaultFontChoiceId(face, slot, serif) };
  return choiceId;
}

/** The Google families a menu offers: the list given (else the common ones), as the catalog spells them, without built-ins. */
export function normalizeOfferedFontFamilies(offered?: readonly unknown[] | null): string[] {
  const families = (offered ?? COMMON_GOOGLE_FONT_NAMES).flatMap((entry) => (typeof entry === 'string' ? (parseCatalogFontRequest(entry)?.family ?? []) : []));
  return [...new Set(families)].filter((family) => resolveFontFamily(family) === undefined && !isBuiltinFontRequest(family));
}

/** An offer list from a setting, cut to its most. */
export const readFontOffers = (value: unknown): unknown[] | null => (Array.isArray(value) ? value.slice(0, MAX_FONT_OFFERS) : null);

export type FontRowKind = 'head' | 'body' | 'mono' | 'sans' | 'serif';

export interface FontRow {
  row: FontRowKind;
}

/** A Font panel row's label; sans and serif rows are told apart only when both are shown. */
export function getFontRowLabel(row: FontRow, rows: readonly FontRow[]): string {
  const words = FONT_PANEL_WORDS.rows;
  switch (row.row) {
    case 'head':
      return words.head;
    case 'body':
      return rows.length === 1 ? words.text : words.body;
    case 'mono':
      return words.mono;
    case 'sans':
    case 'serif':
      if (rows.filter((entry) => entry.row === 'sans' || entry.row === 'serif').length < 2) return words.other;
      return row.row === 'sans' ? words.sans : words.serif;
    default: {
      const never: never = row.row;
      return never;
    }
  }
}

export const formatFamilyList = (families: readonly string[]): string => new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(families);

/** A missing family; `crowded` when it was left out for the film's family limit. */
export type FallbackFont = Pick<MissingFont, 'name' | 'listed' | 'slots'> & { crowded?: true };

/** What the panel says of families that could not be shown, naming the stand-in when one family alone fell back. */
export function describeFontFallbacks<Fallback extends FallbackFont>(fallbacks: readonly Fallback[], familyName: (fallback: Fallback) => string | null): string {
  const unloaded = fallbacks.filter((entry) => entry.listed && entry.slots.length > 0);
  const unknown = fallbacks.filter((entry) => !entry.listed);
  const unused = fallbacks.filter((entry) => entry.listed && entry.slots.length === 0);
  const kept = unused.filter((entry) => entry.crowded !== true);
  const crowded = unused.filter((entry) => entry.crowded === true);
  const single = (entries: readonly Fallback[]): string | null => (entries.length === 1 ? familyName(entries[0]!) : null);
  const names = (entries: readonly Fallback[]): string => formatFamilyList(entries.map((entry) => entry.name));
  const unloadedOther = single(unloaded);
  const unknownOther = single(unknown);
  const unknownNames = formatFamilyList(unknown.map((entry) => `“${entry.name}”`));
  return [
    unloaded.length === 0
      ? ''
      : unloadedOther !== null
        ? FONT_FALLBACK_WORDS.oneUnloaded(names(unloaded), unloadedOther)
        : FONT_FALLBACK_WORDS.unloaded(unloaded.length, names(unloaded)),
    unknown.length === 0
      ? ''
      : unknownOther !== null
        ? FONT_FALLBACK_WORDS.oneUnknown(unknownNames, unknownOther)
        : FONT_FALLBACK_WORDS.unknown(unknown.length, unknownNames),
    kept.length === 0 ? '' : FONT_FALLBACK_WORDS.unloadedKept(kept.length, names(kept)),
    crowded.length === 0 ? '' : FONT_FALLBACK_WORDS.crowded(crowded.length, names(crowded), MAX_STORED_FONT_FAMILIES),
  ]
    .filter((sentence) => sentence !== '')
    .join(' ');
}

/** The family name a built-in's preview face is loaded under, apart from the stage's own. */
export const builtinPreviewFamilyName = (font: Pick<BuiltinFont, 'id'>): string => `Style ${font.id}`;
export const googlePreviewFamilyName = (family: string): string => `Style ${family}`;
