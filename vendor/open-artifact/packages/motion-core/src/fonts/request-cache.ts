/** How the font fetcher reaches the network and the clock; tests pass their own. */
export interface FontFetchIo {
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): number;
  /** Runs `run` after `ms`; the function it gives cancels that. */
  after(ms: number, run: () => void): () => void;
}

export const DEFAULT_FONT_FETCH_IO: FontFetchIo = {
  fetch: (url, init) => fetch(url, init),
  now: () => performance.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** How long a request is waited for before the film loads without it, and how long the page waits on. */
export interface FontWaits {
  sheetMs: number;
  fileMs: number;
  lateMs: number;
}

export const DEFAULT_FONT_WAITS: FontWaits = { sheetMs: 2000, fileMs: 2500, lateMs: 15_000 };

/** A failed request is asked again after a minute, then twice as long each time up to ten minutes. */
export const FONT_FETCH_RETRY_DELAYS: readonly [number, number] = [60_000, 600_000];
export const MAX_CACHED_FONT_REQUESTS = 32;

/** When a request comes too late for the film's load: after `ms` from its start, `late` runs and the wait gives `null`. */
export interface LateWait {
  ms: number;
  late(): void;
}

interface CachedRequest<T> {
  from: number;
  over: boolean;
  whole: Promise<T | null>;
}

interface Failure {
  at: number;
  wait: number;
}

/**
 * Requests by key, each made once while it runs or has given a result (the 32 latest kept), a failed one not made
 * again until its wait is over.
 */
export function createFontRequestCache<T>({ now, after }: Pick<FontFetchIo, 'now' | 'after'>) {
  const requests = new Map<string, CachedRequest<T>>();
  const failures = new Map<string, Failure>();
  const remember = <V>(map: Map<string, V>, key: string, entry: V, keep: (entry: V) => boolean = () => false): void => {
    map.delete(key);
    map.set(key, entry);
    for (const [oldKey, oldEntry] of map) if (map.size > MAX_CACHED_FONT_REQUESTS && !keep(oldEntry)) map.delete(oldKey);
  };
  const start = (key: string, fetchEntry: () => Promise<T | null>, from: number): CachedRequest<T> | null => {
    const failure = failures.get(key);
    if (failure !== undefined && now() - failure.at < failure.wait) return null;
    const request: CachedRequest<T> = {
      from,
      over: false,
      whole: fetchEntry()
        .finally(() => {
          request.over = true;
        })
        .then((result) => {
          if (result !== null) {
            failures.delete(key);
            return result;
          }
          if (requests.get(key) !== request && requests.has(key)) return null;
          requests.delete(key);
          remember(failures, key, {
            at: now(),
            wait: failure === undefined ? FONT_FETCH_RETRY_DELAYS[0] : Math.min(failure.wait * 2, FONT_FETCH_RETRY_DELAYS[1]),
          });
          return null;
        }),
    };
    return request;
  };
  return (key: string, fetchEntry: () => Promise<T | null>, late?: LateWait): Promise<T | null> => {
    const request = requests.get(key) ?? start(key, fetchEntry, late === undefined ? -Infinity : now());
    if (request === null) return Promise.resolve(null);
    remember(requests, key, request, (entry) => !entry.over);
    if (late === undefined || request.over) return request.whole;
    return new Promise<T | null>((resolve, reject) => {
      const cancel = after(Math.max(0, request.from + late.ms - now()), () => {
        late.late();
        resolve(null);
      });
      const stop = (): void => {
        try {
          cancel();
        } catch {
          // A cancel that throws leaves only a timer that resolves nothing.
        }
      };
      request.whole.then(
        (result) => {
          resolve(result);
          stop();
        },
        (error: unknown) => {
          reject(error);
          stop();
        },
      );
    });
  };
}

/** Why a request gave nothing. */
export const FONT_FETCH_FAILURE_CAUSES = ['timeout', 'network', 'invalid_content', 'too_large', 'internal'] as const;
export type FontFetchCause = (typeof FONT_FETCH_FAILURE_CAUSES)[number];

/**
 * A file's bytes, at most `maxBytes` (by its length header and as it streams), with no cookies, referrer or
 * redirect; `null` past `timeoutMs` or on any failure, which `onFailure` names.
 */
export function fetchLimitedBytes(
  io: FontFetchIo,
  url: string,
  timeoutMs: number,
  maxBytes: number,
  onFailure: (cause: FontFetchCause) => void = () => undefined,
): Promise<Uint8Array | null> {
  const abort = new AbortController();
  const read = async (): Promise<Uint8Array | null> => {
    const response = await io.fetch(url, { signal: abort.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', mode: 'cors' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > maxBytes || response.body === null) {
      onFailure(response.ok && response.body !== null ? 'too_large' : 'network');
      return null;
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const reader = response.body.getReader(); ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        onFailure('too_large');
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    chunks.reduce((offset, chunk) => (bytes.set(chunk, offset), offset + chunk.length), 0);
    return bytes;
  };
  return new Promise((resolve) => {
    let cancel = (): void => undefined;
    const finish = (bytes: Uint8Array | null): void => {
      resolve(bytes);
      try {
        cancel();
      } catch {
        // The timer may already be gone.
      }
      if (bytes === null) abort.abort();
    };
    try {
      cancel = io.after(timeoutMs, () => {
        onFailure('timeout');
        finish(null);
      });
      read().then(finish, () => {
        onFailure('network');
        finish(null);
      });
    } catch {
      onFailure('internal');
      finish(null);
    }
  });
}
