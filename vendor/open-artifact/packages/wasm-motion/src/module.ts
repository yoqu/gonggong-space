/**
 * The WebAssembly module (`crates/open-artifact-motion`), instantiated
 * synchronously on first use from its embedded bytes, so it loads the same
 * in a page, a Worker, Node tests and the CLI.
 */

import * as glue from '../generated/open_artifact_motion.js';
import { WASM_BASE64 } from '../generated/bytes.js';

/** RGBA pixels, four bytes a pixel, rows top to bottom (as `ImageData.data` holds them). */
export type RgbaPixels = Uint8Array | Uint8ClampedArray;

let ready = false;

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The module's exports, instantiating it on the first call. */
export function videoModule(): Omit<typeof glue, 'default' | 'initSync'> {
  if (!ready) {
    glue.initSync({ module: decode(WASM_BASE64) });
    ready = true;
  }
  return glue;
}

/** The same pixels as plain bytes (no copy). */
export function pixelBytes(pixels: RgbaPixels): Uint8Array {
  return pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}
