import type { FilmSeconds, PlaySeconds, ScoreData } from '@open-artifact/motion-core';
import type { Chapter, FilmPart, PlayedScore } from '../protocol.ts';

/** A part of the film on its own time, before a person's lengths are laid on it. */
export interface NaturalPart {
  key: string | null;
  label: string;
  a0: FilmSeconds;
  nat: number;
}

export interface SceneClock {
  parts: FilmPart[];
  duration: PlaySeconds;
  moved: boolean;
  /** The lengths asked for would take the film past its limit, so every part plays at its own. */
  aside: boolean;
  at(t: PlaySeconds): { T: FilmSeconds; rate: number };
  back(T: FilmSeconds): PlaySeconds;
}

const MOST_FILM_S = 36000;
const NEAR_S = 0.001;
const EDGE_S = 1e-9;
const MOST_RECORD_CHARS = 262144;
const MOST_ENTRIES = 33;
const CUT_GAP_S = 0.05;

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const film = (x: number): FilmSeconds => x as FilmSeconds;
const play = (x: number): PlaySeconds => x as PlaySeconds;

/**
 * The film cut on its own time: at 0, and at each labelled chapter more than CUT_GAP_S from the cut before it and
 * from the end. `ids`: the scenes' ids, in a film made of scenes.
 */
export function filmParts(duration: number, chapters: readonly Chapter<FilmSeconds>[], ids: readonly string[] | null): NaturalPart[] {
  const cuts: Array<{ t: number; label: string }> = [{ t: 0, label: '' }];
  for (const chapter of chapters) {
    if (chapter.label.trim() === '' || chapter.t >= duration - CUT_GAP_S) continue;
    const first = cuts[0];
    if (chapter.t <= CUT_GAP_S) {
      if (cuts.length === 1 && first) first.label = chapter.label;
      continue;
    }
    const last = cuts[cuts.length - 1];
    if (last && chapter.t - last.t > CUT_GAP_S) cuts.push({ t: chapter.t, label: chapter.label });
  }
  const keyed = !!ids && ids.length === cuts.length;
  return cuts.map((cut, i) => ({
    key: keyed ? (ids?.[i] ?? null) : null,
    label: cut.label,
    a0: film(cut.t),
    nat: round6((cuts[i + 1]?.t ?? duration) - cut.t),
  }));
}

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {});

const HIDDEN_CHARACTERS =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Noncharacter_Code_Point}\p{Default_Ignorable_Code_Point}⠀￼\u{16fe4}\s]+/gu;
const tidyName = (name: string): string => Array.from(name.slice(0, 96)).slice(0, 48).join('').replace(HIDDEN_CHARACTERS, ' ').trim();

function fits(nat: number, length: unknown): length is number {
  return (
    typeof length === 'number' &&
    isFinite(length) &&
    length >= nat * 0.5 - 1e-9 &&
    length <= nat * 3 + 1e-9 &&
    length >= Math.min(1, nat) &&
    length <= MOST_FILM_S
  );
}

function readEntries(text: string | null): unknown[] {
  if (typeof text !== 'string' || text.length > MOST_RECORD_CHARS) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const root = record(parsed);
  return root['v'] === 1 && Array.isArray(root['scenes']) ? root['scenes'].slice(0, MOST_ENTRIES) : [];
}

/**
 * The parts as played, from the film's own parts and `modules/recut.json`. An entry stands only while the film still
 * says its "was", and a length only within the limits; one that does not is ignored, never clamped.
 */
export function sceneClock(own: readonly NaturalPart[], text: string | null): SceneClock {
  const entries = readEntries(text);
  const lay = (stretch: boolean): FilmPart[] => {
    let p0 = 0;
    return own.map((part, i) => {
      let dur = part.nat;
      let label = part.label;
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') continue;
        const fields = record(entry);
        const name = record(fields['name']);
        const length = record(fields['dur']);
        const matches = part.key !== null ? fields['id'] === part.key : fields['part'] === i && fields['id'] === undefined && name['was'] === part.label;
        if (!matches) continue;
        const was = length['was'];
        if (stretch && typeof was === 'number' && Math.abs(was - part.nat) <= NEAR_S && fits(part.nat, length['v'])) dur = length['v'];
        const given = name['v'];
        if (name['was'] === part.label && typeof given === 'string' && tidyName(given) !== '') label = tidyName(given);
      }
      const played: FilmPart = { key: part.key, label, own: part.label, a0: part.a0, nat: part.nat, p0: play(p0), dur };
      p0 = round6(p0 + dur);
      return played;
    });
  };
  const endOf = (parts: FilmPart[]): number => {
    const last = parts[parts.length - 1];
    return last ? round6(last.p0 + last.dur) : 0;
  };
  const isMoved = (parts: FilmPart[]): boolean => parts.some((part) => part.dur !== part.nat);
  let parts = lay(true);
  const aside = endOf(parts) > MOST_FILM_S && isMoved(parts);
  if (aside) parts = lay(false);
  // Where nothing is moved the two clocks are one, to the last digit.
  if (!isMoved(parts)) for (const part of parts) part.p0 = play(part.a0);
  const last = parts[parts.length - 1];
  const filmEnd = last ? last.a0 + last.nat : 0;
  const playEnd = endOf(parts);
  const find = (by: 'a0' | 'p0', value: number): FilmPart | undefined => {
    let found = parts[0];
    for (const part of parts.slice(1)) if (part[by] <= value) found = part;
    return found;
  };
  return {
    parts,
    duration: play(playEnd),
    moved: isMoved(parts),
    aside,
    // A part stops just short of the next one's first instant.
    at(t: PlaySeconds) {
      const clamped = t < 0 ? 0 : t > playEnd ? playEnd : t;
      const part = find('p0', clamped);
      if (!part) return { T: film(clamped), rate: 1 };
      return {
        T: film(part.a0 + Math.min(part === last ? part.nat : part.nat - EDGE_S, (clamped - part.p0) * (part.nat / part.dur))),
        rate: part.nat / part.dur,
      };
    },
    // Before 0 and past the end it runs on at normal speed: a score's lead-in and tail.
    back(T: FilmSeconds) {
      if (T < 0) return play(T);
      if (T >= filmEnd) return play(playEnd + (T - filmEnd));
      const part = find('a0', T);
      if (!part) return play(T);
      return play(part.p0 + (T - part.a0) * (part.dur / part.nat));
    },
  };
}

/** The clock of a film nobody retimed. */
export function plainClock(duration: number): SceneClock {
  return sceneClock(filmParts(duration, [], null), null);
}

/** The score is recorded on the film's own time and played on played time; a stretched part's sound slows with it, at the same pitch. */
export function playedScore(score: ScoreData, clock: SceneClock): PlayedScore {
  return {
    ...score,
    events: score.events.map((event) => {
      const t = clock.back(event.t);
      return { ...event, t, dur: Math.max(0.01, clock.back(film(event.t + event.dur)) - t) };
    }),
  };
}
