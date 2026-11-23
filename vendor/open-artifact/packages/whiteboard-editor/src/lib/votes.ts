/**
 * Votes: face stickers, and where a new one lands on an item.
 *
 * A vote dropped on an item fills it from the bottom-right corner, leftward
 * along a row, then a row up, on two grids (the second offset half a step
 * up and left, so a crowded item takes more). Each voter's stickers sit a
 * few units off the grid, nudged by their id, so votes read as hand-placed.
 * A spot is free when no vote's center is within half a step of it, and it
 * must keep the vote on the item (see `findStickerHost`). When no spot is
 * free, the vote stacks on the first spot that does, each a little up and
 * left of the last.
 *
 * Pure: unit-tested. `tools/sticker.ts` places the votes.
 */

import {
  FACE_STICKER_ART,
  createElementId,
  elementLayoutBox,
  findStickerHost,
  type BoardElement,
  type ElementId,
  type ElementMeasures,
  type Point,
  type StickerElement,
} from '@open-artifact/whiteboard-core';

/** Side of a face sticker. */
export const FACE_STICKER_SIZE = 36;
/** The glyph a face sticker falls back to. */
export const FACE_STICKER_GLYPH = '✋';
/** Distance between neighbouring votes on one item. */
export const FACE_STICKER_SPACING = FACE_STICKER_SIZE * 0.7;
/** How far a vote's grid starts past the item's bottom-right corner (votes overhang it a little). */
export const FACE_STICKER_INSET = FACE_STICKER_SIZE * 0.25;
/** Longest author id a face sticker keeps, in code points. */
const AUTHOR_ID_LIMIT = 128;

/** A face sticker that names its author: a vote. */
export type Vote = StickerElement & { art: typeof FACE_STICKER_ART; authorId: string };

/** Whether an element is a vote (a face sticker that names its author). */
export function isVote(element: BoardElement): element is Vote {
  return element.type === 'sticker' && element.art === FACE_STICKER_ART && element.authorId !== undefined;
}

/** A new vote by `authorId` with its top-left corner at `at`. */
export function createVote(authorId: string, at: Point, id: ElementId = createElementId()): Vote {
  return {
    type: 'sticker',
    id,
    x: at.x,
    y: at.y,
    w: FACE_STICKER_SIZE,
    h: FACE_STICKER_SIZE,
    glyph: FACE_STICKER_GLYPH,
    art: FACE_STICKER_ART,
    authorId: [...authorId].slice(0, AUTHOR_ID_LIMIT).join(''),
  };
}

/** A number from an author id, the same on every page: what nudges their votes off the grid. */
export function voteSeed(authorId: string): number {
  return [...authorId].reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0, 7);
}

/** The nudge off the grid of `authorId`'s votes: each axis in -4..4. */
export function voteNudge(authorId: string): Point {
  const seed = voteSeed(authorId);
  return { x: (seed % 9) - 4, y: ((seed >>> 4) % 9) - 4 };
}

/**
 * Where `authorId`'s next vote on `host` goes (its top-left corner), among
 * the board's `elements` (whose votes it keeps clear of). See the module
 * comment for the order spots are tried in.
 */
export function voteSpotOn(host: BoardElement, authorId: string, elements: readonly BoardElement[], measures?: ElementMeasures): Point {
  // Hosts always have a box (`canHostSticker`); an empty one stands in otherwise.
  const bounds = elementLayoutBox(host, measures) ?? { x: 0, y: 0, w: 0, h: 0 };
  const votes = elements.filter(isVote);
  const nudge = voteNudge(authorId);
  const columns = Math.max(1, Math.floor((bounds.w - 2 * FACE_STICKER_INSET) / FACE_STICKER_SPACING) + 1);
  const rows = Math.max(1, Math.floor((bounds.h - 2 * FACE_STICKER_INSET) / FACE_STICKER_SPACING) + 1);
  const right = bounds.x + bounds.w - FACE_STICKER_SIZE + FACE_STICKER_INSET + nudge.x;
  const bottom = bounds.y + bounds.h - FACE_STICKER_SIZE + FACE_STICKER_INSET + nudge.y;
  const spots = [0, FACE_STICKER_SPACING / 2].flatMap((offset) =>
    Array.from({ length: columns * rows }, (_, index): Point => ({
      x: right - (index % columns) * FACE_STICKER_SPACING - offset,
      y: bottom - Math.floor(index / columns) * FACE_STICKER_SPACING - offset,
    })),
  );
  const half = FACE_STICKER_SIZE / 2;
  const isFree = (spot: Point): boolean => !votes.some((vote) => Math.hypot(vote.x + vote.w / 2 - spot.x - half, vote.y + vote.h / 2 - spot.y - half) < FACE_STICKER_SPACING / 2);
  const landsOnHost = (spot: Point): boolean => findStickerHost({ ...createVote(authorId, spot, ''), id: '' }, elements, measures)?.id === host.id;
  const free = spots.find((spot) => isFree(spot) && landsOnHost(spot));
  if (free !== undefined) return free;
  const fallback = spots.find(landsOnHost) ?? { x: bounds.x + bounds.w / 2 - half, y: bounds.y + bounds.h / 2 - half };
  const taken = new Set(votes.map((vote) => `${vote.x},${vote.y}`));
  const stacked = Array.from({ length: votes.length + 1 }, (_, index): Point => ({ x: fallback.x - 3 * index, y: fallback.y - 2 * index })).find(
    (spot) => !taken.has(`${spot.x},${spot.y}`),
  );
  return stacked ?? fallback;
}
