/**
 * JSON helpers shared by the codec, the sync engine and history: canonical
 * comparison, JSON merge patches (RFC 7396), depth and byte measures.
 *
 * A merge patch sets fields it names, recurses into objects, and deletes a
 * field whose patch value is `null`. Arrays are replaced whole.
 */

/** A JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** A JSON object. */
export type JsonObject = { [key: string]: Json };
/** A JSON merge patch: like the object, with `null` meaning "delete". */
export type MergePatch = { [key: string]: Json | undefined };

const PROTO_KEY = '__proto__';

/** True for a plain object (not an array, not null). */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const stableJsonCache = new WeakMap<object, string>();

function sortKeys(_key: string, value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return sorted;
}

/** JSON text with object keys sorted (cached per object). */
export function stableStringify(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const cached = stableJsonCache.get(value);
    if (cached !== undefined) return cached;
    const json = JSON.stringify(value, sortKeys) ?? 'undefined';
    stableJsonCache.set(value, json);
    return json;
  }
  return JSON.stringify(value, sortKeys) ?? 'undefined';
}

/** True when two values are the same JSON, ignoring key order. */
export function canonicalValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return stableStringify(a) === stableStringify(b);
}

/** Deep merge of `patch` into `base` (no deletes; `undefined` is skipped). */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined || key === PROTO_KEY) continue;
    const current = merged[key];
    merged[key] = isPlainRecord(current) && isPlainRecord(value) ? deepMerge(current, value) : value;
  }
  return merged as T;
}

/**
 * Merges two partial records when they do not conflict in shape (an object
 * field never meets a non-object); `null` when they do.
 */
export function mergeCompatibleRecords(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...a };
  for (const key of Object.keys(b)) {
    const value = b[key];
    if (value === undefined || key === PROTO_KEY) continue;
    const current = merged[key];
    if (isPlainRecord(value) && current !== undefined) {
      if (!isPlainRecord(current)) return null;
      const inner = mergeCompatibleRecords(current, value);
      if (inner === null) return null;
      merged[key] = inner;
    } else merged[key] = value;
  }
  return merged;
}

/**
 * The merge patch that turns `from` into `to`, or `null` when they are equal.
 * With `from` undefined the patch is `to` itself.
 */
export function createJsonMergePatch(from: Record<string, unknown> | undefined, to: Record<string, unknown>): MergePatch | null {
  if (from === to) return null;
  if (from === undefined) return to as MergePatch;
  let patch: MergePatch | null = null;
  for (const key of Object.keys(to)) {
    if (key === PROTO_KEY) continue;
    const next = to[key];
    const previous = from[key];
    if (next === undefined) {
      if (previous !== undefined) (patch ??= {})[key] = null;
      continue;
    }
    if (previous === next) continue;
    if (isPlainRecord(previous) && isPlainRecord(next)) {
      const inner = createJsonMergePatch(previous, next);
      if (inner !== null) (patch ??= {})[key] = inner as Json;
    } else if (previous === undefined || !canonicalValuesEqual(previous, next)) (patch ??= {})[key] = next as Json;
  }
  for (const key of Object.keys(from)) {
    if (from[key] !== undefined && to[key] === undefined) (patch ??= {})[key] = null;
  }
  return patch;
}

/** Applies a merge patch to a record (a missing record starts empty). */
export function applyJsonMergePatch(target: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(target ?? {}) };
  for (const key of Object.keys(patch)) {
    if (key === PROTO_KEY) continue;
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete result[key];
    else if (isPlainRecord(value)) result[key] = applyJsonMergePatch(isPlainRecord(result[key]) ? result[key] : undefined, value);
    else result[key] = value;
  }
  return result;
}

/** Composes two merge patches into one with the same effect (`a` then `b`). */
export function composeMergePatches(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...a };
  for (const key of Object.keys(b)) {
    if (key === PROTO_KEY) continue;
    const value = b[key];
    if (value === undefined) continue;
    const previous = result[key];
    result[key] = isPlainRecord(value) && isPlainRecord(previous) ? composeMergePatches(previous, value) : value;
  }
  return result;
}

/** The patch with every `null` (delete) removed: what the patch *sets*. */
export function removeNullMergePatchFields<T extends Record<string, unknown>>(patch: T): T {
  let result: Record<string, unknown> | undefined;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    let next: unknown = value;
    if (value === null || value === undefined || key === PROTO_KEY) next = undefined;
    else if (isPlainRecord(value)) next = removeNullMergePatchFields(value);
    if (next !== value) {
      result ??= { ...patch };
      if (next === undefined) delete result[key];
      else result[key] = next;
    }
  }
  return (result ?? patch) as T;
}

/** How many `null` deletes a patch carries. */
export function countMergePatchTombstones(patch: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(patch)) {
    if (value === null) count += 1;
    else if (isPlainRecord(value)) count += countMergePatchTombstones(value);
  }
  return count;
}

/** True when applying `patch` to `target` changes nothing. */
export function isMergePatchSubset(patch: Record<string, unknown>, target: Record<string, unknown> | undefined): boolean {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    const current = target?.[key];
    if (value === null) {
      if (current !== undefined) return false;
    } else if (isPlainRecord(value)) {
      if (!isPlainRecord(current) || !isMergePatchSubset(value, current)) return false;
    } else if (!canonicalValuesEqual(value, current)) return false;
  }
  return true;
}

/** Nesting depth of a JSON value (a scalar is 0); stops counting at `limit`. */
export function jsonValueDepth(value: unknown, limit = 64): number {
  if (typeof value !== 'object' || value === null) return 0;
  let depth = 0;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    depth = Math.max(depth, jsonValueDepth(child, limit - 1));
    if (depth >= limit) break;
  }
  return depth + 1;
}

/**
 * Bytes of a value's JSON as a server that escapes `<`, `>`, `&` (as
 * `<`…, +5 bytes each) and U+2028/2029 (+3 bytes) would store it.
 */
export function escapedJsonByteLength(value: unknown): number {
  const json = JSON.stringify(value) ?? '';
  const extra = 5 * (json.match(/[<>&]/g)?.length ?? 0) + 3 * (json.match(/[\u2028\u2029]/g)?.length ?? 0);
  return new TextEncoder().encode(json).length + extra;
}

/** A deep copy of a JSON value. */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
