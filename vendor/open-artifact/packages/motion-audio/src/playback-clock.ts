import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';
import { playTimeAt } from './window.ts';

/** Milliseconds that stand still while the page is hidden, so a film does not jump ahead when it comes back. */
export interface VisibleClock {
  now(): number;
  /** How many times the page came back into view. */
  returns(): number;
  dispose(): void;
}

export function createVisibleClock(): VisibleClock {
  if (typeof document === 'undefined') return { now: () => performance.now(), returns: () => 0, dispose: () => undefined };
  let hiddenFor = 0;
  let returns = 0;
  let hiddenSince: number | null = document.hidden ? performance.now() : null;
  const update = (): void => {
    if (document.hidden) hiddenSince ??= performance.now();
    else if (hiddenSince !== null) {
      hiddenFor += performance.now() - hiddenSince;
      hiddenSince = null;
      returns++;
    }
  };
  document.addEventListener('visibilitychange', update);
  return {
    now: () => (hiddenSince ?? performance.now()) - hiddenFor,
    returns: () => returns,
    dispose() {
      document.removeEventListener('visibilitychange', update);
      if (hiddenSince !== null) hiddenFor += performance.now() - hiddenSince;
      hiddenSince = null;
    },
  };
}

/** Where the playhead is while playing. */
export interface PlaybackTimeSource {
  now(): PlaySeconds;
  /** True when the system cut audible sound off (a call on a phone): the player should pause. */
  interrupted(): boolean;
}

/** Play time from the visible clock alone, for a page without audio. */
export function wallClockSource(from: PlaySeconds, rate: number, clock: VisibleClock): PlaybackTimeSource {
  const startedAt = clock.now();
  return {
    now: () => playSeconds(from + ((clock.now() - startedAt) / 1000) * rate),
    interrupted: () => false,
  };
}

/** Audio that has not moved for this long is taken as stalled, and the picture runs on the visible clock. */
export const STALL_SECONDS = 0.3;

export interface AudioClockOptions {
  readonly context: BaseAudioContext;
  readonly clock: VisibleClock;
  readonly from: PlaySeconds;
  readonly rate: number;
  /** The context time play time 0 stands at in the current pass; it moves when the pass is restarted after a stall. */
  origin(): number;
  /** Whether sound would be heard now (playing, not muted, something to hear). */
  audible(): boolean;
  /** Audio stalled: the pass should stop until it moves again. */
  onStall(): void;
  /** Audio moves again: the pass should restart from `at`. */
  onResume(at: PlaySeconds): void;
}

/**
 * Play time read from the audio context, so picture and sound stay together. When the context stops moving (a hidden
 * tab, a suspended device), time runs on the visible clock instead, and the sound restarts where the picture is once
 * the context moves again. Time never runs backwards.
 */
export function audioClockSource(options: AudioClockOptions): PlaybackTimeSource {
  const { context, clock, from, rate } = options;
  const startedAt = clock.now();
  let lastAudioTime = context.currentTime;
  let lastMovedAt = 0;
  let stalled = false;
  let everMoved = false;
  let audibleStall = false;
  let seenReturns = clock.returns();
  let position = 0;
  let stallBase = 0;
  let stallWall = 0;
  return {
    now() {
      const wall = (clock.now() - startedAt) / 1000;
      const moved = context.currentTime - lastAudioTime > 0.001;
      if (moved) {
        everMoved = true;
        lastAudioTime = context.currentTime;
      }
      const suspended = everMoved && context.state === 'suspended';
      if (moved || suspended || seenReturns !== clock.returns()) lastMovedAt = wall;
      seenReturns = clock.returns();
      if (!stalled && wall - lastMovedAt > STALL_SECONDS) {
        stalled = true;
        audibleStall = everMoved && options.audible();
        stallBase = position;
        stallWall = wall;
        options.onStall();
      } else if (stalled && moved) {
        stalled = false;
        audibleStall = false;
        options.onResume(playSeconds(from + position));
      }
      const elapsed = stalled
        ? stallBase + (wall - stallWall) * rate
        : Math.max(0, playTimeAt(context.currentTime, options.origin(), rate) - from);
      if (elapsed > position) position = elapsed;
      return playSeconds(from + position);
    },
    interrupted: () => audibleStall && String(context.state) === 'interrupted',
  };
}
