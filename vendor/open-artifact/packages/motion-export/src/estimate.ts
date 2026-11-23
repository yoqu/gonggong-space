import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';
import { FrameRenderError, FrameStallError, isAborted } from './errors.ts';
import { GIF_EXTRA_PROBE_FRACTIONS, GIF_PROBE_FRACTIONS } from './gif/estimator.ts';
import type { GifEstimator, GifMeasure } from './gif/estimator.ts';
import type { GifPlan, GifPreset } from './plan.ts';
import type { ExportDimensions, ExportFrame } from './types.ts';

/** Where in the film a video estimate times its frames. */
export const VIDEO_PROBE_FRACTIONS: readonly number[] = [0.1, 0.5, 0.85];
/** Milliseconds of rendering the sound takes per second of film. */
export const AUDIO_RENDER_MS_PER_SECOND = 250;

/** Resolves with the promise's value, or null once the signal aborts. */
async function unlessAborted<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T | null> {
  if (signal === undefined) return promise;
  let stop: () => void = () => undefined;
  const aborted = new Promise<null>((resolve) => {
    stop = () => resolve(null);
  });
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/**
 * Draws a frame at each moment and hands it to `use`; the average milliseconds a good frame took. Held frames are
 * skipped, unless every frame was held: then the first one's error is thrown.
 */
export async function probeFrames(
  frame: ExportFrame,
  times: readonly PlaySeconds[],
  size: ExportDimensions,
  signal: AbortSignal | undefined,
  use?: (bitmap: ImageBitmap, index: number) => void,
): Promise<number> {
  let good = 0;
  let totalMs = 0;
  let firstHeld: FrameRenderError | null = null;
  for (const [index, t] of times.entries()) {
    if (isAborted(signal)) break;
    const startedAt = performance.now();
    const pending = frame(t, size.width, size.height);
    const bitmap = await unlessAborted(
      signal,
      pending.catch((error: unknown) => {
        if (!(error instanceof FrameRenderError) || !error.hold) throw error;
        firstHeld ??= error;
        return null;
      }),
    );
    if (isAborted(signal)) {
      pending.then(
        (late) => late.close(),
        () => undefined,
      );
      break;
    }
    if (bitmap === null) continue;
    good++;
    totalMs += performance.now() - startedAt;
    try {
      use?.(bitmap, index);
    } finally {
      bitmap.close();
    }
  }
  if (good === 0 && firstHeld !== null) throw firstHeld;
  return totalMs / Math.max(1, good);
}

/** Seconds a video takes to make: its frames, the sound, and a second to finish. */
export function videoSeconds(frames: number, msPerFrame: number, duration: number, withAudio: boolean): number {
  return Math.round((frames * msPerFrame + (withAudio ? duration * AUDIO_RENDER_MS_PER_SECOND : 0) + 1000) / 1000);
}

/** Seconds a GIF takes to make: drawing and encoding each frame, and a second to finish. */
export function gifSeconds(frames: number, frameMs: number, encodeMs: number): number {
  return Math.round((frames * (frameMs + encodeMs)) / 1000 + 1);
}

/** Pairs of moments one GIF frame apart, at each fraction of the film. */
export function gifProbeTimes(fractions: readonly number[], duration: number, fps: number): PlaySeconds[] {
  return fractions.flatMap((fraction) => [playSeconds(duration * fraction), playSeconds(Math.min(duration, duration * fraction + 1 / fps))]);
}

/**
 * Probes the GIF's frames in pairs, and more of them while the film rests and the preset's extra time lasts; the
 * estimator's measure and the milliseconds a frame took to draw.
 */
export async function probeGif(
  frame: ExportFrame,
  plan: GifPlan,
  preset: Pick<GifPreset, 'estimateExtraMs'>,
  duration: number,
  estimator: GifEstimator,
  signal: AbortSignal | undefined,
): Promise<{ measure: GifMeasure; frameMs: number } | null> {
  const probe = (fractions: readonly number[]): Promise<number> =>
    probeFrames(frame, gifProbeTimes(fractions, duration, plan.fps), plan, signal, (bitmap, index) =>
      estimator.add(bitmap, fractions[index >> 1] ?? 0, index % 2 === 0 ? 0 : 1),
    );
  const frameMs = await probe(GIF_PROBE_FRACTIONS);
  if (estimator.rests()) {
    const startedAt = performance.now();
    for (const fraction of GIF_EXTRA_PROBE_FRACTIONS) {
      if (isAborted(signal) || performance.now() - startedAt >= preset.estimateExtraMs) break;
      try {
        await probe([fraction]);
      } catch (error) {
        if (error instanceof FrameStallError) break;
        if (!(error instanceof FrameRenderError && error.hold)) throw error;
      }
    }
  }
  if (isAborted(signal)) return null;
  const measure = await estimator.measure(signal);
  return measure === null ? null : { measure, frameMs };
}
