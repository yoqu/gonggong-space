import type { PlaySeconds } from '@open-artifact/motion-core';
import { forgetErrors, reportError } from './console.ts';
import type { FilmSeconds } from '@open-artifact/motion-core';
import { RealMessageChannel, filmTime, realNow, setFilmTime } from './determinism.ts';
import { film, filmAt, isThenable, playedDuration } from './film.ts';
import { say } from './port.ts';
import { anyRetouch, apply, isDue, setRecord, tell } from './retouch/retouch.ts';
import { stretchOf } from './stretch.ts';
import type { Stretch } from './stretch.ts';
import { builtStage, stageParts } from './stage.ts';
import { stageSize } from './stage-size.ts';
import { tellTexts } from './texts.ts';
import { syncVideos, videoSeeks } from './video-sync.ts';
import type { VideoMode } from './video-sync.ts';

const RENDER_LIMIT_MS = 10000;
const SETTLE_WAIT_MS = 1000;
/** A paused moment is drawn after this long when no animation frame came: a frame that is hidden or throttled gets none. */
const PAUSED_DRAW_MS = 100;

/** A render promise that never settled: the frame that waits for it fails for good. */
export class RenderStuck extends Error {
  /** A tab in the background, not the film, may be why. */
  inBackground: boolean;
  constructor(message: string, inBackground: boolean) {
    super(message);
    this.inBackground = inBackground;
  }
}

interface Unsettled {
  q: Promise<void>;
  /** A wait has given up on it after its full second. */
  waited: boolean;
  done: boolean;
}

export const renderState = {
  ok: true,
  error: null as unknown,
  /** How many renders have been begun. */
  count: 0,
  warnedAsync: false,
  /** A render of a moment drawn for a look alone (drawOwn) has given a promise in this load. */
  gavePromise: false,
  /** The played moment renderAt drew last. */
  drawnAt: null as PlaySeconds | null,
};
const unsettled: Unsettled[] = [];

/** Every render promise goes through here: the stage may change until it settles. */
function track<T>(promise: Promise<T>): Promise<T> {
  const entry: Unsettled = { q: Promise.resolve(), waited: false, done: false };
  entry.q = promise.then(
    () => undefined,
    () => undefined,
  ).then(() => {
    entry.done = true;
    unsettled.splice(unsettled.indexOf(entry), 1);
  });
  unsettled.push(entry);
  return promise;
}

export const unsettledNow = (): Unsettled[] => unsettled.slice();

/**
 * null: nothing to wait for. Else settles when the pending renders no wait has given up on have settled, or after
 * a second: a render that stays pending costs the waits one second in all, not one each.
 */
export function rendersSettle(): Promise<unknown> | null {
  const now = unsettled.filter((entry) => !entry.waited);
  if (now.length === 0) return null;
  return Promise.race([
    Promise.all(now.map((entry) => entry.q)),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        for (const entry of now) entry.waited = true;
        resolve();
      }, SETTLE_WAIT_MS),
    ),
  ]);
}

/** One turn of the event loop, by a message: a tab in the background slows timers to a second. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, RealMessageChannel ? 100 : 0);
    if (!RealMessageChannel) return;
    try {
      const channel = new RealMessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        clearTimeout(timer);
        resolve();
      };
      channel.port2.postMessage(0);
    } catch {
      // The timer does it.
    }
  });
}

/**
 * One moment of the film's own time, drawn for a look at the stage alone. false: the film threw there. null: a
 * render has given a promise in this load, so nothing more is drawn here: a render for another moment that finished
 * late could draw that moment over the frame on show.
 */
export function drawOwn(T: number): boolean | null {
  const cut = film.cut;
  const kit = film.kit;
  if (!cut || !kit || renderState.gavePromise || renderState.warnedAsync) return null;
  setFilmTime(T as FilmSeconds);
  try {
    const drawn = cut.render(T as FilmSeconds, kit);
    if (!isThenable(drawn)) return true;
    // It may still paint when it settles, so it is waited for like any render's, and the draw that began it is done again (afterSample).
    renderState.gavePromise = true;
    void track(Promise.race([Promise.resolve(drawn), new Promise<void>((resolve) => setTimeout(resolve, RENDER_LIMIT_MS))]));
    return null;
  } catch {
    return false;
  }
}

