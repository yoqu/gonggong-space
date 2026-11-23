/**
 * Crop geometry. A cropped picture fills its frame (`object-fit: cover`)
 * scaled up by `zoom`; `x` / `y` (0–100) say where the picture's overflow
 * is split: at 0 its left (top) edge meets the frame's, at 100 its right
 * (bottom) edge does.
 *
 * Dragging an edge of the crop frame keeps the picture where it is on the
 * slide and moves only the frame: the frame may grow out to the picture's
 * edges and shrink down to a minimum size, and the crop is recomputed so the
 * picture stays still.
 */

import type { Crop } from '@open-artifact/slides-core';

/** A width and height, px. */
export interface Size {
  w: number;
  h: number;
}

/** A box relative to the frame's top-left corner, px. */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A crop handle: an edge or a corner, by compass position. */
export type CropEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Every crop handle. */
export const CROP_EDGES: readonly CropEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** The largest crop zoom. */
export const MAX_CROP_ZOOM = 50;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The scale at which the picture just covers the frame. */
export function coverScale(frame: Size, image: Size): number {
  return Math.max(frame.w / image.w, frame.h / image.h);
}

/** Where the whole picture lies, relative to the frame, for a crop. */
export function pictureRect(frame: Size, image: Size, crop: Crop): CropBox {
  const scale = coverScale(frame, image) * crop.zoom;
  const w = image.w * scale;
  const h = image.h * scale;
  return { x: ((frame.w - w) * crop.x) / 100, y: ((frame.h - h) * crop.y) / 100, w, h };
}

/**
 * The crop that puts the picture at `rect` (relative to the frame). An axis
 * the picture does not overflow keeps its previous position.
 */
export function cropFromPictureRect(frame: Size, image: Size, rect: CropBox, previous: Crop, maxZoom = MAX_CROP_ZOOM): Crop {
  const cover = coverScale(frame, image);
  const zoom = clamp(rect.w / (image.w * cover), 1, maxZoom);
  const scale = cover * zoom;
  const overflowX = image.w * scale - frame.w;
  const overflowY = image.h * scale - frame.h;
  return {
    zoom,
    x: overflowX > 1e-6 ? clamp((-rect.x / overflowX) * 100, 0, 100) : previous.x,
    y: overflowY > 1e-6 ? clamp((-rect.y / overflowY) * 100, 0, 100) : previous.y,
  };
}

/** The crop that shows the picture still in place inside a new frame `next` (relative to the old frame). */
export function cropToFrame(frame: Size, image: Size, crop: Crop, next: CropBox): Crop {
  const picture = pictureRect(frame, image, crop);
  return cropFromPictureRect(next, image, { x: picture.x - next.x, y: picture.y - next.y, w: picture.w, h: picture.h }, crop, Math.max(MAX_CROP_ZOOM, crop.zoom));
}

/**
 * Drags crop handle `edge` by (dx, dy) frame px: the new frame (relative to
 * the old one) and the crop that keeps the picture still. The frame stays
 * inside the picture and at least `minimum` px on each side.
 */
export function resizeCropFrame(frame: Size, image: Size, crop: Crop, edge: CropEdge, dx: number, dy: number, minimum = 1): { frame: CropBox; crop: Crop } {
  const picture = pictureRect(frame, image, crop);
  const most = Math.max(MAX_CROP_ZOOM, crop.zoom);
  // The frame may shrink until the picture would need more than the largest zoom to cover it.
  const minW = Math.min(frame.w, Math.max(minimum, picture.w / most));
  const minH = Math.min(frame.h, Math.max(minimum, picture.h / most));
  let left = 0;
  let top = 0;
  let right = frame.w;
  let bottom = frame.h;
  if (edge.includes('w')) left = clamp(dx, picture.x, right - minW);
  if (edge.includes('e')) right = clamp(frame.w + dx, left + minW, picture.x + picture.w);
  if (edge.includes('n')) top = clamp(dy, picture.y, bottom - minH);
  if (edge.includes('s')) bottom = clamp(frame.h + dy, top + minH, picture.y + picture.h);
  const next = { x: left, y: top, w: right - left, h: bottom - top };
  return { frame: next, crop: cropToFrame(frame, image, crop, next) };
}
