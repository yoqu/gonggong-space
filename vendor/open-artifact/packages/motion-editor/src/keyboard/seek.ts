/** Where seeking keys move the playhead. Pure; times are seconds as played. */

export const SEEK_ARROW_SECONDS = 5;
export const SEEK_STEP_SECONDS = 1;
export const SEEK_PAGE_SECONDS = 10;

const clamp = (t: number, total: number): number => Math.min(Math.max(0, t), Math.max(0, total));

export function seekedBy(t: number, delta: number, total: number): number {
  return clamp(t + delta, total);
}

/** The frame `frames` frames on from the one showing `t`. */
export function steppedFrames(t: number, frames: number, fps: number, total: number): number {
  const rate = fps > 0 ? fps : 60;
  return clamp((Math.round(t * rate) + frames) / rate, total);
}

/** The next chapter's start after the moment shown (half a frame of slack), else the end. */
export function nextChapterStart(t: number, chapterStarts: readonly number[], fps: number, total: number): number {
  const half = 0.5 / (fps > 0 ? fps : 60);
  const next = [...chapterStarts].sort((a, b) => a - b).find((start) => start > t + half);
  return next === undefined ? clamp(total, total) : clamp(next, total);
}

/** The start of the chapter before the one the moment is in (half a frame of slack), else the start. */
export function previousChapterStart(t: number, chapterStarts: readonly number[], fps: number): number {
  const half = 0.5 / (fps > 0 ? fps : 60);
  const before = [...chapterStarts].sort((a, b) => b - a).find((start) => start < t - half);
  return before === undefined ? 0 : Math.max(0, before);
}

/** PageUp and PageDown: chapter to chapter, or ten seconds in a film without chapters. */
export function pageSeek(t: number, direction: 1 | -1, chapterStarts: readonly number[], fps: number, total: number): number {
  if (chapterStarts.length === 0) return seekedBy(t, direction * SEEK_PAGE_SECONDS, total);
  return direction === 1 ? nextChapterStart(t, chapterStarts, fps, total) : previousChapterStart(t, chapterStarts, fps);
}
