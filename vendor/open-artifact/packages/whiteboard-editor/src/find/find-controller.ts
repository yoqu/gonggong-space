/**
 * Find in page, without the page: a controller that searches as the query
 * settles, keeps the current match across re-searches (the board changed
 * under it), steps forward and back with wrap-around, and asks its adapter
 * to reveal and paint matches. Matches the adapter cannot reveal any more
 * are dropped on the way.
 *
 * The adapter owns the page: `search` lists the matches in reading order,
 * `reveal` brings one into view (`false` when it is gone), `paint`
 * highlights them, `clear` takes the highlights away. `subscribe` tells
 * the controller when the searched content changed.
 */

import { EMPTY_FIND_STATUS, FIND_DEBOUNCE_MS, MAX_FIND_MATCHES, type FindStatus } from './find-text.ts';

/** One match: a stable key, the item it is in, and which of that item's matches it is. */
export interface FindMatch {
  key: string;
  id: string;
  nth: number;
}

/** What the controller needs from the page. */
export interface FindAdapter {
  search(query: string, signal: AbortSignal): FindMatch[] | Promise<FindMatch[]>;
  reveal(match: FindMatch, signal: AbortSignal): Promise<boolean | void>;
  paint(matches: readonly FindMatch[], current: number): void;
  clear(): void;
  subscribe?(listener: () => void): () => void;
}

/** A find controller (see the module comment). */
export interface FindController {
  /** Searches for a query once typing settles (`''` clears). */
  setQuery(query: string): void;
  /** Moves to the next (1) or previous (-1) match and reveals it. */
  step(direction: 1 | -1): void;
  /** Forgets the query and the highlights. */
  clear(): void;
  status(): FindStatus;
  subscribe(listener: (status: FindStatus) => void): () => void;
  dispose(): void;
}

/** Creates a find controller over an adapter. */
export function createFindController(adapter: FindAdapter, options: { debounceMs?: number } = {}): FindController {
  const debounceMs = options.debounceMs ?? FIND_DEBOUNCE_MS;
  const listeners = new Set<(status: FindStatus) => void>();
  let status: FindStatus = EMPTY_FIND_STATUS;
  let matches: FindMatch[] = [];
  let index = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchedQuery = '';
  let revealedKey: string | undefined;
  let searchAbort: AbortController | undefined;
  let revealAbort: AbortController | undefined;
  let disposed = false;

  const publish = (next: FindStatus): void => {
    status = next;
    for (const listener of [...listeners]) listener(status);
  };
  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const reveal = async (direction: 1 | -1 = 1): Promise<void> => {
    revealAbort?.abort();
    const abort = new AbortController();
    revealAbort = abort;
    const tried = new Set<string>();
    while (!abort.signal.aborted && !disposed) {
      const match = matches[index];
      if (match === undefined || tried.has(match.key)) return;
      tried.add(match.key);
      revealedKey = match.key;
      let shown: boolean | void;
      try {
        shown = await adapter.reveal(match, abort.signal);
      } catch {
        return;
      }
      if (abort.signal.aborted || disposed || matches[index]?.key !== match.key) return;
      if (shown !== false) {
        adapter.paint(matches, index);
        return;
      }
      // Gone since the search: drop it and go on in the same direction.
      matches = matches.filter((other) => other.key !== match.key);
      index = matches.length === 0 ? -1 : direction === 1 ? index % matches.length : (index - 1 + matches.length) % matches.length;
      publish({ ...status, total: matches.length, current: index + 1 });
      adapter.paint(matches, index);
    }
  };

  const search = async (): Promise<void> => {
    stopTimer();
    searchAbort?.abort();
    const abort = new AbortController();
    searchAbort = abort;
    const query = status.query;
    let found: FindMatch[];
    try {
      found = await adapter.search(query, abort.signal);
    } catch {
      found = [];
    }
    if (abort.signal.aborted || disposed || query !== status.query) return;
    const newQuery = query !== searchedQuery;
    const keepKey = newQuery ? undefined : matches[index]?.key;
    const capped = found.length > MAX_FIND_MATCHES;
    matches = capped ? found.slice(0, MAX_FIND_MATCHES) : found;
    if (newQuery || matches.length === 0) revealedKey = undefined;
    searchedQuery = query;
    const kept = keepKey === undefined ? -1 : matches.findIndex((match) => match.key === keepKey);
    index = matches.length === 0 ? -1 : kept !== -1 ? kept : newQuery ? 0 : Math.min(Math.max(index, 0), matches.length - 1);
    publish({ query, total: matches.length, current: index + 1, capped, searching: false });
    adapter.paint(matches, index);
    if (newQuery) void reveal();
  };

  const schedule = (): void => {
    stopTimer();
    if (debounceMs <= 0) {
      void search();
      return;
    }
    timer = setTimeout(() => void search(), debounceMs);
  };

  const reset = (): void => {
    stopTimer();
    searchedQuery = '';
    searchAbort?.abort();
    revealAbort?.abort();
    matches = [];
    index = -1;
    adapter.clear();
  };

  const unsubscribe = adapter.subscribe?.(() => {
    if (!disposed && status.query !== '') schedule();
  });

  return {
    setQuery(query) {
      if (disposed || query === status.query) return;
      if (query === '') {
        reset();
        publish(EMPTY_FIND_STATUS);
        return;
      }
      searchAbort?.abort();
      revealAbort?.abort();
      publish({ ...status, query, searching: true });
      schedule();
    },
    step(direction) {
      if (disposed || status.query === '') return;
      if (status.query !== searchedQuery) {
        // Still typing: search now; the first match shows.
        if (timer !== undefined) void search();
        return;
      }
      if (matches.length === 0) return;
      if (matches[index]?.key === revealedKey) index = (index + direction + matches.length) % matches.length;
      publish({ ...status, current: index + 1 });
      adapter.paint(matches, index);
      void reveal(direction);
    },
    clear() {
      if (disposed) return;
      reset();
      if (status !== EMPTY_FIND_STATUS) publish(EMPTY_FIND_STATUS);
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      unsubscribe?.();
      listeners.clear();
    },
  };
}
