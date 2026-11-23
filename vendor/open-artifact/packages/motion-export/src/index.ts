export { createExportEngine } from './engine.ts';
export type { ExportEngine, ExportEngineOptions, ExportResult } from './engine.ts';
export type { FilmFacts, FrameRequest, FrameSource, StageFrame } from './frame-source.ts';
export type {
  ExportDimensions,
  ExportEstimate,
  ExportFrame,
  ExportPhase,
  ExportProgress,
  ExportRunOptions,
  ExportedFile,
  FramePlan,
  HeldFrames,
  RenderedFile,
} from './types.ts';

export {
  EXPORT_AUDIO_BITRATE,
  GIF_HEAVY_BYTES,
  MAX_EXPORT_FPS,
  VIDEO_FRAME_RATES,
  VIDEO_HEIGHTS,
  chooseVideoBitrate,
  estimateVideoBytes,
  fitExportDimensions,
  isVideoHeight,
  planGifFrames,
  planVideoFrames,
  resolveGifPreset,
  resolveVideoSettings,
} from './plan.ts';
export type { GifPlan, GifPreset, GifPresetName, VideoFramePlan, VideoHeight, VideoQuality, VideoSettings } from './plan.ts';
export { describeVideoFormat } from './video/format.ts';
export type { ExportAudioCodec, ExportVideoCodec, VideoFormat, VideoPlan } from './video/format.ts';
export { newEncoderMemory } from './video/attempts.ts';
export type { EncoderMemory } from './video/attempts.ts';
export type { EncodeTryListener, EncodeTryOutcome } from './visibility.ts';
export { gifSeconds, videoSeconds } from './estimate.ts';
export {
  MOV_MAX_MEBIBYTES,
  MOV_SETTINGS,
  STEREO_PCM_BYTES_PER_SECOND,
  estimateMovHeaderBytes,
  movByteLimitMebibytes,
  movFrameBudget,
  planMovFrames,
  storesWholeFrames,
} from './mov/plan.ts';
export type { MovChoices, MovPlan, MovSettings } from './mov/plan.ts';
export { movSeconds } from './mov/estimate.ts';

export { failedProblem, gifExportFormat, heldProblem, videoExportFormat } from './problems.ts';
export {
  BYTES_PER_MEBIBYTE,
  EncoderFailure,
  EncoderSilentError,
  ExportCheckError,
  FrameRenderError,
  FrameStallError,
  GifTooLargeError,
  MovTooLargeError,
  SkippedVideoFramesError,
  SourceExportError,
  VideoUnsupportedError,
  isAbortError,
} from './errors.ts';
export type { ExportCheckCode, SourceRefusalCode } from './errors.ts';
export { exportFileStem, exportFilename } from './filename.ts';
export { createRasterHost } from './raster/host.ts';
export type { RasterCache, RasterHost, RasterHostOptions } from './raster/host.ts';

export { STANDALONE_MAX_BYTES, standaloneFile, standaloneFilm, standaloneHtml } from './standalone/html.ts';
export type { FontLicenceNotice, StandaloneInput } from './standalone/html.ts';
export { SOURCE_MAX_BYTES, buildSourceZip } from './source/zip.ts';
export type { SourceZip, SourceZipInput } from './source/zip.ts';
export { SCORE_MIDI_FILE, sourceFolder } from './source/layout.ts';
export type { SourceAsset, SourceFolder, SourceFolderInput, SourceFont, SourceModule } from './source/layout.ts';

export { words as exportWords, formatLabels } from './words.ts';