/**
 * A sample a draw began (drawOwn) that gave a promise paints its own moment when it settles, after that draw. So what
 * relies on the draw waits for it and has its moment drawn again. before: gavePromise ahead of the draw. again:
 * whether the redraw is still wanted then. null: no such sample; else the redraw's own promise, wrapped so it is
 * handed over as it is, or null where it drew at once or was not wanted.
 */
export function afterSample(before: boolean, t: PlaySeconds | (() => PlaySeconds), again?: () => boolean): Promise<{ q: Promise<unknown> | null }> | null {
  if (before || !renderState.gavePromise) return null;
  return Promise.resolve(rendersSettle()).then(() => ({ q: again && !again() ? null : renderAt(typeof t === 'function' ? t() : t) }));
}

/** A fault in laying what a person changed by hand costs their changes, not the film. */
export function unretouched(): void {
  console.warn('What a person changed by hand about how things look (modules/retouched.json) could not be applied: the film is shown without it.');
  try {
    setRecord(null);
  } catch {
    // Nothing is laid.
  }
}

/** The stretch of the frame renderAt drew last; null: nothing is to be laid on it. */
let lastOn: Stretch | null = null;

/** Tells, ahead of the frame itself, what is laid on the entries of its stretch not told yet. */
function tellDue(on: Stretch, duration: number): void {
  const name = on.name;
  if (name === null || !isDue(name, on.lo)) return;
  try {
    tell(
      name,
      on.lo,
      on.hi,
      (s) => drawOwn(on.base + Math.max(on.lo, Math.min(on.hi - 1 / 240, s))),
      (s) => s < duration && drawOwn(Math.max(0, s)),
    );
  } catch {
    unretouched();
  }
}

/** Marks what is laid on the frame drawn last: at once, and again when its promise settles, since the browser may paint between. */
function lay<T>(value: T): T {
  try {
    if (lastOn) apply(lastOn.name, lastOn.lo);
  } catch {
    unretouched();
  }
  return value;
}

/** Draws played moment `t`. Gives back the render's promise, bounded, if it gave one. */
export function renderAt(t: PlaySeconds): Promise<unknown> | null {
  const cut = film.cut;
  const kit = film.kit;
  if (!cut || !kit) return null;
  renderState.count++;
  renderState.drawnAt = t;
  const played = Math.max(0, Math.min(playedDuration(), Number(t) || 0)) as PlaySeconds;
  film.played = played;
  const at = filmAt(played);
  film.rate = at.rate;
  const on = anyRetouch() ? stretchOf(at.T) : null;
  lastOn = on;
  if (on) tellDue(on, cut.duration);
  setFilmTime(at.T);
  const parts = builtStage();
  parts.fxWatch.clear(stageSize.width, stageSize.height);
  videoSeeks.clear();
  const wasOk = renderState.ok;
  renderState.ok = true;
  let drawn: unknown;
  try {
    drawn = cut.render(at.T, kit);
  } catch (error) {
    renderState.ok = false;
    renderState.error = error;
    reportError('render', error);
    return null;
  }
  if (on) lay(undefined);
  film.captions?.draw(played, parts.stage);
  if (!isThenable(drawn)) {
    // Recovered: a later failure is reported afresh.
    if (!wasOk) forgetErrors();
    return null;
  }
  if (!renderState.warnedAsync) {
    renderState.warnedAsync = true;
    console.warn('CUT.render returned a Promise: live playback will not wait for it (only exported frames do). Do async work in init().');
  }
  const bounded = Promise.race([
    Promise.resolve(drawn).then((value) => (on ? lay(value) : value)),
    new Promise<never>((_, fail) =>
      setTimeout(() => {
        const hidden = document.hidden === true;
        fail(new RenderStuck('render(' + at.T.toFixed(3) + ') returned a Promise that did not settle within 10 s' + (hidden ? ' (this tab was in the background)' : ''), hidden));
      }, RENDER_LIMIT_MS),
    ),
  ]).then((value) => {
    if (!wasOk) forgetErrors();
    // The caption of the frame drawn last: a later one may be up by now.
    const now = stageParts();
    if (now) film.captions?.draw(film.played, now.stage);
    return value;
  });
  return track(bounded);
}

export function syncClips(mode: VideoMode, quick: boolean = false): Promise<unknown> | null {
  const cut = film.cut;
  return syncVideos(stageParts()?.stage ?? null, filmTime(), mode, { fps: cut?.fps ?? 60, rate: film.rate, retimed: !!film.clock }, quick);
}

