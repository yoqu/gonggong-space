/**
 * The Font section's rows, free of React and the DOM: which slots get a row, what each row offers, which choice it
 * shows, and what `refaced.json` becomes when a choice is picked.
 */

import {
  FILM_SCHEMA_VERSION,
  FONT_PANEL_WORDS,
  FONT_SLOTS,
  GOOGLE_FONT_ID_PREFIX,
  MAX_STORED_FONT_FAMILIES,
  availableBuiltinFonts,
  builtinFontsCoverText,
  findGoogleFontMetadata,
  formatFamilyList,
  getFontChoiceId,
  parseFontRequest,
  parseJsonRecord,
  parseRefacedRecord,
  parseRefacedSlot,
  pickedSlotValue,
  readFilmFontSlots,
  readRefacedSlotValues,
  resolveBuiltinFont,
  resolveFontFamily,
  serializeRefacedRecord,
  setRefacedSlot,
  usedFontSlots,
  type BuiltinFont,
  type FilmFontSlots,
  type FontModule,
  type FontRowKind,
  type FontSlot,
  type MissingFont,
} from '@open-artifact/motion-core';
import { lacksLetters } from './words.ts';

export interface FontOption {
  /** `''` for the film's own typeface, a built-in id, or `google:<family>`. */
  value: string;
  name: string;
  face: BuiltinFont | null;
  google: boolean;
  /** Greyed out: the film already uses as many Google Fonts families as it can load. */
  disabled?: true;
}

export interface FontSlotRow {
  row: FontRowKind;
  slot: FontSlot;
  /** The choice on show (`''`: the film's own). */
  value: string;
  /** The headline follows the body: its own choice reads "Same as Body". */
  asBody: boolean;
  /** The pick is not shown, because the built-in typefaces lack a letter the film shows. */
  mute: boolean;
  options: FontOption[];
}

export interface FontRowsInput {
  /** The film's code as it runs, without a person's records applied. */
  script: string;
  modules: readonly FontModule[];
  /** The code with a person's retyped lines in, for the letters the film shows; the same as above when none. */
  shown: { script: string; modules: readonly FontModule[] };
  /** Whether the film's own code, without retyped lines, can be spelled in the built-in typefaces. */
  ownCovered: boolean;
  /** The film retypes lines. */
  retyped: boolean;
  /** `refaced.json` as stored, or `null`. */
  refacedText: string | null;
  assets: ReadonlyArray<{ mime: string }>;
  /** The Google Fonts families offered besides the built-ins. */
  families: readonly string[];
  /** The page can fetch Google Fonts families. */
  fetches: boolean;
  /** Slots a person picked a typeface for while the film's code stayed the same: their rows stay. */
  touched: ReadonlySet<FontSlot>;
}

export interface FontRowsModel {
  rows: FontSlotRow[] | null;
  /** Said once when the film shows in system fonts for want of letters, else `null`. */
  notice: string | null;
  /** The film's own typefaces by slot. */
  film: FilmFontSlots;
  /** A person's picks, as written. */
  picks: Partial<Record<FontSlot, unknown>>;
}

const NO_SLOTS: FilmFontSlots = { faces: {}, other: {}, odd: false };

const sourcesOf = (code: { script: string; modules: readonly FontModule[] }): FontModule[] => [{ name: '', kind: 'js', text: code.script }, ...code.modules];

/** The Google family a slot's value names, when it is not a built-in typeface. */
export function googleFamilyOf(value: unknown): string | undefined {
  if (value === undefined || resolveBuiltinFont(value) !== undefined) return undefined;
  return parseFontRequest(value)?.family;
}

/** True when `refaced.json` is absent or in the form this page writes. */
export function refacedEditable(text: string | null): boolean {
  if (text === null) return true;
  return parseJsonRecord(text)?.v === FILM_SCHEMA_VERSION;
}

/**
 * The Google families the film keeps: a person's picks, and its own code's even where a pick hides them (their
 * stored files stay with the film, so they still count toward its limit).
 */
