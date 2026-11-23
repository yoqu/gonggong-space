/**
 * The document store the live sync engine talks to, and the clock it runs on.
 *
 * {@link SyncTransport} is structural: the runtime's `db` capability
 * (`DbCapability`) satisfies it as-is, and tests pass an in-memory fake. The
 * engine never imports the runtime.
 */

/** One stored document. */
export interface SyncDocument {
  /** Even segment count: `elements/<id>`, `board/meta`. */
  path: string;
  data: Record<string, unknown>;
}

/**
 * A write's precondition: only while the document still has this hash
 * (`documentSha256` of what was read), or `null`: only while it is absent.
 * A failed one refuses the whole batch with `conflict`.
 */
export interface SyncWriteGuard {
  ifMatch?: string | null;
}

/** One write of a batch. */
export type SyncWrite =
  /** Replaces the document (creating it when absent). */
  | ({ op: 'set'; path: string; data: Record<string, unknown> } & SyncWriteGuard)
  /** Applies a JSON merge patch; an absent document starts empty. */
  | ({ op: 'update'; path: string; patch: Record<string, unknown> } & SyncWriteGuard)
  /** Removes the document (a no-op when absent). */
  | ({ op: 'delete'; path: string } & SyncWriteGuard);

/** Changes made by someone else. */
export interface SyncChangeEvent {
  /** Path → the document's new data, or `null` when it was deleted. */
  changes: Record<string, Record<string, unknown> | null>;
  /** Who made the change, when the host knows. */
  author?: string;
}

/**
 * A document store with change notifications. Writes are all or nothing and
 * are never echoed back through {@link SyncTransport.onChange}.
 */
export interface SyncTransport {
  /** Reads one document; `null` when absent. */
  get(path: string): Promise<Record<string, unknown> | null>;
  /** Every document of one collection. */
  list(collection: string): Promise<SyncDocument[]>;
  /** Applies a batch in order, all or nothing. */
  write(writes: SyncWrite[]): Promise<void>;
  /** Subscribes to changes made by anyone else; returns an unsubscribe function. */
  onChange(listener: (event: SyncChangeEvent) => void): () => void;
}

/**
 * Why a store call failed. Hosts reject with an error whose `code` is one of
 * these (the runtime's `ArtifactError` codes plus `resource_exhausted`);
 * anything else counts as `unavailable`.
 */
export type SyncErrorCode = 'conflict' | 'not_writer' | 'not_granted' | 'invalid' | 'not_found' | 'unavailable' | 'resource_exhausted';

const SYNC_ERROR_CODES: readonly SyncErrorCode[] = ['conflict', 'not_writer', 'not_granted', 'invalid', 'not_found', 'unavailable', 'resource_exhausted'];

/** The code of a store failure (`unavailable` for anything unrecognized). */
export function syncErrorCode(error: unknown): SyncErrorCode {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && (SYNC_ERROR_CODES as readonly string[]).includes(code) ? (code as SyncErrorCode) : 'unavailable';
}

/** The message of a store failure, for status text. */
export function syncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return typeof error === 'string' && error !== '' ? error : 'unknown error';
}

/** True for failures that mean the viewer may no longer write. */
export function isAccessError(code: SyncErrorCode): boolean {
  return code === 'not_writer' || code === 'not_granted';
}

/** An opaque timer handle. */
export type TimerHandle = unknown;

/** The clock and timers the engine uses; tests inject a fake. */
export interface SyncTimers {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** Epoch milliseconds. */
  now(): number;
  /** A number in [0, 1). */
  random(): number;
}

/** Real timers. */
export const SYSTEM_TIMERS: SyncTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  now: () => Date.now(),
  random: () => Math.random(),
};

/** The collection of a document path (`elements/a1` → `elements`). */
export function collectionOfPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}
