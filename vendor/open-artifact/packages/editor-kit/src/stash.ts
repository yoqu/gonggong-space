/**
 * Unsaved-work recovery, the shared part: while edits wait to be saved, an
 * editor copies what differs from the saved files to `localStorage` (a
 * "stash"); if the tab closes before the save lands, the next visit offers
 * it back. What a stash holds and how it is restored is the editor's; this
 * module keeps the storage guarded, the age limit and the debounce.
 */

/** How long a stash is kept, ms (three days). */
export const STASH_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

/** True while a stash written at `at` may still be offered (not too old, not from the future). */
export function stashFresh(at: number, now: number): boolean {
  return now - at <= STASH_KEEP_MS && at <= now + 60_000;
}

/** A stored JSON value under one key, every access guarded. */
export interface StoredJson<T> {
  read(): T | null;
  /** Writes `value`; `null` clears. */
  write(value: T | null): void;
  clear(): void;
}

/**
 * A JSON value stored under `key` (e.g. `open-artifact-design:recovery:<path>`).
 * `parse` validates what is read back (`null`: unusable). Storage that is
 * missing, full or blocked reads as empty and ignores writes.
 */
export function storedJson<T>(key: string, parse: (value: unknown) => T | null, storage: () => Storage | undefined = () => globalThis.localStorage): StoredJson<T> {
  const clear = (): void => {
    try {
      storage()?.removeItem(key);
    } catch {
      // Unavailable: nothing to clear.
    }
  };
  return {
    read() {
      try {
        const raw = storage()?.getItem(key);
        return raw ? parse(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    write(value) {
      if (value === null) return clear();
      try {
        storage()?.setItem(key, JSON.stringify(value));
      } catch {
        // Full or unavailable: recovery is best effort.
      }
    },
    clear,
  };
}

/** JSON compared by value (key order and spacing aside), text otherwise. */
export function normalizeJson(text: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    return text;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  return value;
}
