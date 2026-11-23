import type { PlaySeconds, ScoreTempo } from '@open-artifact/motion-core';
import type { ConsoleLevel, ErrorPhase, RenderMode, StageMeta } from '../protocol.ts';

/** The global the tools page sets: `window.filmTools`. */
export const TOOLS_GLOBAL = 'filmTools';

/**
 * A video artifact's film as it lies on disk: the documents under `db/` and the uploads under `_blobs/`.
 * `documents` is keyed by path under `db/` without `.json` (`film/meta`, `film/script`, `modules/scenes.json`,
 * `assets/logo.png`); each value is the file's JSON text or the value it parses to. `blobs` is keyed by upload id
 * (the 32 hex digits of `_blob/<id>`), each the file's bytes as base64.
 */
export interface ToolsFiles {
  documents: Record<string, unknown>;
  blobs?: Record<string, string>;
  /** final (the default): every written scene draws as it is, as in an export. rough: rough scenes draw as sketches. */
  mode?: RenderMode;
}

export interface ToolsLoaded {
  meta: StageMeta;
  /** What of the film the player drops or cannot have (unreadable documents, missing uploads, records not applied). */
  problems: string[];
}
export interface ToolsFailed {
  error: { message: string };
  problems: string[];
}
export type ToolsLoad = ToolsLoaded | ToolsFailed;

export interface ToolsFrameOptions {
  /** Times the film's own size: 0.5 makes a 960 × 540 PNG of a 1080p film. 1 by default. */
  scale?: number;
}

/** The stage's console and the film's errors since the last load, in order. */
export interface ToolsLogLine {
  level: ConsoleLevel;
  text: string;
  /** Set on the film's own errors: whether loading or a render threw. */
  phase?: ErrorPhase;
}

/** The score `kit.score` recorded, counted, and the narration's lines. */
export interface ScoreReport {
  events: number;
  notes: number;
  drums: number;
  fx: number;
  /** `kind:patch` of events whose patch the player has no voice for: they play as silence. */
  unknown: string[];
  /** When the first sound starts and the last ends, played seconds. */
  first: PlaySeconds;
  last: PlaySeconds;
  tempo: ScoreTempo | null;
  /** null: the film has no narration (or this page reads none). */
  narration: { lines: number; seconds: number } | null;
}

/** What the tools page sets as `window.filmTools`. Every call that waits returns a promise. */
export interface FilmTools {
  version: 1;
  load(files: ToolsFiles): Promise<ToolsLoad>;
  /** Shows the film at `t` (played seconds) and resolves once it is on show. */
  seek(t: number): Promise<void>;
  /** The frame at `t` as an export draws it (the stage's snapshot, rastered), as a PNG data URL. */
  frame(t: number, options?: ToolsFrameOptions): Promise<string>;
  /** null before a load succeeds. */
  scoreReport(): ScoreReport | null;
  consoleLog(): ToolsLogLine[];
}
