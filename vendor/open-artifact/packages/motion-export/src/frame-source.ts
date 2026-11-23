import type { PlaySeconds } from '@open-artifact/motion-core';
import type { FilmSound } from '@open-artifact/motion-audio';

/** What a frame request asks the stage for: a snapshot `scale` times the film's size. */
export interface FrameRequest {
  scale: number;
  smallMedia: boolean;
  readFx: boolean;
  smooth: boolean;
}

/**
 * The stage's answer to a frame request.
 * - `picture`: the snapshot as SVG, `pw` × `ph` pixels.
 * - `failed`: the stage's `frame-error`. `hold`: the frame before may stand in. `env`: the browser's doing (a tab in
 *   the background, or no answer in time), not the film's.
 * - `unloaded`: there is no film on the stage.
 */
export type StageFrame =
  | { kind: 'picture'; svg: string; pw: number; ph: number }
  | { kind: 'failed'; message: string; hold: boolean; env: boolean }
  | { kind: 'unloaded' };

/** The film as an export plans it. */
export interface FilmFacts {
  title: string;
  width: number;
  height: number;
  fps: number;
  /** How long the film plays, after the scenes retimed by hand. */
  duration: PlaySeconds;
}

/**
 * What the editor gives the export engine, over its stage controller. `frame` resolves with the stage's answer and
 * rejects only when no frame can come any more (the stage is gone); a stage that does not answer in time resolves
 * `{kind: 'failed', env: true, hold: true}`.
 */
export interface FrameSource {
  /** Null while no film is loaded. */
  facts(): FilmFacts | null;
  frame(t: PlaySeconds, request: FrameRequest): Promise<StageFrame>;
  /** The film's sound as played (the sound player's `sound`); null when it has none. */
  sound(): FilmSound | null;
  /** Stops playback before frames are asked for; the function returned puts the stage back as it was. */
  borrow(): () => Promise<void>;
  /** How long a snapshot waits for words clipped at its first draw (Firefox). */
  clippedTextWaitMs(): number;
}
