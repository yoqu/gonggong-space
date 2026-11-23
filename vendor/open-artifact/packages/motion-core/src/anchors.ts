import type { FilmClock } from './clock.ts';
import { filmSeconds, playSeconds, type FilmSeconds, type PlaySeconds } from './units.ts';

/** Where a comment points on the film; its times are the film's own seconds. */
export type CommentAnchor =
  | {
      kind: 'point';
      t: FilmSeconds;
      /** Fractions of the frame, from its top-left corner. */
      x: number;
      y: number;
      /** A box's size, as fractions of the frame. */
      box?: { w: number; h: number };
    }
  | { kind: 'range'; from: FilmSeconds; to: FilmSeconds };

/** What an anchor needs of the clock; `null` when the film plays at its own lengths. */
export type AnchorClock = Pick<FilmClock, 'toFilm' | 'toPlay'> | null;

export const ANCHOR_ROOT = 'animation-v1:nth-of-type(1)';
export const ANCHOR_SEPARATOR = ' > ';
export const MAX_ANCHOR_PATH_CHARS = 1024;
export const MIN_ANCHOR_SEGMENTS = 3;
export const MAX_ANCHOR_SEGMENTS = 10;
/** The shortest stretch a range comment may cover, both as played and in the film. */
export const MIN_RANGE_ANCHOR_MS = 200;
const MAX_ANCHOR_MS = 999_999_999;

const SEGMENT_PATTERN = /^[a-z][a-z0-9-]{0,23}:nth-of-type\([1-9][0-9]{0,3}\)$/;
const AT_PATTERN = /^at-(\d{1,9})ms:nth-of-type\(1\)$/;
const TO_PATTERN = /^to-(\d{1,9})ms:nth-of-type\(1\)$/;
const XY_PATTERN = /^x(\d{4})-y(\d{4}):nth-of-type\(1\)$/;
const WH_PATTERN = /^w(\d{4})-h(\d{4}):nth-of-type\(1\)$/;

const anchorMs = (seconds: number): number => Math.min(MAX_ANCHOR_MS, Math.max(0, Math.round(seconds * 1000)));
const unitFraction = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);
const fourDigits = (fraction: number): string => String(Math.min(9999, Math.round(unitFraction(fraction) * 1e4))).padStart(4, '0');

/** The anchor as the comment stores it: `animation-v1:nth-of-type(1) > at-12400ms:nth-of-type(1) > x0500-y0250:…`. */
export function encodeAnimationAnchor(anchor: CommentAnchor): string {
  const segments = [ANCHOR_ROOT];
  switch (anchor.kind) {
    case 'point': {
      const x = unitFraction(anchor.x);
      const y = unitFraction(anchor.y);
      segments.push(`at-${anchorMs(anchor.t)}ms:nth-of-type(1)`, `x${fourDigits(x)}-y${fourDigits(y)}:nth-of-type(1)`);
      if (anchor.box !== undefined)
        segments.push(`w${fourDigits(Math.min(unitFraction(anchor.box.w), 1 - x))}-h${fourDigits(Math.min(unitFraction(anchor.box.h), 1 - y))}:nth-of-type(1)`);
      break;
    }
    case 'range':
      segments.push(`at-${anchorMs(anchor.from)}ms:nth-of-type(1)`, `to-${anchorMs(anchor.to)}ms:nth-of-type(1)`);
      break;
    default: {
      const never: never = anchor;
      return never;
    }
  }
  return segments.join(ANCHOR_SEPARATOR);
}

/** The anchor a comment stores, or `null` when the path is not one of an animation. */
export function decodeAnimationAnchor(path: unknown): CommentAnchor | null {
  if (typeof path !== 'string' || path.length > MAX_ANCHOR_PATH_CHARS) return null;
  const segments = path.split(ANCHOR_SEPARATOR);
  if (segments.length < MIN_ANCHOR_SEGMENTS || segments.length > MAX_ANCHOR_SEGMENTS) return null;
  if (!segments.every((segment) => SEGMENT_PATTERN.test(segment)) || segments[0] !== ANCHOR_ROOT) return null;
  const at = AT_PATTERN.exec(segments[1]!);
  if (at === null) return null;
  const t = filmSeconds(Number(at[1]) / 1000);
  const to = TO_PATTERN.exec(segments[2]!);
  if (to !== null) return { kind: 'range', from: t, to: filmSeconds(Number(to[1]) / 1000) };
  const xy = XY_PATTERN.exec(segments[2]!);
  if (xy === null) return null;
  const x = Number(xy[1]) / 1e4;
  const y = Number(xy[2]) / 1e4;
  const wh = segments[3] === undefined ? null : WH_PATTERN.exec(segments[3]);
  return { kind: 'point', t, x, y, ...(wh !== null ? { box: { w: Number(wh[1]) / 1e4, h: Number(wh[2]) / 1e4 } } : {}) };
}

/** A moment as played, as the film's own second that a comment stores (rounded up to the millisecond). */
export function toFilmAnchorTime(clock: AnchorClock, t: PlaySeconds): FilmSeconds {
  if (clock === null) return filmSeconds(t);
  const film = clock.toFilm(t);
  return Math.abs(film - t) < 1e-6 ? filmSeconds(t) : filmSeconds(Math.ceil(film * 1000 - 1e-6) / 1000);
}

