import type { FilmSeconds } from '@open-artifact/motion-core';

/** What `kit.seek(video, s)` asked a clip to show in this render, instead of film time less its start. */
export const videoSeeks = new Map<HTMLVideoElement, number>();
const watched = new WeakSet<HTMLVideoElement>();
const warned = new WeakMap<HTMLVideoElement, Set<string>>();
const slow = new WeakSet<HTMLVideoElement>();

export function warnOnce(video: HTMLVideoElement, key: string, message: string): void {
  const said = warned.get(video) ?? new Set<string>();
  warned.set(video, said);
  if (said.has(key)) return;
  said.add(key);
  console.warn('video ' + (video.id ? '#' + video.id + ' ' : '') + message);
}

/**
 * The clip's own second at film time `t`, looped or held at its end once its duration is known.
 * Half a millisecond on, so a frame boundary reached through float arithmetic lands on that frame.
 */
export function videoTime(video: HTMLVideoElement, t: FilmSeconds): { at: number; live: boolean; explicit: boolean } {
  const explicit = videoSeeks.has(video);
  let at = explicit ? (videoSeeks.get(video) ?? 0) : t - (Number(video.getAttribute('data-start')) || 0);
  const duration = video.duration;
  let live = at >= 0;
  if (duration > 0 && isFinite(duration)) {
    if (video.loop) {
      if (at >= 0) at = at % duration;
    } else {
      live = live && at < duration;
      at = Math.min(at, duration - 0.001);
    }
  }
  return { at: Math.max(0, at) + 0.0005, live, explicit };
}

export function watchVideo(video: HTMLVideoElement): void {
  if (watched.has(video)) return;
  watched.add(video);
  video.playsInline = true;
  video.autoplay = false;
  const failed = (): void => {
    console.error(
      'video ' +
        (video.id ? '#' + video.id + ' ' : '') +
        'did not load (' +
        (video.error ? 'code ' + video.error.code : 'no source') +
        '): use an uploaded .mp4/.webm asset, a data: or a blob: URL',
    );
  };
  video.addEventListener('error', failed);
  if (video.error) failed();
}

/**
 * Resolves once the clip shows the frame it was sought to, or failed. A clip that misses the deadline is warned
 * about once and afterwards waited on only briefly. quick: wait 250 ms at most, and leave its slow mark alone.
 */
function settled(video: HTMLVideoElement, quick: boolean): Promise<void> | null {
  if ((!video.currentSrc && !video.src) || video.error || (!video.seeking && video.readyState >= 2)) return null;
  const ms = quick || slow.has(video) ? 250 : 4000;
  const events = ['seeked', 'loadeddata', 'error'];
  return new Promise<void>((resolve) => {
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, check);
      if (!quick) {
        if (ok) slow.delete(video);
        else {
          slow.add(video);
          warnOnce(video, 'slow', 'did not reach its frame within ' + ms + ' ms; exported frames may show a stale picture of it');
        }
      }
      resolve();
    };
    const check = (): void => {
      if (video.error || (!video.seeking && video.readyState >= 2)) done(true);
    };
    const timer = setTimeout(() => done(false), ms);
    for (const name of events) video.addEventListener(name, check);
  });
}

export type VideoMode = 'play' | 'hold' | 'frame';

export interface VideoClock {
  fps: number;
  /** Film seconds per played second at this moment; clips play at it while the scenes are retimed. */
  rate: number;
  retimed: boolean;
}

/**
 * play: clips play along, corrected when they drift; hold: paused on their frame; frame: an exported frame,
 * with a promise that settles once every clip shows its own.
 */
export function syncVideos(stage: HTMLElement | null, t: FilmSeconds, mode: VideoMode, clock: VideoClock, quick: boolean = false): Promise<unknown> | null {
  if (!stage) return null;
  const waits: Array<Promise<void>> = [];
  const eps = 0.5 / (clock.fps || 60);
  for (const video of stage.querySelectorAll('video')) {
    const wait = syncVideo(video, t, mode, eps, clock, quick);
    if (wait) waits.push(wait);
  }
  return waits.length ? Promise.all(waits) : null;
}

function syncVideo(video: HTMLVideoElement, t: FilmSeconds, mode: VideoMode, eps: number, clock: VideoClock, quick: boolean): Promise<void> | null {
  watchVideo(video);
  video.muted = true;
  if (video.error) return null;
  const time = videoTime(video, t);
  if (mode === 'play' && time.live && !time.explicit) {
    if (clock.retimed && Math.abs(video.playbackRate - clock.rate) > 1e-4) video.playbackRate = clock.rate;
    if ((video.paused || (!video.seeking && video.readyState >= 3)) && Math.abs(video.currentTime - time.at) > 0.25) video.currentTime = time.at;
    if (video.paused) {
      video.play().catch((error: unknown) => {
        const name = error instanceof Error ? error.name : String(error);
        if (name !== 'AbortError') warnOnce(video, 'play', 'could not play: ' + name);
      });
    }
    return null;
  }
  if (!video.paused) video.pause();
  if (Math.abs(video.currentTime - time.at) > eps) video.currentTime = time.at;
  return mode === 'frame' ? settled(video, quick) : null;
}
