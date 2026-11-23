import type { PlaySeconds } from '@open-artifact/motion-core';

export interface ExportDimensions {
  width: number;
  height: number;
}

/** The frames an export draws: `frames` of them, `fps` a second, at `width` × `height`. */
export interface FramePlan extends ExportDimensions {
  fps: number;
  frames: number;
}

export type ExportPhase = 'probe' | 'audio' | 'frames' | 'mux';

export interface ExportProgress {
  done: number;
  total: number;
  phase: ExportPhase;
  /** Video only: packets the encoder put out so far, and their bytes. */
  packets?: number;
  bytes?: number;
}

/** Frames that could not be drawn, each replaced by the one before. */
export interface HeldFrames {
  count: number;
  total: number;
  first?: { t: PlaySeconds; message: string };
  last?: PlaySeconds;
  /** Frames asked for again after the page had been hidden: how many then came, and how many failed again. */
  again?: { good: number; failed: number };
}

/** One frame as a picture `width` × `height`; rejects with FrameRenderError or FrameStallError. */
export type ExportFrame = (t: PlaySeconds, width: number, height: number) => Promise<ImageBitmap>;

export interface ExportRunOptions {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

/** A finished export: what the editor hands to the downloads capability. */
export interface ExportedFile {
  blob: Blob;
  filename: string;
  mime: string;
}

/** A finished video or GIF, with the frames it had to hold. */
export interface RenderedFile extends ExportedFile {
  held: HeldFrames;
  ms: number;
}

export interface ExportEstimate {
  bytes: number;
  /** Seconds the export should take. */
  seconds: number;
  label: string;
  /** The bytes are a floor, not a guess. */
  atLeast?: boolean;
  /** MOV only: bytes a second of movement adds, and the bytes left for frames under the limit (0 or less: none). */
  mov?: { bytesPerSecond: number; budget: number; maxBytes: number };
}