export function googleFamiliesInUse(film: FilmFontSlots, picks: Partial<Record<FontSlot, unknown>>): Set<string> {
  const families = new Set<string>();
  for (const slot of FONT_SLOTS) {
    for (const value of [film.other[slot], picks[slot]]) {
      const family = googleFamilyOf(value);
      if (family !== undefined) families.add(family);
    }
  }
  return families;
}

/** Whether picking `choice` for `slot` would ask for more Google families than the film may load. */
export function overFamilyLimit(film: FilmFontSlots, picks: Partial<Record<FontSlot, unknown>>, slot: FontSlot, choice: string): boolean {
  if (!choice.startsWith(GOOGLE_FONT_ID_PREFIX)) return false;
  const family = choice.slice(GOOGLE_FONT_ID_PREFIX.length);
  const after = googleFamiliesInUse(film, { ...picks, [slot]: { family } });
  return after.size > MAX_STORED_FONT_FAMILIES;
}

function fontNotice(input: FontRowsInput, mute: boolean, film: FilmFontSlots, picks: Partial<Record<FontSlot, unknown>>): string | null {
  if (!mute) return null;
  if (Object.keys(film.faces).length > 0) return input.retyped && input.ownCovered ? FONT_PANEL_WORDS.glyphFallbackRestore : FONT_PANEL_WORDS.glyphFallback;
  const names = pickedBuiltinNames(picks);
  return names.length === 0 ? null : lacksLetters(names.length, formatFamilyList(names));
}

const pickedBuiltinNames = (picks: Partial<Record<FontSlot, unknown>>): string[] => [
  ...new Set(FONT_SLOTS.flatMap((slot) => (picks[slot] === undefined ? [] : (resolveBuiltinFont(picks[slot])?.name ?? [])))),
];

/** The rows of the Font section, one per slot the film sets text in (and each slot a person picked for). */
export function fontRows(input: FontRowsInput): FontRowsModel {
  let film: FilmFontSlots;
  let mute: boolean;
  let tries: FontSlot[] = [];
  let faces: readonly BuiltinFont[] | null = null;
  try {
    film = readFilmFontSlots(input.modules, 'film');
    const shown = sourcesOf(input.shown);
    mute = !builtinFontsCoverText(shown);
    if (!mute) {
      faces = availableBuiltinFonts(input.assets);
      tries = usedFontSlots(shown, { ...film.other, ...film.faces });
    }
  } catch {
    return { rows: null, notice: null, film: NO_SLOTS, picks: {} };
  }
  const picks = readRefacedSlotValues(input.refacedText);
  const muteWithPicks = mute && pickedBuiltinNames(picks).length > 0;
  const notice = fontNotice(input, mute, film, picks);
  const touched = new Set<FontSlot>([...input.touched, ...FONT_SLOTS.filter((slot) => picks[slot] !== undefined)]);
  const extra = FONT_SLOTS.filter((slot) => !tries.includes(slot) && touched.has(slot));
  const ordered: FontSlot[] = [...extra.filter((slot) => slot === 'display'), ...tries, ...extra.filter((slot) => slot !== 'display')];
  const body = ordered.find((slot) => slot !== 'display');

  const rowFor = (row: FontRowKind, slot: FontSlot): FontSlotRow => {
    const family = googleFamilyOf(film.other[slot]);
    const shownFamily = input.fetches ? family : undefined;
    const ownFace = mute || shownFamily !== undefined ? undefined : film.faces[slot];
    const skipFace = mute || family !== undefined ? undefined : film.faces[slot];
    const builtins: FontOption[] = (faces ?? []).filter((face) => face !== skipFace).map((face) => ({ value: face.id, name: face.name, face, google: false }));
    const google: FontOption[] =
      faces === null || faces.length === 0 || !input.fetches
        ? []
        : input.families
            .filter((name) => name !== family)
            .map((name) => ({
              value: GOOGLE_FONT_ID_PREFIX + name,
              name,
              face: null,
              google: true,
              ...(overFamilyLimit(film, picks, slot, GOOGLE_FONT_ID_PREFIX + name) ? { disabled: true as const } : {}),
            }));
    const chosen = picks[slot] === undefined ? null : getFontChoiceId(picks[slot]);
    const own = family === undefined ? film.faces[slot]?.id : GOOGLE_FONT_ID_PREFIX + family;
    const value = chosen === null || chosen === own ? '' : chosen;
    const options: FontOption[] = [{ value: '', name: shownFamily ?? ownFace?.name ?? '', face: ownFace ?? null, google: false }, ...builtins, ...google];
    if (!options.some((option) => option.value === value)) {
      const face = resolveFontFamily(value) ?? null;
      options.push({
        value,
        name: face?.name ?? value.slice(GOOGLE_FONT_ID_PREFIX.length),
        face,
        google: input.fetches && value.startsWith(GOOGLE_FONT_ID_PREFIX),
      });
    }
    return {
      row,
      slot,
      value,
      asBody: row === 'head' && body === 'sans' && film.faces.display === undefined && film.other.display === undefined,
      mute: muteWithPicks && value !== '' && !value.startsWith(GOOGLE_FONT_ID_PREFIX),
      options,
    };
  };

  const rows = ordered
    .map((slot) => rowFor(slot === 'display' ? 'head' : slot === body ? 'body' : rowKindOf(slot), slot))
    .filter((row) => row.options.length > 1);
  return { rows: rows.length > 0 ? rows : null, notice, film, picks };
}

