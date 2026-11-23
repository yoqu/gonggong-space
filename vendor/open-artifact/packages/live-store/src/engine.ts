/**
 * The live sync engine: keeps a value in step with a document store (a
 * board: one document per element plus a few board records; a dashboard:
 * its datasets, page files and settings).
 *
 * Model, per document path:
 * - `server`: the last value the store reported (by listing, a change event,
 *   or our own acknowledged write);
 * - `acked`: our writes acknowledged in the last few seconds, re-applied over
 *   `server` so a late event about an older write does not flash old data;
 * - `inflight`: the change being written;
 * - `pending`: the change waiting to be written (debounced, merged).
 *
 * What the viewer sees is `server ⊕ acked ⊕ inflight ⊕ pending`. Changes are
 * JSON merge patches computed against the document as it was before them, so
 * two people editing different fields of one element both win; the same
 * field: the last write wins.
 *
 * Local edits are applied at once ({@link LiveStore.commit}), split into
 * documents on the next tick, and written after {@link LIVE_EDIT_DEBOUNCE_MS}
 * of quiet (at most {@link LIVE_EDIT_MAX_WAIT_MS} after the first edit). Failed
 * writes are retried with backoff; a document the store refuses (too large,
 * invalid) is parked and the rest keep syncing. Losing write access stops
 * syncing and keeps the edits on screen.
 *
 * Saved copy: with a {@link LiveCache}, the engine keeps the documents the
 * store confirmed on the device. When the store does not answer within
 * {@link LIVE_SNAPSHOT_TIMEOUT_MS}, or loading fails for a reason other than
 * access, the saved copy is shown (`cached`): people can keep editing, and
 * their edits wait until the store answers, then sync over what it holds.
 *
 * The engine is framework-agnostic: {@link LiveStore.getSnapshot} and
 * {@link LiveStore.subscribe} fit React's `useSyncExternalStore` or a Zustand
 * store.
 */

import {
  applyJsonMergePatch,
  canonicalValuesEqual,
  countMergePatchTombstones,
  createJsonMergePatch,
  escapedJsonByteLength,
  isPlainRecord,
  removeNullMergePatchFields,
} from './json.ts';
import {
  SYSTEM_TIMERS,
  collectionOfPath,
  isAccessError,
  syncErrorCode,
  syncErrorMessage,
  type SyncChangeEvent,
  type SyncDocument,
  type SyncErrorCode,
  type SyncTimers,
  type SyncTransport,
  type SyncWrite,
  type TimerHandle,
} from './transport.ts';

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

/** Quiet time after the last edit of a document before it is written. */
export const LIVE_EDIT_DEBOUNCE_MS = 350;
/** Longest a document waits after its first unsent edit. */
export const LIVE_EDIT_MAX_WAIT_MS = 1500;
/** After this long loading, the saved copy shows (when there is one), else the status says it is still loading. */
export const LIVE_SNAPSHOT_TIMEOUT_MS = 10_000;
/** After this long loading, the load counts as failed and is retried. */
export const LIVE_EXTENDED_LOAD_TIMEOUT_MS = 35_000;
/** Delays between load retries; the last one repeats. */
export const LIVE_RECONNECT_BACKOFF_MS: readonly number[] = [2000, 4000, 8000, 15_000, 30_000, 60_000];
/** How long an acknowledged write is re-applied over store events. */
export const ACKNOWLEDGED_WRITE_GRACE_MS = 5000;
/** A write that has not settled after this long is retried. */
export const STUCK_WRITE_TIMEOUT_MS = 60_000;
/** A patch deleting more fields than this is sent as a whole document instead. */
export const MAX_MERGE_PATCH_TOMBSTONES = 64;
/** The first retry after a failed write waits a random time in this range. */
export const INITIAL_WRITE_RETRY_JITTER_MS: readonly [number, number] = [300, 800];
/** Later retries: `min(MAX, BASE · 2^(failures − 2))`. */
export const WRITE_RETRY_BASE_MS = 2000;
export const WRITE_RETRY_MAX_MS = 30_000;
/** Retries when the store says it is overloaded: `min(MAX, BASE · 2^(failures − 1))`. */
export const BACKPRESSURE_RETRY_BASE_MS = 1000;
export const BACKPRESSURE_RETRY_MAX_MS = 8000;
/** Overload lasting this long shows as an error. */
export const BACKPRESSURE_ERROR_AFTER_MS = 30_000;
/** Shortest timer the engine sets. */
export const MIN_SYNC_TIMER_DELAY_MS = 16;
/** Acknowledged writes kept per document, at most. */
export const MAX_UNCOALESCED_ACKNOWLEDGED_WRITES = 8;
/** Write calls in flight at once, at most. */
export const MAX_CONCURRENT_LIVE_WRITES = 25;
/** Documents per write call, at most (the store allows 500). */
export const MAX_WRITES_PER_BATCH = 100;
/** Approximate bytes per write call, at most (one larger document still goes alone). */
export const MAX_BATCH_BYTES = 1_048_576;
/** Quiet time before the saved copy is updated after the store's documents change. */
export const LIVE_CACHE_WRITE_DELAY_MS = 2000;

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** One document's data. */
export type DocumentValue = Record<string, unknown>;
/** Documents by path. */
export type DocumentMap = ReadonlyMap<string, DocumentValue>;

/**
 * How a value maps to documents. `C` is what composing learns that the next
 * split needs (the board's order slots of missing elements).
 */
export interface LiveCodec<T, C = unknown> {
  /** Collections the value lives in, in write order (elements before `board`). */
  readonly collections: readonly string[];
  /** The document that lists the order; written after its collection's documents. */
  readonly metaPath: string;
  /**
   * Documents may hold `null` values. A change that sets one is written
   * whole (`set`), since a merge patch's `null` removes the field.
   */
  readonly keepsNulls?: boolean;
  /** Splits a value into documents; `previous` lends identity and records the value does not carry. Returns a new map. */
  decompose(value: T, previous: DocumentMap | undefined, carry: C | undefined): Map<string, DocumentValue>;
  /** Builds the value from documents (the map is the engine's: copy what the value keeps). */
  compose(documents: DocumentMap): { value: T; carry?: C };
  /** Documents always written whole. */
  replaceOnly(path: string): boolean;
  /** Why a document may not be written (too large…), or `undefined`. */
  refuse(path: string, value: unknown, totalBytes: number): string | undefined;
  /** Keeps unchanged parts of `previous` in `next` (identity); returns `previous` when equal. */
  share?(previous: T, next: T): T;
}

/**
 * Whether the first snapshot has arrived: `loading`, `cached` (the store
 * has not answered; the saved copy is shown and loading goes on), `live`
 * or `failed`.
 */
