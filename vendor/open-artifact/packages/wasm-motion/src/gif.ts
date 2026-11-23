/**
 * GIF encoding in this thread: a palette picked from sample frames, then
 * an encoder fed one frame at a time. Use it where blocking is fine (a
 * Worker, Node, size estimates over a few frames); `openGifSession` runs
 * the same work in a Worker for a page.
 */

import type { GifEncoder as WasmGifEncoder } from '../generated/open_artifact_motion.js';
import { pixelBytes, videoModule, type RgbaPixels } from './module.ts';

/** Options of a palette. */
export interface GifPaletteOptions {
  /** Count fewer pixels and refine less (for a quick palette of one frame). */
  fast?: boolean;
}

/** Options of a GIF. */
export interface GifEncoderOptions {
  width: number;
  height: number;
  /** The shared color table: RGB triples, at most 255 colors (see `buildGifPalette`). */
  palette: Uint8Array;
  /** Plays after the first (default 0: loop for ever). */
  repeat?: number;
}

/** A GIF being written. */
export interface GifFrameEncoder {
  /**
   * Adds a frame of `width` × `height` RGBA pixels shown for `delayCs`
   * hundredths of a second; the bytes it added (0 when nothing changed:
   * the frame before is shown longer instead).
   */
  add(pixels: RgbaPixels, delayCs: number): number;
  /** Bytes written so far. */
  readonly byteLength: number;
  /** The bytes written so far that no later frame changes, handed out once (keeps the module's memory small). */
  takeReady(): Uint8Array;
  /** Ends the GIF and releases the encoder; the bytes not handed out yet. */
  finish(): Uint8Array;
  /** Releases the encoder without finishing. */
  dispose(): void;
}

const toUint16 = (value: number): number => Math.max(0, Math.min(65535, Math.round(value) || 0));

/**
 * A palette for frames (RGB triples, at most 255 colors): the exact colors
 * when there are few, else large flat areas kept exact and the rest by a
 * weighted median cut refined by k-means.
 */
export function buildGifPalette(frames: Iterable<RgbaPixels>, options: GifPaletteOptions = {}): Uint8Array {
  const builder = new (videoModule().GifPaletteBuilder)(options.fast ?? false);
  try {
    for (const frame of frames) builder.add(pixelBytes(frame));
    return builder.finish();
  } finally {
    builder.free();
  }
}

/** A looping GIF written frame by frame. */
export function createGifEncoder(options: GifEncoderOptions): GifFrameEncoder {
  let encoder: WasmGifEncoder | null = new (videoModule().GifEncoder)(
    options.width,
    options.height,
    options.palette,
    toUint16(options.repeat ?? 0),
  );
  const open = (): WasmGifEncoder => {
    if (encoder === null) throw new Error('The GIF is finished.');
    return encoder;
  };
  return {
    add: (pixels, delayCs) => open().add(pixelBytes(pixels), toUint16(delayCs)),
    get byteLength() {
      return open().byteLength;
    },
    takeReady: () => open().takeReady(),
    finish: () => {
      const finishing = open();
      encoder = null;
      try {
        return finishing.finish();
      } finally {
        finishing.free();
      }
    },
    dispose: () => {
      encoder?.free();
      encoder = null;
    },
  };
}
