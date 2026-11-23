import type { FilmSeconds } from '@open-artifact/motion-core';
import type { Chapter } from '../protocol.ts';
import type { Cut } from './film.ts';
import type { Kit } from './kit/index.ts';

const MOST_FILM_S = 36000;
const MOST_CHAPTERS = 32;
const LONGEST_LABEL = 48;

const isFps = (value: unknown): value is Cut['fps'] => value === 24 || value === 30 || value === 60;
const isSide = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 16 && Number(value) <= 4096;

/** window.CUT as the stage calls it, or why it cannot be. A width, height or fps left out takes its default. */
export function readCut(given: unknown): Cut | string {
  if (given === null || typeof given !== 'object') return 'the script did not set window.CUT';
  const field = (key: string): unknown => Reflect.get(given, key);
  const render = field('render');
  if (typeof render !== 'function') return 'window.CUT.render(t, kit) is missing';
  const width = field('width') ?? 1920;
  const height = field('height') ?? 1080;
  const fps = field('fps') ?? 60;
  const duration = field('duration');
  if (!isSide(width) || !isSide(height)) return 'CUT.width/height must be integers between 16 and 4096';
  if (!isFps(fps)) return 'CUT.fps must be 24, 30 or 60';
  if (!(typeof duration === 'number' && isFinite(duration) && duration > 0 && duration <= MOST_FILM_S)) return 'CUT.duration must be a number of seconds in (0, 36000]';
  const init = field('init');
  const background = field('background');
  // The film's own object, so that a render reading `this` finds what it set.
  return {
    width,
    height,
    fps,
    duration,
    background: typeof background === 'string' ? background : '#ffffff',
    chapters: field('chapters'),
    render: (t: FilmSeconds, kit: Kit): unknown => Reflect.apply(render, given, [t, kit]),
    init: typeof init === 'function' ? (kit: Kit): unknown => Reflect.apply(init, given, [kit]) : null,
    // Read when asked, after init: a film of scenes sets its score and narration there.
    get score() {
      const score = field('score');
      return typeof score === 'function' ? (builder: unknown, kit: Kit): unknown => Reflect.apply(score, given, [builder, kit]) : null;
    },
    get narration() {
      return field('narration');
    },
  };
}

/** The cut's chapters that can be read, in order, within the film. */
export function chaptersOf(cut: Pick<Cut, 'chapters' | 'duration'>): Chapter<FilmSeconds>[] {
  const out: Chapter<FilmSeconds>[] = [];
  if (!Array.isArray(cut.chapters)) return out;
  const given: unknown[] = cut.chapters;
  for (const chapter of given) {
    if (out.length >= MOST_CHAPTERS) break;
    if (chapter === null || typeof chapter !== 'object') continue;
    const t: unknown = Reflect.get(chapter, 't');
    const label: unknown = Reflect.get(chapter, 'label');
    if (typeof t === 'number' && isFinite(t) && typeof label === 'string')
      out.push({ t: Math.max(0, Math.min(cut.duration, t)) as FilmSeconds, label: label.slice(0, LONGEST_LABEL) });
  }
  return out.sort((a, b) => a.t - b.t);
}
