/**
 * Camera math. The camera names the board point at the viewport's top-left
 * corner and a zoom factor:
 *
 *     screen = (board - camera) × zoom
 *
 * The generic math is `@open-artifact/canvas-engine/camera`; this module
 * adds the board's zoom limits, its grid and per-tab camera memory.
 * Everything here is pure; the camera store (`state/camera.ts`) applies the
 * result to the DOM.
 */

import { GRID_SPACING } from '@open-artifact/whiteboard-core';
import {
  clampZoom as clampZoomIn,
  fitRect as fitRectIn,
  nextZoomStep as nextZoomStepIn,
  screenToWorld,
  worldToScreen,
  type CameraState,
  type FitOptions,
  type Point,
  type Rect,
} from '@open-artifact/canvas-engine/camera';

export {
  FIT_PADDING,
  ZOOM_PRESETS,
  ZOOM_STEPS,
  ZOOM_STEP_EPSILON,
  cameraLayerTransform,
  centerOn,
  panBy,
  sameCamera,
  snapCameraOffset,
  visibleRect,
  zoomAround,
  zoomPercent,
} from '@open-artifact/canvas-engine/camera';
export type { Point, Rect };

/** A camera: the board point at the viewport's top-left and the zoom. */
export type Camera = CameraState;

/** Smallest zoom (5%). */
export const MIN_ZOOM = 0.05;
/** Smallest zoom of the compact (narrow or touch) layout. */
export const MIN_COMPACT_ZOOM = 0.6;
/** Largest zoom (800%). */
export const MAX_ZOOM = 8;
/** "Fit" never zooms in past 100%. */
export const MAX_FIT_ZOOM = 1;

/** The initial camera: board origin at the top-left, 100%. */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Clamps a zoom into `[min, max]` (the board's limits by default). */
export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return clampZoomIn(zoom, min, max);
}

/** Board point → screen point. */
export const boardToScreen: (camera: Camera, point: Point) => Point = worldToScreen;

/** Screen point → board point. */
export const screenToBoard: (camera: Camera, point: Point) => Point = screenToWorld;

/** The next zoom step from `zoom` in a direction, within `[min, max]` (the board's limits by default). */
export function nextZoomStep(zoom: number, direction: 1 | -1, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return nextZoomStepIn(zoom, direction, min, max);
}

/**
 * The camera that shows `rect` centered in a `width × height` viewport,
 * zoomed to fit (never past `maxZoom`, by default {@link MAX_FIT_ZOOM}, nor
 * below {@link MIN_ZOOM}), leaving `padding` pixels around it.
 */
export function fitRect(rect: Rect, width: number, height: number, options: FitOptions = {}): Camera {
  return fitRectIn(rect, width, height, { ...options, minZoom: options.minZoom ?? MIN_ZOOM, maxZoom: options.maxZoom ?? MAX_FIT_ZOOM });
}

/** How long a camera glide takes, ms. */
export const CAMERA_GLIDE_MS = 220;

/** The camera `t` (0–1) of the way through a glide from `from` to `to`, easing out. */
export function glideCameraAt(from: Camera, to: Camera, t: number): Camera {
  const along = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - along) ** 3;
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, zoom: from.zoom + (to.zoom - from.zoom) * eased };
}

/* -------------------------------------------------------------------------- */
/* Grid                                                                       */
/* -------------------------------------------------------------------------- */

/** The grid's base pitch, board units: every other dot of the 24-unit grid. */
export const GRID_BASE_PITCH = 2 * GRID_SPACING;
/** Screen pitches between which a doubled grid fades in. */
export const GRID_FADE_START_PX = 30;
export const GRID_FADE_END_PX = 44;

/**
 * The grid pitch on screen at a zoom, doubling until dots are at least
 * {@link GRID_FADE_START_PX} apart, and how far the in-between dots have
 * faded in (`going`, 0–1, smoothstep).
 */
export function gridPitchAtZoom(zoom: number): { pitch: number; going: number } {
  let step = GRID_BASE_PITCH;
  while (step * zoom < GRID_FADE_START_PX) step *= 2;
  const fade = Math.min(1, (step * zoom - GRID_FADE_START_PX) / (GRID_FADE_END_PX - GRID_FADE_START_PX));
  return { pitch: step * zoom, going: fade * fade * (3 - 2 * fade) };
}

/** The snapping grid step on screen at a zoom (at least 14 px). */
export function gridStepAtZoom(zoom: number): number {
  let step = GRID_SPACING;
  while (step * zoom < 14) step *= 2;
  return step * zoom;
}

/** Rounds a board coordinate to the grid. */
export function snapToGrid(value: number, step = GRID_SPACING): number {
  return Math.round(value / step) * step;
}

/* -------------------------------------------------------------------------- */
/* Session memory                                                             */
/* -------------------------------------------------------------------------- */

/** Remembers each tab's camera per board in sessionStorage. */
export function rememberCamera(key: string, camera: Camera): void {
  try {
    sessionStorage.setItem(`wb-camera:${key}`, JSON.stringify(camera));
  } catch {
    /* storage may be unavailable */
  }
}

/** The camera this tab last had on a board, if valid. */
export function recallCamera(key: string, min = MIN_ZOOM, max = MAX_ZOOM): Camera | undefined {
  try {
    const raw = sessionStorage.getItem(`wb-camera:${key}`);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<Camera>;
    const { x, y, zoom } = parsed;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(zoom >= min && zoom <= max)) return undefined;
    return { x, y, zoom };
  } catch {
    return undefined;
  }
}
