/** Times as the player shows them. A hair is added before flooring so 2.9999999 shows as 0:03, not 0:02. */

const EPSILON = 1e-6;

const minutesSeconds = (whole: number): string => `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;

/** `m:ss`. */
export function formatPlaybackTime(seconds: number): string {
  const whole = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) + EPSILON));
  return minutesSeconds(whole);
}

/** `m:ss.t`, for stretches shorter than a second apart. */
export function formatTenthsTime(seconds: number): string {
  const tenths = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * 10 + EPSILON));
  return `${minutesSeconds(Math.floor(tenths / 10))}.${tenths % 10}`;
}

/** Seconds cut down to whole hundredths. */
export function floorCentiseconds(seconds: number): number {
  return Math.floor((Number.isFinite(seconds) ? seconds : 0) * 100 + EPSILON) / 100;
}

const frameRate = (fps: number): number => (Number.isFinite(fps) && fps > 0 ? fps : 60);

/** The nearest frame's moment. */
export function snapToFrame(seconds: number, fps: number): number {
  const rate = frameRate(fps);
  return Math.round(seconds * rate) / rate;
}

/** The first frame at or after `seconds`. */
export function ceilToFrame(seconds: number, fps: number): number {
  const rate = frameRate(fps);
  return Math.ceil(seconds * rate - EPSILON) / rate;
}

/** What a screen reader says of the playhead: `3 of 12 seconds, Intro`. */
export function spokenPosition(seconds: number, total: number, chapter: string | null): string {
  const position = `${Math.floor(Math.max(0, seconds) + EPSILON)} of ${Math.floor(Math.max(0, total) + EPSILON)} seconds`;
  return chapter === null || chapter === '' ? position : `${position}, ${chapter}`;
}

/** `0:03 / 0:12`. */
export function formatPosition(seconds: number, total: number): string {
  return `${formatPlaybackTime(seconds)} / ${formatPlaybackTime(total)}`;
}
