/**
 * Flash analysis (WCAG 2.3.1 general flashes) of a scene sampled at 30 fps:
 * how fast its quickest three flashes over a large enough area are, and so
 * the least share of its length it may be shortened to.
 */

import type { FlashAnalyzer as WasmFlashAnalyzer } from '../generated/open_artifact_motion.js';
import { pixelBytes, videoModule, type RgbaPixels } from './module.ts';

/** Frames are sampled this many times a second. */
export const FLASH_SAMPLE_FPS = 30;
/** The film around a scene sampled too (seconds each side): flashes at its cuts count. */
export const FLASH_SAMPLE_PADDING_SECONDS = 1;
/** Longer scenes are not checked. */
export const FLASH_MAX_SCENE_SECONDS = 30;
/** Frames are rendered at this share of the film's size for the analysis. */
export const FLASH_RASTER_SCALE = 0.103;
/** Three flashes may take this long at the least (seconds). */
const SAFE_SPAN_SECONDS = 31 / 30;

/** What the analysis found. */
export interface FlashReport {
  /** Frames analyzed. */
  frames: number;
  /** The quickest three flashes within the judged frames: the sample frames of their first and last transition. */
  fastest: { first: number; last: number } | null;
  /** How long the quickest three flashes took, seconds (`Infinity`: none). */
  span: number;
  /** The least share of its length the scene can be shortened to: 0 any, 1 none. */
  safeScale: number;
}

/** Which frames to sample for a scene and which of them are judged. */
export interface FlashSampling {
  /** The times to render, on the same clock as the scene's start (seconds). */
  times: number[];
  /** Transitions judged reach into sample frames `fromFrame`…`toFrame`. */
  fromFrame: number;
  toFrame: number;
}

/** A flash analyzer fed one sampled frame at a time. */
export interface FlashFrameAnalyzer {
  /** Adds the next frame, `width` pixels wide; every frame must be the size of the first. */
  add(pixels: RgbaPixels, width: number): void;
  report(): FlashReport;
  /** Releases the analyzer. */
  dispose(): void;
}

/** The least share of its length a stretch whose quickest three flashes took `span` seconds can be shortened to. */
export function flashSafeScale(span: number): number {
  return Math.min(1, SAFE_SPAN_SECONDS / span);
}

/**
 * The sampling of a scene starting at `sceneStart` and `sceneLength` long
 * in a film `filmLength` long (all seconds on the film's own clock), with a
 * second of film each side; `null` for a scene too long to check.
 */
export function planFlashSampling(sceneStart: number, sceneLength: number, filmLength: number): FlashSampling | null {
  if (sceneLength > FLASH_MAX_SCENE_SECONDS) return null;
  const from = Math.max(0, sceneStart - FLASH_SAMPLE_PADDING_SECONDS);
  const fromFrame = Math.round((sceneStart - from) * FLASH_SAMPLE_FPS);
  const until = Math.min(filmLength, sceneStart + sceneLength + FLASH_SAMPLE_PADDING_SECONDS);
  const count = Math.max(0, Math.floor((until - from) * FLASH_SAMPLE_FPS + 1e-6) + 1);
  return {
    times: Array.from({ length: count }, (_, index) => from + index / FLASH_SAMPLE_FPS),
    fromFrame,
    toFrame: fromFrame + Math.round(sceneLength * FLASH_SAMPLE_FPS),
  };
}

const toFrameIndex = (value: number): number => Math.max(0, Math.min(0xffff_ffff, Math.round(value) || 0));

/** An analyzer judging flashes that reach into sample frames `fromFrame`…`toFrame`. */
export function createFlashAnalyzer(range: { fromFrame: number; toFrame: number }): FlashFrameAnalyzer {
  let analyzer: WasmFlashAnalyzer | null = new (videoModule().FlashAnalyzer)(toFrameIndex(range.fromFrame), toFrameIndex(range.toFrame));
  const open = (): WasmFlashAnalyzer => {
    if (analyzer === null) throw new Error('The flash analyzer is released.');
    return analyzer;
  };
  return {
    add: (pixels, width) => open().add(pixelBytes(pixels), width),
    report: () => {
      const current = open();
      const fastest = current.fastest();
      const span = fastest.length === 2 ? (fastest[1] - fastest[0]) / FLASH_SAMPLE_FPS : Infinity;
      return {
        frames: current.frames,
        fastest: fastest.length === 2 ? { first: fastest[0], last: fastest[1] } : null,
        span,
        safeScale: current.safeScale(),
      };
    },
    dispose: () => {
      analyzer?.free();
      analyzer = null;
    },
  };
}

/** Analyzes frames sampled at 30 fps, all `width` pixels wide. */
export function analyzeFlashes(frames: Iterable<RgbaPixels>, options: { width: number; fromFrame: number; toFrame: number }): FlashReport {
  const analyzer = createFlashAnalyzer(options);
  try {
    for (const frame of frames) analyzer.add(frame, options.width);
    return analyzer.report();
  } finally {
    analyzer.dispose();
  }
}
