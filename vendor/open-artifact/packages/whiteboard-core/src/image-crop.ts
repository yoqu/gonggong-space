/**
 * Image crop math.
 *
 * An image fills its frame like CSS `object-fit: cover`, then is zoomed
 * (`zoom`, 1–50) and panned (`x`, `y`, 0–1; 0.5 is centered). The default
 * crop `{zoom: 1, x: 0.5, y: 0.5}` is never stored.
 *
 * `frame` is the element's box size, `natural` the media's pixel size.
 */

import type { ImageCrop } from './schema.ts';

/** A width and height. */
export interface Size {
  w: number;
  h: number;
}

/** A rectangle in frame coordinates. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The crop that shows the whole image (cover fit, centered). */
export const DEFAULT_IMAGE_CROP: Readonly<ImageCrop> = { zoom: 1, x: 0.5, y: 0.5 };

/** Corner handles of the crop editor. */
export type CropCorner = 'nw' | 'ne' | 'se' | 'sw';
/** Every handle of the crop editor (sides crop the frame, corners scale the image). */
export type CropHandle = CropCorner | 'n' | 'e' | 's' | 'w';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

/** True when two crops (missing = default) are the same. */
export function imageCropsEqual(a: ImageCrop | undefined, b: ImageCrop | undefined): boolean {
  const [left, right] = [a ?? DEFAULT_IMAGE_CROP, b ?? DEFAULT_IMAGE_CROP];
  return left.zoom === right.zoom && left.x === right.x && left.y === right.y;
}

/** A stored crop: clamped and rounded; `undefined` for the default or invalid input. */
export function normalizeImageCrop(value: unknown): ImageCrop | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const read = (key: string): number | null => (typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : null);
  const [zoom, x, y] = [read('zoom'), read('x'), read('y')];
  if (zoom === null || x === null || y === null) return undefined;
  const crop = { zoom: round(clamp(zoom, 1, 50), 4), x: round(clamp(x, 0, 1), 5), y: round(clamp(y, 0, 1), 5) };
  return imageCropsEqual(crop, DEFAULT_IMAGE_CROP) ? undefined : crop;
}

/** Scale at which the natural image covers the frame. */
export function coverImageScale(frame: Size, natural: Size): number {
  return Math.max(frame.w / natural.w, frame.h / natural.h);
}

/** Largest zoom the editor allows (never below the current one). */
export function maxImageCropZoom(crop: ImageCrop): number {
  return Math.max(50, crop.zoom);
}

/** Where the whole image sits relative to the frame. */
export function imageCropRect(frame: Size, natural: Size, crop: ImageCrop): CropRect {
  const scale = coverImageScale(frame, natural) * crop.zoom;
  const [w, h] = [natural.w * scale, natural.h * scale];
  return { x: (frame.w - w) * crop.x + 0, y: (frame.h - h) * crop.y + 0, w, h };
}

/** The crop that puts the whole image at `rect` relative to the frame. */
export function cropFromImageRect(frame: Size, natural: Size, rect: CropRect, previous: ImageCrop, maxZoom = maxImageCropZoom(previous)): ImageCrop {
  const zoom = clamp(rect.w / (natural.w * coverImageScale(frame, natural)), 1, maxZoom);
  const scale = coverImageScale(frame, natural) * zoom;
  const [spareW, spareH] = [natural.w * scale - frame.w, natural.h * scale - frame.h];
  return {
    zoom,
    x: spareW > 0.000001 ? clamp(-rect.x / spareW, 0, 1) : previous.x,
    y: spareH > 0.000001 ? clamp(-rect.y / spareH, 0, 1) : previous.y,
  };
}

/** Pans the image by `(dx, dy)` frame units. */
export function panImageCrop(frame: Size, natural: Size, crop: ImageCrop, dx: number, dy: number): ImageCrop {
  const rect = imageCropRect(frame, natural, crop);
  return cropFromImageRect(frame, natural, { ...rect, x: rect.x + dx, y: rect.y + dy }, crop);
}

/**
 * Scales the image from one corner, keeping the opposite corner still and
 * the image covering the frame. `(dx, dy)` is how far the corner moved.
 */
