/**
 * Pin geometry shared by every editor's comments. Pure.
 *
 * Editor-agnostic: this folder
 * imports only `@open-artifact/runtime`, `@open-artifact/ui`, React, zustand
 * and lucide-react, never an editor's own stores. Where a comment sits is the
 * editor's business; it hands these modules world points and boxes.
 */

/** A point (world or screen px). */
export interface Point {
  x: number;
  y: number;
}

/** A box (world or screen px). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** A dragged area (a highlight draws it dashed, as it was drawn). */
  area?: boolean;
}

/** A pan-and-zoom camera: screen = world × zoom + (x, y). */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * How a stored anchor resolves against the document now:
 *
 * - `ok`: what it names is there.
 * - `moved`: found again at another address (by a fingerprint).
 * - `detached`: the element is gone; the thread falls back to its container.
 * - `orphaned`: the container is gone too (the thread shows in the list only).
 */
export type AnchorState = 'ok' | 'moved' | 'detached' | 'orphaned';

/** Where a thread's pin sits, as the editor resolved its anchor. */
export interface PinPlace {
  world: Point;
  state: AnchorState;
}

/** A world point on screen. */
export function toScreenPoint(camera: Camera, world: Point): Point {
  return { x: world.x * camera.zoom + camera.x, y: world.y * camera.zoom + camera.y };
}

/** A screen point in the world. */
export function toWorldPoint(camera: Camera, screen: Point): Point {
  const zoom = camera.zoom || 1;
  return { x: (screen.x - camera.x) / zoom, y: (screen.y - camera.y) / zoom };
}

/** A world box on screen, as CSS `left/top/width/height`. */
export function screenBox(camera: Camera, r: Box): { left: number; top: number; width: number; height: number } {
  return { left: r.x * camera.zoom + camera.x, top: r.y * camera.zoom + camera.y, width: r.w * camera.zoom, height: r.h * camera.zoom };
}

/**
 * Pins that would sit on top of each other are fanned out: a pin within
 * `gap` screen px of an earlier one moves right by `gap` until it is clear.
 * Input order is kept; returns the shifted screen points.
 */
export function spreadPins(points: readonly Point[], gap = 20): Point[] {
  const placed: Point[] = [];
  for (const p of points) {
    let x = p.x;
    for (let tries = 0; tries < 50 && placed.some((q) => Math.abs(q.x - x) < gap && Math.abs(q.y - p.y) < gap); tries++) x += gap;
    placed.push({ x, y: p.y });
  }
  return placed;
}

/**
 * Where a thread card opens next to its pin: to the right when it fits in
 * the viewport, else to the left; kept inside vertically.
 */
export function cardPosition(pin: Point, viewport: { width: number; height: number }, card = { w: 288, h: 320 }): Point {
  const right = pin.x + 18 + card.w <= viewport.width - 8;
  return { x: right ? pin.x + 18 : Math.max(8, pin.x - 14 - card.w), y: Math.max(8, Math.min(pin.y - 8, viewport.height - card.h)) };
}
