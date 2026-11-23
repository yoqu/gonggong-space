import { isPlainObject, parseJsonRecord, type JsonObject } from '../json.ts';
import { FILM_SCHEMA_VERSION } from '../limits.ts';
import { FETCHED_FONTS_MODULE, RECOLORED_MODULE, RECUT_MODULE, REFACED_MODULE, RETOUCHED_MODULE, RETYPED_MODULE, SCENES_MODULE } from '../names.ts';
import { scanStringLiterals } from '../retype/js-strings.ts';
import { FONT_SLOTS, PRIMARY_FONT_SLOTS, isFontSlot, resolveBuiltinFont, resolveFontFamily, type BuiltinFont, type FontSlot } from './builtin.ts';

/** What a film's modules give the font code: a name, a kind (js, css, html, json, …) and a text. */
export interface FontModule {
  name: string;
  kind: string;
  text: string;
}

/**
 * Which typeface each slot shows: `faces` the built-in typeface (named, or the stand-in of a family), `other` each
 * slot's value that is not a plain built-in name (a Google Fonts family, as written), `odd` when `"fonts"` in
 * scenes.json is not a record of slots.
 */
export interface FilmFontSlots {
  faces: Partial<Record<FontSlot, BuiltinFont>>;
  other: Partial<Record<FontSlot, unknown>>;
  odd: boolean;
}

/**
 * Which picks a reading takes: `shown` all of a person's picks (what the stage shows), `film` none (the film's own),
 * `asked` only those that are not a built-in typeface (what is fetched).
 */
export type FontSlotReading = 'shown' | 'film' | 'asked';

const moduleText = (modules: readonly FontModule[], name: string): string | undefined => modules.find((module) => module.name === name)?.text;

/** The slots `refaced.json` picks, as written: a built-in name, or a record whose `or` names one. */
export function readRefacedSlotValues(text: unknown): Partial<Record<FontSlot, unknown>> {
  const record = parseJsonRecord(text);
  if (record === null || record.v !== FILM_SCHEMA_VERSION) return {};
  return Object.fromEntries(
    FONT_SLOTS.flatMap((slot) => {
      const value = record[slot];
      const usable = resolveBuiltinFont(value) !== undefined || (isPlainObject(value) && resolveFontFamily(value.or) !== undefined);
      return usable ? [[slot, value] as const] : [];
    }),
  );
}

export function readFilmFontSlots(modules: readonly FontModule[], reading: FontSlotReading = 'shown'): FilmFontSlots {
  const scenes = parseJsonRecord(moduleText(modules, SCENES_MODULE));
  const fonts: JsonObject = scenes?.v === FILM_SCHEMA_VERSION && isPlainObject(scenes.fonts) ? scenes.fonts : {};
  const odd =
    scenes?.v === FILM_SCHEMA_VERSION && scenes.fonts !== undefined && (!isPlainObject(scenes.fonts) || Object.keys(fonts).some((key) => !isFontSlot(key)));
  const picks = reading === 'film' ? {} : readRefacedSlotValues(moduleText(modules, REFACED_MODULE));
  const merged: Partial<Record<string, unknown>> = {
    ...fonts,
    ...Object.fromEntries(Object.entries(picks).filter(([, value]) => reading === 'shown' || resolveBuiltinFont(value) === undefined)),
  };
  const faces: Partial<Record<FontSlot, BuiltinFont>> = {};
  const other: Partial<Record<FontSlot, unknown>> = {};
  for (const slot of FONT_SLOTS) {
    const value = merged[slot];
    if (value === undefined) continue;
    const plain = resolveFontFamily(value);
    const face = plain ?? (isPlainObject(value) ? (resolveFontFamily(value.family) ?? resolveFontFamily(value.or)) : undefined);
    if (face !== undefined) faces[slot] = face;
    if (plain === undefined) other[slot] = value;
  }
  return { faces, other, odd };
}

