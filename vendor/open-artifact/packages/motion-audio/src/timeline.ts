import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { FilmSeconds, PlaySeconds } from '@open-artifact/motion-core';

/**
 * How the film's own time is played. Sound is recorded in film time and heard in play time.
 * `toPlay` gives null for a film instant that is not played (a span cut out). Before 0 and past the film's end it runs on
 * at normal speed, so a score's lead-in and tail keep their length.
 */
export interface FilmTimeline {
  readonly filmDuration: FilmSeconds;
  readonly playDuration: PlaySeconds;
  toPlay(film: FilmSeconds): PlaySeconds | null;
  toFilm(play: PlaySeconds): FilmSeconds;
}

/** One stretch of the film played at a constant rate: `filmLength` film seconds shown over `playLength` play seconds. */
export interface TimelineSegment {
  readonly film: FilmSeconds;
  readonly filmLength: number;
  readonly play: PlaySeconds;
  readonly playLength: number;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
/** A segment stops just short of the next one's first instant. */
const EDGE = 1e-9;

export function identityTimeline(duration: FilmSeconds): FilmTimeline {
  return {
    filmDuration: duration,
    playDuration: playSeconds(duration),
    toPlay: (film) => playSeconds(film),
    toFilm: (play) => filmSeconds(Math.max(0, Math.min(duration, play))),
  };
}

/**
 * A piecewise-linear timeline. Segments are in film order and do not overlap; film time between two segments is cut out.
 * With no segment the film plays as it is.
 */
export function segmentTimeline(segments: readonly TimelineSegment[], filmDuration: FilmSeconds): FilmTimeline {
  const parts = segments.filter((part) => part.filmLength > 0 && part.playLength > 0);
  const last = parts.at(-1);
  if (last === undefined) return identityTimeline(filmDuration);
  const playDuration = playSeconds(round6(last.play + last.playLength));
  const filmEnd = Math.max(filmDuration, last.film + last.filmLength);
  return {
    filmDuration,
    playDuration,
    toPlay(film) {
      if (film < 0) return playSeconds(film);
      if (film >= filmEnd) return playSeconds(playDuration + (film - filmEnd));
      const part = parts.find((candidate) => film >= candidate.film && film < candidate.film + candidate.filmLength);
      if (part === undefined) return null;
      return playSeconds(part.play + (film - part.film) * (part.playLength / part.filmLength));
    },
    toFilm(play) {
      const at = Math.max(0, Math.min(playDuration, play));
      let part = parts[0];
      for (const candidate of parts) if (candidate.play <= at) part = candidate;
      if (part === undefined) return filmSeconds(at);
      const room = part === last ? part.filmLength : part.filmLength - EDGE;
      return filmSeconds(part.film + Math.min(room, (at - part.play) * (part.filmLength / part.playLength)));
    },
  };
}
