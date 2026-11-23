import type { FilmSeconds } from '@open-artifact/motion-core';
import { film } from './film.ts';

/**
 * The stretch of the film a moment lies in, as the record of changes made by hand counts it. name: a scene's id;
 * 'film' in a film not made of scenes, whatever the chapter; null: a scene that is not final, where nothing is laid.
 * lo and hi are its ends in seconds from base: a scene's count from its own start, a chapter's from the film's.
 */
export interface Stretch {
  name: string | null;
  base: number;
  lo: number;
  hi: number;
}

export function stretchOf(T: FilmSeconds): Stretch {
  const parts = film.meta?.parts ?? [];
  let i = 0;
  while (i + 1 < parts.length && T >= (parts[i + 1]?.a0 ?? Infinity)) i++;
  const part = parts[i];
  if (!part || part.key === null) {
    const a0 = part ? part.a0 : 0;
    const nat = part ? part.nat : (film.cut?.duration ?? 0);
    return { name: 'film', base: 0, lo: a0, hi: a0 + nat };
  }
  const key = part.key;
  const scene = film.meta?.scenes?.find((each) => each.id === key);
  return { name: scene && scene.state === 'final' ? key : null, base: part.a0, lo: 0, hi: part.nat };
}
