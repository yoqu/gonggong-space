/**
 * The Whiteboard geometry module (`crates/open-artifact-wb-geom`), instantiated on
 * first use. The bytes are embedded, so this works the same in Node, in the
 * bundled CLI and in the editor page, and callers keep synchronous APIs.
 */

import * as glue from '../generated/open_artifact_wb_geom.js';
import { WASM_BASE64 } from '../generated/bytes.js';

export type WbGeom = Omit<typeof glue, 'default' | 'initSync'>;

let ready = false;

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The module's exports, instantiating it on the first call. */
export function wbGeom(): WbGeom {
  if (!ready) {
    glue.initSync({ module: decode(WASM_BASE64) });
    ready = true;
  }
  return glue;
}
