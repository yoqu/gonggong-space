/**
 * What a flash check of a scene comes to, and the rules around it. A scene shortened plays faster, so flashes that
 * were slow enough at its own pace may come too fast; the check finds the least share of its own length the scene
 * may play over. Pure.
 */

import { RECUT_MODULE, playSeconds, type FilmModule, type PlaySeconds } from '@open-artifact/motion-core';

/**
 * How a check ended: the least share of its length the scene may play over (0 any, 1 none); `long`, a scene too long
 * to check, which any length suits; or why it gave no answer (`late` out of time, `unseen` no frame came, `faulty` a
 * frame could not be read, `torn` the stage failed or the check was called off).
 */
export type FlashOutcome = number | 'long' | 'late' | 'unseen' | 'faulty' | 'torn';

/**
 * `too-fast`: shorter than `minimum` could flash too fast. `unchecked`: the check gave no answer, so the scene may not
 * be shorter than the share of its length allowed unchecked scenes. `unknown`: there is no such scene to check.
 */
export type FlashVerdict =
  | { kind: 'safe' }
  | { kind: 'too-fast'; minimum: PlaySeconds }
  | { kind: 'unchecked'; minimum: PlaySeconds }
  | { kind: 'unknown' };

export interface FlashEntry {
  outcome: FlashOutcome;
  tries: number;
}

/** A scene no longer than this (seconds) is not checked: too short to hold three flashes worth a limit. */
export const MIN_SHORT_SCENE_SECONDS = 1;
/** Tries a scene gets before a check that gives no answer is taken as final. */
export const MAX_TRIES = 2;
/** The second try asks for frames this much more slowly, and waits this much longer. */
export const SLOW_RETRY_FACTOR = 1.5;
/** Checks kept, the oldest let go first. */
export const MAX_KEPT_CHECKS = 400;
/** Each second of film checked may take this long before the check is out of time (ms). */
export const MS_PER_SAMPLED_SECOND = 3000;

/** A check that will not change if asked again. */
export const isFinished = (entry: FlashEntry | undefined): boolean =>
  entry !== undefined && (typeof entry.outcome === 'number' || entry.outcome === 'long' || entry.tries >= MAX_TRIES);

/** How long a scene `nat` seconds long (with `padding` seconds of film each side) may take to check (ms). */
export const checkBudgetMs = (nat: number, padding: number, waitMs: number): number => Math.max(waitMs, MS_PER_SAMPLED_SECOND * (nat + 2 * padding));

/** A short, stable hash of text (53 bits, as hex). */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export interface FlashFilm {
  script: string;
  modules: readonly Pick<FilmModule, 'name' | 'kind' | 'text'>[];
  assets: readonly { name: string; ref: string }[];
}

/** What the film draws, its recut aside: lengths set by hand change how fast a scene plays, never what it shows. */
export function flashSignature(film: FlashFilm): string {
  const modules = film.modules.filter((module) => module.name !== RECUT_MODULE).map((module) => `${module.name}\u0000${module.kind}\u0000${module.text}`);
  const assets = film.assets.map((asset) => `${asset.name}=${asset.ref}`);
  return hashText([film.script, modules.join('\u0001'), assets.join('\u0001')].join('\u0002'));
}

/** A scene of a film, on the film's own clock (seconds). */
export interface FlashScene {
  start: number;
  nat: number;
}

export const flashCacheKey = (signature: string, scene: FlashScene): string => `${signature} ${scene.start}+${scene.nat}`;

/** The least share of its length a scene may play over, from its check; `null`: any. */
export function leastScale(outcome: FlashOutcome, uncheckedScale: number): number | null {
  if (typeof outcome === 'number') return outcome;
  switch (outcome) {
    case 'long':
      return null;
    case 'late':
    case 'unseen':
    case 'faulty':
    case 'torn':
      return uncheckedScale;
  }
}

/** Whether a scene `nat` seconds long may play over `playDur` without a check at all. */
export const needsNoCheck = (nat: number, playDur: number): boolean => nat <= MIN_SHORT_SCENE_SECONDS || playDur >= nat - 1e-6;

/** The verdict on playing a scene `nat` seconds long over `playDur`, given its check. */
export function flashVerdict(input: { outcome: FlashOutcome; nat: number; playDur: number; uncheckedScale: number }): FlashVerdict {
  const { outcome, nat, playDur } = input;
  if (needsNoCheck(nat, playDur)) return { kind: 'safe' };
  const scale = leastScale(outcome, input.uncheckedScale);
  if (scale === null || !(scale > 0)) return { kind: 'safe' };
  const minimum = Math.ceil(Math.min(1, scale) * nat * 100 - 1e-6) / 100;
  if (playDur >= minimum - 1e-6) return { kind: 'safe' };
  return { kind: typeof outcome === 'number' ? 'too-fast' : 'unchecked', minimum: playSeconds(minimum) };
}
