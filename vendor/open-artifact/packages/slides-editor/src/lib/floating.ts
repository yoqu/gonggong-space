/**
 * Placement of the toolbar that floats next to the selection.
 *
 * The toolbar sits 10px above the selection when there is room between the
 * top of the visible stage and the selection; otherwise 10px below it.
 * When neither fits (a selection taller than the view), it goes where it
 * covers least of the line being typed into: above the caret's line, below
 * it, or pinned to the top or the bottom of the view.
 *
 * All values are client (viewport) pixels.
 */

/** What the placement needs to know. */
export interface FloatingLayout {
  /** Top and bottom of the selection. */
  selTop: number;
  selBottom: number;
  /** The toolbar's height. */
  menuH: number;
  /** The visible band of the stage the toolbar must stay in. */
  bandTop: number;
  bandBottom: number;
  /** The caret's box while typing (read only when needed), or null. */
  caret: () => { top: number; bottom: number; lineTop?: number } | null;
}

/** Where the toolbar goes. */
export interface FloatingPlacement {
  top: number;
  placed: 'above' | 'below';
  /** The toolbar covers part of the selection. */
  overlaps: boolean;
}

/** Gap between the toolbar and the selection (or the caret's line). */
const GAP = 10;
/** Margin inside the band. */
const MARGIN = 8;

/** Places the toolbar vertically. */
export function placeFloatingToolbar(layout: FloatingLayout): FloatingPlacement {
  const highest = layout.bandTop + MARGIN;
  const lowest = Math.max(highest, layout.bandBottom - MARGIN - layout.menuH);

  const above = Math.max(highest, layout.selTop - layout.menuH - GAP);
  if (above + layout.menuH + MARGIN <= layout.selTop) return { top: Math.min(above, lowest), placed: 'above', overlaps: false };

  const below = layout.selBottom + GAP;
  if (below <= lowest) return { top: Math.max(highest, below), placed: 'below', overlaps: false };

  // The selection fills the view: stay clear of the caret's line if possible.
  const caret = layout.caret();
  if (caret === null || caret.top >= highest + layout.menuH + GAP) return { top: highest, placed: 'above', overlaps: true };
  const underCaret = Math.max(highest, caret.bottom + GAP);
  if (underCaret <= lowest) return { top: underCaret, placed: 'below', overlaps: true };

  // How much of [from, caret.bottom] a toolbar at `top` covers.
  const covered = (top: number, from: number): number => Math.max(0, Math.min(top + layout.menuH, caret.bottom) - Math.max(top, from));
  const lineTop = caret.lineTop ?? caret.top;
  const preferTop = (covered(highest, lineTop) - covered(lowest, lineTop) || covered(highest, caret.top) - covered(lowest, caret.top)) <= 0;
  return preferTop ? { top: highest, placed: 'above', overlaps: true } : { top: lowest, placed: 'below', overlaps: true };
}

/** Places the toolbar horizontally: at the selection's left, kept inside the band. */
export function placeFloatingLeft(selLeft: number, width: number, bandLeft: number, bandRight: number): number {
  return Math.max(bandLeft + MARGIN, Math.min(selLeft, bandRight - width - MARGIN));
}