export type LiveLoadState = 'loading' | 'cached' | 'live' | 'failed';

/**
 * The sync status: `loading`, `cached` (showing the saved copy while the
 * store is out of reach), `ready` (all synced), `dirty` (edits waiting),
 * `saving` (writes in flight), `offline` (the store is unreachable;
 * retrying), `error` (load failed, access lost or a document parked) or
 * `readonly`.
 */
export type LiveStatus = 'loading' | 'cached' | 'ready' | 'dirty' | 'saving' | 'offline' | 'error' | 'readonly';

/** The last failure. */
export interface LiveSyncError {
  code: SyncErrorCode | 'refused';
  message: string;
  path?: string;
}

/** A one-time message for a toast (a new `id` means a new notice). */
export interface LiveNotice {
  id: number;
  message: string;
}

/** Everything the UI reads. The object is replaced only when something changed. */
export interface LiveSnapshot<T> {
  readonly value: T;
  readonly loadState: LiveLoadState;
  readonly status: LiveStatus;
  /** Status text in English (the UI may localize from `status` and the counts). */
  readonly message: string;
  /** A second line for the status (what to do). */
  readonly hint?: string;
  /** Clicking the status may help ({@link LiveStore.retry}). */
  readonly retryable: boolean;
  readonly readOnly: boolean;
  /** Documents with unsent or in-flight changes. */
  readonly pending: number;
  /** Write calls in flight. */
  readonly flights: number;
  /** Why a document the codec refused cannot be stored (while it stays unsent). */
  readonly refusal?: string;
  readonly notice?: LiveNotice;
  readonly lastSyncedAt?: number;
  readonly lastError?: LiveSyncError;
}

/** What a change notification says. */
export interface LiveChange<T> {
  /** The value changed because of someone else's edit (or a reload). */
  readonly remote: boolean;
  /** The value changed (otherwise only the status did). */
  readonly valueChanged: boolean;
  /** The value before the change. */
  readonly previous: T;
}

/**
 * The saved copy on this device: the documents the store last confirmed.
 * Both calls are synchronous and may fail quietly (storage full or off).
 */
export interface LiveCache {
  /** The saved documents, or `undefined` when there is no saved copy. */
  read(): SyncDocument[] | undefined;
  /** Replaces the saved copy. */
  write(documents: SyncDocument[]): void;
}

/** Options of {@link createLiveStore}. */
export interface LiveStoreOptions<T, C = unknown> {
  transport: SyncTransport;
  /** Keeps a saved copy to show when the store is out of reach. */
  cache?: LiveCache;
  codec: LiveCodec<T, C>;
  /** The value shown until the first snapshot arrives. */
  initial: T;
  /** Viewers never write. */
  readOnly?: boolean;
  timers?: SyncTimers;
  /** Formats the "synced at" time of the ready message. */
  formatTime?: (epochMs: number) => string;
}

/** A live, synced value. */
export interface LiveStore<T> {
  /** The current snapshot (same object until something changes). */
  getSnapshot(): LiveSnapshot<T>;
  /** The current value. */
  value(): T;
  /** Listens to changes; returns an unsubscribe function. */
  subscribe(listener: (change: LiveChange<T>) => void): () => void;
  /** Applies a local edit; `false` when editing is not possible (loading, read-only, stopped). */
  commit(next: T): boolean;
  /** True when {@link LiveStore.commit} would be accepted. */
  canEdit(): boolean;
  /** Writes everything now; resolves when nothing more can be sent. */
  flush(): Promise<void>;
  /**
   * Resolves once the local changes of these documents are stored (or were
   * dropped because someone deleted the document); rejects with a
   * {@link LiveWriteError} when one is refused, writing stops (access lost,
   * read-only) or the store is disposed.
   */
  whenWritten(paths: readonly string[]): Promise<void>;
  /**
   * Writes a batch at once, outside the debounce (a write guarded by
   * `ifMatch`, say), after the local changes of its documents are stored.
   * On success the documents show the result; a failure is not retried and
   * rejects with the store's error.
   */
  writeNow(writes: readonly SyncWrite[]): Promise<void>;
  /** Retries a failed load, parked documents and backed-off writes now. */
  retry(): void;
  /** Switches viewer mode. */
  setReadOnly(readOnly: boolean): void;
  /** Bytes of every document, as the store counts them. */
  documentBytes(): number;
  /** Stops syncing (call {@link LiveStore.flush} first to send pending edits). */
  dispose(): void;
}

/** Why {@link LiveStore.whenWritten} rejected. */
export class LiveWriteError extends Error {
  readonly code: SyncErrorCode | 'refused' | 'readonly' | 'disposed';
  readonly path: string | undefined;

  constructor(code: LiveWriteError['code'], message: string, path?: string) {
    super(message);
    this.name = 'LiveWriteError';
    this.code = code;
    this.path = path;
  }
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

/** Status and notice texts (English defaults). */
export const LIVE_MESSAGES = {
  loading: 'Loading the latest content…',
  loadingSlow: 'Still loading the latest content…',
  loadFailed: 'The latest content failed to load. Click to retry.',
  cached: 'Showing your saved copy. Reconnecting…',
  cachedEdits: 'Showing your saved copy. Your changes will sync when you’re back online.',
  cachedReadOnly: 'Showing a saved copy. Reconnecting…',
  readOnly: 'Read-only. You’re seeing live changes.',
  accessEnded: 'Live sync ended for this view. Reload to continue.',
  parkedSuffix: 'Other changes keep syncing.',
  refusedHint: 'Shorten it to resume syncing this item.',
  retryHint: 'Click to retry.',
  unreachableNow: 'The store is unreachable. Retrying now. Your edits are kept on this screen.',
  unreachableLater: 'The store is unreachable. Retrying shortly; click to retry now. Your edits are kept on this screen.',
  busy: 'The store is busy. Your edits are kept on this screen and will sync when it recovers.',
  saving: 'Syncing…',
  syncedHint: 'Edits sync as you go; if two people change the same thing, the last change wins.',
  itemGone: 'An item you were editing was deleted by someone else.',
  cannotStore: (why: string): string => `This change can’t be stored (${why}).`,
  waiting: (count: number): string => (count === 1 ? '1 change waiting to sync.' : `${count} changes waiting to sync.`),
  syncedAt: (time: string): string => `All changes synced · ${time}.`,
  synced: 'Synced.',
} as const;

/* -------------------------------------------------------------------------- */
/* Internal model                                                             */
/* -------------------------------------------------------------------------- */

/** A change to one document. */
type Change = { kind: 'delete' } | { kind: 'patch'; patch: DocumentValue; replace: boolean };

const DELETE: Change = { kind: 'delete' };

interface Acked {
  change: Change;
  at: number;
}

interface Parked {
  message: string;
  /** Refused by the codec (shortening it helps) rather than by the store. */
  refused: boolean;
}

interface Entry {
  path: string;
  server: DocumentValue | undefined;
  /** The store reported this document deleted. */
  removedSeen: boolean;
  inflight: Change | undefined;
  pending: Change | undefined;
  acked: Acked[];
  firstAt: number;
  lastAt: number;
  failures: number;
  notBefore: number;
  seq: number;
  parked: Parked | undefined;
  /** Write this document alone (a batch containing it was rejected). */
  solo: boolean;
  goneNoticed: boolean;
}

interface WriteWaiter {
  paths: readonly string[];
  resolve: () => void;
  reject: (error: LiveWriteError) => void;
}

interface Flight {
  entries: Entry[];
  writes: SyncWrite[];
  settled: boolean;
  timer: TimerHandle | undefined;
}

/**
 * Applies a change to a document; a patch on a document someone deleted
 * stays deleted. With `keepsNulls` a whole document keeps its `null` values.
 */
function applyDocumentChange(doc: DocumentValue | undefined, change: Change, removed: boolean, keepsNulls = false): DocumentValue | undefined {
  if (change.kind === 'delete') return undefined;
  if (change.replace) return keepsNulls ? change.patch : removeNullMergePatchFields(change.patch);
  if (doc === undefined) return removed ? undefined : removeNullMergePatchFields(change.patch);
  return applyJsonMergePatch(doc, change.patch);
}

/** True when a merge patch would remove a field that `target` holds as `null`. */
function patchDropsNull(patch: Record<string, unknown>, target: Record<string, unknown>): boolean {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null && Object.hasOwn(target, key)) return true;
    const held = target[key];
    if (isPlainRecord(value) && isPlainRecord(held) && patchDropsNull(value, held)) return true;
  }
  return false;
}