export function resizeImageCropFromCorner(frame: Size, natural: Size, crop: ImageCrop, corner: CropCorner, dx: number, dy: number): ImageCrop {
  const rect = imageCropRect(frame, natural, crop);
  const [signX, signY] = [corner === 'ne' || corner === 'se' ? 1 : -1, corner === 'sw' || corner === 'se' ? 1 : -1];
  const anchor = { x: signX > 0 ? rect.x : rect.x + rect.w, y: signY > 0 ? rect.y : rect.y + rect.h };
  const diagonal = Math.hypot(rect.w, rect.h);
  const projected = ((signX * rect.w + dx) * signX * rect.w + (signY * rect.h + dy) * signY * rect.h) / diagonal;
  const coverWidth = natural.w * coverImageScale(frame, natural);
  const reachX = signX > 0 ? frame.w - anchor.x : anchor.x;
  const reachY = signY > 0 ? frame.h - anchor.y : anchor.y;
  const minWidth = Math.max(coverWidth, reachX, (reachY * rect.w) / rect.h);
  const width = clamp((rect.w * projected) / diagonal, minWidth, Math.max(minWidth, coverWidth * maxImageCropZoom(crop)));
  const height = (width * rect.h) / rect.w;
  return cropFromImageRect(frame, natural, { x: signX > 0 ? anchor.x : anchor.x - width, y: signY > 0 ? anchor.y : anchor.y - height, w: width, h: height }, crop);
}

/** The crop that keeps the image where it is inside a new frame `rect`. */
export function cropImageToRect(frame: Size, natural: Size, crop: ImageCrop, rect: CropRect): ImageCrop {
  const image = imageCropRect(frame, natural, crop);
  return cropFromImageRect(rect, natural, { x: image.x - rect.x, y: image.y - rect.y, w: image.w, h: image.h }, crop, Math.max(50, crop.zoom));
}

/**
 * Crops the frame from a side or corner handle by `(dx, dy)`: the frame
 * shrinks or grows inside the image's current extent, the image stays put.
 */
export function resizeCropViewport(frame: Size, natural: Size, crop: ImageCrop, handle: CropHandle, dx: number, dy: number, minSize = 1): { frame: CropRect; crop: ImageCrop } {
  const image = imageCropRect(frame, natural, crop);
  const maxZoom = Math.max(50, crop.zoom);
  const [minW, minH] = [Math.min(frame.w, Math.max(minSize, image.w / maxZoom)), Math.min(frame.h, Math.max(minSize, image.h / maxZoom))];
  let [left, top, right, bottom] = [0, 0, frame.w, frame.h];
  if (handle.includes('w')) left = clamp(dx, image.x, right - minW);
  if (handle.includes('e')) right = clamp(frame.w + dx, left + minW, image.x + image.w);
  if (handle.includes('n')) top = clamp(dy, image.y, bottom - minH);
  if (handle.includes('s')) bottom = clamp(frame.h + dy, top + minH, image.y + image.h);
  const rect = { x: left + 0, y: top + 0, w: right - left, h: bottom - top };
  return { frame: rect, crop: cropImageToRect(frame, natural, crop, rect) };
}

/** Zooms the image by `factor` around `center` (the frame center by default). */
export function zoomImageCrop(frame: Size, natural: Size, crop: ImageCrop, factor: number, center?: { x: number; y: number }): ImageCrop {
  const rect = imageCropRect(frame, natural, crop);
  const coverWidth = natural.w * coverImageScale(frame, natural);
  const scale = clamp(rect.w * factor, coverWidth, coverWidth * maxImageCropZoom(crop)) / rect.w;
  const [cx, cy] = [center?.x ?? frame.w / 2, center?.y ?? frame.h / 2];
  return cropFromImageRect(frame, natural, { x: cx + (rect.x - cx) * scale, y: cy + (rect.y - cy) * scale, w: rect.w * scale, h: rect.h * scale }, crop);
}

/** Recenters an axis the image does not overflow (so the stored crop stays clean). */
export function centerUncroppedImageAxes(frame: Size, natural: Size, crop: ImageCrop): ImageCrop | undefined {
  const rect = imageCropRect(frame, natural, crop);
  return normalizeImageCrop({ zoom: crop.zoom, x: rect.w - frame.w < 0.5 ? 0.5 : crop.x, y: rect.h - frame.h < 0.5 ? 0.5 : crop.y });
}

/** The visible part of the image, as fractions of the image. */
export function imageCropNormalizedViewport(frame: Size, natural: Size, crop: ImageCrop): CropRect {
  const rect = imageCropRect(frame, natural, crop);
  return { x: -rect.x / rect.w, y: -rect.y / rect.h, w: frame.w / rect.w, h: frame.h / rect.h };
}

/** CSS that shows a cropped image without knowing its natural size. */
export function imageCropCss(crop: ImageCrop): Record<string, string> {
  const percent = (value: number): string => `${round(value * 100, 4)}%`;
  return {
    position: 'absolute',
    width: percent(crop.zoom),
    height: percent(crop.zoom),
    left: percent(-(crop.zoom - 1) * crop.x),
    top: percent(-(crop.zoom - 1) * crop.y),
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'cover',
    objectPosition: `${percent(crop.x)} ${percent(crop.y)}`,
  };
}
