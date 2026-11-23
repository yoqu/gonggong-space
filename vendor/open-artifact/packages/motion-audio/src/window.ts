import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';

/** The span a sound is heard over, in play time; sounds come ordered by `start`. */
export interface HeardSpan {
  readonly start: PlaySeconds;
  readonly end: PlaySeconds;
}

/** How far ahead of the playhead sounds are handed to the audio context, in context seconds. */
export const LOOKAHEAD_SECONDS = 1.2;
/** How often the scheduler looks ahead. */
export const SCHEDULER_INTERVAL_MS = 200;
/** A start this far in the future, so the first sounds are not late. */
export const START_DELAY_SECONDS = 0.06;

/** The play time `contextTime` stands for, in a pass that put play time `0` at context time `origin` and plays at `rate`. */
export function playTimeAt(contextTime: number, origin: number, rate: number): PlaySeconds {
  return playSeconds((contextTime - origin) * rate);
}

/** The context time play time `play` sounds at, in that same pass. */
export function contextTimeOf(play: number, origin: number, rate: number): number {
  return origin + play / rate;
}

/** The context origin of a pass that starts playing `from` at `contextNow` + the start delay. */
export function passOrigin(contextNow: number, from: PlaySeconds, rate: number): number {
  return contextNow + START_DELAY_SECONDS - from / rate;
}

/** The play time up to which sounds are due: the playhead plus the lookahead, both as played at `rate`. */
export function lookaheadHorizon(contextNow: number, origin: number, rate: number, lookahead = LOOKAHEAD_SECONDS): PlaySeconds {
  return playSeconds((contextNow - origin + lookahead) * rate);
}

/** The first sound still heard at or after `from`, counting from the start. */
export function firstHeard(spans: readonly HeardSpan[], from: PlaySeconds): number {
  let index = 0;
  while (index < spans.length && spans[index].end <= from) index++;
  return index;
}

/**
 * The sounds due by `horizon`, from `index` on: those that start to be heard by then, less any already over at `from`.
 * `next` is where the next look starts.
 */
export function dueSounds(
  spans: readonly HeardSpan[],
  index: number,
  from: PlaySeconds,
  horizon: PlaySeconds,
): { due: number[]; next: number } {
  const due: number[] = [];
  let next = index;
  while (next < spans.length) {
    const span = spans[next];
    if (span.end <= from) {
      next++;
      continue;
    }
    if (span.start > horizon) break;
    due.push(next);
    next++;
  }
  return { due, next };
}

/** Every sound heard at or after `from`, as an offline render schedules them all at once. */
export function heardFrom(spans: readonly HeardSpan[], from: PlaySeconds): number[] {
  const heard: number[] = [];
  spans.forEach((span, index) => {
    if (span.end > from) heard.push(index);
  });
  return heard;
}