function rowKindOf(slot: Exclude<FontSlot, 'display'>): FontRowKind {
  switch (slot) {
    case 'sans':
      return 'sans';
    case 'serif':
      return 'serif';
    case 'mono':
      return 'mono';
    default: {
      const never: never = slot;
      return never;
    }
  }
}

/**
 * `refaced.json` with `choice` picked for `slot` (`''`: the film's own), or `undefined` when the choice names
 * nothing the record can hold. `null` text: the record goes.
 */
export function refacedTextFor(refacedText: string | null, film: FilmFontSlots, slot: FontSlot, choice: string): string | null | undefined {
  const family = choice.startsWith(GOOGLE_FONT_ID_PREFIX) ? choice.slice(GOOGLE_FONT_ID_PREFIX.length) : undefined;
  const serif = (family === undefined ? slot : (findGoogleFontMetadata(family)?.generic ?? slot)) === 'serif';
  const value = pickedSlotValue(choice, film.faces[slot], slot, serif);
  const picked = value === null ? null : parseRefacedSlot(value);
  if (picked === undefined) return undefined;
  return serializeRefacedRecord(setRefacedSlot(parseRefacedRecord(refacedText), slot, picked));
}

/** True when a person picked another typeface for `slot` than the missing `family`, so its absence does not show. */
const pickedOver = (picks: Partial<Record<FontSlot, unknown>>, slot: FontSlot, family: string): boolean =>
  picks[slot] !== undefined && getFontChoiceId(picks[slot]) !== GOOGLE_FONT_ID_PREFIX + family;

/**
 * The missing families a person should be told of: not those still coming, and not those every slot of which a
 * person picked something else for. `told` names the families already told of.
 */
export function fallbacksToTell(missing: readonly MissingFont[], picks: Partial<Record<FontSlot, unknown>>, told: ReadonlySet<string>): MissingFont[] {
  return missing.filter(
    (font) => font.coming !== true && !told.has(font.name) && (font.slots.length === 0 || font.slots.some((slot) => !pickedOver(picks, slot, font.name))),
  );
}

/** What a fallback toast names as the stand-in a family fell back to, or `null` to name none. */
export function standInName(font: MissingFont, picks: Partial<Record<FontSlot, unknown>>): string | null {
  if (font.or === null || font.slots.some((slot) => pickedOver(picks, slot, font.name))) return null;
  return resolveFontFamily(font.or)?.name ?? font.or;
}
