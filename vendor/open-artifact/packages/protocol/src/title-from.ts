/**
 * A type's `titleFrom` (`<file>#<JSON pointer>`, as `artifact-type.json` declares it): where an artifact's title lives
 * in its own files. Shared by the type server (and so the hosts) and the daemon, which read the file themselves.
 */

/** A `titleFrom` split into its file (relative to the artifact root) and JSON pointer, or null when it is not one. */
export function parseTitleFrom(spec: string): { file: string; pointer: string } | null {
  const hash = spec.indexOf('#');
  const file = hash === -1 ? spec : spec.slice(0, hash);
  const pointer = hash === -1 ? '' : spec.slice(hash + 1);
  if (!file || file.startsWith('/') || file.split('/').some((part) => part === '..' || part === '')) return null;
  if (pointer !== '' && !pointer.startsWith('/')) return null;
  return { file, pointer };
}

/** The value at a JSON pointer (RFC 6901) inside a parsed JSON value, or undefined. */
export function valueAtPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  let at: unknown = value;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(at)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) return undefined;
      at = at[Number(key)];
    } else if (at && typeof at === 'object' && Object.hasOwn(at, key)) {
      at = (at as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return at;
}

/** The title at `pointer` in a JSON file's text: a non-empty string, trimmed, or undefined (also for bad JSON). */
export function titleInJson(text: string, pointer: string): string | undefined {
  try {
    const value = valueAtPointer(JSON.parse(text), pointer);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}
