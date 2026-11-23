/**
 * Live sync of the film's documents (`film/*`, `modules/*`, `assets/*`) over the session's store. The value is the
 * documents by path; the engine decodes them. The page writes only its own records (`modules/recut.json`…) through
 * {@link writeFilmDocument}. Leaving or hiding the page sends what is waiting; the Shell is told the save state.
 */

import type { ChromeCommand, ChromeReport } from '@open-artifact/runtime';
import { createLiveStore, localStorageCache, type DocumentValue, type LiveCodec, type LiveSnapshot, type LiveStore, type SyncTransport } from '@open-artifact/live-store';
import { jsonValueDepth } from '@open-artifact/live-store/json';
import { DB_LIMITS } from '@open-artifact/runtime/capabilities';
import { FILM_COLLECTIONS, FILM_META_PATH, FILM_SCRIPT_PATH, isReplaceOnlyPath } from '@open-artifact/motion-core';
import { toast } from '@open-artifact/ui';
import { useWorking } from '../stores/working.ts';
import { session } from './session.ts';
import { onShellCommand, setShellReport, useShellDraws } from './shell.ts';

/** The film's documents by store path. */
export type FilmDocuments = ReadonlyMap<string, DocumentValue>;

/** What the engine reads of the live film. */
export interface FilmSource {
  documents(): FilmDocuments;
  /** The store has answered (or a saved copy is shown). */
  loaded(): boolean;
  /** Told after every change of the documents; `remote`: someone else made it. */
  subscribe(listener: (remote: boolean) => void): () => void;
}

const EMPTY: FilmDocuments = new Map();

export function refuseFilmDocument(value: unknown): string | undefined {
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  if (bytes > DB_LIMITS.maxDocumentBytes) return `it is larger than ${Math.floor(DB_LIMITS.maxDocumentBytes / 1024)} KB`;
  if (jsonValueDepth(value, DB_LIMITS.maxDepth + 1) > DB_LIMITS.maxDepth) return `it nests deeper than ${DB_LIMITS.maxDepth} levels`;
  return undefined;
}

function sameDocuments(a: FilmDocuments, b: FilmDocuments): boolean {
  if (a.size !== b.size) return false;
  for (const [path, data] of a) if (b.get(path) !== data) return false;
  return true;
}

export function createFilmCodec(): LiveCodec<FilmDocuments> {
  return {
    collections: FILM_COLLECTIONS,
    metaPath: FILM_META_PATH,
    keepsNulls: true,
    decompose: (value) => new Map(value),
    compose: (documents) => ({ value: new Map(documents) }),
    replaceOnly: (path) => isReplaceOnlyPath(path),
    refuse: (_path, value) => refuseFilmDocument(value),
    share: (previous, next) => (sameDocuments(previous, next) ? previous : next),
  };
}

let store: LiveStore<FilmDocuments> | null = null;
let stopSync: (() => void) | null = null;
const listeners = new Set<(remote: boolean) => void>();

export const filmSource: FilmSource = {
  documents: () => store?.value() ?? EMPTY,
  loaded: () => {
    const state = store?.getSnapshot().loadState;
    return state === 'live' || state === 'cached';
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** Replaces a document, or with `null` deletes it; `false` when the page may not write now. */
export function writeFilmDocument(path: string, data: DocumentValue | null): boolean {
  if (store === null) return false;
  const next = new Map(store.value());
  if (data === null) next.delete(path);
  else next.set(path, data);
  return store.commit(next);
}

/** Writes this page made that the store has not confirmed yet. */
export function filmPending(): number {
  return store?.getSnapshot().pending ?? 0;
}

/** Sends every waiting write now. */
export function flushFilm(): Promise<void> {
  return store?.flush() ?? Promise.resolve();
}

function shellSaved(snapshot: LiveSnapshot<FilmDocuments>): ChromeReport['saved'] {
  switch (snapshot.status) {
    case 'ready':
      return 'saved';
    case 'dirty':
      return 'unsaved';
    case 'error':
      return snapshot.loadState === 'failed' && snapshot.pending === 0 ? undefined : 'unsaved';
    case 'saving':
      return 'saving';
    case 'offline':
    case 'cached':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
    case 'loading':
      return undefined;
    default: {
      const never: never = snapshot.status;
      return never;
    }
  }
}

function syncState(snapshot: LiveSnapshot<FilmDocuments>): 'connecting' | 'cached' | 'live' | 'unavailable' {
  switch (snapshot.loadState) {
    case 'loading':
      return 'connecting';
    case 'cached':
      return 'cached';
    case 'live':
      return 'live';
    case 'failed':
      return 'unavailable';
    default: {
      const never: never = snapshot.loadState;
      return never;
    }
  }
}

const hasScript = (documents: FilmDocuments): boolean => {
  const code = documents.get(FILM_SCRIPT_PATH)?.code;
  return typeof code === 'string' && code.trim() !== '';
};

/** Starts live sync; calling it again does nothing. */
export function startLiveFilm(): () => void {
  if (store !== null) return () => undefined;
  const { db, viewer, canEdit } = session();
  const transport: SyncTransport = {
    get: (path) => db.get(path),
    list: (collection) => db.list(collection),
    // Paths come from the codec, which writes only well-formed document paths.
    write: (writes) => db.write(writes as Parameters<typeof db.write>[0]),
    onChange: (listener) => db.onChange(listener),
  };
  const live = createLiveStore<FilmDocuments>({
    transport,
    codec: createFilmCodec(),
    initial: EMPTY,
    readOnly: !canEdit,
    cache: localStorageCache(`video-saved-copy:${typeof location === 'undefined' ? '' : location.pathname}:${viewer.id}`),
  });
  store = live;
  let lastNotice: number | undefined;
  const stops: (() => void)[] = [];

  const publish = (): void => {
    const snapshot = live.getSnapshot();
    useWorking.setState({ sync: syncState(snapshot) });
    if (snapshot.notice !== undefined && snapshot.notice.id !== lastNotice) {
      lastNotice = snapshot.notice.id;
      toast.add({ title: snapshot.notice.message });
    }
    setShellReport({ saved: shellSaved(snapshot), leaveLosesWork: snapshot.pending > 0, hasContent: hasScript(snapshot.value) });
  };
  stops.push(
    live.subscribe((change) => {
      publish();
      if (!change.valueChanged) return;
      if (change.remote) useWorking.setState({ lastFilmWriteAt: Date.now() });
      for (const listener of [...listeners]) listener(change.remote);
    }),
  );
  publish();

  stops.push(
    onShellCommand((command: ChromeCommand) => {
      if (command.cmd !== 'action' || command.id !== 'save_now') return;
      live.retry();
      void live.flush();
    }),
  );

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (live.getSnapshot().pending === 0) return;
    void live.flush();
    if (!useShellDraws.getState().framed) event.preventDefault();
  };
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void live.flush();
  };
  const onPageHide = (): void => void live.flush();
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onHide);
  stops.push(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onHide);
  });

  stopSync = () => {
    for (const stop of stops.reverse()) stop();
  };
  return () => {
    stopSync?.();
    stopSync = null;
    store = null;
    void live.flush().finally(() => live.dispose());
  };
}
