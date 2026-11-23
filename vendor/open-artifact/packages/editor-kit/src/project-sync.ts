/**
 * Loading, autosave and changes made elsewhere, the shared part. An editor
 * keeps its project as an index file plus item files under `project/`; this
 * module owns the mechanics around them:
 *
 * - Load: the listing, the named files and every item file ({@link readProject}).
 * - Save: a debounced save after each local change, one at a time (a change
 *   during a save saves again after it), one publish batch with `ifMatch` on
 *   every file. A conflict reads the files that lost the race and lets the
 *   editor merge, then retries (a bounded number of times). Offline: backoff.
 * - Remote changes: pushed by the host, read and handed to the editor. A file
 *   held by a text edit waits until the edit ends.
 *
 * What a batch holds, what a save marks saved and how a change is merged
 * are the editor's ({@link ProjectSyncOptions}).
 */

import { isArtifactError, type ArtifactCapability, type ConflictPath, type PublishBatch } from '@open-artifact/runtime';

/** The save states the engine sets (an editor's badge may know more). */
export type ProjectSaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'readonly';

/** How the editor takes one changed file (see {@link ProjectSyncOptions.remote}). */
export interface RemoteFile {
  /** The hash this tab holds; a change to the same hash is skipped (unless forced). `undefined`: never skipped. */
  hash: string | null | undefined;
  /** A text edit holds the file: the change waits until it ends (unless forced). */
  held?: boolean;
  /** Takes their version (`text` null: deleted or unreadable). */
  apply(text: string | null, hash: string | null): void;
}

/** What {@link createProjectSync} drives. `Sent` is what one batch sent; `Run` is one pass of remote changes. */
export interface ProjectSyncOptions<Sent, Run> {
  /** The artifact capability (read when used, so it may come from a session set up later). */
  artifact(): Pick<ArtifactCapability, 'readText' | 'publish' | 'onChange'>;
  /** Delay between the last change and the save, ms. */
  saveDelay: number;
  /** Conflict retries per save (default 4). */
  maxRetries?: number;

  readOnly(): boolean;
  /** True when something has not reached the server. */
  isDirty(): boolean;
  save(): string;
  setSave(save: ProjectSaveState): void;

  /** Builds the next batch. */
  collect(): { batch: PublishBatch; sent: Sent };
  /** The batch went through; `hashes` as the host returned them (artifact paths). */
  acknowledge(sent: Sent, hashes: Record<string, string | null>): void;
  /** The batch was empty (nothing to publish). */
  unsent?(sent: Sent): void;
  /** Everything is saved (after the badge says so). */
  saved?(): void;
  /** The host refused the write (`not_writer`): go read-only and tell the person. */
  lostWriteAccess(): void;

  /** Remote changes, one pass at a time: `begin`, `file` per changed path (`undefined`: ignored), `end`. */
  remote: {
    begin(): Run;
    file(path: string, hash: string | null, run: Run): RemoteFile | undefined;
    end(run: Run): void;
  };

  /** Calls `changed` after each local change (the store's revision moved). */
  watchChanges(changed: () => void): void;
  /** Calls `ended` when a text edit ends. */
  watchTextEdit(ended: () => void): void;
  /** Before a flush on unload with unsaved work. */
  beforeUnload?(): void;

  /** Timers (tests inject fakes). */
  timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** Where `beforeunload` is listened to (default `window`; none in node). */
  window?: Pick<Window, 'addEventListener'> | null;
}

/** A running sync (see {@link createProjectSync}). */
export interface ProjectSync {
  /** Listens to remote changes, local changes, text edits and unload. Call once, after loading. */
  start(): void;
  /** Schedules a save (default: the save delay). */
  schedule(delay?: number): void;
  /** Saves now (coalescing with a save already running). */
  flush(): Promise<void>;
  /** Retries a failed save now, resetting the backoff. */
  retryNow(): void;
  /** Applies changes made elsewhere (path → new hash, `null`: deleted). `force` re-reads even known hashes and ignores text edits. */
  applyRemote(changes: Record<string, string | null>, options?: { force?: boolean }): Promise<void>;
}

/** First offline retry delay, ms (doubles up to {@link OFFLINE_MAX_MS}). */
export const OFFLINE_FIRST_MS = 2_000;
/** Longest offline retry delay, ms. */
export const OFFLINE_MAX_MS = 30_000;

