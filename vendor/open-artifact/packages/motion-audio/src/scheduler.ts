import type { PlaySeconds } from '@open-artifact/motion-core';
import type { MasterBus } from './mixer.ts';
import type { FilmSound } from './offline.ts';
import type { PlayedSound } from './played-score.ts';
import { createScoreSession } from './session.ts';
import type { ScoreSession } from './session.ts';
import { scheduleSound } from './synth/schedule.ts';
import { SCHEDULER_INTERVAL_MS, dueSounds, firstHeard, lookaheadHorizon, passOrigin } from './window.ts';

/** The timer the scheduler looks ahead on; the page's own by default. */
export interface SchedulerTimers {
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
}

const pageTimers: SchedulerTimers = {
  setInterval: (callback, ms) => Number(globalThis.setInterval(callback, ms)),
  clearInterval: (id) => globalThis.clearInterval(id),
};

export interface ScorePassOptions {
  readonly master: MasterBus;
  readonly sound: FilmSound;
  readonly from: PlaySeconds;
  readonly rate: number;
  readonly timers?: SchedulerTimers;
}

/** One stretch of live playback from `from`: sounds are handed to the context a little ahead of the playhead. */
export interface ScorePass {
  readonly session: ScoreSession;
  readonly from: PlaySeconds;
  /** Every sound has been handed over. */
  done(): boolean;
  stop(): void;
}

/** Sounds hold their length in play time; at another rate they are heard over that length divided by the rate. */
function atRate(heard: PlayedSound, rate: number): PlayedSound['sound'] {
  return rate === 1 ? heard.sound : { ...heard.sound, dur: heard.sound.dur / rate };
}

/**
 * Starts playback from `from`: the narration and the duck at once, the score's sounds a lookahead at a time, every
 * scheduler interval. A seek, a pause, a new rate or a new timeline stops the pass and starts another.
 */
export function startScorePass(options: ScorePassOptions): ScorePass {
  const { master, sound, from, rate } = options;
  const timers = options.timers ?? pageTimers;
  const { context } = master;
  const session = createScoreSession(master, {
    master: sound.score.master,
    speech: sound.speech,
    duration: sound.score.duration,
    origin: passOrigin(context.currentTime, from, rate),
    rate,
  });
  session.speak(from);
  const { sounds } = sound.score;
  let index = firstHeard(sounds, from);
  let timer: number | null = null;
  let stopped = false;
  const look = (): void => {
    if (stopped) return;
    const horizon = lookaheadHorizon(context.currentTime, session.origin, rate);
    const { due, next } = dueSounds(sounds, index, from, horizon);
    for (const at of due) {
      const heard = sounds[at];
      scheduleSound(session.bus, heard.patch, atRate(heard, rate), session.contextTime(heard.at));
    }
    index = next;
    if (index >= sounds.length && timer !== null) {
      timers.clearInterval(timer);
      timer = null;
    }
  };
  look();
  if (index < sounds.length) timer = timers.setInterval(look, SCHEDULER_INTERVAL_MS);
  return {
    session,
    from,
    done: () => index >= sounds.length,
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      session.stop();
    },
  };
}
