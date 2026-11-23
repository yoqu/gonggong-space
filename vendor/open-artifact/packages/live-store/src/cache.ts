import type { LiveCache } from './engine.ts';
import type { SyncDocument } from './transport.ts';

/** The largest saved copy kept (UTF-16 characters); a larger one is dropped rather than kept stale. */
export const SAVED_COPY_MAX_CHARS = 4_000_000;

function isSyncDocument(item: unknown): item is SyncDocument {
  if (typeof item !== 'object' || item === null) return false;
  const document = item as Partial<SyncDocument>;
  return typeof document.path === 'string' && typeof document.data === 'object' && document.data !== null;
}

/**
 * A saved copy in local storage under `key`. Storage that is unavailable
 * (private windows, blocked site data) or full just means no copy.
 */
export function localStorageCache(key: string, maxChars = SAVED_COPY_MAX_CHARS): LiveCache {
  return {
    read() {
      try {
        const value: unknown = JSON.parse(globalThis.localStorage.getItem(key) ?? 'null');
        if (!Array.isArray(value)) return undefined;
        const documents = value.filter(isSyncDocument);
        return documents.length > 0 ? documents : undefined;
      } catch {
        return undefined;
      }
    },
    write(documents) {
      try {
        const json = JSON.stringify(documents);
        if (json.length > maxChars) globalThis.localStorage.removeItem(key);
        else globalThis.localStorage.setItem(key, json);
      } catch {
        // No room or no storage: no saved copy.
      }
    },
  };
}
