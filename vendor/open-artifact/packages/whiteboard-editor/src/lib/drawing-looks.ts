/**
 * Bookkeeping of painted drawing looks: the zoom steps they are painted
 * at, how big a painting gets, and the cache key that names one.
 */

import type { ColorScheme, DrawingLook } from '@open-artifact/whiteboard-core';

/** Looks that are painted as pixels. */
export type RasterLook = 'marker' | 'watercolor' | 'paper';

/** True for a look that is painted as pixels. */
export function isRasterLook(look: DrawingLook): look is RasterLook {
  return look === 'marker' || look === 'watercolor' || look === 'paper';
}

/** Smallest and largest paint scale (device pixels per board unit). */
export const LOOK_SCALE_RANGE = { min: 0.25, max: 4 } as const;
/** Longest side of a painted look, pixels. */
export const MAX_LOOK_PX = 2048;
/** How long the view must stay still before looks are painted for a new zoom, ms. */
export const LOOK_SETTLE_MS = 350;

/** The paint scale for a zoom: the power of two at or above zoom × pixel ratio, within {@link LOOK_SCALE_RANGE}. */
export function drawingLookScale(zoom: number, pixelRatio: number): number {
  const target = zoom * pixelRatio;
  if (!(target > 0)) return LOOK_SCALE_RANGE.min;
  const step = 2 ** Math.ceil(Math.log2(target) - 1e-9);
  return Math.min(LOOK_SCALE_RANGE.max, Math.max(LOOK_SCALE_RANGE.min, step));
}

/** Pixel size of a look painted for a `w` × `h` element at `scale`, halving the scale until it fits {@link MAX_LOOK_PX}. */
export function lookPaintSize(w: number, h: number, scale: number): { width: number; height: number; scale: number } {
  let fitted = scale;
  while (fitted > LOOK_SCALE_RANGE.min && Math.max(w, h) * fitted > MAX_LOOK_PX) fitted /= 2;
  const fit = Math.min(1, MAX_LOOK_PX / Math.max(1, w * fitted, h * fitted));
  return { width: Math.max(1, Math.round(w * fitted * fit)), height: Math.max(1, Math.round(h * fitted * fit)), scale: fitted };
}

/** FNV-1a of a string, base 36. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** A short name of a drawing's source (its hash and length). */
export function drawingSourceId(src: string): string {
  return `${hashText(src)}.${src.length.toString(36)}`;
}

/** The cache key of one painted look: the source, look, scheme and the painted pixel size. */
export function lookPaintKey(src: string, look: RasterLook, scheme: ColorScheme, width: number, height: number): string {
  return `${drawingSourceId(src)}|${look}|${scheme}|${String(width)}x${String(height)}`;
}

/** The source part of a key made by {@link lookPaintKey}. */
export function lookPaintKeySource(key: string): string {
  return key.slice(0, key.indexOf('|'));
}
