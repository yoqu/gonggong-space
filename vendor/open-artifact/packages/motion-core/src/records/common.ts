import { INVISIBLE_RUN_PATTERN, hasVisibleText, isPlainObject, readRecordInput, type JsonObject } from '../json.ts';
import { FILM_SCHEMA_VERSION, MAX_SCENE_NAME_CHARS } from '../limits.ts';

/** Which version of a record a module holds: none (or not readable), this one, or a later one this page cannot read. */
export type RecordVersion = 'none' | 'ours' | 'later';

/** The record's object when it is version 1 with a list under `key`, else `null`. */
export function readVersionOneRecord(input: unknown, key: string): JsonObject | null {
  const record = readRecordInput(input);
  return record !== null && record.v === FILM_SCHEMA_VERSION && Array.isArray(record[key]) ? record : null;
}

export function recordVersion(input: unknown, key: string): RecordVersion {
  const record = readRecordInput(input);
  if (record === null) return 'none';
  if (record.v === FILM_SCHEMA_VERSION && Array.isArray(record[key])) return 'ours';
  return typeof record.v === 'number' && Number.isInteger(record.v) && record.v >= 2 ? 'later' : 'none';
}

/** The record's `about` when it shows something (the page writes one; a blank one counts as none). */
export function recordAbout(record: JsonObject | null): string | undefined {
  return record !== null && hasVisibleText(record.about) ? (record.about as string) : undefined;
}

/** How a record is written back: with the page's `about` text, or bare (as the film had it). */
export interface SerializeRecordOptions {
  about?: boolean;
}

/** A scene's name as typed by hand: hidden characters as spaces, trimmed, at most 48 characters. */
export function normalizeSceneLabel(input: string): string {
  return Array.from(input.slice(0, 2 * MAX_SCENE_NAME_CHARS))
    .slice(0, MAX_SCENE_NAME_CHARS)
    .join('')
    .replace(INVISIBLE_RUN_PATTERN, ' ')
    .trim();
}

export const MAX_LAYER_LABEL_CHARS = 60;

/** A layer's label as shown: hidden characters as spaces, trimmed, at most 60 characters. */
export function normalizeLayerLabel(input: string | null | undefined): string {
  return Array.from((input ?? '').replace(INVISIBLE_RUN_PATTERN, ' ').trim())
    .slice(0, MAX_LAYER_LABEL_CHARS)
    .join('')
    .trim();
}

/** A `{was, v}` pair of the given guards, else `undefined`. */
export function readPair<W, V>(value: unknown, was: (item: unknown) => item is W, v: (item: unknown) => item is V): { was: W; v: V } | undefined {
  return isPlainObject(value) && was(value.was) && v(value.v) ? { was: value.was, v: value.v } : undefined;
}

export const numberWithin =
  (min: number, max: number) =>
  (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export const matching =
  (pattern: RegExp) =>
  (value: unknown): value is string =>
    typeof value === 'string' && pattern.test(value);
