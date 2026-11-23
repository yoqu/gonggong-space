import type { FilmSeconds } from '@open-artifact/motion-core';
import { frameSeed, rng } from './kit/random.ts';

/*
 * The film clock is the only clock the film can read, and its randomness starts afresh at every moment drawn: a
 * frame follows from t alone. What the stage itself needs of the real clock and of the browser is taken here, at
 * startup, before any film code can replace it.
 */
export const realNow: () => number = performance.now.bind(performance);
export const wallNow: () => number = Date.now.bind(Date);
export const RealMutationObserver: typeof MutationObserver = MutationObserver;
export const RealMessageChannel: typeof MessageChannel | null = typeof MessageChannel === 'function' ? MessageChannel : null;

/** What `new Date()` says at film time 0. */
export const FILM_EPOCH_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

let filmT = 0 as FilmSeconds;
let random = rng(frameSeed(0));

export const filmTime = (): FilmSeconds => filmT;

export function setFilmTime(t: FilmSeconds): void {
  filmT = t;
  random = rng(frameSeed(t * 1000));
}

/** Math.random starts afresh from `seed` (a scene's own seed, at its own moment). */
export function reseed(seed: number): void {
  random = rng(seed);
}

/** Zero-argument `Date()`, `new Date()` and `Date.now()` read the film clock; an explicit date passes through. */
function installFilmDate(): void {
  const RealDate = Date;
  const at = (): number => FILM_EPOCH_MS + Math.round(filmT * 1000);
  function FilmDate(...args: unknown[]): Date | string {
    const given = args.length === 0 ? [at()] : args;
    if (new.target === undefined) return (Reflect.construct(RealDate, given) as Date).toString();
    return Reflect.construct(RealDate, given, new.target) as Date;
  }
  Object.defineProperty(FilmDate, 'prototype', { value: RealDate.prototype });
  Object.assign(FilmDate, { UTC: RealDate.UTC, parse: RealDate.parse, now: at });
  Reflect.set(window, 'Date', FilmDate);
}

export function installFilmClock(): void {
  installFilmDate();
  try {
    Reflect.set(performance, 'now', () => filmT * 1000);
  } catch {
    // Not writable here: left as it is.
  }
  Math.random = (): number => random();
}
