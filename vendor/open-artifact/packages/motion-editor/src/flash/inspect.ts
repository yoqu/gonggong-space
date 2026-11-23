/**
 * One try at checking a scene for flashes: its frames (and a second of film each side) pulled from a stage at 30 fps,
 * small, read as pixels and fed to the flash analyzer in order, within a time budget. Takes everything it uses as
 * arguments, so it runs the same against fakes.
 */

import type { FlashFrameAnalyzer, FlashSampling, RgbaPixels } from '@open-artifact/wasm-motion';
import { RETRY_WAIT_MS, flashProgress } from './progress.ts';
import type { FlashOutcome } from './verdict.ts';

/** A frame as the stage drew it: an SVG picture `pw` × `ph` pixels. */
export interface PulledFrame {
  svg: string;
  pw: number;
  ph: number;
}

/** Reads a frame's pixels; `null` when the browser will not let them be read. */
export type Rasterize = (frame: PulledFrame) => Promise<{ pixels: RgbaPixels; width: number } | null>;

export interface SceneInspection {
  sampling: FlashSampling;
  /** Draws the film's moment `t` (seconds on the stage's clock). */
  pull: (t: number) => Promise<PulledFrame>;
  rasterize: Rasterize;
  analyzer: (range: { fromFrame: number; toFrame: number }) => FlashFrameAnalyzer;
  budgetMs: number;
  patienceMs: number;
  /** Frames asked for before the one being read came. */
  ahead: number;
  /** Waits stretch by this much (a second try is given more time). */
  slowdown: number;
  /** False once the check is no longer wanted. */
  wanted: () => boolean;
  now?: () => number;
}

class Stopped extends Error {}

export async function inspectScene(inspection: SceneInspection): Promise<FlashOutcome> {
  const { sampling, slowdown, patienceMs } = inspection;
  const now = inspection.now ?? (() => performance.now());
  const total = sampling.times.length;
  if (total === 0) return 'unseen';
  const analyzer = inspection.analyzer({ fromFrame: sampling.fromFrame, toFrame: sampling.toFrame });
  let late = false;
  let wake: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const stop = (): void => {
    late = true;
    wake();
  };
  let budget = setTimeout(stop, slowdown * inspection.budgetMs);
  let patience: ReturnType<typeof setTimeout> | undefined;
  const pulls = new Map<number, Promise<PulledFrame>>();
  const ask = (index: number): void => {
    const t = sampling.times[index];
    if (t === undefined || pulls.has(index)) return;
    const pull = inspection.pull(t);
    // A frame asked for and never read must not be an unhandled rejection.
    pull.catch(() => undefined);
    pulls.set(index, pull);
  };
  const awaitOrStop = async <T>(work: Promise<T>): Promise<T> => {
    const settled = await Promise.race([work.then((value) => ({ value })), stopped.then(() => null)]);
    if (settled === null || late) throw new Stopped();
    return settled.value;
  };
  const times: number[] = [];
  let first = 0;
  try {
    for (let index = 0; index < total; index++) {
      if (!inspection.wanted()) return 'torn';
      for (let next = index; next < Math.min(total, index + Math.max(1, inspection.ahead)); next++) ask(next);
      let frame: PulledFrame;
      try {
        frame = await awaitOrStop(pulls.get(index) ?? inspection.pull(sampling.times[index] ?? 0));
      } catch (error) {
        if (error instanceof Stopped) throw error;
        return 'torn';
      }
      pulls.delete(index);
      const read = await awaitOrStop(inspection.rasterize(frame).catch(() => null));
      if (read === null) return 'faulty';
      if (index === 0) {
        first = now();
        // The time to load the film is not the check's: the budget starts with the first frame.
        if (patienceMs > 0) {
          clearTimeout(budget);
          budget = setTimeout(stop, slowdown * inspection.budgetMs);
        }
      }
      analyzer.add(read.pixels, read.width);
      times.push((now() - first) / slowdown);
      const progress = flashProgress(times, total, inspection.budgetMs, patienceMs);
      if (progress === 'late') stop();
      else if (progress === 'behind') patience ??= setTimeout(stop, slowdown * (patienceMs + RETRY_WAIT_MS));
      else {
        clearTimeout(patience);
        patience = undefined;
      }
    }
    return analyzer.report().safeScale;
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    return times.length === 0 ? 'unseen' : 'late';
  } finally {
    clearTimeout(budget);
    clearTimeout(patience);
    analyzer.dispose();
  }
}
