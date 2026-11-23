import { EXPORT_SETTINGS } from '@open-artifact/motion-core';
import { FrameRenderError, FrameStallError, exportAbortError } from './errors.ts';
import { words } from './words.ts';

/** A frame that failed after this long on a page that was hidden meanwhile is asked for again. */
export const HIDDEN_FRAME_SLOW_MS = 15_000;
export const FRAME_RETRY_PAUSE_MS = 1000;

/** How many times a frame that stalls with the page in view is asked for again. */
export const STALLS_IN_VIEW = EXPORT_SETTINGS.stallsInView;

const pauseBeforeRetry = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, FRAME_RETRY_PAUSE_MS));

/** Resolves once the page is visible; rejects with an AbortError when the signal aborts first. */
export function waitForVisibleDocument(page: Document, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const check = (): void => {
      if (page.hidden && !signal.aborted) return;
      page.removeEventListener('visibilitychange', check);
      signal.removeEventListener('abort', check);
      if (signal.aborted) reject(exportAbortError());
      else resolve();
    };
    page.addEventListener('visibilitychange', check);
    signal.addEventListener('abort', check);
    check();
  });
}

/**
 * Calls `onTimeout` when `promise` has not settled after `timeoutMs` of the page being visible: a hidden page's
 * encoder may be throttled, which is no reason to give up on it.
 */
export function withVisibleTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void, signal: AbortSignal | undefined, page: Document = document): Promise<T> {
  if (timeoutMs <= 0 || signal?.aborted === true) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restart = (): void => {
    clearTimeout(timer);
    if (!page.hidden) timer = setTimeout(onTimeout, timeoutMs);
  };
  const cleanup = (): void => {
    clearTimeout(timer);
    page.removeEventListener('visibilitychange', restart);
    signal?.removeEventListener('abort', cleanup);
  };
  page.addEventListener('visibilitychange', restart);
  signal?.addEventListener('abort', cleanup);
  restart();
  promise.then(cleanup, cleanup);
  return promise;
}

/** Whether the page was hidden at any moment since the watch began. */
export interface HiddenWatch {
  seen(): boolean;
  stop(): void;
}

export function watchDocumentHidden(page: Document = document): HiddenWatch {
  let hidden = page.hidden;
  const check = (): void => {
    hidden = true;
  };
  page.addEventListener('visibilitychange', check);
  return { seen: () => hidden, stop: () => page.removeEventListener('visibilitychange', check) };
}

/** How one encoder try went. */
export type EncodeTryOutcome = { kind: 'made' } | { kind: 'reordered' } | { kind: 'cancelled' } | { kind: 'threw'; error: unknown };

export type EncodeTryListener = (outcome: EncodeTryOutcome, hidden: boolean) => void;

/** Runs one encoder try, watching whether the page was hidden meanwhile, and tells `onTry` how it went. */
export async function trackEncodeTry<Result>(
  onTry: EncodeTryListener | undefined,
  signal: AbortSignal | undefined,
  encode: (hidden: HiddenWatch, reordered: () => void) => Promise<Result>,
  page: Document = document,
): Promise<Result> {
  const hidden = watchDocumentHidden(page);
  let outcome: EncodeTryOutcome = { kind: 'made' };
  try {
    return await encode(hidden, () => {
      outcome = { kind: 'reordered' };
    });
  } catch (error) {
    outcome = signal?.aborted === true ? { kind: 'cancelled' } : { kind: 'threw', error };
    throw error;
  } finally {
    hidden.stop();
    try {
      onTry?.(outcome, hidden.seen());
    } catch {
      // A listener's failure is not the export's.
    }
  }
}

export interface RetryOptions {
  /** How many times a frame that stalls with the page in view is asked for again. */
  stalls: number;
  pause?: () => Promise<void>;
  /** Told, for a frame that failed and was asked for again, whether it then came. */
  onAgain?: (good: boolean) => void;
}

/**
 * Asks again for a frame that stalled, or that failed (held) slowly or while the page was hidden: a background tab's
 * timers and decoders are throttled, so such a failure says nothing about the film. A stall with the page in view is
 * asked for again `stalls` times, after a pause; with the page hidden, once it is visible.
 */
export function retryBackgroundFrame<Arguments extends unknown[], Result>(
  render: (...args: Arguments) => Promise<Result>,
  signal: AbortSignal,
  page: Document,
  options: RetryOptions,
): (...args: Arguments) => Promise<Result> {
  let stallsLeft = options.stalls;
  const pause = options.pause ?? pauseBeforeRetry;
  return async (...args: Arguments): Promise<Result> => {
    let askedAgain = false;
    for (;;) {
      let hidden = page.hidden;
      let changed = false;
      const note = (): void => {
        changed = true;
        hidden ||= page.hidden;
      };
      page.addEventListener('visibilitychange', note);
      const startedAt = Date.now();
      try {
        const result = await render(...args);
        if (askedAgain) options.onAgain?.(true);
        return result;
      } catch (error) {
        hidden ||= page.hidden;
        const slow = (hidden || changed) && Date.now() - startedAt > HIDDEN_FRAME_SLOW_MS;
        const held = error instanceof FrameRenderError && error.hold;
        const worth = error instanceof FrameStallError || (held && (slow || (hidden && !page.hidden)));
        const inViewSpent = !hidden && (!(stallsLeft > 0) || (error instanceof Error && error.message === words.filmNotLoaded));
        if (!worth || signal.aborted || inViewSpent) {
          if (askedAgain && held) options.onAgain?.(false);
          throw error;
        }
        askedAgain ||= error instanceof FrameRenderError;
      } finally {
        page.removeEventListener('visibilitychange', note);
      }
      if (!hidden) {
        stallsLeft--;
        await pause();
      }
      await waitForVisibleDocument(page, signal);
    }
  };
}