const SLOT_USE_PATTERN =
  /font(?:-family|Family)?["']?\s{0,20}[:=]\s{0,20}["'`]?[^;}"'`]{0,200}?var\(\s*--(sans|serif|mono|display)\b|\bfonts\.(sans|serif|mono|display)\b/g;
const CODE_KINDS = ['js', 'css', 'html'];

/**
 * The slots a film sets text in, the way the Font panel lists them: display first, then the stage's own stack, then
 * the other running-text slots; just sans when the code names none.
 */
export function usedFontSlots(modules: readonly FontModule[], picks: Partial<Record<FontSlot, unknown>>): FontSlot[] {
  const named = new Set(
    modules.flatMap((module) => (CODE_KINDS.includes(module.kind) ? [...module.text.matchAll(SLOT_USE_PATTERN)].map((match) => match[1] ?? match[2]) : [])),
  );
  const used = FONT_SLOTS.filter((slot) => picks[slot] !== undefined || named.has(slot));
  const stageSlots = modules.flatMap((module) => {
    const at = module.kind === 'css' ? module.text.search(/#stage\s*\{/) : -1;
    if (at < 0) return [];
    const rule = module.text.slice(at, at + 2000).split('}', 1)[0] ?? '';
    const slot = /font(?:-family)?\s*:[^;]{0,200}?var\(\s*--(sans|serif|mono)\b/.exec(rule)?.[1];
    return slot === undefined ? [] : [slot];
  });
  const primary = PRIMARY_FONT_SLOTS.filter((slot) => used.includes(slot));
  return [
    ...used.filter((slot) => slot === 'display'),
    ...new Set([...primary.filter((slot) => stageSlots.includes(slot)), ...(primary.length > 0 ? primary : (['sans'] as const))]),
  ];
}

/** Modules whose text is not shown words: the page's records and the film's settings. */
const FONT_SCAN_EXCLUDED_MODULES = new Set([RETYPED_MODULE, RECOLORED_MODULE, REFACED_MODULE, RECUT_MODULE, RETOUCHED_MODULE, SCENES_MODULE]);

export function isFontScanExcluded(module: FontModule): boolean {
  if (FONT_SCAN_EXCLUDED_MODULES.has(module.name)) return true;
  if (module.name !== FETCHED_FONTS_MODULE) return false;
  const record = parseJsonRecord(module.text);
  return record !== null && record.v === FILM_SCHEMA_VERSION && Array.isArray(record.families);
}

const decodeCodePoint = (match: string, hex?: string, decimal?: string): string => {
  const point = hex !== undefined ? parseInt(hex, 16) : decimal !== undefined ? Number(decimal) : NaN;
  return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
};

/**
 * The text a module could show: a script's string literals (all of it when it does not scan), with `\u…` and `\x…`
 * escapes read in scripts and JSON, and character references everywhere.
 */
export function moduleShownText({ kind, text }: FontModule): string {
  const literals = kind === 'js' ? scanStringLiterals(text)?.literals : undefined;
  const shown = literals === undefined ? text : literals.flat().map((span) => text.slice(span.start, span.end)).join('\n');
  const unescaped =
    kind === 'js' || kind === 'json'
      ? shown.replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2}))/gi, (match: string, braced?: string, four?: string, two?: string) =>
          decodeCodePoint(match, braced ?? four ?? two),
        )
      : shown;
  return unescaped.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (match: string, hex?: string, decimal?: string) => decodeCodePoint(match, hex, decimal));
}

/** All the text a film could show. */
export const filmShownText = (modules: readonly FontModule[]): string =>
  modules
    .filter((module) => !isFontScanExcluded(module))
    .map(moduleShownText)
    .join('\n');

/** Too many marks on one letter, which no font draws well. */
const EXCESSIVE_COMBINING_MARKS = /\p{M}{9}/u;
/** A letter or mark the built-in typefaces lack (they hold Latin, Greek in part, and some symbols). */
const UNSUPPORTED_BUILTIN_CHARACTERS =
  /(?![\u0000-þıŒœʻʼͰ-Ͽⁿ⃣℀-⅏ﬁﬂ︀-️])[\p{L}\p{M}]|[Ͱ-Ͽ](?=[Ͱ-Ͽ])/u;

/** True when the built-in typefaces can spell all the film shows. */
export function builtinFontsCoverText(modules: readonly FontModule[]): boolean {
  return !modules.some((module) => {
    if (isFontScanExcluded(module)) return false;
    const text = moduleShownText(module);
    return EXCESSIVE_COMBINING_MARKS.test(text) || UNSUPPORTED_BUILTIN_CHARACTERS.test(text.normalize('NFC'));
  });
}
