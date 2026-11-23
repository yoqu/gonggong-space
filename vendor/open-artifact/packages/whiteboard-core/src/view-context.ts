/**
 * The board's view as plain values: the board area the camera shows, the
 * debounced report of that area to the host (so the agent knows what a
 * person is looking at), and the math for following another person's view
 * (their area, a camera that fits it, and an eased step toward it).
 *
 * The React context, key relay and animation-frame glide live in the
 * editor; everything here is DOM-free (timers are injectable).
 */

import { clampZoom, type Box, type Camera, type ViewInsets, type ViewSize } from './geometry.ts';
import { COORDINATE_LIMIT } from './schema.ts';

/* -------------------------------------------------------------------------- */
/* Board events and frame ids                                                 */
/* -------------------------------------------------------------------------- */

/** Document event fired (capture phase) on every key press inside the board page. */
export const BOARD_KEY_PRESSED_EVENT = 'wb-key-pressed';

/** Document event fired when a pointer goes down on an element frame. */
export const BOARD_FRAME_PRESSED_EVENT = 'wb-frame-pressed';

/** The frame id of an agent ask bubble (kept apart from element ids, which never contain spaces). */
export function askFrameId(id: string | number): string {
  return 'ask ' + String(id);
}

/** True for a frame id made by {@link askFrameId}. */
export function isAskFrameId(id: string): boolean {
  return id.startsWith('ask ');
}

/* -------------------------------------------------------------------------- */
/* Visible area                                                               */
/* -------------------------------------------------------------------------- */

/** A view's size with the chrome covering its top and bottom. */
export type InsetViewport = ViewSize & ViewInsets;

/** The board area a camera shows in a view of `viewport` size. */
export function cameraWorldRect(camera: Camera, viewport: ViewSize): Box {
  return { x: camera.x, y: camera.y, w: viewport.w / camera.zoom, h: viewport.h / camera.zoom };
}

/** Wait after the last camera move before reporting the view. */
export const VIEW_REPORT_DEBOUNCE_MS = 300;

/** A rectangle rounded to whole units (what the view report sends). */
export function roundViewRect(rect: Box): Box {
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
}

