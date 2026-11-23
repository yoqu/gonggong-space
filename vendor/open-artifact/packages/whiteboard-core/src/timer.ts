/**
 * The shared board timer: one countdown everyone sees, stored whole as the
 * `board/timer` document. Pure functions over {@link TimerFields}; `now` is
 * always passed in (epoch ms) so pages and tests agree on time.
 *
 * States:
 * - **unstarted**: not running, full length left;
 * - **running**: `endsAt` is in the future;
 * - **paused**: not running, part of the length left;
 * - **ended**: `endsAt` passed. It lingers {@link TIMER_DONE_LINGER_MS}
 *   ("Time's up") before it counts as idle again.
 */

import { DEFAULT_TIMER_MS, MAX_TIMER_MS, type BoardContent, type TimerFields } from './schema.ts';
import { normalizeTimerFields } from './normalize.ts';

/** A fresh timer: 5 minutes, not started. */
export const DEFAULT_TIMER: TimerFields = { durationMs: DEFAULT_TIMER_MS, endsAt: null, remainingMs: DEFAULT_TIMER_MS };

/** How long "Time's up" shows after the end before the timer rests. */
export const TIMER_DONE_LINGER_MS = 2400;
/** Shortest length a person can enter. */
export const MIN_TIMER_ENTRY_MS = 1000;
/** Longest length a person can enter (99:59). */
export const MAX_TIMER_ENTRY_MS = 5_999_000;
/** Under this much left, the face shows "soon". */
export const TIMER_SOON_MS = 10_000;

/** What a timer button asks for. */
export type TimerAction = 'start' | 'pause' | 'reset';

/** Time left (a deadline further than {@link MAX_TIMER_MS} away is ignored as bogus). */
export function timerRemainingMs(timer: TimerFields, now: number): number {
  return timer.endsAt !== null && timer.endsAt - now <= MAX_TIMER_MS ? Math.max(0, timer.endsAt - now) : timer.remainingMs;
}

/** True while it counts down. */
export function isTimerRunning(timer: TimerFields, now: number): boolean {
  return timer.endsAt !== null && timer.endsAt > now && timer.endsAt - now <= MAX_TIMER_MS;
}

/** True before the first start (or after a reset). */
export function isTimerUnstarted(timer: TimerFields): boolean {
  return timer.endsAt === null && timer.remainingMs === timer.durationMs;
}

/** True when there is nothing to show: unstarted, or ended a while ago. */
export function isTimerIdle(timer: TimerFields, now: number): boolean {
  return isTimerUnstarted(timer) || (timer.endsAt === null ? timer.remainingMs === 0 : now - timer.endsAt >= TIMER_DONE_LINGER_MS);
}

/** True in the linger after the end ("Time's up"). */
export function isTimerEnded(timer: TimerFields, now: number): boolean {
  return !isTimerIdle(timer, now) && timer.endsAt !== null && timerRemainingMs(timer, now) === 0;
}

/** True when paused part-way. */
export function isTimerPaused(timer: TimerFields, now: number): boolean {
  return !isTimerRunning(timer, now) && !isTimerIdle(timer, now) && !isTimerEnded(timer, now);
}

/** Applies Start / Pause / Reset. */
export function applyTimerAction(timer: TimerFields, action: TimerAction, now: number): TimerFields {
  const remaining = timerRemainingMs(timer, now);
  const runMs = remaining > 0 ? remaining : timer.durationMs;
  if (action === 'start') return { durationMs: timer.durationMs, endsAt: now + runMs, remainingMs: runMs };
  return { durationMs: timer.durationMs, endsAt: null, remainingMs: action === 'pause' ? remaining : timer.durationMs };
}

/** Sets the length (only while not running); rounds to whole seconds within the entry limits. */
export function setTimerDuration(timer: TimerFields, durationMs: number, now: number): TimerFields {
  if (isTimerRunning(timer, now) || !Number.isFinite(durationMs)) return timer;
  const clamped = Math.min(MAX_TIMER_ENTRY_MS, Math.max(MIN_TIMER_ENTRY_MS, Math.round(durationMs / 1000) * 1000));
  return normalizeTimerFields({ durationMs: clamped, endsAt: null, remainingMs: clamped }, now);
}

/** The next whole minute up or down from a length (1–99 minutes), or `undefined` past the ends. */
function nextWholeMinute(ms: number, direction: number): number | undefined {
  const wholeSeconds = Math.floor(ms / 1000) * 1000;
  const next = direction > 0 ? Math.floor(wholeSeconds / 60_000) * 60_000 + 60_000 : Math.min(5_940_000, Math.ceil(wholeSeconds / 60_000) * 60_000 - 60_000);
  return next >= 60_000 && next <= 5_940_000 ? next : undefined;
}

/**
 * One minute more or less. At rest it changes the length (to whole
 * minutes); while running it moves the deadline. `undefined` when the step
 * would leave the allowed range (or the timer is paused).
 */
export function nudgeTimerMinutes(timer: TimerFields, minutes: number, now: number): TimerFields | undefined {
  if (isTimerIdle(timer, now)) {
    const duration = nextWholeMinute(timer.durationMs, minutes);
    return duration === undefined ? undefined : setTimerDuration(timer, duration, now);
  }
  if (!isTimerRunning(timer, now)) return undefined;
  const remaining = timerRemainingMs(timer, now) + minutes * 60_000;
  if (remaining < MIN_TIMER_ENTRY_MS || (minutes > 0 && remaining > MAX_TIMER_ENTRY_MS)) return undefined;
  return { durationMs: timer.durationMs, endsAt: now + remaining, remainingMs: remaining };
}

/** `[mm, ss]` of a length. */
export function timerDigits(ms: number): [string, string] {
  return [String(Math.floor(ms / 60_000)).padStart(2, '0'), String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')];
}

/** The clock face, `mm:ss`. */
export function formatTimerFace(ms: number): string {
  return timerDigits(ms).join(':');
}

/** `[mm, ss]` from typed digits (`undefined`: not a valid length). */
export function digitsToTimerMs([minutes, seconds]: readonly [string, string]): number | undefined {
  const ms = Math.min(99, Number(minutes)) * 60_000 + Math.min(59, Number(seconds)) * 1000;
  return Number.isFinite(ms) && ms >= MIN_TIMER_ENTRY_MS ? ms : undefined;
}

/** A spoken length: "4 minutes 30 seconds". */
export function formatTimerDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return [minutes > 0 ? unit(minutes, 'minute') : '', seconds > 0 || minutes === 0 ? unit(seconds, 'second') : ''].filter(Boolean).join(' ');
}

/** The timer for assistive tech: "Shared timer, 3 minutes, running". */
export function describeTimer(remainingMs: number, running: boolean): string {
  if (running && remainingMs <= 0) return 'Shared timer, time’s up';
  const minutes = Math.ceil(remainingMs / 60_000);
  const left = remainingMs < 60_000 ? 'less than a minute' : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `Shared timer, ${left}, ${running ? 'running' : 'paused'}`;
}

/** The board content with a timer set (or removed with `undefined`). */
export function withTimerContent(content: BoardContent, timer: TimerFields | undefined): BoardContent {
  const { timer: _previous, ...rest } = content;
  return timer === undefined ? rest : { ...rest, timer };
}

/**
 * How long to wait before checking a deadline again: the whole wait, but at
 * most a minute when the deadline is implausibly far (clock skew).
 */
export function deadlineWaitMs(deadline: number, now: number): number {
  if (deadline <= now) return 0;
  return Math.min(deadline - now, deadline - now > MAX_TIMER_MS ? 60_000 : Number.POSITIVE_INFINITY);
}
