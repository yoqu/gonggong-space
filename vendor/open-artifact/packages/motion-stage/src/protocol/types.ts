import type { FilmSeconds, PlaySeconds, RetouchedRecord, ScoreData, ScoreEvent } from '@open-artifact/motion-core';
import type { AskedLook, LayersReport } from './layers.ts';

export type * from './layers.ts';

/** Bumped when a message changes shape; the host refuses a stage that says another. */
export const STAGE_PROTOCOL_VERSION = 2;

/**
 * The one message the host posts to the frame's window, on the frame's load, carrying the port every later message
 * goes through. The frame takes the first one that comes from its parent and ignores the rest.
 */
export const STAGE_CONNECT = 'video-stage:connect';
export interface StageConnect {
  type: typeof STAGE_CONNECT;
  version: number;
}

export type StageModuleKind = 'js' | 'css' | 'html' | 'json' | 'text';
export interface StageModule {
  name: string;
  kind: StageModuleKind;
  text: string;
}

/** Pictures and fonts arrive as bytes and become data: URLs, which a snapshot can see; a clip arrives as its URL and streams. */
export interface StageAsset {
  name: string;
  mime: string;
  w: number;
  h: number;
  bytes?: ArrayBuffer;
  url?: string;
}

export type StackName = 'sans' | 'serif' | 'mono' | 'display';

/** A face from the page (shipped with the type, or fetched): woff2 as a data: URL. */
export interface StageFace {
  family: string;
  url: string;
  weight: string;
  style: string;
  range?: string;
  /** ascent and descent overrides, in percent. */
  box?: [number, number];
  /** One or two characters the face draws, to load a face whose unicode-range leaves out a space. */
  sample?: string;
}

export interface StageFaces {
  fonts: StageFace[];
  /** The family that heads each stack, from the film's scenes.json fonts or a person's choice. */
  slots: Partial<Record<StackName, string>>;
}

export interface NarrationLimits {
  maxLines: number;
  maxLineSeconds: number;
}

export interface StageFilm {
  script: string;
  modules: StageModule[];
  assets: StageAsset[];
  faces: StageFaces | null;
  /** null: this viewer gets no narration, so narration.js is not read. */
  narration: NarrationLimits | null;
  /** How long a snapshot waits for words clipped at its first draw (Firefox). */
  clippedTextWaitMs: number;
  mode: RenderMode;
}

/** rough: a scene that says it is rough draws as a grey sketch. final: every written scene draws as it is. */
export type RenderMode = 'rough' | 'final';

export interface Chapter<Time extends number> {
  t: Time;
  label: string;
}

/** A part of the film (a scene, or a stretch between chapters) on both clocks. */
export interface FilmPart {
  key: string | null;
  /** The person's name for it, or the film's. */
  label: string;
  /** The film's own name for it. */
  own: string;
  a0: FilmSeconds;
  nat: number;
  p0: PlaySeconds;
  dur: number;
}

export type SceneState = 'todo' | 'failed' | 'rough' | 'final';
export interface SceneReport {
  id: string;
  state: SceneState;
}

export interface StageMeta {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  duration: PlaySeconds;
  filmDuration: FilmSeconds;
  chapters: Chapter<PlaySeconds>[];
  /** null: not a film made of scenes. */
  scenes: SceneReport[] | null;
  /** The stage's computed background colour and image. */
  background: [string, string];
  parts: FilmPart[];
}

export interface PlayedScoreEvent extends Omit<ScoreEvent, 't'> {
  t: PlaySeconds;
}
/** The score as played: recorded on the film's clock, moved with a person's scene lengths. */
export interface PlayedScore extends Omit<ScoreData, 'events'> {
  events: PlayedScoreEvent[];
}

export interface PlayedNarrationLine {
  at: PlaySeconds;
  dur: number;
  text: string;
  audio: string;
}
export interface NarrationReport {
  lines: PlayedNarrationLine[];
  duck: number | null;
}

/** One text node on the stage, in document order. A hidden node is told too, without a box. */
export interface StageText {
  text: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** The height of its first line, in film pixels. */
  line?: number;
  /** `<stretch>:<place>`: the line of words it is part of, where the page asked for places. */
  id?: string;
  seen?: boolean;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';
export type ErrorPhase = 'load' | 'render';

export type HostToStage =
  | { type: 'load'; film: StageFilm }
  /** Seek, play and pause: the moment to show and whether the film is playing on from it. */
  | { type: 'render'; seq: number; t: PlaySeconds; playing: boolean }
  | { type: 'mode'; mode: RenderMode }
  /** A snapshot of the stage at `t`, `scale` times its size. */
  | { type: 'frame'; seq: number; t: PlaySeconds; scale: number; smallMedia: boolean; readFx: boolean; smooth: boolean }
  /** Read the stage's text nodes now and after each paused frame (`watch` on), with their places if asked. */
  | { type: 'watch'; on: boolean; places: boolean }
  /** Check the stage for what a snapshot cannot show; findings come as console errors. */
  | { type: 'scan' }
  /**
   * Read the layers of the stretch `from`–`to`, drawing it many times over, and their boxes and looks at `at`.
   * `scene`: the scene the stretch is, whose class prefix names things; null in a film not made of scenes.
   * `stop`: no reading is wanted any more, so one under way ends unanswered.
   */
  | { type: 'layers'; seq: number; from: PlaySeconds; to: PlaySeconds; at: PlaySeconds; scene: string | null; stop: boolean }
  /**
   * A person's changes by hand to how things look (modules/retouched.json, parsed), laid over the film from the next
   * frame on and drawn at once on the moment on show. null: none.
   */
  | { type: 'retouch'; record: RetouchedRecord | null }
  /** How the film itself draws the thing `id` names in the stretch on show; `t`: the moment on show, if not the last asked. */
  | { type: 'look'; seq: number; id: string; t: PlaySeconds | null };

export type StageToHost =
  | { type: 'hello'; version: number }
  | { type: 'ready'; meta: StageMeta; score: PlayedScore | null; narration: NarrationReport | null; loadMs: number }
  /** The frame asked for with `seq` (and every one before it) is on show. */
  | { type: 'presented'; seq: number; t: PlaySeconds; ok: boolean; ms: number }
  | { type: 'frame'; seq: number; t: FilmSeconds; svg: string; pw: number; ph: number; ms: number }
  /** hold: this frame failed but the next may not. env: the browser's doing (a tab in the background), not the film's. */
  | { type: 'frame-error'; seq: number; hold: boolean; env: boolean; message: string }
  | { type: 'console'; level: ConsoleLevel; text: string }
  | { type: 'error'; phase: ErrorPhase; message: string; stack: string }
  /** The frame is about to navigate away: the film is gone. */
  | { type: 'navigating' }
  | { type: 'texts'; nodes: StageText[] }
  | { type: 'layers'; report: LayersReport }
  /** null: nothing could be told of it (it is not there, the stage is not displayed, or the film's render gives promises). */
  | { type: 'looked'; seq: number; id: string; look: AskedLook | null; lost: string[] }
  /** A person clicked a link on the stage; the frame never follows it, the host decides. */
  | { type: 'link'; href: string };

export type HostToStageType = HostToStage['type'];
export type StageToHostType = StageToHost['type'];
