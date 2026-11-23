import { buildGifPalette, createGifEncoder } from '@open-artifact/wasm-motion';
import type { RgbaPixels } from '@open-artifact/wasm-motion';
import type { GifPlan } from '../plan.ts';
import type { ExportDimensions } from '../types.ts';
import { createOpaqueSurface } from './surface.ts';
import type { SurfaceMaker } from './surface.ts';

/** Where in the film a GIF estimate looks: each a pair of frames, one frame apart. */
export const GIF_PROBE_FRACTIONS: readonly number[] = [0.1, 0.5, 0.85];
/** Where it looks next when a pair rests (the two frames are the same), for as long as the preset allows. */
export const GIF_EXTRA_PROBE_FRACTIONS: readonly number[] = [0.2803, 0.6623, 0.4262, 0.718, 0.1902, 0.5721, 0.9541, 0.3361, 0.0443];

export interface GifSizeEncoder {
  /** The bytes the frame added. */
  add(pixels: RgbaPixels, delayCs: number): number;
  dispose(): void;
}

/** What measuring needs; the defaults run the GIF encoder in this thread. */
export interface GifMeasureTools {
  palette(frames: readonly RgbaPixels[]): Uint8Array;
  encoder(size: ExportDimensions, palette: Uint8Array): GifSizeEncoder;
  yieldTask(): Promise<void>;
}

export const DEFAULT_GIF_MEASURE_TOOLS: GifMeasureTools = {
  palette: (frames) => buildGifPalette(frames),
  encoder: (size, palette) => {
    const encoder = createGifEncoder({ width: size.width, height: size.height, palette });
    return { add: (pixels, delayCs) => encoder.add(pixels, delayCs), dispose: () => encoder.dispose() };
  },
  yieldTask: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

export interface GifMeasure {
  bytes: number;
  /** Encoding time per frame. */
  msPerFrame: number;
  /** The bytes are a floor: the first frames alone came to more than the guess. */
  atLeast?: boolean;
}

export interface GifEstimator {
  /** Paints frame `side` (0 or 1) of probe `probe`; null for a held frame. */
  add(image: CanvasImageSource | null, probe: number, side: 0 | 1): void;
  /** Some probe's two frames are the same: the film rests there, and more probes give a fairer guess. */
  rests(): boolean;
  measure(signal?: AbortSignal): Promise<GifMeasure | null>;
}

function equalPixels(left: RgbaPixels, right: RgbaPixels): boolean {
  if (left.length !== right.length) return false;
  const a = new Uint32Array(left.buffer, left.byteOffset, left.length >> 2);
  const b = new Uint32Array(right.buffer, right.byteOffset, right.length >> 2);
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

type Pair = [RgbaPixels | undefined, RgbaPixels | undefined];

/**
 * Guesses a GIF's size from pairs of frames: the largest first frame, plus the average change a frame brings times the
 * frames after the first.
 */
export function createGifEstimator(plan: GifPlan, surface: SurfaceMaker = createOpaqueSurface, tools: GifMeasureTools = DEFAULT_GIF_MEASURE_TOOLS): GifEstimator {
  const target = surface(plan);
  const samples = new Map<number, Pair>();
  const ordered = (): Pair[] => [...samples].sort(([a], [b]) => a - b).map(([, pair]) => pair);
  const paired = (): Array<[RgbaPixels, RgbaPixels]> =>
    ordered().flatMap(([first, second]): Array<[RgbaPixels, RgbaPixels]> => (first !== undefined && second !== undefined ? [[first, second]] : []));
  return {
    add(image, probe, side) {
      target.paint(image);
      const pair: Pair = samples.get(probe) ?? [undefined, undefined];
      pair[side] = target.pixels();
      samples.set(probe, pair);
    },
    rests: () => paired().some(([first, second]) => equalPixels(first, second)),
    async measure(signal) {
      const pairs = paired();
      if (pairs.length === 0) return null;
      const palette = tools.palette(ordered().flatMap((pair) => pair.filter((pixels): pixels is RgbaPixels => pixels !== undefined)));
      const allFirsts = tools.encoder(plan, palette);
      let largestFirst = 0;
      let seconds = 0;
      let firsts = 0;
      let encodeMs = 0;
      try {
        let startedAt = performance.now();
        for (const [first, second] of pairs) {
          const one = tools.encoder(plan, palette);
          try {
            largestFirst = Math.max(largestFirst, one.add(first, plan.delayCs));
            seconds += one.add(second, plan.delayCs);
          } finally {
            one.dispose();
          }
          encodeMs += performance.now() - startedAt;
          firsts += allFirsts.add(first, plan.delayCs);
          await tools.yieldTask();
          if (signal?.aborted === true) return null;
          startedAt = performance.now();
        }
      } finally {
        allFirsts.dispose();
      }
      return gifMeasureOf({ largestFirst, seconds, firsts, encodeMs, pairs: pairs.length, frames: plan.frames });
    },
  };
}

export interface GifMeasureInput {
  largestFirst: number;
  /** Bytes the second frames of all pairs added. */
  seconds: number;
  /** Bytes of one GIF fed every pair's first frame. */
  firsts: number;
  encodeMs: number;
  pairs: number;
  frames: number;
}

export function gifMeasureOf(input: GifMeasureInput): GifMeasure {
  const msPerFrame = input.encodeMs / (input.pairs * 2);
  const guess = Math.round(input.largestFirst + (input.seconds / input.pairs) * (input.frames - 1));
  return input.firsts > guess && input.pairs <= input.frames ? { bytes: input.firsts, msPerFrame, atLeast: true } : { bytes: guess, msPerFrame };
}
