import { filmSeconds } from '@open-artifact/motion-core';
import type { FilmSeconds, ScoreEvent } from '@open-artifact/motion-core';
import { resolvePatch } from './presets.ts';
import type { ResolvedPatch } from './presets.ts';

/** A sound's own settings, each within its bounds. `into` turns a whoosh around; `rate` is a boing's wobble per second. */
export interface VoiceSettings {
  pan?: number;
  gain?: number;
  rev?: number;
  detune?: number;
  bright?: number;
  into?: number;
  rate?: number;
}

const SETTING_BOUNDS: Readonly<Record<keyof VoiceSettings, readonly [number, number]>> = {
  pan: [-1, 1],
  gain: [-60, 12],
  rev: [0, 1],
  detune: [-2400, 2400],
  bright: [0, 2],
  into: [0, 1],
  rate: [0.5, 40],
};
const SETTING_KEYS = Object.keys(SETTING_BOUNDS) as (keyof VoiceSettings)[];

/** What a patch needs to sound: its length in seconds as heard, its MIDI pitch and velocity, its settings. */
export interface Sound {
  readonly dur: number;
  readonly midi: number;
  readonly vel: number;
  readonly settings: VoiceSettings;
}

/** A score event made safe to synthesize: its patch resolved, every number within bounds. */
export interface Voice {
  readonly t: FilmSeconds;
  readonly patch: ResolvedPatch;
  readonly sound: Sound;
}

export const MAX_SOUND_SECONDS = 30;

export const midiToFrequency = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
export const velocityToGain = (velocity: number): number => Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.5);
export const decibelsToGain = (decibels: number): number => Math.pow(10, decibels / 20);

export function bounded(input: unknown, fallback: number, least: number, most: number): number {
  return typeof input === 'number' && Number.isFinite(input) ? Math.max(least, Math.min(most, input)) : fallback;
}

export function readVoiceSettings(params: ScoreEvent['params']): VoiceSettings {
  const settings: VoiceSettings = {};
  if (params === undefined || params === null || typeof params !== 'object') return settings;
  const raw: Readonly<Record<string, unknown>> = { ...params };
  for (const key of SETTING_KEYS) {
    const value = raw[key];
    const [least, most] = SETTING_BOUNDS[key];
    if (typeof value === 'number' && Number.isFinite(value)) settings[key] = Math.max(least, Math.min(most, value));
  }
  return settings;
}

/** Null for a drum or effect nobody knows. */
export function voiceOf(event: ScoreEvent): Voice | null {
  const patch = resolvePatch(event.kind, event.patch);
  if (patch === null) return null;
  return {
    t: filmSeconds(bounded(event.t, 0, 0, 1e4)),
    patch,
    sound: {
      dur: bounded(event.dur, 0.25, 0.01, MAX_SOUND_SECONDS),
      midi: Math.round(bounded(event.midi, 60, 0, 127)),
      vel: bounded(event.vel, 64, 1, 127),
      settings: readVoiceSettings(event.params),
    },
  };
}

/** The gain a sound enters the mix at: its velocity on a curve, its patch's level and its own. */
export function voiceGain(sound: Sound, presetGainDb: number): number {
  return velocityToGain(sound.vel) * decibelsToGain(presetGainDb + (sound.settings.gain ?? 0));
}
