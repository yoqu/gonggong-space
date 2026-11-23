/**
 * The Motion type's pixel work, done by `crates/open-artifact-motion` compiled
 * to WebAssembly: GIF palettes and encoding (in-thread, or in a Worker
 * session for a page), MOV writing (QuickTime Animation with alpha, PCM
 * sound) and the flash analysis of scenes.
 */

export type { RgbaPixels } from './module.ts';
export { buildGifPalette, createGifEncoder } from './gif.ts';
export type { GifEncoderOptions, GifFrameEncoder, GifPaletteOptions } from './gif.ts';
export { createMovWriter } from './mov.ts';
export type { MovRepeats, MovSound, MovWriter, MovWriterOptions } from './mov.ts';
export { gifBackend, openGifSession } from './gif-session.ts';
export type { GifSession, GifSessionOptions } from './gif-session.ts';
export {
  FLASH_MAX_SCENE_SECONDS,
  FLASH_RASTER_SCALE,
  FLASH_SAMPLE_FPS,
  FLASH_SAMPLE_PADDING_SECONDS,
  analyzeFlashes,
  createFlashAnalyzer,
  flashSafeScale,
  planFlashSampling,
} from './flash.ts';
export type { FlashFrameAnalyzer, FlashReport, FlashSampling } from './flash.ts';