/** A comment's stored second as played now. */
export function toPlaybackAnchorTime(clock: AnchorClock, t: FilmSeconds): PlaySeconds {
  if (clock === null) return playSeconds(t);
  const played = clock.toPlay(t);
  return Math.abs(played - t) < 1e-6 ? playSeconds(t) : played;
}

/** A point (or box) comment at that second of the film. */
export function makePointCommentAnchor(t: FilmSeconds, point: { x?: number; y?: number; w?: number; h?: number } = {}): CommentAnchor {
  const x = unitFraction(point.x ?? 0.5);
  const y = unitFraction(point.y ?? 0.5);
  const box = point.w !== undefined && point.h !== undefined ? { w: Math.min(unitFraction(point.w), 1 - x), h: Math.min(unitFraction(point.h), 1 - y) } : undefined;
  return { kind: 'point', t: filmSeconds(Math.round(Math.max(0, t) * 1000) / 1000), x, y, ...(box !== undefined ? { box } : {}) };
}

/** A range comment over a stretch as played, or `null` when it is shorter than 0.2 s as played or in the film. */
export function makeRangeCommentAnchor(from: PlaySeconds, to: PlaySeconds, clock: AnchorClock): CommentAnchor | null {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const playA = anchorMs(a);
  const playB = anchorMs(b);
  const filmA = anchorMs(toFilmAnchorTime(clock, a));
  const filmB = anchorMs(toFilmAnchorTime(clock, b));
  if (playB - playA < MIN_RANGE_ANCHOR_MS || filmB - filmA < MIN_RANGE_ANCHOR_MS) return null;
  return { kind: 'range', from: filmSeconds(filmA / 1000), to: filmSeconds(filmB / 1000) };
}

/** `m:ss` of whole seconds. */
export function formatWholeMinutesSeconds(seconds: number): string {
  const whole = Math.floor(seconds + 1e-6);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const formatMs = (ms: number): string => formatWholeMinutesSeconds(Math.floor(ms / 1000));
const formatTenths = (ms: number): string => `${formatMs(ms)}.${Math.floor(ms / 100) % 10}`;
const percent = (fraction: number): string => `${Math.round(fraction * 1e4) / 100}%`;
const sameAsPlayed = (played: number, film: number): boolean => Math.round(played * 100) === Math.round(film * 100);
const playedSeconds = (played: number): string => `${Math.round(played * 100) / 100} s`;
/** Said after film seconds that differ from those played. */
export const asPlayed = (played: string): string =>
  ` in the film’s own seconds (the ones its code counts; ${played} as played when this was written, see modules/recut.json)`;

/** What the agent is told of where a comment points: `Location: <label>`, `Anchor detail: <detail>`. */
export function describeAnimationAnchor(anchor: CommentAnchor, clock: AnchorClock = null): { label: string; detail: string } {
  switch (anchor.kind) {
    case 'point': {
      const played = toPlaybackAnchorTime(clock, anchor.t);
      const where =
        anchor.box !== undefined
          ? `a box with its top-left corner at x ${percent(anchor.x)} y ${percent(anchor.y)} of the frame, ${percent(anchor.box.w)} wide and ${percent(anchor.box.h)} tall`
          : `the point at x ${percent(anchor.x)} y ${percent(anchor.y)} of the frame`;
      return {
        label: formatMs(anchorMs(played)),
        detail: `at ${anchorMs(anchor.t) / 1000} s${sameAsPlayed(played, anchor.t) ? '' : asPlayed(playedSeconds(played))}, ${where}`,
      };
    }
    case 'range': {
      const playedFrom = toPlaybackAnchorTime(clock, anchor.from);
      const playedTo = toPlaybackAnchorTime(clock, anchor.to);
      const a = anchorMs(playedFrom);
      const b = anchorMs(playedTo);
      const format = formatMs(a) === formatMs(b) ? formatTenths : formatMs;
      const same = sameAsPlayed(playedFrom, anchor.from) && sameAsPlayed(playedTo, anchor.to);
      return {
        label: `${format(a)} to ${format(b)}`,
        detail: `from ${anchorMs(anchor.from) / 1000} s to ${anchorMs(anchor.to) / 1000} s${
          same ? ' of the film' : asPlayed(`${playedSeconds(playedFrom)} to ${playedSeconds(playedTo)}`)
        }`,
      };
    }
    default: {
      const never: never = anchor;
      return never;
    }
  }
}

/** The short position shown on a comment's marker: `0:12 · x 50% y 25%`, `0:12–0:15`. */
export function describeAnchorPosition(anchor: CommentAnchor, clock: AnchorClock = null): string {
  switch (anchor.kind) {
    case 'point': {
      const at = formatMs(anchorMs(toPlaybackAnchorTime(clock, anchor.t)));
      const box = anchor.box !== undefined ? ` · ${percent(anchor.box.w)}×${percent(anchor.box.h)}` : '';
      return `${at} · x ${percent(anchor.x)} y ${percent(anchor.y)}${box}`;
    }
    case 'range':
      return `${formatMs(anchorMs(toPlaybackAnchorTime(clock, anchor.from)))}–${formatMs(anchorMs(toPlaybackAnchorTime(clock, anchor.to)))}`;
    default: {
      const never: never = anchor;
      return never;
    }
  }
}

/** The second as played that a comment's anchor opens the film at. */
export function anchorPlayTime(anchor: CommentAnchor, clock: AnchorClock = null): PlaySeconds {
  return toPlaybackAnchorTime(clock, anchor.kind === 'point' ? anchor.t : anchor.from);
}
