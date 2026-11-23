import { create } from 'zustand';
import type { ClockPart, Film, FilmClock, FilmProblem, PlaySeconds, ScenesFile } from '@open-artifact/motion-core';
import type { Chapter, ConsoleLevel, ErrorPhase, SceneReport, StageMeta } from '@open-artifact/motion-stage';
import { NO_RECORDS, type FilmRecords } from '../engine/records.ts';

/** Where the stage is: no film to load, loading one, playing one, or stopped by an error. */
export type StagePhase = 'idle' | 'loading' | 'ready' | 'error';

export interface StageProblem {
  phase: ErrorPhase;
  message: string;
  stack: string;
  /** The moment it failed at, as played (a render error). */
  at: PlaySeconds | null;
}

export interface ConsoleLine {
  level: ConsoleLevel;
  text: string;
}

export const MAX_CONSOLE_LINES = 200;

export interface FilmState {
  /** The film as decoded from the store; `null` before the store answered. */
  film: Film | null;
  /** Bumped by every decoded change the stage reloads for. */
  revision: number;
  problems: FilmProblem[];
  /** The film has a cut to play (`film/script` is not empty). */
  hasScript: boolean;
  /** `scenes.json`, when it reads. */
  scenes: ScenesFile | null;
  records: FilmRecords;
  stage: StagePhase;
  /** What the stage reported when it was ready. */
  meta: StageMeta | null;
  /** The film's seconds and the seconds as played (scenes or chapters, with the recut). */
  clock: FilmClock | null;
  stageProblem: StageProblem | null;
  console: ConsoleLine[];
  loadMs: number | null;
}

export const useFilm = create<FilmState>()(() => ({
  film: null,
  revision: 0,
  problems: [],
  hasScript: false,
  scenes: null,
  records: NO_RECORDS,
  stage: 'idle',
  meta: null,
  clock: null,
  stageProblem: null,
  console: [],
  loadMs: null,
}));

const NO_PARTS: readonly ClockPart[] = [];
const NO_CHAPTERS: readonly Chapter<PlaySeconds>[] = [];

export const selectDuration = (state: FilmState): number => state.meta?.duration ?? 0;
export const selectFps = (state: FilmState): number => state.meta?.fps ?? 30;
export const selectParts = (state: FilmState): readonly ClockPart[] => state.clock?.parts ?? NO_PARTS;
export const selectChapters = (state: FilmState): readonly Chapter<PlaySeconds>[] => state.meta?.chapters ?? NO_CHAPTERS;
/** The stage's word on each scene (`todo` scenes are not made yet); `null` for a film not made of scenes. */
export const selectSceneReports = (state: FilmState): SceneReport[] | null => state.meta?.scenes ?? null;

export function addConsoleLine(line: ConsoleLine): void {
  useFilm.setState((state) => ({ console: [...state.console.slice(-(MAX_CONSOLE_LINES - 1)), line] }));
}
