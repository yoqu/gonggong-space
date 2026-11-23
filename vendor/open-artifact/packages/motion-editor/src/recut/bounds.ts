/** How long a scene may play when set by hand: from half to three times its own length, within the 36000 s (10-hour) cap. Pure. */

import {
  MAX_FILM_SECONDS,
  MAX_SCENE_DURATION_SCALE,
  MIN_SCENE_DURATION_SCALE,
  MIN_SHORT_SCENE_SECONDS,
  SCENE_DURATION_STEP,
  isAllowedRecutDuration,
  snapSceneDuration,
} from '@open-artifact/motion-core';

/** What the bounds need of a part: its own length and its length as played. */
export interface LengthPart {
  key: string | null;
  own: string;
  filmDur: number;
  playDur: number;
}

export interface LengthBounds {
  /** The scene's own length, always allowed (it takes the change back). */
  filmDur: number;
  min: number;
  max: number;
}

/** Lengths within this of the scene's own snap to it, so a drag can land back on it. */
const OWN_LENGTH_PULL = SCENE_DURATION_STEP / 2;

const roundMs = (value: number): number => Math.round(value * 1000) / 1000;

/** The lengths the scene at `index` may play over; `null` when there is no such scene. */
export function sceneLengthBounds(parts: readonly LengthPart[], index: number): LengthBounds | null {
  const part = parts[index];
  if (part === undefined) return null;
  const { filmDur } = part;
  const others = parts.reduce((sum, other, at) => (at === index ? sum : sum + other.playDur), 0);
  // A step snapped toward the inside can still fall a hair outside the rule; one more step brings it in.
  const accepted = (value: number, nudge: number): number => (isAllowedRecutDuration(filmDur, value) ? value : roundMs(value + nudge));
  const shortest = Math.max(filmDur * MIN_SCENE_DURATION_SCALE, Math.min(MIN_SHORT_SCENE_SECONDS, filmDur));
  const longest = Math.min(filmDur * MAX_SCENE_DURATION_SCALE, MAX_FILM_SECONDS - others);
  return {
    filmDur,
    min: Math.min(filmDur, accepted(snapSceneDuration(shortest - 1e-6, Math.ceil), SCENE_DURATION_STEP)),
    max: Math.max(filmDur, accepted(snapSceneDuration(longest + 1e-6, Math.floor), -SCENE_DURATION_STEP)),
  };
}

/** A length snapped to the step and kept within bounds; near the scene's own length, its own length. */
export function clampSceneLength(bounds: LengthBounds, seconds: number): number {
  if (Math.abs(seconds - bounds.filmDur) < OWN_LENGTH_PULL) return bounds.filmDur;
  return Math.min(bounds.max, Math.max(bounds.min, snapSceneDuration(seconds)));
}

/**
 * The length that plays the scene at `speed` times its pace now (2: twice as fast, half as long), or `null` when the
 * bounds leave no such length. Landing near the scene's own length takes the change back.
 */
export function scaledSceneLength(bounds: LengthBounds, playDur: number, speed: number): number | null {
  const wanted = playDur / speed;
  if (Math.abs(wanted - bounds.filmDur) < SCENE_DURATION_STEP / Math.min(1, speed) - 1e-9) return bounds.filmDur === playDur ? null : bounds.filmDur;
  const clamped = clampSceneLength(bounds, wanted);
  return Math.abs(clamped - wanted) < SCENE_DURATION_STEP + 1e-9 && clamped !== playDur ? clamped : null;
}

/** A name for a part that survives the film changing round it: its scene id, else its place and own name. */
export function stableSceneKey(part: Pick<LengthPart, 'key' | 'own'>, index: number): string {
  return part.key ?? `${index} ${part.own}`;
}

/** The part a stable key names now, or -1. */
export function findScene(parts: readonly Pick<LengthPart, 'key' | 'own'>[], key: string): number {
  return parts.findIndex((part, index) => stableSceneKey(part, index) === key);
}

/** Seconds as a field shows them: tenths, without a trailing zero. */
export function roundTenths(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
