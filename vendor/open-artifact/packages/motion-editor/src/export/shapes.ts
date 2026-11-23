/**
 * The shapes a film can be made again in, as the Shape menu and the export dialog offer them. A film has one size;
 * another shape is a second film the agent makes, never a crop of this one.
 */

import { FILM_SHAPES, FILM_SHAPE_IDS, customFilmShape, type FilmShape, type FilmShapeId } from '@open-artifact/motion-core';
import { SHAPE_NAMES, shapeLabel } from './words.ts';

export interface FilmSize {
  width: number;
  height: number;
}

/** What the person picked: the film's own shape, a named one, or a ratio they typed. */
export type ShapeChoice = { kind: 'own' } | { kind: 'named'; id: FilmShapeId } | { kind: 'typed'; across: number; down: number };

export const OWN_SHAPE: ShapeChoice = { kind: 'own' };

/** Ratios people know by other terms than their lowest ones. */
const KNOWN_RATIOS: ReadonlyArray<readonly [readonly [number, number], string]> = [
  [[7, 3], '21:9'],
  [[8, 5], '16:10'],
];

const greatestDivisor = (a: number, b: number): number => (b === 0 ? a : greatestDivisor(b, a % b));

export const sameShape = (a: FilmSize, b: FilmSize): boolean => a.width * b.height === a.height * b.width;

/** The size's ratio in its lowest terms, `16:9`, or as people say it (`21:9`). */
export function ratioOf(size: FilmSize): string {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (width <= 0 || height <= 0) return '';
  const divisor = greatestDivisor(width, height);
  const across = width / divisor;
  const down = height / divisor;
  const known = KNOWN_RATIOS.find(([[a, b]]) => a === across && b === down);
  return known !== undefined ? known[1] : `${across}:${down}`;
}

/** The named shape the size has, if any. */
export function shapeIdOf(size: FilmSize): FilmShapeId | null {
  return FILM_SHAPE_IDS.find((id) => sameShape(FILM_SHAPES[id], size)) ?? null;
}

/** The film's own shape as a label, `Wide · 16:9`. */
export function ownShapeLabel(size: FilmSize): string {
  const id = shapeIdOf(size);
  return id === null ? ratioOf(size) : shapeLabel(SHAPE_NAMES[id], FILM_SHAPES[id].ratio);
}

/** The named shapes other than the film's own. */
export function otherShapeIds(own: FilmSize): FilmShapeId[] {
  return FILM_SHAPE_IDS.filter((id) => !sameShape(FILM_SHAPES[id], own));
}

/**
 * The shape to make for a choice: null for none (the film's own, or a ratio the same as it), `unusable` for a typed
 * ratio that cannot be made.
 */
export function chosenShape(choice: ShapeChoice, own: FilmSize): FilmShape | 'unusable' | null {
  let shape: FilmShape | null;
  switch (choice.kind) {
    case 'own':
      return null;
    case 'named':
      shape = FILM_SHAPES[choice.id];
      break;
    case 'typed':
      shape = customFilmShape(choice.across, choice.down);
      break;
    default: {
      const never: never = choice;
      return never;
    }
  }
  if (shape === null) return 'unusable';
  return sameShape(shape, own) ? null : shape;
}

/** Where a typed ratio starts: the film's own ratio, turned when that is a named shape (so it differs). */
export function typedStart(own: FilmSize): ShapeChoice {
  const width = Math.round(own.width);
  const height = Math.round(own.height);
  const divisor = width > 0 && height > 0 ? greatestDivisor(width, height) : 1;
  const across = Math.max(1, Math.min(999, width / divisor));
  const down = Math.max(1, Math.min(999, height / divisor));
  return Number.isInteger(across) && Number.isInteger(down) && across !== down ? { kind: 'typed', across: down, down: across } : { kind: 'typed', across: 4, down: 3 };
}
