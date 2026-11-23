/**
 * Where everything sits in the Canvas view, in world units (canvas pixels at
 * 100%): one row per outline section, its label on the left, then its slides.
 *
 * The DOM board places its elements with these numbers. The engine board
 * (CanvasEngineBoard.tsx) also hit-tests, finds drop gaps and culls with
 * them, since it has no tile elements to measure. Pure, so it is unit-tested
 * directly.
 */

import type { SectionEntry, SectionGroup } from '@open-artifact/slides-core';

/** Width of one slide tile. */
export const TILE_W = 480;
/** Height of the caption line under a slide (its number and title). */
export const CAPTION_H = 28;
/** Space between tiles in a row. */
export const GAP_X = 48;
/** Space between rows. */
export const GAP_Y = 96;
/** Width of the label column on the left of each row. */
export const LABEL_W = 320;

/** A rectangle in world units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One slide on the canvas: `x, y, w, h` is the slide itself, the caption is below it. */
export interface TileBox extends Box {
  id: string;
  /** Place in the deck order (0-based). */
  index: number;
  /** Row (outline group) it sits in. */
  row: number;
}

/** One row: a section (or the opening run) and its slides. */
export interface RowBox {
  row: number;
  /** The section, or null for the opening run. */
  section: SectionEntry | null;
  /** Section key, or null for the opening run. */
  key: string | null;
  /** Top of the row's tiles. */
  top: number;
  /** Deck index of its first slide. */
  first: number;
  ids: readonly string[];
  /** The "drop slides here" box of an empty section, else null. */
  empty: Box | null;
}

/** The whole canvas. */
export interface CanvasLayout {
  tiles: TileBox[];
  byId: ReadonlyMap<string, TileBox>;
  rows: RowBox[];
  /** Slide height of a tile (16:9 or 4:3). */
  slideH: number;
  /** Tile height: the slide plus its caption. */
  tileH: number;
  width: number;
  height: number;
}

/** Lays out the outline's rows for slides of `slideWidth` × `slideHeight`. */
export function canvasLayout(groups: readonly SectionGroup[], slideWidth: number, slideHeight: number): CanvasLayout {
  const slideH = (TILE_W * slideHeight) / slideWidth;
  const tileH = slideH + CAPTION_H;
  const tiles: TileBox[] = [];
  const byId = new Map<string, TileBox>();
  const rows: RowBox[] = [];
  let index = 0;
  groups.forEach((group, row) => {
    const top = row * (tileH + GAP_Y);
    rows.push({
      row,
      section: group.section,
      key: group.section?.key ?? null,
      top,
      first: index,
      ids: group.ids,
      empty: group.ids.length === 0 ? { x: LABEL_W, y: top, w: TILE_W, h: slideH } : null,
    });
    group.ids.forEach((id, i) => {
      const tile: TileBox = { id, index: index++, row, x: LABEL_W + i * (TILE_W + GAP_X), y: top, w: TILE_W, h: slideH };
      tiles.push(tile);
      byId.set(id, tile);
    });
  });
  const columns = Math.max(1, ...groups.map((g) => g.ids.length));
  return {
    tiles,
    byId,
    rows,
    slideH,
    tileH,
    width: LABEL_W + columns * TILE_W + (columns - 1) * GAP_X,
    height: Math.max(1, groups.length) * (tileH + GAP_Y) - GAP_Y,
  };
}

const inside = (b: Box, x: number, y: number): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

/** The row whose band (tiles and the half gaps around them) holds world y, clamped to the first and last rows. */
function rowAt(layout: CanvasLayout, y: number): RowBox | undefined {
  const pitch = layout.tileH + GAP_Y;
  const n = Math.floor((y + GAP_Y / 2) / pitch);
  return layout.rows[Math.min(layout.rows.length - 1, Math.max(0, n))];
}

/** The slide at a world point, and whether the point is on its caption rather than the slide. */
export function tileAt(layout: CanvasLayout, x: number, y: number): { tile: TileBox; caption: boolean } | null {
  const row = rowAt(layout, y);
  if (!row || !row.ids.length) return null;
  const i = Math.floor((x - LABEL_W) / (TILE_W + GAP_X));
  const id = row.ids[i];
  const tile = id === undefined ? undefined : layout.byId.get(id);
  if (!tile) return null;
  if (inside(tile, x, y)) return { tile, caption: false };
  if (inside({ x: tile.x, y: tile.y + tile.h, w: tile.w, h: CAPTION_H }, x, y)) return { tile, caption: true };
  return null;
}

/** The empty section whose drop box holds a world point, or null. */
export function emptySectionAt(layout: CanvasLayout, x: number, y: number): string | null {
  for (const row of layout.rows) if (row.empty && row.key && inside(row.empty, x, y)) return row.key;
  return null;
}

/**
 * The drop gap (index into the deck order) for a world point: next to the
 * nearest tile, rows weighing more than columns, on the side of its middle
 * the point is on. As the grid's `gapAt` (useSlideDrag.ts) does with tile
 * elements.
 */
export function dropGapAt(layout: CanvasLayout, x: number, y: number): number {
  let best: TileBox | null = null;
  let bestD = Infinity;
  for (const tile of layout.tiles) {
    const bottom = tile.y + layout.tileH;
    const dx = x < tile.x ? tile.x - x : x > tile.x + tile.w ? x - tile.x - tile.w : 0;
    const dy = y < tile.y ? tile.y - y : y > bottom ? y - bottom : 0;
    const d = dy * 4 + dx;
    if (d < bestD) {
      best = tile;
      bestD = d;
    }
  }
  if (!best) return 0;
  return best.index + (x > best.x + best.w / 2 ? 1 : 0);
}

/**
 * Where the insertion lines for a drop gap go: left of the slide at `gap`,
 * and right of the slide before it when that one ends its row (a gap between
 * rows shows on both, as the DOM board draws it).
 */
export function dropLineBoxes(layout: CanvasLayout, gap: number): Box[] {
  const out: Box[] = [];
  const before = layout.tiles[gap];
  const after = layout.tiles[gap - 1];
  if (before) out.push({ x: before.x - GAP_X / 2 - 2, y: before.y, w: 4, h: layout.tileH });
  if (after && (!before || before.row !== after.row)) out.push({ x: after.x + after.w + GAP_X / 2 - 2, y: after.y, w: 4, h: layout.tileH });
  return out;
}

/** Tiles (slide and caption) meeting a world rectangle. */
export function tilesIn(layout: CanvasLayout, view: Box): TileBox[] {
  const out: TileBox[] = [];
  for (const tile of layout.tiles) {
    if (tile.x < view.x + view.w && tile.x + tile.w > view.x && tile.y < view.y + view.h && tile.y + layout.tileH > view.y) out.push(tile);
  }
  return out;
}

/** A world rectangle grown by `fraction` of its size on every side. */
export function grow(box: Box, fraction: number): Box {
  return { x: box.x - box.w * fraction, y: box.y - box.h * fraction, w: box.w * (1 + fraction * 2), h: box.h * (1 + fraction * 2) };
}