/** A camera that can be read and watched. */
export interface WatchedCamera {
  readonly current: Camera;
  /** Calls `listener` after each camera change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Timer functions (the global ones by default). */
export interface ViewTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const GLOBAL_TIMERS: ViewTimers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** Options of {@link createViewReporter}. */
export interface ViewReporterOptions {
  camera: WatchedCamera;
  /** The view's current size in screen pixels. */
  window(): ViewSize;
  /** False while the page is hidden (nothing is reported then). */
  visible(): boolean;
  /** Sends the visible board area (rounded). */
  tell(rect: Box): void;
  timers?: ViewTimers;
}

/** A running view reporter. */
export interface ViewReporter {
  /** Schedules a report (call when the view resized or became visible). */
  moved(): void;
  dispose(): void;
}

/**
 * Reports the visible board area {@link VIEW_REPORT_DEBOUNCE_MS} after the
 * camera or view last changed, only while visible and only when the rounded
 * area differs from the last one sent. Schedules a first report at once.
 */
export function createViewReporter(options: ViewReporterOptions): ViewReporter {
  const timers = options.timers ?? GLOBAL_TIMERS;
  let lastSent = '';
  let timer: unknown;
  const send = (): void => {
    timer = undefined;
    const rect = roundViewRect(cameraWorldRect(options.camera.current, options.window()));
    if (!options.visible() || JSON.stringify(rect) === lastSent) return;
    lastSent = JSON.stringify(rect);
    options.tell(rect);
  };
  const schedule = (): void => {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(send, VIEW_REPORT_DEBOUNCE_MS);
  };
  const unsubscribe = options.camera.subscribe(schedule);
  schedule();
  return {
    moved: schedule,
    dispose: () => {
      timers.clearTimeout(timer);
      unsubscribe();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Following a view                                                           */
/* -------------------------------------------------------------------------- */

/** Largest coordinate or size a shared follow area may have. */
export const FOLLOW_AREA_LIMIT = 1e9;

/** Time constant of the follow glide (it closes ~63% of the gap per this many ms). */
export const FOLLOW_EASE_MS = 90;

/** Retry delay while the follower is busy (dragging or typing). */
export const FOLLOW_BUSY_RETRY_MS = 300;

/** Smallest view (clear of chrome) treated as roomy; smaller views keep the last roomy size. */
export const FOLLOW_MIN_VIEWPORT: Readonly<ViewSize> = { w: 200, h: 80 };

/** Wait after the view stops resizing before re-placing the followed area. */
export const FOLLOW_RESIZE_SETTLE_MS = 300;

/** The view's height not covered by chrome. */
export function viewportClearHeight(viewport: InsetViewport): number {
  return viewport.h - viewport.top - viewport.bottom;
}

/** {@link viewportClearHeight}, at least 1. */
export function followViewportClearHeight(viewport: InsetViewport): number {
  return Math.max(1, viewport.h - viewport.top - viewport.bottom);
}

/** Rounds a follow coordinate to a tenth of a unit. */
export function roundFollowCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The board area a person sees (clear of chrome), as shared with followers. */
export function followViewArea(camera: Camera, viewport: InsetViewport): Box {
  return {
    x: roundFollowCoord(camera.x),
    y: roundFollowCoord(camera.y + viewport.top / camera.zoom),
    w: Math.max(1, roundFollowCoord(viewport.w / camera.zoom)),
    h: Math.max(1, roundFollowCoord(followViewportClearHeight(viewport) / camera.zoom)),
  };
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && value >= min && value <= max;
}

/** A follow area from a message, or `undefined` when it is not a sane rectangle. */
export function parseFollowArea(raw: unknown): Box | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { x, y, w, h } = raw as Record<string, unknown>;
  return isNumberInRange(x, -FOLLOW_AREA_LIMIT, FOLLOW_AREA_LIMIT) &&
    isNumberInRange(y, -FOLLOW_AREA_LIMIT, FOLLOW_AREA_LIMIT) &&
    isNumberInRange(w, 1, FOLLOW_AREA_LIMIT) &&
    isNumberInRange(h, 1, FOLLOW_AREA_LIMIT)
    ? { x, y, w, h }
    : undefined;
}

/** {@link parseFollowArea}, also refusing areas that reach past the board's extent. */
export function readFollowArea(raw: unknown): Box | undefined {
  const area = parseFollowArea(raw);
  return area !== undefined && Math.max(-area.x, -area.y, area.x + area.w, area.y + area.h) <= COORDINATE_LIMIT ? area : undefined;
}

/** The camera that fits `area` into the view (clear of chrome), centered. */
export function cameraFittingArea(area: Box, viewport: InsetViewport, clamp: (zoom: number) => number = clampZoom): Camera {
  const zoom = clamp(Math.min(viewport.w / area.w, followViewportClearHeight(viewport) / area.h));
  return {
    x: area.x + area.w / 2 - viewport.w / 2 / zoom,
    y: area.y + area.h / 2 - (viewport.top + followViewportClearHeight(viewport) / 2) / zoom,
    zoom,
  };
}

/**
 * One eased step from camera `from` toward `to` after `elapsedMs`: zoom
 * eases geometrically and the view center linearly. Returns `to` itself once
 * the remaining gap is under half a screen pixel.
 */
export function easeCameraToward(from: Camera, to: Camera, elapsedMs: number, viewport: ViewSize): Camera {
  if (Math.abs(from.zoom / to.zoom - 1) < 0.002 && Math.abs(from.x - to.x) * to.zoom < 0.5 && Math.abs(from.y - to.y) * to.zoom < 0.5) return to;
  const progress = 1 - Math.exp(-Math.max(0, elapsedMs) / FOLLOW_EASE_MS);
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, progress);
  const centerOf = (camera: Camera): [number, number] => [camera.x + viewport.w / 2 / camera.zoom, camera.y + viewport.h / 2 / camera.zoom];
  const [fromX, fromY] = centerOf(from);
  const [toX, toY] = centerOf(to);
  return {
    x: fromX + (toX - fromX) * progress - viewport.w / 2 / zoom,
    y: fromY + (toY - fromY) * progress - viewport.h / 2 / zoom,
    zoom,
  };
}

/** True when the view is at least {@link FOLLOW_MIN_VIEWPORT} clear of chrome. */
export function isRoomyViewport(viewport: InsetViewport): boolean {
  return viewport.w >= FOLLOW_MIN_VIEWPORT.w && viewportClearHeight(viewport) >= FOLLOW_MIN_VIEWPORT.h;
}

/** The roomier of two views: the taller clear area, at the wider width. */
export function roomierViewport(previous: InsetViewport, next: InsetViewport): InsetViewport {
  return { ...(viewportClearHeight(next) > viewportClearHeight(previous) ? next : previous), w: Math.max(previous.w, next.w) };
}
