/**
 * The canvas engine core (`crates/open-artifact-canvas`) compiled to WebAssembly. The bytes are
 * embedded (base64), so this works the same in Node and in the editor pages.
 *
 * Loading is asynchronous: the module is compiled with `WebAssembly.compile` (off
 * the main thread's critical path in browsers) and instantiated once. Use
 * `@open-artifact/canvas-engine`, not this package, from editors.
 */

import * as glue from '../generated/open_artifact_canvas.js';
import { WASM_BASE64 } from '../generated/bytes.js';

export type { CanvasCore } from '../generated/open_artifact_canvas.js';

/** The module's exports once loaded. */
export interface CanvasWasm {
  CanvasCore: typeof glue.CanvasCore;
  /** The instance's linear memory (for size reporting). */
  memory: WebAssembly.Memory;
}

let loading: Promise<CanvasWasm> | undefined;

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Compiles and instantiates the module on the first call; later calls share it. */
export function loadCanvasWasm(): Promise<CanvasWasm> {
  loading ??= (async () => {
    const module = await WebAssembly.compile(decode(WASM_BASE64));
    const exports = glue.initSync({ module });
    return { CanvasCore: glue.CanvasCore, memory: exports.memory };
  })();
  return loading;
}

/** Size of the embedded module in bytes (decoded). */
export function canvasWasmSize(): number {
  const padding = WASM_BASE64.endsWith('==') ? 2 : WASM_BASE64.endsWith('=') ? 1 : 0;
  return (WASM_BASE64.length * 3) / 4 - padding;
}
