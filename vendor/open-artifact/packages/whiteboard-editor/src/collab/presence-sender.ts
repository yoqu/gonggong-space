/**
 * The presence sender: every key this page publishes goes through one
 * sender, which keeps at most one `room.presence` call in flight, merges
 * patches made meanwhile (the last value of a key wins) and leaves a short
 * gap between calls, so cursors stay smooth without flooding the host.
 *
 * Pure apart from the injected publish function and timers (unit-tested).
 */

/** A presence patch: keys to set, `null` to remove. */
export type PresencePatch = Record<string, unknown>;

/** Timers the sender uses (injectable for tests). */
export interface SenderTimers {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The sender. */
export interface PresenceSender {
  /** Queues a patch (merged with whatever is waiting). */
  send(patch: PresencePatch): void;
  /** Sends what is waiting now, without the gap. */
  flush(): void;
  /** Stops sending; waiting patches are dropped. */
  dispose(): void;
}

/** Least time between two presence calls (ms): about 25 cursor updates a second. */
export const PRESENCE_MIN_GAP_MS = 40;

const SYSTEM_TIMERS: SenderTimers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** Creates a sender over a publish function (normally `room.presence`). */
export function createPresenceSender(publish: (patch: PresencePatch) => Promise<void>, options: { minGapMs?: number; timers?: SenderTimers } = {}): PresenceSender {
  const timers = options.timers ?? SYSTEM_TIMERS;
  const minGap = options.minGapMs ?? PRESENCE_MIN_GAP_MS;
  let waiting: PresencePatch | null = null;
  let inFlight = false;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: unknown;
  let disposed = false;

  const pump = (force = false): void => {
    if (disposed || inFlight || waiting === null) return;
    const wait = force ? 0 : lastSentAt + minGap - timers.now();
    if (wait > 0) {
      if (timer === undefined) {
        timer = timers.setTimeout(() => {
          timer = undefined;
          pump();
        }, wait);
      }
      return;
    }
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
    const patch = waiting;
    waiting = null;
    inFlight = true;
    lastSentAt = timers.now();
    publish(patch)
      .catch(() => {
        // Presence is best effort: a lost update is replaced by the next one.
      })
      .finally(() => {
        inFlight = false;
        pump();
      });
  };

  return {
    send(patch) {
      if (disposed) return;
      waiting = { ...(waiting ?? {}), ...patch };
      pump();
    },
    flush() {
      pump(true);
    },
    dispose() {
      disposed = true;
      waiting = null;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
    },
  };
}
