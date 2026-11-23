import { encodePcmWave } from '@open-artifact/motion-audio';
import { createMovWriter } from '@open-artifact/wasm-motion';
import type { MovSound } from '@open-artifact/wasm-motion';
import { MovTooLargeError } from '../errors.ts';
import { renderExportFrames } from '../frames.ts';
import type { SurfaceMaker } from '../gif/surface.ts';
import type { ExportFrame, ExportProgress, HeldFrames } from '../types.ts';
import { MOV_SETTINGS, movFrameBudget } from './plan.ts';
import type { MovPlan, MovSettings } from './plan.ts';
import { createAlphaSurface } from './surface.ts';

const WAVE_HEADER_BYTES = 44;

export interface MovEncodeOptions {
  plan: MovPlan;
  frame: ExportFrame;
  /** The film's sound, rendered; null for a silent movie. */
  audio: AudioBuffer | null;
  supersample: boolean;
  settings?: MovSettings;
  surface?: SurfaceMaker;
  page?: Document;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface EncodedMov {
  blob: Blob;
  held: HeldFrames;
  ms: number;
}

/** The sound as the interleaved 16-bit PCM a MOV stores. */
export function movSound(audio: AudioBuffer): MovSound {
  return { pcm: encodePcmWave(audio).subarray(WAVE_HEADER_BYTES), sampleRate: audio.sampleRate, channels: audio.numberOfChannels };
}

/** Draws every frame on a clear surface into a QuickTime Animation movie with the sound; stops once it passes the limit. */
export async function encodeMov(options: MovEncodeOptions): Promise<EncodedMov> {
  const { plan, signal } = options;
  const settings = options.settings ?? MOV_SETTINGS;
  const startedAt = performance.now();
  const sound = options.audio === null ? null : movSound(options.audio);
  const budget = movFrameBudget(plan.frames, sound?.pcm.byteLength ?? 0, settings.maxBytes);
  if (budget <= 0) throw new MovTooLargeError(settings.maxBytes);
  const target = (options.surface ?? createAlphaSurface)(plan);
  const writer = createMovWriter({ width: plan.width, height: plan.height, fps: plan.fps, keyEvery: settings.keyEvery, repeats: settings.repeats });
  try {
    const held = await renderExportFrames({
      plan,
      frame: options.frame,
      scale: options.supersample ? 2 : 1,
      ...(signal !== undefined ? { signal } : {}),
      ...(options.page !== undefined ? { page: options.page } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      draw: (bitmap, index) => {
        if (bitmap !== null || index === 0) target.paint(bitmap);
      },
      commit: () => {
        writer.add(target.pixels());
        if (writer.byteLength > budget) throw new MovTooLargeError(settings.maxBytes);
      },
    });
    options.onProgress?.({ done: plan.frames, total: plan.frames, phase: 'mux' });
    const blob = new Blob(writer.finish(sound), { type: 'video/quicktime' });
    return { blob, held, ms: performance.now() - startedAt };
  } finally {
    writer.dispose();
  }
}
