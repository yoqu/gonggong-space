import { openGifSession } from '@open-artifact/wasm-motion';
import { GifTooLargeError } from '../errors.ts';
import { renderExportFrames } from '../frames.ts';
import type { GifPlan } from '../plan.ts';
import type { ExportFrame, ExportProgress, HeldFrames } from '../types.ts';
import { createOpaqueSurface } from './surface.ts';
import type { SurfaceMaker } from './surface.ts';

/** Frames sampled, spread over the film, for the GIF's one palette. */
export const GIF_PALETTE_SAMPLES = 24;

export interface GifEncodeOptions {
  plan: GifPlan;
  /** The film's length in seconds, as played. */
  duration: number;
  frame: ExportFrame;
  maxBytes: number;
  surface?: SurfaceMaker;
  page?: Document;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface EncodedGif {
  bytes: Uint8Array;
  held: HeldFrames;
  ms: number;
}

/** Draws sample frames for the palette, then every frame into the GIF; stops once it passes `maxBytes`. */
export async function encodeGif(options: GifEncodeOptions): Promise<EncodedGif> {
  const { plan, signal, maxBytes } = options;
  const startedAt = performance.now();
  const target = (options.surface ?? createOpaqueSurface)(plan);
  const session = openGifSession({ width: plan.width, height: plan.height });
  const shared = {
    frame: options.frame,
    scale: 1,
    ...(signal !== undefined ? { signal } : {}),
    ...(options.page !== undefined ? { page: options.page } : {}),
  };
  try {
    const samples = Math.min(GIF_PALETTE_SAMPLES, plan.frames);
    const sampled: Array<Promise<void>> = [];
    await renderExportFrames({
      ...shared,
      plan: { ...plan, fps: samples / Math.max(options.duration, 1e-3), frames: samples },
      draw: (bitmap) => {
        if (bitmap === null) return;
        target.paint(bitmap);
        const sample = session.sample(target.pixels());
        sample.catch(() => undefined);
        sampled.push(sample);
      },
      commit: () => undefined,
    });
    await Promise.all(sampled);
    let size = 0;
    const held = await renderExportFrames({
      ...shared,
      plan,
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      draw: (bitmap, index) => {
        if (bitmap !== null || index === 0) target.paint(bitmap);
      },
      commit: async () => {
        size = await session.add(target.pixels(), plan.delayCs);
        if (size > maxBytes) throw new GifTooLargeError(maxBytes);
      },
    });
    options.onProgress?.({ done: plan.frames, total: plan.frames, phase: 'mux' });
    const bytes = await session.finish();
    if (bytes.length > maxBytes) throw new GifTooLargeError(maxBytes);
    return { bytes, held, ms: performance.now() - startedAt };
  } finally {
    session.close();
  }
}
