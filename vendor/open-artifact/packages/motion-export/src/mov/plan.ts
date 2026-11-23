import type { MovRepeats } from '@open-artifact/wasm-motion';
import { BYTES_PER_MEBIBYTE } from '../errors.ts';
import type { FilmFacts } from '../frame-source.ts';
import { MAX_EXPORT_FPS, fitExportDimensions, isVideoHeight } from '../plan.ts';
import type { FramePlan } from '../types.ts';

/** A MOV stops once it passes this many mebibytes. */
export const MOV_MAX_MEBIBYTES = 50;
/** Bytes a second of 48 kHz stereo 16-bit PCM takes. */
export const STEREO_PCM_BYTES_PER_SECOND = 192_000;

/** How a MOV is written: its limit, how often a frame is stored whole, and what a repeated frame becomes. */
export interface MovSettings {
  maxBytes: number;
  keyEvery: number;
  repeats: MovRepeats;
}

export const MOV_SETTINGS: Readonly<MovSettings> = { maxBytes: MOV_MAX_MEBIBYTES * BYTES_PER_MEBIBYTE, keyEvery: 1, repeats: 'unchanged' };

/** What a person picks for a MOV. */
export interface MovChoices {
  /** The short side, in pixels: 720 or 1080. */
  height: number;
  fps?: number;
  /** Draw each frame at twice the size and scale it down. */
  supersample?: boolean;
}

export type MovPlan = FramePlan;

export function planMovFrames(film: Pick<FilmFacts, 'width' | 'height' | 'fps' | 'duration'>, choices: Partial<MovChoices>): MovPlan {
  const size = fitExportDimensions(film, isVideoHeight(choices.height) ? choices.height : 1080);
  const wanted = typeof choices.fps === 'number' && Number.isFinite(choices.fps) ? choices.fps : film.fps;
  const fps = Math.max(1, Math.min(wanted, Math.max(1, film.fps), MAX_EXPORT_FPS));
  return { ...size, fps, frames: Math.max(1, Math.round(film.duration * fps)) };
}

/** The most the movie's atoms take for `frames` frames, with room to spare. */
export const estimateMovHeaderBytes = (frames: number): number => frames * 16 + 16_384;

/** Bytes left for the frames under `maxBytes`, after the atoms and `pcmBytes` of sound; 0 or less leaves none. */
export const movFrameBudget = (frames: number, pcmBytes: number, maxBytes: number = MOV_SETTINGS.maxBytes): number =>
  maxBytes - estimateMovHeaderBytes(frames) - pcmBytes;

/** A limit in bytes as the whole mebibytes people are told (at least 1). */
export const movByteLimitMebibytes = (bytes: number): number => Math.max(1, Math.round(bytes / BYTES_PER_MEBIBYTE));

/** Every frame is stored whole, so a still second costs as much as a moving one. */
export const storesWholeFrames = (settings: Pick<MovSettings, 'keyEvery' | 'repeats'> = MOV_SETTINGS): boolean =>
  settings.repeats === 'whole' && settings.keyEvery === 1;
