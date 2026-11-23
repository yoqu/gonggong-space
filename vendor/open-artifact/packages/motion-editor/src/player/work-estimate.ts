/**
 * How long the agent's work on the scenes may still take: a usual range until a scene has come in while the page
 * watched, then minutes left from the scenes' own pace, and "late" once a scene takes far longer than it should.
 * Pure: the working bar feeds it the scene count and the time.
 */

import { TIME_LEFT_SETTINGS } from '@open-artifact/motion-core';

export type WorkWhat = 'making' | 'finalizing';

/** The scenes the agent is on: making them or finalizing them, `toCome` still to do, of `of`. */
export interface WorkCount {
  what: WorkWhat;
  toCome: number;
  of: number;
}

export interface WorkEstimate {
  work: WorkCount;
  /** When this work began (ms), and when the scene now under way began. */
  began: number;
  mark: number;
  /** Seconds the scenes timed so far took, and how many. */
  spent: number;
  timed: number;
}

export type WorkSettings = typeof TIME_LEFT_SETTINGS;

/** The next estimate: a new one when the work changed or more is to come, the pace updated when a scene came in. */
export function advanceEstimate(previous: WorkEstimate | null, work: WorkCount | null, now: number): WorkEstimate | null {
  if (work === null) return null;
  if (previous === null || previous.work.what !== work.what || previous.work.of !== work.of || work.toCome > previous.work.toCome) {
    return { work, began: previous !== null && previous.work.what === work.what ? previous.began : now, mark: now, spent: 0, timed: 0 };
  }
  if (work.toCome === previous.work.toCome) return previous;
  const done = previous.work.toCome - work.toCome;
  return { work, began: previous.began, mark: now, spent: previous.spent + Math.max(0, now - previous.mark) / 1000, timed: previous.timed + done };
}

/** The estimate with `ms` left out of its clock: the time the agent waited on the person's answer. */
export function pauseEstimate(estimate: WorkEstimate | null, ms: number): WorkEstimate | null {
  return estimate === null || ms <= 0 ? estimate : { ...estimate, began: estimate.began + ms, mark: estimate.mark + ms };
}

const averageScene = (estimate: WorkEstimate, settings: WorkSettings): number =>
  (settings[estimate.work.what].sceneS + estimate.spent) / (1 + estimate.timed);

const currentBudget = (estimate: WorkEstimate, settings: WorkSettings): number =>
  estimate.work.toCome > 0 ? averageScene(estimate, settings) : settings[estimate.work.what].finishS;

/** Whole minutes; under 45 seconds is 0 ("Finishing up"). */
export const roundEtaMinutes = (seconds: number): number => (seconds < 45 ? 0 : Math.round(seconds / 60));

/** The minutes range a first estimate gives, before any scene came in. */
export function usualRange(estimate: WorkEstimate, now: number, settings: WorkSettings = TIME_LEFT_SETTINGS): [number, number] {
  if (estimate.work.what === 'finalizing') return [settings.finalizing.usualFromMin, settings.finalizing.usualToMin];
  const spent = Math.max(0, now - estimate.began) / 1000;
  const { making } = settings;
  const [from, to] = [making.firstFromS, making.firstToS].map((first) =>
    Math.max(1, Math.round((Math.max(0, first - spent) + Math.max(0, estimate.work.toCome - 1) * making.sceneS + making.finishS) / 60)),
  );
  return [from!, to!];
}

/** What the bar says of the time left. */
export type TimeLeft = { kind: 'usual'; range: [number, number] } | { kind: 'left'; minutes: number } | { kind: 'late' };

export function timeLeft(estimate: WorkEstimate, now: number, settings: WorkSettings = TIME_LEFT_SETTINGS): TimeLeft {
  const elapsed = Math.max(0, now - estimate.mark) / 1000;
  const budget = currentBudget(estimate, settings);
  if (elapsed > Math.max(budget * settings.lateTimes, settings.lateS) && estimate.timed > 0) return { kind: 'late' };
  if (estimate.timed === 0) {
    const past =
      estimate.work.what === 'making' ? now - estimate.began > settings.making.firstToS * 1000 : elapsed > settings.finalizing.usualToMin * 60;
    return past && elapsed > settings.lateS ? { kind: 'late' } : { kind: 'usual', range: usualRange(estimate, now, settings) };
  }
  const tail = estimate.work.toCome > 0 ? (estimate.work.toCome - 1) * averageScene(estimate, settings) + settings[estimate.work.what].finishS : 0;
  return { kind: 'left', minutes: roundEtaMinutes(Math.max(0, budget - elapsed) + tail) };
}

export function timeLeftWords(left: TimeLeft): string {
  switch (left.kind) {
    case 'usual': {
      const [from, to] = left.range;
      return from === to ? `usually about ${to} min` : `usually ${from} to ${to} min`;
    }
    case 'left':
      return left.minutes === 0 ? 'Finishing up' : `about ${left.minutes} min left`;
    case 'late':
      return 'Taking longer than usual';
    default: {
      const never: never = left;
      return never;
    }
  }
}
