/**
 * MOV writing in this thread: QuickTime Animation frames (32-bit ARGB, the
 * alpha kept) and 16-bit PCM sound. The module lays out the movie; the
 * bytes of each frame stay here, so its memory stays small, and `finish`
 * hands back the file as parts in order.
 */

import type { MovEncoder as WasmMovEncoder } from '../generated/open_artifact_motion.js';
import { pixelBytes, videoModule, type RgbaPixels } from './module.ts';

/**
 * What becomes of a frame that repeats the one before: a 7-byte sample
 * ("unchanged"), the bytes of a repeated key frame stored once ("shared"),
 * or every frame stored whole ("whole").
 */
export type MovRepeats = 'unchanged' | 'shared' | 'whole';

/** Options of a MOV. */
export interface MovWriterOptions {
  width: number;
  height: number;
  fps: number;
  /** A key frame (stored whole) every so many frames; 1: every frame. */
  keyEvery?: number;
  repeats?: MovRepeats;
}

/** The movie's sound: interleaved 16-bit little-endian PCM. */
export interface MovSound {
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
}

/** A MOV being written. */
export interface MovWriter {
  /** Adds a frame of `width` × `height` RGBA pixels; the bytes kept for it (0 when it shares the frame before). */
  add(pixels: RgbaPixels): number;
  /** Bytes of the frames kept so far. */
  readonly byteLength: number;
  /** Ends the movie and releases the writer; the file as parts, in order. */
  finish(sound?: MovSound | null): Uint8Array<ArrayBuffer>[];
  /** Releases the writer without finishing. */
  dispose(): void;
}

const positive = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && value! >= 1 ? Math.floor(value!) : fallback;

/** A MOV written frame by frame. */
export function createMovWriter(options: MovWriterOptions): MovWriter {
  let encoder: WasmMovEncoder | null = new (videoModule().MovEncoder)(
    options.width,
    options.height,
    options.fps,
    positive(options.keyEvery, 1),
    options.repeats ?? 'unchanged',
  );
  const frames: Uint8Array<ArrayBuffer>[] = [];
  const open = (): WasmMovEncoder => {
    if (encoder === null) throw new Error('The MOV is finished.');
    return encoder;
  };
  const release = (): void => {
    encoder?.free();
    encoder = null;
  };
  return {
    add: (pixels) => {
      const kept = open().add(pixelBytes(pixels)) as Uint8Array<ArrayBuffer>;
      frames.push(kept);
      return kept.byteLength;
    },
    get byteLength() {
      return open().byteLength;
    },
    finish: (sound) => {
      const finishing = open();
      try {
        const channels = sound ? Math.max(1, Math.floor(sound.channels)) : 0;
        const soundFrames = sound ? Math.floor(sound.pcm.byteLength / (channels * 2)) : 0;
        const header = finishing.finish(soundFrames, sound ? Math.round(sound.sampleRate) : 0, channels) as Uint8Array<ArrayBuffer>;
        const pieces = finishing.pieces();
        const parts = [header];
        const bytesPerFrame = channels * 2;
        for (let at = 0; at < pieces.length; at += 3) {
          if (pieces[at] === 0) parts.push(frames[pieces[at + 1]!]!);
          else parts.push(sound!.pcm.subarray(pieces[at + 1]! * bytesPerFrame, pieces[at + 2]! * bytesPerFrame) as Uint8Array<ArrayBuffer>);
        }
        return parts;
      } finally {
        frames.length = 0;
        release();
      }
    },
    dispose: () => {
      frames.length = 0;
      release();
    },
  };
}