/** The change that turns `base` into `target`. */
function documentChangeBetween(base: DocumentValue | undefined, target: DocumentValue | undefined, replace: boolean, keepsNulls = false): Change | undefined {
  if (target === undefined) return base === undefined ? undefined : DELETE;
  if (base === undefined || replace) return { kind: 'patch', patch: target, replace: true };
  const patch = createJsonMergePatch(base, target);
  if (patch === null) return undefined;
  if (keepsNulls && patchDropsNull(patch, target)) return { kind: 'patch', patch: target, replace: true };
  return { kind: 'patch', patch: patch as DocumentValue, replace: false };
}

/**
 * Drops the parts of a patch that recurse into an object field the store now
 * holds as a non-object: merging them would build a half object.
 */
export function dropShapeConflicts(patch: Record<string, unknown>, server: Record<string, unknown> | undefined): Record<string, unknown> {
  if (server === undefined) return patch;
  let result: Record<string, unknown> | undefined;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (!isPlainRecord(value)) continue;
    const current = server[key];
    let next: Record<string, unknown> | undefined;
    if (current !== undefined && !isPlainRecord(current)) next = undefined;
    else if (isPlainRecord(current)) next = dropShapeConflicts(value, current);
    else continue;
    if (next === value) continue;
    result ??= { ...patch };
    if (next === undefined) delete result[key];
    else result[key] = next;
  }
  return result ?? patch;
}

function defaultFormatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

