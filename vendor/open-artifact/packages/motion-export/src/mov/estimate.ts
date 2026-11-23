import { createMovWriter } from '@open-artifact/wasm-motion';
import type { MovWriter } from '@open-artifact/wasm-motion';
import { AUDIO_RENDER_MS_PER_SECOND } from '../estimate.ts';
import type { ExportSurface } from '../gif/surface.ts';
import type { MovPlan, MovSettings } from './plan.ts';
import { MOV_SETTINGS, STEREO_PCM_BYTES_PER_SECOND, estimateMovHeaderBytes, movFrameBudget } from './plan.ts';

/** What a MOV of the film should come to, from the frames probed. */
export interface MovMeasure {
  /** The movie's bytes if it moved all the way through. */
  bytes: number;
  /** Bytes a second of movement adds. */
  bytesPerSecond: number;
  /** Bytes left for the frames under the limit. */
  budget: number;
  /** Milliseconds encoding a frame takes. */
  encodeMs: number;
}

/** Measures probed frames as a MOV stores a frame that moves: whole, every one a key frame. */
export interface MovProbe {
  add(bitmap: ImageBitmap): void;
  measure(withAudio: boolean): MovMeasure;
  dispose(): void;
}

export function createMovProbe(plan: MovPlan, duration: number, surface: ExportSurface, settings: MovSettings = MOV_SETTINGS): MovProbe {
  const writer: MovWriter = createMovWriter({ width: plan.width, height: plan.height, fps: plan.fps, keyEvery: 1, repeats: 'whole' });
  let largest = 0;
  let encodeMs = 0;
  let probed = 0;
  return {
    add(bitmap) {
      surface.paint(bitmap);
      const pixels = surface.pixels();
      const startedAt = performance.now();
      largest = Math.max(largest, writer.add(pixels));
      encodeMs += performance.now() - startedAt;
      probed++;
    },
    measure(withAudio) {
      const pcmBytes = withAudio ? Math.ceil(duration * STEREO_PCM_BYTES_PER_SECOND) : 0;
      const bytesPerSecond = largest * plan.fps;
      return {
        bytes: Math.round(estimateMovHeaderBytes(plan.frames) + pcmBytes + bytesPerSecond * duration),
        bytesPerSecond,
        budget: movFrameBudget(plan.frames, pcmBytes, settings.maxBytes),
        encodeMs: encodeMs / Math.max(1, probed),
      };
    },
    dispose: () => writer.dispose(),
  };
}

/** Seconds a MOV takes to make: its frames drawn and encoded, the sound, and a second to finish. */
export function movSeconds(frames: number, frameMs: number, encodeMs: number, duration: number, withAudio: boolean): number {
  return Math.round((frames * (frameMs + encodeMs) + (withAudio ? duration * AUDIO_RENDER_MS_PER_SECOND : 0)) / 1000 + 1);
}
