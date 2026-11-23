/**
 * @open-artifact/canvas-engine: a generic WebGL2 canvas engine in Rust/WASM
 * (`crates/open-artifact-canvas`) with a TypeScript API. See `CanvasEngine`.
 */

export { CanvasEngine } from './engine.ts';
export { parseColor, parseSvgPath, polylineCommands, PatchEncoder, IdRegistry, MAX_CUTS } from './protocol.ts';
export type * from './types.ts';
