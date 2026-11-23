import type { FilmSeconds, PlaySeconds, RetouchProperty, TextAlign } from '@open-artifact/motion-core';

export type LayerKind = 'ground' | 'group' | 'shape' | 'image' | 'text';

/** What the list calls a drawing that has no name of its own; '' where its kind says enough. */
export type LayerDrawn = '' | 'graphic' | 'drawing' | 'group' | 'line' | 'path' | 'polygon';

export type LayerEffect = 'fade' | 'grow' | 'left' | 'right' | 'top' | 'bottom';

/**
 * How a layer comes on or goes, as far as its opacity and its box tell: `how` is null where they cannot (better no
 * word than a wrong one), and empty where it just appears.
 */
export interface LayerMotion {
  how: LayerEffect[] | null;
  from: PlaySeconds;
  to: PlaySeconds;
}

/** x, y, width and height in film pixels. */
export type LayerBox = [number, number, number, number];

/**
 * How the film itself draws a layer at the moment on show, for the controls that change it by hand. A value is null
 * where nothing a person sets would show, or where the film changes it in the course of the stretch.
 */
export interface LayerLook {
  /** The classes it has at every moment read, as many as the record can hold. */
  cls: string;
  /** Which it is of how many like elements, and maybe a print of its words (a `RetouchLayer` kin); null: none. */
  kin: string | null;
  /** For a g inside an svg that a hide would hold on: what the hide is also found by (a `RetouchLayer` parts). */
  parts?: string;
  /** The moment of the stretch on show, in the stretch's own seconds (a scene's from its start). */
  at: FilmSeconds;
  fill: string | null;
  ink: string | null;
  radius: number | null;
  /** The largest radius that would still show: half its shorter side. */
  most: number;
  size: number | null;
  hidden: 0 | null;
  svgfill: string | null;
  svgstroke: string | null;
  /** A shape whose fill shows even where no colour is offered for it (a gradient): its stroke is a Stroke, not a Color. */
  filled?: true;
  /** The id of the entry of the record that marks it. */
  entry: string | null;
  /** That entry was found by its turn, not its print, on a thing with words: it may be another thing. */
  loose: boolean;
  /** The entry's own moment lies in the stretch on show. */
  home: boolean;
  /** What of the entry no longer counts here: the film's own style now says otherwise. */
  lapsed: RetouchProperty[];
}

export interface LayerRow {
  /** `<stretch>:<place>/<tag>`, with `+` for a node made anew at the same place and `*` for a pack of alike things. */
  id: string;
  kind: LayerKind;
  /** A shape that is round (a dot, a circle). */
  round: boolean;
  name: string;
  /** held: something that holds it was hidden by hand; own: it was. */
  hidden: 'held' | 'own' | false;
  /** The id of what was hidden, where `hidden` is 'held'. */
  under: string | null;
  own: boolean;
  /** How many alike things a pack holds; 0: no pack. */
  many: number;
  texts: string[];
  /** When it is on in the stretch read, as played. Six at most. */
  spans: Array<[PlaySeconds, PlaySeconds]>;
  /** Where to look at it: the first moment it is as solid as it gets and at rest. */
  at: PlaySeconds;
  enter: LayerMotion;
  leave: LayerMotion;
  /** Its box at the moment on show; null: not on the picture then. */
  box: LayerBox | null;
  /** The box round its words alone, for a line of words. */
  wordsBox: LayerBox | null;
  look: LayerLook | null;
  kids: LayerRow[];
  /** The one shape that is all a drawing's row holds: the row's colours are that shape's. */
  sole: LayerRow | null;
  /** Everything the svg draws is listed under the row, so a colour set on the row leaves nothing behind. */
  whole: boolean;
  drawn: LayerDrawn;
  /** As large as the picture, but no Background: only the list picks it. */
  full: boolean;
}

export interface LayersReport {
  seq: number;
  from: PlaySeconds;
  to: PlaySeconds;
  /** The moment on show, which the boxes and looks are of. */
  at: PlaySeconds;
  /** The record's entries for the stretch on show that find nothing, or another entry's thing. */
  lost: string[];
  /** Of those, the hides whose thing another entry's hide hides all the same. */
  underHide: string[];
  /** null: no reading (the film is not loaded, a newer question came, or the film's render gives promises). */
  rows: LayerRow[] | null;
}

/** How the film itself sets one line of words, as the text style controls read it. null: nothing a person sets would show. */
export interface TypeLook {
  weight: number | null;
  italic: 0 | 1 | null;
  px: number | null;
  leading: number | 'normal' | null;
  tracking: number | null;
  align: TextAlign | null;
}

/** How the film itself draws the thing an id names, read with no change by hand on the stage. */
export interface AskedLook extends TypeLook {
  cls: string;
  kin: string | null;
  at: FilmSeconds;
  fill: string | null;
  ink: string | null;
  radius: number | null;
  most: number;
  size: number | null;
  hidden: 0 | null;
  entry: string | null;
  home: boolean;
  lapsed: RetouchProperty[];
  /** The head of its font stack; '': none that is a plain name. */
  family: string;
}
