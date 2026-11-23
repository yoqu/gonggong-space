export type JsonObject = Record<string, unknown>;

export const isPlainObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The longest JSON text a record or `scenes.json` is read from. */
export const MAX_RECORD_CHARS = 262_144;

/** A JSON object from its text, or `null` for anything else (bad JSON, an array, a text over `maxChars`). */
export function parseJsonRecord(text: unknown, maxChars: number = MAX_RECORD_CHARS): JsonObject | null {
  if (typeof text !== 'string' || text.length > maxChars) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** A record given as its JSON text or already parsed. */
export function readRecordInput(input: unknown): JsonObject | null {
  return typeof input === 'string' ? parseJsonRecord(input) : isPlainObject(input) ? input : null;
}

const encoder = new TextEncoder();

/** UTF-8 bytes of a text. */
export const utf8Bytes = (text: string): number => encoder.encode(text).length;

/**
 * The store's measure of a document: UTF-8 bytes of its JSON, with `<`, `>`, `&` and U+2028/9 counted as the
 * escapes the store writes for them.
 */
export function storeBytes(value: unknown): number {
  const text = JSON.stringify(value) ?? '';
  return utf8Bytes(text) + 5 * (text.match(/[<>&]/g)?.length ?? 0) + 3 * (text.match(/[\u2028\u2029]/g)?.length ?? 0);
}

export const formatKib = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;

export const formatMib = (bytes: number): string => `${bytes / 1024 / 1024} MiB`;

/** At most `max` characters (code points) of a text; anything but a string is empty. */
export function clipCharacters(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  const characters = Array.from(input);
  return characters.length <= max ? input : characters.slice(0, max).join('');
}

/** Characters that never show: controls, format, private use, separators, blanks and the like. */
export const INVISIBLE_RUN_PATTERN =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Noncharacter_Code_Point}\p{Default_Ignorable_Code_Point}⠀￼\u{16fe4}\s]+/gu;

const HIDDEN_OR_EMOJI_PATTERN =
  /(\p{Extended_Pictographic}[️\p{Emoji_Modifier}]?(?:‍\p{Extended_Pictographic}[️\p{Emoji_Modifier}]?)*|[0-9#*]️?⃣)|[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Noncharacter_Code_Point}\p{Default_Ignorable_Code_Point}⠀￼\u{16fe4}]+/gu;

/** At most `max` characters of a text with hidden characters turned into spaces (emoji kept whole). */
export function clipVisibleText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return Array.from(input)
    .slice(0, max)
    .join('')
    .replace(HIDDEN_OR_EMOJI_PATTERN, (_match: string, emoji: string | undefined) => emoji ?? ' ');
}

/** True when a text shows something (hidden and blank characters do not count). */
export const hasVisibleText = (input: unknown): boolean => typeof input === 'string' && input.replace(INVISIBLE_RUN_PATTERN, '') !== '';

/** JSON with every object's keys sorted, to compare two records. */
export function stringifySortedKeys(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isPlainObject(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item,
  );
}
