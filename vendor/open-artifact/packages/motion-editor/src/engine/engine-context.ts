import type { FilmEngine } from './film-engine.ts';

let engine: FilmEngine | null = null;

/** The running engine, or `null` before the page started it. */
export const filmEngine = (): FilmEngine | null => engine;

export function setFilmEngine(next: FilmEngine | null): void {
  engine = next;
}
