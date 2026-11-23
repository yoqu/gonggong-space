/**
 * Camera math shared by every canvas editor, pure and DOM-free. The camera
 * names the world point at the viewport's top-left corner and a zoom factor
 * (the engine's {@link CameraState}):
 *
 *     screen = (world - camera) × zoom
 *
 * Zoom limits differ per editor, so every function that clamps takes them
 * as arguments; the shared zoom ladder and menu presets live here.
 */

import type { CameraState, Point, Rect } from './types.ts';

export type { CameraState, Point, Rect };

/** Steps the wheel, the keyboard and the zoom buttons walk. */
export const ZOOM_STEPS: readonly number[] = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
/** Presets of the zoom menu. */
export const ZOOM_PRESETS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2];
/** Two zooms closer than this are the same step. */
export const ZOOM_STEP_EPSILON = 0.005;
/** Padding around content when fitting, screen pixels. */
export const FIT_PADDING = 64;

/** Space taken by floating chrome on each side of the viewport, screen pixels. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Clamps a zoom into `[min, max]`. */
export function clampZoom(zoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, zoom));
}

/** World point → screen point. */
export function worldToScreen(camera: CameraState, point: Point): Point {
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

/** Screen point → world point. */
export function screenToWorld(camera: CameraState, point: Point): Point {
  return { x: point.x / camera.zoom + camera.x, y: point.y / camera.zoom + camera.y };
}

/** The world rectangle a viewport of `width × height` pixels shows. */
export function visibleRect(camera: CameraState, width: number, height: number): Rect {
  return { x: camera.x, y: camera.y, w: width / camera.zoom, h: height / camera.zoom };
}

/** Zooms to `zoom` keeping the screen point `anchor` fixed on the same world point. */
export function zoomAround(camera: CameraState, zoom: number, anchor: Point): CameraState {
  const world = screenToWorld(camera, anchor);
  return { zoom, x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom };
}

/** Pans by a screen-pixel delta (content follows the pointer). */
export function panBy(camera: CameraState, dx: number, dy: number): CameraState {
  return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom };
}

/**
 * The next {@link ZOOM_STEPS} step from `zoom` in a direction, within
 * `[min, max]` (`max` going in past the last step, `min` going out past the
 * first). Zooms within `epsilon` of a step count as that step.
 */
export function nextZoomStep(zoom: number, direction: 1 | -1, min: number, max: number, epsilon = ZOOM_STEP_EPSILON): number {
  const steps = ZOOM_STEPS.filter((step) => step > min + epsilon && step < max - epsilon);
  if (direction === 1) return steps.find((step) => step > zoom + epsilon) ?? max;
  return steps.filter((step) => step < zoom - epsilon).at(-1) ?? min;
}

/** Options of {@link fitRect}. */
export interface FitOptions {
  /** Pixels left around the rect (default {@link FIT_PADDING}). */
  padding?: number;
  /** Fit never zooms in past this (default 1). */
  maxZoom?: number;
  /** Fit never zooms out past this (default 0: no limit). */
  minZoom?: number;
  /** Screen space reserved by floating chrome. */
  insets?: ViewInsets;
}

/**
 * The camera that shows `rect` centered in a `width × height` viewport,
 * zoomed to fit, leaving `padding` pixels around it.
 */
export function fitRect(rect: Rect, width: number, height: number, options: FitOptions = {}): CameraState {
  const padding = options.padding ?? FIT_PADDING;
  const insets = options.insets ?? NO_INSETS;
  const availableW = Math.max(1, width - insets.left - insets.right - 2 * padding);
  const availableH = Math.max(1, height - insets.top - insets.bottom - 2 * padding);
  const zoom = clampZoom(Math.min(availableW / Math.max(1, rect.w), availableH / Math.max(1, rect.h)), options.minZoom ?? 0, options.maxZoom ?? 1);
  const centerX = insets.left + (width - insets.left - insets.right) / 2;
  const centerY = insets.top + (height - insets.top - insets.bottom) / 2;
  return { zoom, x: rect.x + rect.w / 2 - centerX / zoom, y: rect.y + rect.h / 2 - centerY / zoom };
}

/** The camera centered on a world point at a zoom. */
export function centerOn(point: Point, zoom: number, width: number, height: number): CameraState {
  return { zoom, x: point.x - width / 2 / zoom, y: point.y - height / 2 / zoom };
}

/** Same camera (exactly). */
export function sameCamera(a: CameraState, b: CameraState): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/** A camera offset rounded to whole device pixels (crisp text while panning). */
export function snapCameraOffset(offset: number, zoom: number, pixelRatio: number): number {
  return Math.round(-offset * zoom * pixelRatio) / pixelRatio;
}

/** The CSS transform of a DOM layer that follows the camera. */
export function cameraLayerTransform(camera: CameraState, pixelRatio: number): string {
  return `translate(${snapCameraOffset(camera.x, camera.zoom, pixelRatio)}px, ${snapCameraOffset(camera.y, camera.zoom, pixelRatio)}px) scale(${camera.zoom})`;
}

/** The zoom label, e.g. `100%`. */
export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