/** Creates a live store; loading starts at once. */
export function createLiveStore<T, C = unknown>(options: LiveStoreOptions<T, C>): LiveStore<T> {
  const { transport, codec } = options;
  const keepsNulls = codec.keepsNulls === true;
  const applyChange = (doc: DocumentValue | undefined, change: Change, removed: boolean): DocumentValue | undefined =>
    applyDocumentChange(doc, change, removed, keepsNulls);
  const changeBetween = (base: DocumentValue | undefined, target: DocumentValue | undefined, replace: boolean): Change | undefined =>
    documentChangeBetween(base, target, replace, keepsNulls);
  const timers = options.timers ?? SYSTEM_TIMERS;
  const formatTime = options.formatTime ?? defaultFormatTime;
  const collections = new Set(codec.collections);
  const collectionRank = new Map(codec.collections.map((name, index) => [name, index]));

  const entries = new Map<string, Entry>();
  const listeners = new Set<(change: LiveChange<T>) => void>();
  let local = new Map<string, DocumentValue>();
  const bytes = new Map<string, number>();
  let totalBytes = 0;
  let carry: C | undefined;

  let value = options.initial;
  let unmaterialized = false;
  let materializeTimer: TimerHandle | undefined;

  let loadState: LiveLoadState = 'loading';
  let loadAttempt = 0;
  let loadFailures = 0;
  let loadSlow = false;
  let loadTimer: TimerHandle | undefined;
  let slowTimer: TimerHandle | undefined;
  let retryLoadTimer: TimerHandle | undefined;
  let buffered: SyncChangeEvent[] | undefined = [];
  let cacheTimer: TimerHandle | undefined;

  let readOnly = options.readOnly === true;
  let stopped = false;
  let disposed = false;
  let seqCounter = 0;
  let flights = new Set<Flight>();
  let syncTimer: TimerHandle | undefined;
  let syncTimerAt = Infinity;
  let urgent = false;
  let backpressureSince: number | undefined;
  let lastSyncedAt: number | undefined;
  let lastError: LiveSyncError | undefined;
  let notice: LiveNotice | undefined;
  let noticeCounter = 0;
  let flushWaiters: (() => void)[] = [];
  let writeWaiters: WriteWaiter[] = [];
  /** Documents a {@link LiveStore.writeNow} batch is writing: the engine holds their changes meanwhile. */
  const guarded = new Map<string, number>();
  let directWrites = 0;
  let snapshot: LiveSnapshot<T> = buildSnapshot();

  /* ---------------------------------------------------------------- entries */

  function entryFor(path: string): Entry {
    let entry = entries.get(path);
    if (entry === undefined) {
      entry = {
        path,
        server: undefined,
        removedSeen: false,
        inflight: undefined,
        pending: undefined,
        acked: [],
        firstAt: 0,
        lastAt: 0,
        failures: 0,
        notBefore: 0,
        seq: 0,
        parked: undefined,
        solo: false,
        goneNoticed: false,
      };
      entries.set(path, entry);
    }
    return entry;
  }

  /** Forgets entries that hold nothing. */
  function sweep(entry: Entry): void {
    if (entry.server === undefined && !entry.removedSeen && entry.inflight === undefined && entry.pending === undefined && entry.acked.length === 0) {
      entries.delete(entry.path);
    }
  }

  /** The document before `pending` (or with it). */
  function viewOf(entry: Entry, withPending: boolean): DocumentValue | undefined {
    let doc = entry.server;
    for (const acked of entry.acked) doc = applyChange(doc, acked.change, entry.removedSeen);
    if (entry.inflight !== undefined) doc = applyChange(doc, entry.inflight, entry.removedSeen);
    if (withPending && entry.pending !== undefined) doc = applyChange(doc, entry.pending, entry.removedSeen);
    return doc;
  }

  function setBytes(path: string, doc: DocumentValue | undefined): void {
    totalBytes -= bytes.get(path) ?? 0;
    if (doc === undefined) bytes.delete(path);
    else {
      const size = escapedJsonByteLength(doc);
      bytes.set(path, size);
      totalBytes += size;
    }
  }

  function setPending(entry: Entry, change: Change | undefined, now: number): void {
    if (change === undefined) {
      entry.pending = undefined;
      entry.firstAt = 0;
      if (entry.parked?.refused === true) entry.parked = undefined;
      return;
    }
    if (entry.pending === undefined) {
      entry.firstAt = now;
      entry.seq = ++seqCounter;
    }
    entry.pending = change;
    entry.lastAt = now;
  }

  function showNotice(message: string): void {
    notice = { id: ++noticeCounter, message };
  }

  /** The doc was deleted by someone else while we had edits for it. */
  function itemGone(entry: Entry): void {
    entry.pending = undefined;
    entry.firstAt = 0;
    entry.parked = undefined;
    if (!entry.goneNoticed) {
      entry.goneNoticed = true;
      showNotice(LIVE_MESSAGES.itemGone);
    }
  }

  /* ------------------------------------------------------------ local edits */

  function canEdit(): boolean {
    return (loadState === 'live' || loadState === 'cached') && !readOnly && !stopped && !disposed;
  }

  function commit(next: T): boolean {
    if (!canEdit()) return false;
    if (next === value) return true;
    const previous = value;
    value = next;
    unmaterialized = true;
    if (materializeTimer === undefined) materializeTimer = timers.setTimeout(materialize, MIN_SYNC_TIMER_DELAY_MS);
    emit({ remote: false, valueChanged: true, previous });
    return true;
  }

  /** Splits the current value into documents and stages what changed. */
  function materialize(): void {
    if (materializeTimer !== undefined) {
      timers.clearTimeout(materializeTimer);
      materializeTimer = undefined;
    }
    if (!unmaterialized) return;
    unmaterialized = false;
    const now = timers.now();
    const next = codec.decompose(value, local, carry);
    const touched: string[] = [];
    for (const [path, doc] of next) {
      const previous = local.get(path);
      if (previous === doc) continue;
      if (previous !== undefined && canonicalValuesEqual(previous, doc)) {
        next.set(path, previous);
        continue;
      }
      stage(path, doc, now);
      touched.push(path);
    }
    for (const path of local.keys()) {
      if (next.has(path)) continue;
      stage(path, undefined, now);
      touched.push(path);
    }
    local = next;
    if (touched.length > 0) schedule();
    emitStatus();
  }

  /** Stages the local value of one document. */
  function stage(path: string, doc: DocumentValue | undefined, now: number): void {
    const entry = entryFor(path);
    const base = viewOf(entry, false);
    let change: Change | undefined;
    if (doc === undefined) change = base === undefined ? undefined : DELETE;
    else if (base === undefined || codec.replaceOnly(path)) change = canonicalValuesEqual(base, doc) ? undefined : { kind: 'patch', patch: doc, replace: true };
    else change = changeBetween(base, doc, false);
    setPending(entry, change, now);
    const previousBytes = bytes.get(path) ?? 0;
    setBytes(path, doc);
    if (doc === undefined || change === undefined) {
      if (entry.parked?.refused === true) entry.parked = undefined;
    } else {
      const size = bytes.get(path) ?? 0;
      const reason = codec.refuse(path, doc, size > previousBytes ? totalBytes : 0);
      if (reason !== undefined) {
        entry.parked = { message: reason, refused: true };
        lastError = { code: 'refused', message: reason, path };
      } else if (entry.parked !== undefined) {
        entry.parked = undefined;
        entry.failures = 0;
      }
    }
    sweep(entry);
  }

  /* ----------------------------------------------------------- remote edits */

  function onRemote(event: SyncChangeEvent): void {
    if (disposed) return;
    if (buffered !== undefined) {
      buffered.push(event);
      return;
    }
    applyRemote(event);
  }

  function applyRemote(event: SyncChangeEvent): void {
    materialize();
    const touched: string[] = [];
    for (const [path, data] of Object.entries(event.changes)) {
      if (!collections.has(collectionOfPath(path))) continue;
      const entry = entryFor(path);
      if (data === null) {
        entry.server = undefined;
        entry.removedSeen = true;
        const pending = entry.pending;
        if (pending !== undefined && pending.kind === 'patch' && !pending.replace && entry.inflight === undefined) itemGone(entry);
      } else {
        entry.server = data;
        entry.removedSeen = false;
        entry.goneNoticed = false;
        const pending = entry.pending;
        if (pending !== undefined && pending.kind === 'patch' && !pending.replace) {
          const patch = dropShapeConflicts(pending.patch, viewOf(entry, false));
          if (patch !== pending.patch) setPending(entry, Object.keys(patch).length === 0 ? undefined : { kind: 'patch', patch, replace: false }, entry.lastAt);
        }
      }
      touched.push(path);
    }
    if (touched.length > 0) refresh(touched, true);
  }

  /** Recomputes the local documents of some paths and recomposes the value. */
  function refresh(paths: readonly string[], remote: boolean): void {
    let changed = false;
    for (const path of paths) {
      const entry = entries.get(path);
      const doc = entry === undefined ? undefined : viewOf(entry, true);
      const previous = local.get(path);
      if (doc === undefined) {
        if (previous === undefined) continue;
        local.delete(path);
      } else {
        if (previous !== undefined && (previous === doc || canonicalValuesEqual(previous, doc))) continue;
        local.set(path, doc);
      }
      setBytes(path, doc);
      changed = true;
      if (entry !== undefined) sweep(entry);
    }
    if (!changed) {
      emitStatus();
      return;
    }
    recompose(remote);
  }

  function recompose(remote: boolean): void {
    const previous = value;
    const composed = codec.compose(local);
    carry = composed.carry;
    value = codec.share !== undefined ? codec.share(previous, composed.value) : composed.value;
    emit({ remote, valueChanged: value !== previous, previous });
  }

  /* ------------------------------------------------------------------ load */

  const unsubscribe = transport.onChange(onRemote);

  /** Whether a load is still waiting for the store (with or without the saved copy shown). */
  function awaitingStore(): boolean {
    return loadState === 'loading' || loadState === 'cached';
  }

  function load(): void {
    if (disposed) return;
    const attempt = ++loadAttempt;
    // The saved copy stays up (and editable) while loading again.
    if (loadState !== 'cached') loadState = 'loading';
    loadSlow = false;
    buffered = [];
    clearLoadTimers();
    slowTimer = timers.setTimeout(() => {
      if (attempt !== loadAttempt || !awaitingStore()) return;
      loadSlow = true;
      if (!showSavedCopy()) emitStatus();
    }, LIVE_SNAPSHOT_TIMEOUT_MS);
    loadTimer = timers.setTimeout(() => {
      if (attempt !== loadAttempt || !awaitingStore()) return;
      loadFailed(attempt, { code: 'unavailable', message: 'timed out' });
    }, LIVE_EXTENDED_LOAD_TIMEOUT_MS);
    emitStatus();
    Promise.all(codec.collections.map((collection) => transport.list(collection))).then(
      (lists) => {
        if (attempt !== loadAttempt || disposed) return;
        clearLoadTimers();
        const seen = new Set<string>();
        for (const list of lists) {
          for (const document of list) {
            if (!collections.has(collectionOfPath(document.path))) continue;
            const entry = entryFor(document.path);
            entry.server = document.data;
            entry.removedSeen = false;
            seen.add(document.path);
          }
        }
        for (const entry of entries.values()) {
          if (!seen.has(entry.path) && entry.server !== undefined) {
            entry.server = undefined;
            entry.removedSeen = true;
            // Edited on the saved copy, deleted in the store meanwhile: the edit goes.
            const pending = entry.pending;
            if (pending !== undefined && pending.kind === 'patch' && !pending.replace && entry.inflight === undefined) itemGone(entry);
          }
        }
        const events = buffered ?? [];
        buffered = undefined;
        loadState = 'live';
        loadFailures = 0;
        lastError = undefined;
        for (const event of events) {
          for (const [path, data] of Object.entries(event.changes)) {
            if (!collections.has(collectionOfPath(path))) continue;
            const entry = entryFor(path);
            entry.server = data ?? undefined;
            entry.removedSeen = data === null;
          }
        }
        local = new Map();
        bytes.clear();
        totalBytes = 0;
        for (const entry of entries.values()) {
          const doc = viewOf(entry, true);
          if (doc === undefined) continue;
          local.set(entry.path, doc);
          setBytes(entry.path, doc);
        }
        recompose(true);
        schedule();
        saveCopySoon();
      },
      (error: unknown) => {
        if (attempt !== loadAttempt || disposed) return;
        loadFailed(attempt, { code: syncErrorCode(error), message: syncErrorMessage(error) });
      },
    );
  }

  function loadFailed(attempt: number, error: LiveSyncError): void {
    if (attempt !== loadAttempt) return;
    loadAttempt += 1;
    clearLoadTimers();
    buffered = [];
    lastError = error;
    const code = error.code;
    const retrying = code !== 'refused' && !isAccessError(code);
    // Out of reach (not refused): show the saved copy, if there is one, while retrying.
    if (!retrying || !showSavedCopy()) loadState = 'failed';
    if (retrying) {
      const delay = LIVE_RECONNECT_BACKOFF_MS[Math.min(loadFailures, LIVE_RECONNECT_BACKOFF_MS.length - 1)] ?? 60_000;
      loadFailures += 1;
      retryLoadTimer = timers.setTimeout(() => {
        retryLoadTimer = undefined;
        if (loadState === 'failed' || loadState === 'cached') load();
      }, delay);
    }
    emitStatus();
  }

  /**
   * Shows the saved copy while the store is out of reach. `true` when it is
   * shown (now or already); `false` without one.
   */
  function showSavedCopy(): boolean {
    if (loadState === 'cached') return true;
    if (loadState === 'live' || disposed) return false;
    const saved = readSavedCopy();
    if (saved === undefined) return false;
    loadState = 'cached';
    for (const document of saved) {
      if (!collections.has(collectionOfPath(document.path))) continue;
      const entry = entryFor(document.path);
      entry.server = document.data;
      entry.removedSeen = false;
    }
    local = new Map();
    bytes.clear();
    totalBytes = 0;
    for (const entry of entries.values()) {
      const doc = viewOf(entry, true);
      if (doc === undefined) continue;
      local.set(entry.path, doc);
      setBytes(entry.path, doc);
    }
    recompose(true);
    return true;
  }

  function readSavedCopy(): SyncDocument[] | undefined {
    try {
      return options.cache?.read();
    } catch {
      return undefined;
    }
  }

  /** The store's documents with our acknowledged writes: what the saved copy holds. */
  function confirmedDocuments(): SyncDocument[] {
    const documents: SyncDocument[] = [];
    for (const entry of entries.values()) {
      let doc = entry.server;
      for (const acked of entry.acked) doc = applyChange(doc, acked.change, entry.removedSeen);
      if (doc !== undefined) documents.push({ path: entry.path, data: doc as Record<string, unknown> });
    }
    return documents;
  }

  /** Updates the saved copy after {@link LIVE_CACHE_WRITE_DELAY_MS} (live only). */
  function saveCopySoon(): void {
    if (options.cache === undefined || loadState !== 'live' || disposed || cacheTimer !== undefined) return;
    cacheTimer = timers.setTimeout(() => {
      cacheTimer = undefined;
      saveCopyNow();
    }, LIVE_CACHE_WRITE_DELAY_MS);
  }

  function saveCopyNow(): void {
    if (options.cache === undefined || loadState !== 'live') return;
    try {
      options.cache.write(confirmedDocuments());
    } catch {
      // A full or disabled storage only loses the saved copy.
    }
  }

  function clearLoadTimers(): void {
    for (const handle of [loadTimer, slowTimer, retryLoadTimer]) if (handle !== undefined) timers.clearTimeout(handle);
    loadTimer = slowTimer = retryLoadTimer = undefined;
  }

  /* ---------------------------------------------------------------- writes */

  function sendable(entry: Entry): boolean {
    return entry.pending !== undefined && entry.inflight === undefined && entry.parked === undefined && !guarded.has(entry.path);
  }

  function dueAt(entry: Entry): number {
    const debounced = urgent ? 0 : Math.min(entry.lastAt + LIVE_EDIT_DEBOUNCE_MS, entry.firstAt + LIVE_EDIT_MAX_WAIT_MS);
    return Math.max(debounced, entry.notBefore);
  }

  function writing(): boolean {
    return loadState === 'live' && !readOnly && !stopped && !disposed;
  }

  /** Sets the one sync timer for the soonest due work. */
  function schedule(): void {
    if (disposed) return;
    let soonest = Infinity;
    if (writing()) for (const entry of entries.values()) if (sendable(entry)) soonest = Math.min(soonest, dueAt(entry));
    for (const entry of entries.values()) {
      const oldest = entry.acked[0];
      if (oldest !== undefined) soonest = Math.min(soonest, oldest.at + ACKNOWLEDGED_WRITE_GRACE_MS);
    }
    if (soonest === Infinity) {
      if (syncTimer !== undefined) timers.clearTimeout(syncTimer);
      syncTimer = undefined;
      syncTimerAt = Infinity;
      return;
    }
    const now = timers.now();
    const at = Math.max(soonest, now + (urgent ? 0 : MIN_SYNC_TIMER_DELAY_MS));
    if (syncTimer !== undefined && syncTimerAt <= at) return;
    if (syncTimer !== undefined) timers.clearTimeout(syncTimer);
    syncTimerAt = at;
    syncTimer = timers.setTimeout(() => {
      syncTimer = undefined;
      syncTimerAt = Infinity;
      pump();
    }, at - now);
  }

  /** Drops acknowledged writes past their grace period. */
  function pruneAcked(now: number): void {
    const touched: string[] = [];
    for (const entry of entries.values()) {
      const before = entry.acked.length;
      if (before === 0) continue;
      entry.acked = entry.acked.filter((acked) => now - acked.at < ACKNOWLEDGED_WRITE_GRACE_MS).slice(-MAX_UNCOALESCED_ACKNOWLEDGED_WRITES);
      if (entry.acked.length !== before) touched.push(entry.path);
    }
    if (touched.length > 0) refresh(touched, true);
  }

  /** Sends what is due. */
  function pump(): void {
    if (disposed) return;
    materialize();
    const now = timers.now();
    pruneAcked(now);
    if (writing()) {
      const ready = [...entries.values()].filter((entry) => sendable(entry) && dueAt(entry) <= now);
      ready.sort(compareEntries);
      while (ready.length > 0 && flights.size < MAX_CONCURRENT_LIVE_WRITES) {
        const batch: Entry[] = [];
        let batchBytes = 0;
        while (ready.length > 0 && batch.length < MAX_WRITES_PER_BATCH) {
          const entry = ready[0]!;
          const size = bytes.get(entry.path) ?? 256;
          if (entry.solo && batch.length > 0) break;
          if (batch.length > 0 && batchBytes + size > MAX_BATCH_BYTES) break;
          ready.shift();
          batch.push(entry);
          batchBytes += size;
          if (entry.solo) break;
        }
        send(batch);
      }
    }
    schedule();
    emitStatus();
  }

  /** Write order: changes before deletes, collections in order (deletes reversed), meta last, then age. */
  function compareEntries(a: Entry, b: Entry): number {
    const rank = (entry: Entry): number => {
      const deleting = entry.pending?.kind === 'delete';
      const collection = collectionRank.get(collectionOfPath(entry.path)) ?? codec.collections.length;
      const ordered = deleting ? codec.collections.length - collection : collection;
      return (deleting ? 1000 : 0) + ordered + (entry.path === codec.metaPath ? 0.5 : 0);
    };
    return rank(a) - rank(b) || a.seq - b.seq;
  }

  function send(batch: Entry[]): void {
    const writes: SyncWrite[] = [];
    const sent: Entry[] = [];
    for (const entry of batch) {
      const change = entry.pending;
      if (change === undefined) continue;
      let write: SyncWrite;
      let inflight: Change = change;
      if (change.kind === 'delete') write = { op: 'delete', path: entry.path };
      else if (change.replace) write = { op: 'set', path: entry.path, data: keepsNulls ? change.patch : removeNullMergePatchFields(change.patch) };
      else {
        const base = viewOf(entry, false);
        if (base === undefined || (entry.server === undefined && entry.removedSeen)) {
          itemGone(entry);
          refresh([entry.path], true);
          continue;
        }
        if (countMergePatchTombstones(change.patch) > MAX_MERGE_PATCH_TOMBSTONES) {
          const data = applyJsonMergePatch(base, change.patch);
          write = { op: 'set', path: entry.path, data };
          inflight = { kind: 'patch', patch: data, replace: true };
        } else write = { op: 'update', path: entry.path, patch: change.patch };
      }
      entry.inflight = inflight;
      entry.pending = undefined;
      entry.firstAt = 0;
      writes.push(write);
      sent.push(entry);
    }
    if (writes.length === 0) return;
    const flight: Flight = { entries: sent, writes, settled: false, timer: undefined };
    flights.add(flight);
    flight.timer = timers.setTimeout(() => settle(flight, { code: 'unavailable', error: new Error('the write timed out') }), STUCK_WRITE_TIMEOUT_MS);
    let request: Promise<void>;
    try {
      request = transport.write(writes);
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      () => settle(flight, undefined),
      (error: unknown) => settle(flight, { code: syncErrorCode(error), error }),
    );
  }

  /** Puts an in-flight change back in front of the pending one. */
  function restorePending(entry: Entry, now: number): void {
    const inflight = entry.inflight;
    entry.inflight = undefined;
    if (inflight === undefined) return;
    if (entry.pending === undefined) {
      entry.pending = inflight;
      entry.firstAt = now;
      entry.lastAt = now;
      entry.seq = ++seqCounter;
      return;
    }
    const base = viewOf(entry, false);
    const target = applyChange(applyChange(base, inflight, entry.removedSeen), entry.pending, entry.removedSeen);
    const replace = (inflight.kind === 'patch' && inflight.replace) || (entry.pending.kind === 'patch' && entry.pending.replace) || inflight.kind === 'delete';
    entry.pending = changeBetween(base, target, replace);
    if (entry.pending === undefined) entry.firstAt = 0;
  }

  function settle(flight: Flight, failure: { code: SyncErrorCode; error: unknown } | undefined): void {
    if (flight.settled) return;
    flight.settled = true;
    if (flight.timer !== undefined) timers.clearTimeout(flight.timer);
    flights.delete(flight);
    if (disposed) return;
    const now = timers.now();
    if (failure === undefined) {
      backpressureSince = undefined;
      lastSyncedAt = now;
      if (lastError !== undefined && lastError.code !== 'refused') lastError = undefined;
      flight.writes.forEach((write, index) => {
        const entry = flight.entries[index]!;
        const change = entry.inflight;
        entry.inflight = undefined;
        entry.failures = 0;
        entry.solo = false;
        if (change === undefined) return;
        if (write.op === 'delete') {
          entry.server = undefined;
          entry.removedSeen = false;
        } else if (write.op === 'set') {
          entry.server = write.data;
          entry.removedSeen = false;
        } else if (entry.server === undefined && entry.removedSeen) {
          // Deleted while the update flew: the store may now hold a stub; remove it.
          itemGone(entry);
          setPending(entry, DELETE, now);
          entry.notBefore = 0;
        } else entry.server = applyJsonMergePatch(entry.server, write.patch);
        entry.acked.push({ change, at: now });
        if (entry.acked.length > MAX_UNCOALESCED_ACKNOWLEDGED_WRITES) entry.acked.shift();
      });
      refresh(
        flight.entries.map((entry) => entry.path),
        false,
      );
    } else handleFailure(flight, failure.code, failure.error, now);
    if (urgent && flushIdle()) urgent = false;
    pump();
    resolveFlushWaiters();
  }

  function handleFailure(flight: Flight, code: SyncErrorCode, error: unknown, now: number): void {
    const why = syncErrorMessage(error);
    lastError = { code, message: why, path: flight.entries.length === 1 ? flight.entries[0]!.path : undefined };
    if (isAccessError(code)) {
      for (const entry of flight.entries) restorePending(entry, now);
      stopped = true;
      return;
    }
    if (code === 'invalid' || code === 'not_found') {
      if (flight.entries.length > 1) {
        for (const entry of flight.entries) {
          restorePending(entry, now);
          entry.solo = true;
          entry.notBefore = 0;
          entry.firstAt = entry.lastAt = 0;
        }
        return;
      }
      const entry = flight.entries[0]!;
      const write = flight.writes[0]!;
      if (write.op === 'update' && (code === 'not_found' || (entry.server === undefined && entry.removedSeen))) {
        entry.inflight = undefined;
        itemGone(entry);
        refresh([entry.path], true);
        return;
      }
      restorePending(entry, now);
      entry.parked = { message: LIVE_MESSAGES.cannotStore(why), refused: false };
      return;
    }
    const busy = code === 'resource_exhausted';
    if (busy) backpressureSince ??= now;
    for (const entry of flight.entries) {
      restorePending(entry, now);
      entry.failures += 1;
      const failures = entry.failures;
      const delay = busy
        ? Math.min(BACKPRESSURE_RETRY_MAX_MS, BACKPRESSURE_RETRY_BASE_MS * 2 ** (failures - 1))
        : failures === 1
          ? INITIAL_WRITE_RETRY_JITTER_MS[0] + timers.random() * (INITIAL_WRITE_RETRY_JITTER_MS[1] - INITIAL_WRITE_RETRY_JITTER_MS[0])
          : Math.min(WRITE_RETRY_MAX_MS, WRITE_RETRY_BASE_MS * 2 ** Math.max(0, failures - 2));
      entry.notBefore = now + delay;
    }
  }

  /* ----------------------------------------------------------------- flush */

  function flushIdle(): boolean {
    if (flights.size > 0 || directWrites > 0) return false;
    if (!writing()) return true;
    const now = timers.now();
    for (const entry of entries.values()) if (sendable(entry) && entry.failures === 0 && entry.notBefore <= now) return false;
    return !unmaterialized;
  }

  function resolveFlushWaiters(): void {
    if (flushWaiters.length === 0 || !flushIdle()) return;
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function flush(): Promise<void> {
    materialize();
    if (flushIdle()) return Promise.resolve();
    urgent = true;
    for (const entry of entries.values()) if (sendable(entry)) entry.notBefore = 0;
    const done = new Promise<void>((resolve) => flushWaiters.push(resolve));
    pump();
    resolveFlushWaiters();
    return done;
  }

  function retry(): void {
    if (disposed) return;
    if (loadState === 'failed' || loadState === 'cached') {
      loadFailures = 0;
      load();
      return;
    }
    for (const entry of entries.values()) {
      if (entry.parked !== undefined && !entry.parked.refused) entry.parked = undefined;
      entry.notBefore = 0;
    }
    pump();
  }

  /* ------------------------------------------------------ write promises */

  /** `true` when stored, a {@link LiveWriteError} when it never will be, `undefined` while waiting. */
  function writeOutcome(paths: readonly string[]): true | LiveWriteError | undefined {
    if (disposed) return new LiveWriteError('disposed', 'The live document was closed.');
    if (stopped) return new LiveWriteError(lastError?.code ?? 'not_writer', LIVE_MESSAGES.accessEnded);
    if (readOnly) return new LiveWriteError('readonly', LIVE_MESSAGES.readOnly);
    let waiting = false;
    for (const path of paths) {
      const entry = entries.get(path);
      if (entry === undefined || (entry.pending === undefined && entry.inflight === undefined)) continue;
      if (entry.parked !== undefined && entry.inflight === undefined) {
        return new LiveWriteError(entry.parked.refused ? 'refused' : (lastError?.code ?? 'invalid'), entry.parked.message, path);
      }
      waiting = true;
    }
    return waiting || unmaterialized ? undefined : true;
  }

  function settleWriteWaiters(): void {
    if (writeWaiters.length === 0) return;
    const waiting: WriteWaiter[] = [];
    for (const waiter of writeWaiters) {
      const outcome = writeOutcome(waiter.paths);
      if (outcome === undefined) waiting.push(waiter);
      else if (outcome === true) waiter.resolve();
      else waiter.reject(outcome);
    }
    writeWaiters = waiting;
  }

  function whenWritten(paths: readonly string[]): Promise<void> {
    materialize();
    const outcome = writeOutcome(paths);
    if (outcome === true) return Promise.resolve();
    if (outcome !== undefined) return Promise.reject(outcome);
    return new Promise<void>((resolve, reject) => writeWaiters.push({ paths: [...paths], resolve, reject }));
  }

  async function writeNow(writes: readonly SyncWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const paths = writes.map((write) => write.path);
    if (!canEdit()) {
      const outcome = writeOutcome(paths);
      throw outcome instanceof LiveWriteError ? outcome : new LiveWriteError('unavailable', LIVE_MESSAGES.loading);
    }
    for (const path of paths) {
      const entry = entries.get(path);
      if (entry !== undefined && sendable(entry)) entry.notBefore = 0;
    }
    urgent = true;
    pump();
    await whenWritten(paths);
    if (loadState !== 'live') throw new LiveWriteError('unavailable', LIVE_MESSAGES.unreachableLater);
    for (const path of paths) guarded.set(path, (guarded.get(path) ?? 0) + 1);
    directWrites += 1;
    emitStatus();
    let timer: TimerHandle | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = timers.setTimeout(() => reject(Object.assign(new Error('the write timed out'), { code: 'unavailable' })), STUCK_WRITE_TIMEOUT_MS);
        let request: Promise<void>;
        try {
          request = transport.write([...writes]);
        } catch (error) {
          request = Promise.reject(error);
        }
        request.then(resolve, reject);
      });
    } catch (error) {
      const code = syncErrorCode(error);
      if (!disposed) {
        lastError = { code, message: syncErrorMessage(error), ...(paths.length === 1 ? { path: paths[0] } : {}) };
        if (isAccessError(code)) stopped = true;
      }
      throw new LiveWriteError(code, syncErrorMessage(error), paths.length === 1 ? paths[0] : undefined);
    } finally {
      if (timer !== undefined) timers.clearTimeout(timer);
      directWrites -= 1;
      for (const path of paths) {
        const count = (guarded.get(path) ?? 1) - 1;
        if (count <= 0) guarded.delete(path);
        else guarded.set(path, count);
      }
      if (!disposed) {
        if (urgent && flushIdle()) urgent = false;
        pump();
        resolveFlushWaiters();
      }
    }
    if (disposed) return;
    const now = timers.now();
    materialize();
    lastSyncedAt = now;
    if (lastError !== undefined && lastError.code !== 'refused') lastError = undefined;
    for (const write of writes) {
      const entry = entryFor(write.path);
      let change: Change;
      if (write.op === 'delete') {
        entry.server = undefined;
        change = DELETE;
      } else if (write.op === 'set') {
        entry.server = write.data;
        change = { kind: 'patch', patch: write.data, replace: true };
      } else {
        entry.server = applyJsonMergePatch(entry.server, write.patch);
        change = { kind: 'patch', patch: write.patch, replace: false };
      }
      entry.removedSeen = false;
      entry.acked.push({ change, at: now });
      if (entry.acked.length > MAX_UNCOALESCED_ACKNOWLEDGED_WRITES) entry.acked.shift();
    }
    refresh(paths, false);
    schedule();
  }

  /* --------------------------------------------------------------- status */

  function pendingCount(): number {
    let count = 0;
    for (const entry of entries.values()) if (entry.pending !== undefined || entry.inflight !== undefined) count += 1;
    return count + (unmaterialized ? 1 : 0);
  }

  function buildSnapshot(): LiveSnapshot<T> {
    const pending = pendingCount();
    let refusal: string | undefined;
    for (const entry of entries.values()) if (entry.parked?.refused === true && entry.pending !== undefined) refusal ??= entry.parked.message;
    const base = {
      value,
      loadState,
      readOnly: readOnly || stopped,
      pending,
      flights: flights.size + directWrites,
      ...(refusal !== undefined ? { refusal } : {}),
      ...(notice !== undefined ? { notice } : {}),
      ...(lastSyncedAt !== undefined ? { lastSyncedAt } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    };
    if (loadState === 'loading') return { ...base, status: 'loading', message: loadSlow ? LIVE_MESSAGES.loadingSlow : LIVE_MESSAGES.loading, retryable: false };
    if (loadState === 'failed') return { ...base, status: 'error', message: LIVE_MESSAGES.loadFailed, retryable: lastError === undefined || !isAccessError(lastError.code as SyncErrorCode) };
    if (loadState === 'cached') {
      const message = readOnly || stopped ? LIVE_MESSAGES.cachedReadOnly : pending > 0 ? LIVE_MESSAGES.cachedEdits : LIVE_MESSAGES.cached;
      return { ...base, status: readOnly || stopped ? 'readonly' : 'cached', message, retryable: true };
    }
    if (stopped) return { ...base, status: 'error', message: LIVE_MESSAGES.accessEnded, retryable: false };
    if (readOnly) return { ...base, status: 'readonly', message: LIVE_MESSAGES.readOnly, retryable: false };
    let parked: Parked | undefined;
    let failing = false;
    for (const entry of entries.values()) {
      if (entry.parked !== undefined && entry.pending !== undefined) parked ??= entry.parked;
      if (entry.failures > 0 && (entry.pending !== undefined || entry.inflight !== undefined)) failing = true;
    }
    if (parked !== undefined) {
      return {
        ...base,
        status: 'error',
        message: `${parked.message} ${LIVE_MESSAGES.parkedSuffix}`,
        hint: parked.refused ? LIVE_MESSAGES.refusedHint : LIVE_MESSAGES.retryHint,
        retryable: !parked.refused,
      };
    }
    if (backpressureSince !== undefined && failing) {
      const long = timers.now() - backpressureSince >= BACKPRESSURE_ERROR_AFTER_MS;
      return { ...base, status: long ? 'error' : 'offline', message: LIVE_MESSAGES.busy, retryable: true };
    }
    if (failing) return { ...base, status: 'offline', message: base.flights > 0 ? LIVE_MESSAGES.unreachableNow : LIVE_MESSAGES.unreachableLater, retryable: true };
    if (base.flights > 0) return { ...base, status: 'saving', message: LIVE_MESSAGES.saving, retryable: false };
    if (pending > 0) return { ...base, status: 'dirty', message: LIVE_MESSAGES.waiting(pending), retryable: false };
    return {
      ...base,
      status: 'ready',
      message: lastSyncedAt !== undefined ? LIVE_MESSAGES.syncedAt(formatTime(lastSyncedAt)) : LIVE_MESSAGES.synced,
      hint: LIVE_MESSAGES.syncedHint,
      retryable: false,
    };
  }

  function sameSnapshot(a: LiveSnapshot<T>, b: LiveSnapshot<T>): boolean {
    return (
      a.value === b.value &&
      a.loadState === b.loadState &&
      a.status === b.status &&
      a.message === b.message &&
      a.hint === b.hint &&
      a.retryable === b.retryable &&
      a.readOnly === b.readOnly &&
      a.pending === b.pending &&
      a.flights === b.flights &&
      a.refusal === b.refusal &&
      a.notice === b.notice &&
      a.lastSyncedAt === b.lastSyncedAt &&
      a.lastError === b.lastError
    );
  }

  function emit(change: LiveChange<T>): void {
    saveCopySoon();
    settleWriteWaiters();
    const next = buildSnapshot();
    if (!change.valueChanged && sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener(change);
  }

  function emitStatus(): void {
    emit({ remote: false, valueChanged: false, previous: value });
  }

  /* ------------------------------------------------------------------ API */

  load();

  return {
    getSnapshot: () => snapshot,
    value: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    commit,
    canEdit,
    flush,
    whenWritten,
    writeNow,
    retry,
    setReadOnly(next) {
      if (readOnly === next) return;
      readOnly = next;
      if (!readOnly) schedule();
      emitStatus();
    },
    documentBytes: () => {
      materialize();
      return totalBytes;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      clearLoadTimers();
      if (cacheTimer !== undefined) {
        timers.clearTimeout(cacheTimer);
        cacheTimer = undefined;
        saveCopyNow();
      }
      for (const handle of [syncTimer, materializeTimer]) if (handle !== undefined) timers.clearTimeout(handle);
      for (const flight of flights) if (flight.timer !== undefined) timers.clearTimeout(flight.timer);
      flights = new Set();
      listeners.clear();
      const waiters = flushWaiters;
      flushWaiters = [];
      for (const resolve of waiters) resolve();
      settleWriteWaiters();
    },
  };
}
