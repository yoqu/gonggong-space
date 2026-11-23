import { clipVisibleText, isFiniteNumber, isPlainObject } from './json.ts';
import { MAX_CHAPTERS, MAX_CHAPTER_LABEL_CHARS } from './limits.ts';
import { recutByPart, recutExceedsFilmLimit, type RecutPart, type RecutRecord } from './records/recut.ts';
import type { SceneEntry } from './scenes-file.ts';
import { filmSeconds, playSeconds, type FilmSeconds, type PlaySeconds } from './units.ts';

/** A part of the timeline: a scene of `scenes.json`, or a chapter the film reports. */
export interface ClockPartInput {
  /** The scene's id; `null` for a chapter. */
  key: string | null;
  /** Its own name, as the film gives it. */
  name: string;
  dur: FilmSeconds;
}

/** A part as it plays. */
export interface ClockPart {
  key: string | null;
  /** Its own name. */
  own: string;
  /** What people call it: the name given by hand, else its own. */
  label: string;
  /** The name given by hand, if any. */
  renamed: string | null;
  filmStart: FilmSeconds;
  filmDur: FilmSeconds;
  playStart: PlaySeconds;
  playDur: PlaySeconds;
  /** Shown over another length than the film gives it. */
  retimed: boolean;
}

/** The film's own seconds and the seconds as played, one from the other. */
export interface FilmClock {
  parts: readonly ClockPart[];
  filmTotal: FilmSeconds;
  playTotal: PlaySeconds;
  /** Some part plays over another length than the film's. */
  retimed: boolean;
  /** Lengths were set by hand but would take the film past 300 s, so the film plays at its own. */
  overLimit: boolean;
  toPlay(t: FilmSeconds): PlaySeconds;
  toFilm(t: PlaySeconds): FilmSeconds;
  /** The part playing at that moment, or -1 when there are no parts. */
  partAtPlay(t: PlaySeconds): number;
  partAtFilm(t: FilmSeconds): number;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

interface Span {
  fromStart: number;
  fromDur: number;
  toStart: number;
  toDur: number;
}

/** Maps a moment through the parts: proportionally inside one, by plain offset before the first or after the last. */
function mapThroughParts(spans: readonly Span[], t: number): number {
  if (spans.length === 0 || t < 0) return t;
  const last = spans[spans.length - 1]!;
  const fromEnd = last.fromStart + last.fromDur;
  if (t >= fromEnd) return last.toStart + last.toDur + (t - fromEnd);
  let found = spans[0]!;
  for (const span of spans) if (span.fromStart <= t) found = span;
  if (found.fromDur <= 0) return found.toStart;
  return found.toStart + ((t - found.fromStart) * found.toDur) / found.fromDur;
}

function lastStartingBy(starts: readonly number[], t: number): number {
  let index = starts.length === 0 ? -1 : 0;
  starts.forEach((start, at) => {
    if (start <= t + 1e-6) index = at;
  });
  return index;
}

/** The clock for these parts, with the lengths and names a person set by hand. */
export function buildClock(inputs: readonly ClockPartInput[], recut: RecutRecord | null = null): FilmClock {
  const recutParts: RecutPart[] = inputs.map((part) => ({ key: part.key, own: part.name, filmDur: part.dur }));
  const values = recut === null ? inputs.map(() => ({ dur: null, name: null })) : recutByPart(recut, recutParts);
  const overLimit = recut !== null && recutExceedsFilmLimit(recut, recutParts);
  let filmAt = 0;
  let playAt = 0;
  const parts: ClockPart[] = inputs.map((input, index) => {
    const value = values[index]!;
    const playDur = !overLimit && value.dur !== null ? value.dur.v : input.dur;
    const part: ClockPart = {
      key: input.key,
      own: input.name,
      label: value.name?.v ?? input.name,
      renamed: value.name?.v ?? null,
      filmStart: filmSeconds(round6(filmAt)),
      filmDur: input.dur,
      playStart: playSeconds(round6(playAt)),
      playDur: playSeconds(playDur),
      retimed: playDur !== input.dur,
    };
    filmAt += input.dur;
    playAt += playDur;
    return part;
  });
  const retimed = parts.some((part) => part.retimed);
  const toPlaySpans: Span[] = parts.map((part) => ({ fromStart: part.filmStart, fromDur: part.filmDur, toStart: part.playStart, toDur: part.playDur }));
  const toFilmSpans: Span[] = parts.map((part) => ({ fromStart: part.playStart, fromDur: part.playDur, toStart: part.filmStart, toDur: part.filmDur }));
  const filmStarts = parts.map((part) => part.filmStart as number);
  const playStarts = parts.map((part) => part.playStart as number);
  return {
    parts,
    filmTotal: filmSeconds(round6(filmAt)),
    playTotal: playSeconds(round6(playAt)),
    retimed,
    overLimit,
    toPlay: (t) => (retimed ? playSeconds(mapThroughParts(toPlaySpans, t)) : playSeconds(t)),
    toFilm: (t) => (retimed ? filmSeconds(mapThroughParts(toFilmSpans, t)) : filmSeconds(t)),
    partAtPlay: (t) => lastStartingBy(playStarts, t),
    partAtFilm: (t) => lastStartingBy(filmStarts, t),
  };
}

/** The clock's parts for the scenes of `scenes.json`. */
export const sceneClockParts = (scenes: readonly SceneEntry[]): ClockPartInput[] => scenes.map((scene) => ({ key: scene.id, name: scene.name, dur: scene.dur }));

/** A chapter the film reports with `kit.chapter`: where it starts in the film's own seconds and what it is called. */
export interface Chapter {
  t: FilmSeconds;
  label: string;
}

/** The chapters as the player keeps them: at most 32, sorted, inside the film, labels cut to 48 characters. */
export function parseChapters(input: unknown, total: FilmSeconds): Chapter[] {
  if (!Array.isArray(input)) return [];
  const chapters: Chapter[] = [];
  for (const item of input.slice(0, MAX_CHAPTERS)) {
    if (!isPlainObject(item) || !isFiniteNumber(item.t)) continue;
    const label = clipVisibleText(item.label, MAX_CHAPTER_LABEL_CHARS);
    if (label === '') continue;
    chapters.push({ t: filmSeconds(Math.min(Math.max(0, item.t), total)), label });
  }
  return chapters.sort((a, b) => a.t - b.t);
}

/** The clock's parts for a film of chapters: each runs to the next one, the last to the film's end. */
export function chapterClockParts(chapters: readonly Chapter[], total: FilmSeconds): ClockPartInput[] {
  return chapters.map((chapter, index) => ({
    key: null,
    name: chapter.label,
    dur: filmSeconds(round6(Math.max(0, (chapters[index + 1]?.t ?? total) - chapter.t))),
  }));
}