/** Creates the save and remote-change engine of one project. */
export function createProjectSync<Sent, Run>(options: ProjectSyncOptions<Sent, Run>): ProjectSync {
  const maxRetries = options.maxRetries ?? 4;
  const timers = options.timers ?? { set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let timer: unknown = null;
  let running = false;
  let again = false;
  let offlineDelay = OFFLINE_FIRST_MS;
  /** Paths whose remote change waits for a text edit to end. */
  const deferred = new Map<string, string | null>();

  function schedule(delay = options.saveDelay): void {
    if (options.readOnly()) return;
    if (options.isDirty()) options.setSave(options.save() === 'offline' ? 'offline' : 'dirty');
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function flush(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const { batch, sent } = options.collect();
        if (Object.keys(batch).length === 0) {
          options.unsent?.(sent);
          break;
        }
        options.setSave('saving');
        try {
          const result = await options.artifact().publish(batch);
          options.acknowledge(sent, result.hashes);
          offlineDelay = OFFLINE_FIRST_MS;
          break;
        } catch (error) {
          if (isArtifactError(error, 'conflict') && attempt < maxRetries) {
            await resolveConflicts(error.paths ?? []);
            continue;
          }
          if (isArtifactError(error, 'not_writer')) {
            options.lostWriteAccess();
            return;
          }
          // Offline or host error: keep the edits and retry with backoff.
          options.setSave('offline');
          offlineDelay = Math.min(offlineDelay * 2, OFFLINE_MAX_MS);
          schedule(offlineDelay);
          return;
        }
      }
    } finally {
      running = false;
    }
    const dirty = options.isDirty();
    if (again || dirty) {
      again = false;
      schedule(dirty ? options.saveDelay : 0);
    } else {
      options.setSave('saved');
      options.saved?.();
    }
  }

  /** Reads the files that lost a race and merges ours on top. */
  async function resolveConflicts(paths: readonly ConflictPath[]): Promise<void> {
    const changes: Record<string, string | null> = {};
    for (const conflict of paths) changes[conflict.path] = conflict.actual;
    await applyRemote(changes, { force: true });
  }

  async function applyRemote(changes: Record<string, string | null>, { force = false }: { force?: boolean } = {}): Promise<void> {
    const artifact = options.artifact();
    const run = options.remote.begin();
    for (const [path, hash] of Object.entries(changes)) {
      const file = options.remote.file(path, hash, run);
      if (!file) continue;
      if (!force && hash === file.hash) continue;
      if (!force && file.held) {
        deferred.set(path, hash);
        continue;
      }
      const text = hash === null ? null : await artifact.readText(path).catch(() => null);
      file.apply(text, hash);
    }
    options.remote.end(run);
  }

  function start(): void {
    options.artifact().onChange((event) => void applyRemote(event.changes));
    options.watchChanges(() => schedule());
    // Merge deferred remote changes once a text edit ends.
    options.watchTextEdit(() => {
      if (!deferred.size) return;
      const changes = Object.fromEntries(deferred);
      deferred.clear();
      void applyRemote(changes);
    });
    const target = options.window === undefined ? globalThis.window : options.window;
    target?.addEventListener('beforeunload', (event) => {
      if (options.isDirty()) {
        options.beforeUnload?.();
        void flush();
        event.preventDefault();
      }
    });
  }

  return {
    start,
    schedule,
    flush,
    retryNow() {
      offlineDelay = OFFLINE_FIRST_MS;
      schedule(0);
    },
    applyRemote,
  };
}

/** What {@link readProject} read. */
export interface ProjectFiles {
  title: string;
  /** Each named file, `null` when absent. */
  files: Record<string, { text: string; hash: string } | null>;
  /** Each item file by its key. */
  items: Record<string, { text: string; hash: string }>;
}

/**
 * Reads the title, the listing, the named `files` and every item file (a path
 * `item` maps to a key; `undefined`: not an item), all at once. Rejects when
 * any read fails.
 */
export async function readProject(
  artifact: Pick<ArtifactCapability, 'title' | 'list' | 'readText'>,
  spec: { files: readonly string[]; item(path: string): string | null | undefined },
): Promise<ProjectFiles> {
  const [title, listing] = await Promise.all([artifact.title(), artifact.list()]);
  const items: ProjectFiles['items'] = {};
  const reads = Object.entries(listing).flatMap(([path, entry]) => {
    const key = spec.item(path);
    if (key === undefined || key === null) return [];
    return [
      (async () => {
        items[key] = { text: await artifact.readText(path), hash: entry.sha256 };
      })(),
    ];
  });
  const named = spec.files.map(async (path) => {
    const entry = listing[path];
    return [path, entry ? { text: await artifact.readText(path), hash: entry.sha256 } : null] as const;
  });
  const [read] = await Promise.all([Promise.all(named), ...reads]);
  return { title, files: Object.fromEntries(read), items };
}
