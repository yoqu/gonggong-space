/**
 * The flash checks the page has made, kept by what the film draws and which scene, and the one running. Checks run
 * one at a time; asking again for a scene being checked waits for that check. A check in the background (nobody
 * waiting on it) gives way when the page needs its time: it is called off and asked again later.
 */

import { MAX_KEPT_CHECKS, SLOW_RETRY_FACTOR, isFinished, type FlashEntry, type FlashOutcome } from './verdict.ts';

export interface FlashTry {
  /** 1 for a first try; more for a try given more time. */
  slowdown: number;
  /** False once nobody wants the check any more. */
  wanted: () => boolean;
}

export type SceneInspector = (attempt: FlashTry) => Promise<FlashOutcome>;

interface Running {
  promise: Promise<FlashOutcome>;
  /** Callers waiting on this check (none: a background check). */
  waiting: number;
}

export interface FlashChecksOptions {
  /** Whether a background check may run now (the page is paused). */
  idle: () => boolean;
  max?: number;
}

export class FlashChecks {
  readonly #kept = new Map<string, FlashEntry>();
  readonly #running = new Map<string, Running>();
  readonly #idle: () => boolean;
  readonly #max: number;
  #queue: Promise<unknown> = Promise.resolve();
  /** Checks someone waits on that have not started yet: a background check gives way to them. */
  #asked = 0;

  constructor(options: FlashChecksOptions) {
    this.#idle = options.idle;
    this.#max = options.max ?? MAX_KEPT_CHECKS;
  }

  /** The check kept for `key`, if any (finished or not). */
  peek(key: string): FlashEntry | undefined {
    return this.#kept.get(key);
  }

  /** The scene's check: kept, the one running, or a new one (up to two tries). */
  check(key: string, inspect: SceneInspector, background = false): Promise<FlashOutcome> {
    const kept = this.#kept.get(key);
    if (kept !== undefined && isFinished(kept)) return Promise.resolve(kept.outcome);
    const running = this.#running.get(key);
    if (running !== undefined) {
      if (!background) running.waiting++;
      return running.promise;
    }
    const entry: Running = { promise: Promise.resolve<FlashOutcome>('torn'), waiting: background ? 0 : 1 };
    if (!background) this.#asked++;
    const wanted = (): boolean => entry.waiting > 0 || (this.#idle() && this.#asked === 0);
    entry.promise = this.#queue
      .then(async () => {
        if (!background) this.#asked--;
        let entryNow = this.#kept.get(key);
        let outcome: FlashOutcome = entryNow?.outcome ?? 'torn';
        while (!isFinished(entryNow) && wanted()) {
          const tries = entryNow?.tries ?? 0;
          outcome = await inspect({ slowdown: tries === 0 ? 1 : SLOW_RETRY_FACTOR, wanted }).catch((): FlashOutcome => 'torn');
          // Called off: nothing learned, so nothing kept.
          if (!wanted()) break;
          entryNow = { outcome, tries: tries + 1 };
          this.#keep(key, entryNow);
        }
        return outcome;
      })
      .finally(() => this.#running.delete(key));
    this.#running.set(key, entry);
    this.#queue = entry.promise.catch(() => undefined);
    return entry.promise;
  }

  /** Forgets every check (another film). */
  clear(): void {
    this.#kept.clear();
  }

  #keep(key: string, entry: FlashEntry): void {
    this.#kept.delete(key);
    this.#kept.set(key, entry);
    while (this.#kept.size > this.#max) {
      const oldest = this.#kept.keys().next().value;
      if (oldest === undefined) break;
      this.#kept.delete(oldest);
    }
  }
}
