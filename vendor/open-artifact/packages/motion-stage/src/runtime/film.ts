import type { FilmSeconds, PlaySeconds } from '@open-artifact/motion-core';
import type { RenderMode, StageMeta } from '../protocol.ts';
import type { CaptionLayer } from './captions.ts';
import type { Kit } from './kit/index.ts';
import type { SceneClock } from './recut.ts';

/** window.CUT, as checked: everything the stage calls on it. */
export interface Cut {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  duration: number;
  background: string;
  chapters: unknown;
  render(t: FilmSeconds, kit: Kit): unknown;
  init: ((kit: Kit) => unknown) | null;
  score: ((builder: unknown, kit: Kit) => unknown) | null;
  narration: unknown;
}

/** The one film this frame loads. */
export const film = {
  cut: null as Cut | null,
  kit: null as Kit | null,
  meta: null as StageMeta | null,
  /** null: nobody retimed the scenes, so played time is the film's own. */
  clock: null as SceneClock | null,
  captions: null as CaptionLayer | null,
  loaded: false,
  mode: 'rough' as RenderMode,
  /** Film seconds per played second at the moment drawn last. */
  rate: 1,
  played: 0 as PlaySeconds,
};

/** The film's own time at played time `t`, and the played length. */
export function filmAt(t: PlaySeconds): { T: FilmSeconds; rate: number } {
  const cut = film.cut;
  if (!cut) return { T: t as number as FilmSeconds, rate: 1 };
  const clock = film.clock;
  if (!clock) return { T: Math.min(cut.duration, t) as FilmSeconds, rate: 1 };
  const at = clock.at(t);
  // The parts' lengths are rounded to 1e-6, so their sum can miss the cut's duration: the played end draws the cut's own end.
  return { T: (t >= clock.duration ? cut.duration : Math.min(cut.duration, at.T)) as FilmSeconds, rate: at.rate };
}

export const playedDuration = (): number => film.clock?.duration ?? film.cut?.duration ?? 0;

/** A thing a film gave back that may be a promise. */
export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && typeof Reflect.get(value, 'then') === 'function';
