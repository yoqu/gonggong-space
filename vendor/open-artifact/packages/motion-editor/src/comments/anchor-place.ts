/**
 * Where comments sit on the film. A thread's anchor is a moment and a point (or box) of the frame, or a stretch of
 * the timeline; times in anchors are the film's own seconds, and are shown as played through the clock. Pure.
 */

import {
  anchorPlayTime,
  makePointCommentAnchor,
  playSeconds,
  toFilmAnchorTime,
  toPlaybackAnchorTime,
  type AnchorClock,
  type CommentAnchor,
  type FilmSeconds,
} from '@open-artifact/motion-core';
import type { Camera, Point } from '@open-artifact/editor-kit';
import type { PlayerBox } from '../stores/ui.ts';

/** A comment's anchor; `film` is the whole animation (a thread whose anchor did not read). */
export type VideoAnchor = CommentAnchor | { kind: 'film' };

export const FILM_ANCHOR: VideoAnchor = { kind: 'film' };

/** A point comment's pin shows this long either side of its moment. */
export const PIN_WINDOW_SECONDS = 0.5;
/** A dragged box smaller than this (each way, as a fraction of the frame) is a click. */
export const MIN_BOX_FRACTION = 0.01;

export interface FilmSize {
  width: number;
  height: number;
}

/** The camera that maps film pixels onto the player, where the picture sits letterboxed. */
export function stageCamera(box: PlayerBox, film: FilmSize): Camera {
  return { x: box.left, y: box.top, zoom: film.width > 0 ? box.width / film.width : 1 };
}

/** The stretch an anchor covers, in seconds as played; `null` for the whole film. */
export function anchorSpan(anchor: VideoAnchor, clock: AnchorClock): { from: number; to: number } | null {
  switch (anchor.kind) {
    case 'film':
      return null;
    case 'point': {
      const at = toPlaybackAnchorTime(clock, anchor.t);
      return { from: at, to: at };
    }
    case 'range':
      return { from: toPlaybackAnchorTime(clock, anchor.from), to: toPlaybackAnchorTime(clock, anchor.to) };
    default: {
      const never: never = anchor;
      return never;
    }
  }
}

/** The pin shows at the moment `now` (seconds as played). */
export function anchorShowsAt(anchor: VideoAnchor, now: number, clock: AnchorClock, window: number = PIN_WINDOW_SECONDS): boolean {
  const span = anchorSpan(anchor, clock);
  if (span === null) return false;
  return anchor.kind === 'point' ? Math.abs(now - span.from) <= window : now >= span.from - 1e-6 && now <= span.to + 1e-6;
}

/** Where an anchor's pin sits on the frame, in film pixels: a point (a box's top-left corner); a stretch at the top middle. */
export function pinWorldPoint(anchor: VideoAnchor, film: FilmSize): Point | null {
  switch (anchor.kind) {
    case 'film':
      return null;
    case 'point':
      return { x: anchor.x * film.width, y: anchor.y * film.height };
    case 'range':
      return { x: film.width / 2, y: film.height * 0.06 };
    default: {
      const never: never = anchor;
      return never;
    }
  }
}

const unit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);

/** A point comment at a film pixel, at the film's moment `t`. */
export function pointAnchorAt(world: Point, film: FilmSize, t: FilmSeconds): CommentAnchor {
  return makePointCommentAnchor(t, { x: unit(world.x / film.width), y: unit(world.y / film.height) });
}

/** A box comment from two dragged corners (film pixels); a tiny box is a point. */
export function boxAnchorAt(a: Point, b: Point, film: FilmSize, t: FilmSeconds): CommentAnchor {
  const left = unit(Math.min(a.x, b.x) / film.width);
  const top = unit(Math.min(a.y, b.y) / film.height);
  const w = unit(Math.abs(a.x - b.x) / film.width);
  const h = unit(Math.abs(a.y - b.y) / film.height);
  if (w < MIN_BOX_FRACTION && h < MIN_BOX_FRACTION) return makePointCommentAnchor(t, { x: left, y: top });
  return makePointCommentAnchor(t, { x: left, y: top, w, h });
}

/** The box a point-with-box anchor outlines, in film pixels. */
export function anchorWorldBox(anchor: VideoAnchor, film: FilmSize): { x: number; y: number; w: number; h: number } | null {
  if (anchor.kind !== 'point' || anchor.box === undefined) return null;
  return { x: anchor.x * film.width, y: anchor.y * film.height, w: anchor.box.w * film.width, h: anchor.box.h * film.height };
}

/** A thread's mark on the timeline: where it starts and ends, as fractions of the film's length. */
export interface TimelineMark {
  id: string;
  from: number;
  /** `null`: a moment, not a stretch. */
  to: number | null;
}

export function timelineMark(id: string, anchor: VideoAnchor, clock: AnchorClock, total: number): TimelineMark | null {
  const span = anchorSpan(anchor, clock);
  if (span === null || !(total > 0)) return null;
  const fraction = (t: number): number => Math.min(1, Math.max(0, t / total));
  return { id, from: fraction(span.from), to: anchor.kind === 'range' ? fraction(span.to) : null };
}

/** The moment, as played, a thread opens the film at. */
export function revealTime(anchor: VideoAnchor, clock: AnchorClock): number {
  return anchor.kind === 'film' ? 0 : anchorPlayTime(anchor, clock);
}

/** The film's own moment for a moment as played. */
export const filmMomentOf = (clock: AnchorClock, t: number): FilmSeconds => toFilmAnchorTime(clock, playSeconds(t));
