import type { PlaySeconds } from '@open-artifact/motion-core';
import { words } from './words.ts';

/** A frame the film could not draw. `hold`: the frame before stands in for it and the export goes on. */
export class FrameRenderError extends Error {
  override name = 'FrameRenderError';
  readonly t: PlaySeconds;
  readonly hold: boolean;
  constructor(message: string, t: PlaySeconds, hold = true) {
    super(message);
    this.t = t;
    this.hold = hold;
  }
}

/** A frame that did not come: the browser's doing (a tab in the background), not the film's. */
export class FrameStallError extends Error {
  override name = 'FrameStallError';
}

/** The raster frame gave no answer in time. */
export class RasterStallError extends FrameStallError {
  override name = 'RasterStallError';
}

/** The raster frame could not decode or draw a snapshot. */
export class RasterDecodeError extends Error {
  override name = 'RasterDecodeError';
}

/** The raster host was disposed while frames were still asked for. */
export class RasterGoneError extends Error {
  override name = 'RasterGoneError';
}

export class SnapshotLimitError extends Error {
  override name = 'SnapshotLimitError';
}

export type ExportCheckCode = 'no_canvas' | 'no_output' | 'skipped_frames' | 'no_film' | 'torn_frame';

/** An export that cannot finish, with a code an editor can act on. */
export class ExportCheckError extends Error {
  override name = 'ExportCheckError';
  readonly code: ExportCheckCode;
  constructor(message: string, code: ExportCheckCode) {
    super(message);
    this.code = code;
  }
}

export class SkippedVideoFramesError extends ExportCheckError {
  override name = 'SkippedVideoFramesError';
  readonly skipped: number;
  readonly frames: number;
  constructor(skipped: number, frames: number) {
    super(words.skippedFrames(skipped, frames), 'skipped_frames');
    this.skipped = skipped;
    this.frames = frames;
  }
}

export class VideoUnsupportedError extends Error {
  override name = 'VideoUnsupportedError';
  constructor() {
    super(words.videoUnsupported);
  }
}

/** The encoder put nothing out in time. */
export class EncoderSilentError extends Error {
  override name = 'EncoderSilentError';
  constructor(cause?: unknown) {
    super(words.encoderSilent, cause === undefined ? undefined : { cause });
  }
}

/** The encoder broke while the page stayed in view: worth a try with the next set-up. */
export class EncoderFailure extends Error {
  override name = 'EncoderFailure';
  readonly failure: Error;
  constructor(failure: Error) {
    super(failure.message);
    this.failure = failure;
  }
}

export class GifTooLargeError extends Error {
  override name = 'GifTooLargeError';
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(words.gifTooLarge(wholeMegabytes(maxBytes)));
    this.maxBytes = maxBytes;
  }
}

/** The MOV passed its limit; `maxBytes` is that limit. */
export class MovTooLargeError extends Error {
  override name = 'MovTooLargeError';
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(words.movTooLarge(Math.max(1, Math.round(maxBytes / BYTES_PER_MEBIBYTE))));
    this.maxBytes = maxBytes;
  }
}

export type SourceRefusalCode = 'too_large' | 'unreadable';

/** The source ZIP or the standalone page could not be made. */
export class SourceExportError extends Error {
  override name = 'SourceExportError';
  readonly code: SourceRefusalCode;
  constructor(message: string, code: SourceRefusalCode) {
    super(message);
    this.code = code;
  }
}

export const BYTES_PER_MEBIBYTE = 1_048_576;
export const wholeMegabytes = (bytes: number): number => Math.floor(bytes / BYTES_PER_MEBIBYTE);

export const exportAbortError = (): DOMException => new DOMException(words.exportCancelled, 'AbortError');

export const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

export const isAborted = (signal: AbortSignal | undefined): boolean => signal !== undefined && signal.aborted;

export const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));
