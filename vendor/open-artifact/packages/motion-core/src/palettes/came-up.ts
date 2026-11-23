/**
 * A film with a person's retyped lines or colors swapped in may not play with them. The player then tries it again
 * with less: without the colors (when it has lines too), then as its code is written. Which try came up decides how
 * the Palette section shows the film's palette.
 */

/** What a load of the film carries of a person's records. */
export interface FilmTry {
  /** Retyped lines swapped in. */
  lines: boolean;
  /** Colors swapped in. */
  colors: boolean;
}

/** What a person's records give the film before it is tried. */
export interface FilmRecordsHeld extends FilmTry {
  /** The retyped lines could not be read, so the film runs as written whatever comes up. */
  unreadLines: boolean;
}

/** The loads to try, in order: everything, then the lines without the colors, then the film as written. */
export function filmTries(held: FilmTry): FilmTry[] {
  const tries: FilmTry[] = [{ lines: held.lines, colors: held.colors }];
  if (held.lines && held.colors) tries.push({ lines: true, colors: false });
  if (held.lines || held.colors) tries.push({ lines: false, colors: false });
  return tries;
}

/** How the film came up, as the Palette section reads it. */
export interface PaletteFallback {
  /** The film shows its original text and colors: it could not play with the text changed in Properties. */
  original: boolean;
  /** The film could not play in its palette and shows its own colors. */
  fell: boolean;
}

export const NO_PALETTE_FALLBACK: PaletteFallback = { original: false, fell: false };

/**
 * `original` when lines were swapped in and the try that came up has none; `fell` when colors were swapped in, the
 * try that came up has none, and the film is not shown as written.
 */
export function paletteFallback(held: FilmRecordsHeld, came: FilmTry): PaletteFallback {
  const original = held.lines && !came.lines;
  const asWritten = held.unreadLines || original;
  return { original, fell: held.colors && !came.colors && !asWritten };
}

/** What the page says once a film comes up: nothing, the pick taken back, or that the film shows its own palette. */
export type PaletteFallReply = 'none' | 'undo' | 'tell';

/**
 * A film that fell after a pick of this page (its record still the one the pick wrote) has the pick taken back;
 * one that newly fell otherwise is told of once.
 */
export function paletteFallReply(input: { fell: boolean; wasFell: boolean; pickFailed: boolean }): PaletteFallReply {
  if (!input.fell) return 'none';
  if (input.pickFailed) return 'undo';
  return input.wasFell ? 'none' : 'tell';
}
