import { playSeconds } from '@open-artifact/motion-core';
import { FrameRenderError, exportAbortError, isAborted } from './errors.ts';
import type { ExportFrame, ExportProgress, FramePlan, HeldFrames } from './types.ts';
import { STALLS_IN_VIEW, retryBackgroundFrame } from './visibility.ts';
import { words } from './words.ts';

/** A held frame that took longer than this, and much longer than good ones, counts toward giving up. */
export const HELD_FRAME_SLOW_MS = 250;
export const MAX_COUNTED_FRAME_WAIT_MS = 15_000;
/** Slow failures add up to this much waiting at most before the export stops. */
export const MAX_HELD_FRAME_WAIT_MS = 20_000;

/** How long good frames took and how long slow failures kept the export waiting. */
export interface FrameTiming {
  waitMs: number;
  goodMs: number;
  good: number;
}

export const newFrameTiming = (): FrameTiming => ({ waitMs: 0, goodMs: 0, good: 0 });

/**
 * The frame, or null for a held one (counted in `held`). Throws what cannot be held, and gives up once failing
 * frames have kept the export waiting too long.
 */
export async function awaitExportFrame(frame: Promise<ImageBitmap>, held: HeldFrames, timing: FrameTiming, started: { at: number }): Promise<ImageBitmap | null> {
  try {
    const bitmap = await frame;
    timing.goodMs += Math.min(performance.now() - started.at, MAX_COUNTED_FRAME_WAIT_MS);
    timing.good++;
    return bitmap;
  } catch (error) {
    if (!(error instanceof FrameRenderError) || !error.hold) throw error;
    held.count++;
    const first = (held.first ??= { t: error.t, message: error.message });
    held.last = error.t;
    const waited = performance.now() - started.at;
    if (waited > HELD_FRAME_SLOW_MS && (timing.good === 0 || waited > (3 * timing.goodMs) / timing.good))
      timing.waitMs += Math.min(waited, MAX_COUNTED_FRAME_WAIT_MS);
    if (timing.waitMs > MAX_HELD_FRAME_WAIT_MS) throw new FrameRenderError(words.slowFailures(held.count, error.t, first.message), error.t, false);
    return null;
  }
}

export interface RenderFramesOptions {
  plan: FramePlan;
  frame: ExportFrame;
  /** Frames are drawn this many times the plan's size (2 to supersample). */
  scale: number;
  signal?: AbortSignal;
  page?: Document;
  stalls?: number;
  onProgress?: (progress: ExportProgress) => void;
  /** Draws frame `index`; null when it was held. */
  draw(bitmap: ImageBitmap | null, index: number): void;
  /** Hands frame `index` on (to the encoder); the next frame is drawn meanwhile. */
  commit(index: number): void | Promise<void>;
}

const closeLater = (pending: Promise<ImageBitmap> | null): void => {
  pending?.then(
    (bitmap) => bitmap.close(),
    () => undefined,
  );
};

/** Draws every frame of the plan in order, asking for the next while the last is handed on. */
export async function renderExportFrames(options: RenderFramesOptions): Promise<HeldFrames> {
  const { plan, signal, onProgress } = options;
  const page = options.page ?? document;
  const controller = new AbortController();
  const held: HeldFrames = { count: 0, total: plan.frames };
  const started = { at: 0 };
  const frame = retryBackgroundFrame(
    (t: number, width: number, height: number) => {
      started.at = performance.now();
      return options.frame(playSeconds(t), width, height);
    },
    controller.signal,
    page,
    {
      stalls: options.stalls ?? STALLS_IN_VIEW,
      onAgain: (good) => {
        const again = (held.again ??= { good: 0, failed: 0 });
        if (good) again.good++;
        else again.failed++;
      },
    },
  );
  let rejectAbort: (reason: DOMException) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  aborted.catch(() => undefined);
  const abort = (): void => {
    controller.abort();
    rejectAbort(exportAbortError());
  };
  signal?.addEventListener('abort', abort, { once: true });
  const timing = newFrameTiming();
  const width = plan.width * options.scale;
  const height = plan.height * options.scale;
  let pending: Promise<ImageBitmap> | null = null;
  try {
    pending = frame(0, width, height);
    for (let index = 0; index < plan.frames; index++) {
      if (isAborted(signal)) throw exportAbortError();
      const current: Promise<ImageBitmap> = pending ?? frame(index / plan.fps, width, height);
      const bitmap = await Promise.race([awaitExportFrame(current, held, timing, started), aborted]);
      pending = null;
      if (isAborted(signal)) {
        bitmap?.close();
        throw exportAbortError();
      }
      pending = index + 1 < plan.frames ? frame((index + 1) / plan.fps, width, height) : null;
      pending?.catch(() => undefined);
      try {
        options.draw(bitmap, index);
      } finally {
        bitmap?.close();
      }
      await options.commit(index);
      if (isAborted(signal)) throw exportAbortError();
      onProgress?.({ done: index + 1, total: plan.frames, phase: 'frames' });
    }
    if (isAborted(signal)) throw exportAbortError();
    if (held.count === plan.frames) throw new FrameRenderError(words.noFrame(held.first?.message ?? ''), held.first?.t ?? playSeconds(0), false);
    return held;
  } catch (error) {
    closeLater(pending);
    throw error;
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}
