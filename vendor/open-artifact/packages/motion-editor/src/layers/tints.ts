/**
 * The colors a drawing (or a group of svg shapes) is painted in, gathered from its parts so one control sets all
 * the parts that share a color. Pure.
 */

import { MAX_RETOUCHED_LAYERS } from '@open-artifact/motion-core';
import { flattenLayers } from '@open-artifact/motion-stage/layers';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';

export type SvgPaint = 'svgfill' | 'svgstroke';
export const SVG_PAINTS: readonly SvgPaint[] = ['svgfill', 'svgstroke'];

/** Where a color is painted: the part, which paint, and the film's own value (with its alpha). */
export interface TintPlace {
  row: LayerRow;
  key: SvgPaint;
  was: string;
}

export interface LayerTint {
  /** `#rrggbb`, lower case. */
  hue: string;
  at: TintPlace[];
}

/** The most colors a drawing shows controls for, the ones that cover the most of it first. */
export const MAX_TINTS = 6;

const colorable = (row: LayerRow): boolean =>
  row.kids.length === 0
    ? row.look !== null && row.kind !== 'group' && row.drawn !== 'graphic' && !(row.kind === 'shape' && row.id.endsWith('/g'))
    : row.many > 0
      ? row.kids.length >= row.many
      : row.drawn === 'group' || row.whole;

/** The colors of a layer's parts, by how much of it they cover; none where some part cannot be told or changed. */
export function collectLayerTints(layer: LayerRow): LayerTint[] {
  const sole = layer.whole ? layer.sole : null;
  const parts = sole !== null ? [sole] : flattenLayers(layer.kids).map((row) => row.sole ?? row);
  if (parts.length === 0 || !(sole !== null ? parts : [layer, ...parts]).every(colorable)) return [];
  const byHue = new Map<string, { at: TintPlace[]; room: number }>();
  for (const row of parts)
    for (const key of SVG_PAINTS) {
      const was = row.look?.[key] ?? null;
      const box = row.box;
      if (was === null || box === null) continue;
      const hue = was.slice(0, 7).toLowerCase();
      const entry = byHue.get(hue) ?? { at: [], room: 0 };
      entry.at.push({ row, key, was });
      entry.room += key === 'svgfill' ? box[2] * box[3] : (box[2] + box[3]) * 4;
      byHue.set(hue, entry);
    }
  return [...byHue]
    .filter(([, entry]) => new Set(entry.at.map((place) => place.row)).size <= MAX_RETOUCHED_LAYERS)
    .sort((a, b) => b[1].room - a[1].room)
    .slice(0, MAX_TINTS)
    .map(([hue, entry]) => ({ hue, at: entry.at }));
}

/** The row whose own colors Appearance shows: the drawing itself where it is whole, else its one shape. */
export const appearanceRow = (layer: LayerRow): LayerRow => (layer.whole ? layer : (layer.sole ?? layer));