/** The frame pulls, layer readings and look questions take turns on the one stage. */
let turns: Promise<void> = Promise.resolve();
export const busy = { framing: false };
/** The turn under way held the stage, drawing moments of its own. */
let held = false;

/** A turn draws moments of its own: live renders wait until {@link releaseStage}. */
export function holdStage(): void {
  busy.framing = true;
  held = true;
}

export function releaseStage(): void {
  busy.framing = false;
}

export function takeTurn(job: () => Promise<void>): void {
  turns = turns.then(async () => {
    held = false;
    // Nothing may throw out of a turn: every later one would be skipped.
    try {
      await job();
    } catch {
      // The next frame draws it.
    }
    // A live render that came meanwhile skipped the words; the turn has drawn the moment on show again.
    if (held && showsAsked()) tellTexts();
  });
}

interface Asked {
  t: PlaySeconds;
  seq: number;
  playing: boolean;
}
let pending: Asked | null = null;
let asked: Asked | null = null;
let queued = false;
/** The render count of the newest frame said to be presented. */
let presented = 0;
let shownT: PlaySeconds | null = null;

/**
 * The stage shows, still, the moment the page last asked for, with nothing to draw over it: what its words are is
 * worth telling. Not before the page's first render of a load, whose own first frame is at 0.
 */
export const showsAsked = (): boolean => !pending && !busy.framing && !!asked && !asked.playing && renderState.drawnAt === shownT;

/** The moment the page last asked to see, drawn yet or not. */
export const onShow = (): PlaySeconds => pending?.t ?? shownT ?? (0 as PlaySeconds);
export const isPlaying = (): boolean => !!asked && asked.playing;
export const hasPending = (): boolean => pending !== null;
/** A moment a question drew again is the one on show. */
export const setShown = (t: PlaySeconds): void => {
  shownT = t;
};

export function askRender(next: Asked): void {
  pending = next;
  if (!queued) {
    queued = true;
    requestAnimationFrame(flushRender);
  }
  if (!next.playing) setTimeout(flushPaused, PAUSED_DRAW_MS);
}

/** Paused, a moment asked for is drawn without waiting on animation frames that may never come. */
function flushPaused(): void {
  if (pending && !pending.playing) flushRender();
}

/** Draws the moment on show again under the same ask, after a change the film reads, such as the render mode. */
export function redraw(): void {
  const last = pending ?? asked;
  if (last) askRender(last);
}

function flushRender(): void {
  queued = false;
  if (!pending || !film.loaded) return;
  // A frame pull owns the stage until its snapshot is serialized; live renders wait for it.
  if (busy.framing) {
    queued = true;
    requestAnimationFrame(flushRender);
    if (!pending.playing) setTimeout(flushPaused, PAUSED_DRAW_MS);
    return;
  }
  const ask = pending;
  pending = null;
  const began = realNow();
  shownT = ask.t;
  const sampled = renderState.gavePromise;
  const drawn = renderAt(ask.t);
  const count = renderState.count;
  asked = ask;
  // Settled after a newer frame was shown: that one said 'presented', which answers this one's waiters too.
  const done = (ok: boolean): void => {
    if (count < presented) return;
    presented = count;
    const now = pending ?? asked ?? ask;
    if (!busy.framing) void syncClips(now.playing ? 'play' : 'hold');
    say({ type: 'presented', seq: ask.seq, t: ask.t, ok, ms: Math.round((realNow() - began) * 10) / 10 });
    if (!now.playing && !busy.framing) tellTexts();
  };
  const failed = (error: unknown): void => {
    renderState.ok = false;
    renderState.error = error;
    reportError('render', error);
  };
  const finish = (q: Promise<unknown> | null): void => {
    if (!q) {
      done(renderState.ok);
      return;
    }
    q.then(
      () => done(true),
      (error: unknown) => {
        failed(error);
        done(false);
      },
    );
  };
  // 'presented' follows a sample this draw began, and the moment on show drawn again, unless one is still to come or a pull holds the stage.
  const again = afterSample(sampled, onShow, () => !pending && !busy.framing);
  if (!again) {
    finish(drawn);
    return;
  }
  drawn?.then(undefined, failed);
  void again.then((a) => finish(a.q));
}
