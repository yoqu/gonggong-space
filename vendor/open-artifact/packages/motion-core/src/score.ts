import type { FilmSeconds } from './units.ts';

export type ScoreEventKind = 'note' | 'drum' | 'fx';

export const PATCH_NAMES = ['marimba', 'vibes', 'glock', 'ep', 'keys', 'pluck', 'bass', 'pad'] as const;
export type PatchName = (typeof PATCH_NAMES)[number];

export const DRUM_NAMES = ['kick', 'snare', 'clap', 'sidestick', 'hat', 'openhat', 'shaker', 'tamb', 'woodblock', 'cowbell', 'tom', 'crash', 'ride'] as const;
export type DrumName = (typeof DRUM_NAMES)[number];

export const FX_NAMES = ['tick', 'click', 'doubleclick', 'pop', 'ding', 'chime', 'sparkle', 'whoosh', 'revswell', 'roll', 'boing', 'thud'] as const;
export type FxName = (typeof FX_NAMES)[number];

export interface VoiceParameters {
  pan?: number;
  gain?: number;
  rev?: number;
  detune?: number;
  bright?: number;
  /** Whoosh direction: sweeping in (1) or out (0). */
  into?: number;
  /** Boing wobble rate. */
  rate?: number;
}

/** One sound of the score, in film time. `patch` names the patch, drum or effect. */
export interface ScoreEvent {
  t: FilmSeconds;
  dur: number;
  kind: ScoreEventKind;
  patch: string;
  midi: number;
  vel: number;
  params?: VoiceParameters;
}

export interface ScoreMaster {
  gain: number;
  fadeOut: number;
  loudness?: number | null;
}

export interface ScoreTempo {
  bpm: number;
  t0: FilmSeconds;
}

/** What `kit.score(...)` records: plain data the page synthesizes. */
export interface ScoreData {
  events: ScoreEvent[];
  master: ScoreMaster;
  tempo?: ScoreTempo;
}

/** One line of `modules/narration.js`: a take (an audio asset) and its words. */
export interface NarrationLine {
  at: FilmSeconds;
  dur: number;
  text: string;
  audio: string;
}

export interface NarrationData {
  lines: NarrationLine[];
  captions?: false | { style?: string };
  duck?: number;
}
