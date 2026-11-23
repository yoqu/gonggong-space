/**
 * Ink: how lines look drawn by hand.
 *
 * Two parts:
 *
 * - **Hand-drawn outlines.** A shape's outline (from `shape-paths.ts`) is
 *   flattened into polylines and turned into a filled ribbon whose width
 *   follows a smooth, seeded "pen pressure" noise, tapering at open ends and
 *   breaking at sharp corners (where a small blob hides the joint). The seed
 *   is the element id, so an outline looks the same on every screen.
 * - **Pen strokes.** Freehand stroke points (flat `[x0, y0, x1, y1, …]`)
 *   become a smooth quadratic path; helpers append points while drawing,
 *   straighten a held tail into a line, and normalize a finished stroke to
 *   its top-left corner.
 *
 * Flattening, pressure, ribbons and stroke paths run in WebAssembly
 * (`crates/open-artifact-wb-geom/src/ink.rs`); this module encodes the arguments and
 * decodes the results. The pen helpers that edit the caller's point array
 * in place while drawing stay in TypeScript.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { decodePoints, encodeCommands, encodePoints, kindCode, utf16 } from './geom-codec.ts';
import { MAX_STROKE_POINTS, type ShapeKind } from './schema.ts';
import type { OutlineKind, PathCommand } from './shape-paths.ts';

/** A point `[x, y]`. */
export type InkPoint = readonly [number, number];

/** A flattened outline piece. */
export interface InkPolyline {
  /** Points along the piece. */
  pts: InkPoint[];
  /** Indexes of points where the outline turns sharply. */
  corners: number[];
  /** The piece closes on itself. */
  closed: boolean;
}

/** Length over which an open ink line tapers in, board units. */
export const INK_TAPER_LENGTH = 12;
/** Flatness tolerance of cubic flattening. */
export const INK_FLATNESS = 0.1;
/** Turn (radians) above which a joint counts as a corner. */
export const INK_CORNER_ANGLE = 0.05;
/** Outline length at which pressure noise has its base frequency. */
export const INK_NOISE_BASE_LENGTH = 48;

/** Half the ribbon width for a pressure in [0, 1]. */
export function inkHalfWidth(pressure: number): number {
  return 0.27 + 0.853 * pressure;
}

/** `a - b`. */
export function subtractInkPoints(a: InkPoint, b: InkPoint): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}

/** Distance between two points. */
export function inkPointDistance(a: InkPoint, b: InkPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Midpoint of two points. */
export function inkMidpoint(a: InkPoint, b: InkPoint): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Absolute angle (radians) between two direction vectors. */
export function inkTurnAngle(a: InkPoint, b: InkPoint): number {
  return Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
}

/** A point as path text with two decimals. */
export function formatInkPoint(point: InkPoint): string {
  return `${Math.round(point[0] * 100) / 100} ${Math.round(point[1] * 100) / 100}`;
}

/**
 * Flattens outline commands into polylines with points at most `step`
 * apart, noting sharp corners. Pieces with fewer than three points are
 * dropped.
 */
export function flattenPathToPolylines(path: readonly PathCommand[], step: number): InkPolyline[] {
  const values = wbGeom().ink_flatten_path(encodeCommands(path), step);
  const polylines: InkPolyline[] = [];
  let at = 1;
  for (let index = 0; index < values[0]!; index++) {
    const closed = values[at] === 1;
    const pointCount = values[at + 1]!;
    const pts = decodePoints(values, at + 2, pointCount);
    at += 2 + pointCount * 2;
    const cornerCount = values[at]!;
    const corners = Array.from(values.subarray(at + 1, at + 1 + cornerCount));
    at += 1 + cornerCount;
    polylines.push({ pts, corners, closed });
  }
  return polylines;
}

/** Hermite smoothstep of `x` between two edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Periodic 1-D value noise over [0, 1) with `count` random knots. */
export function createValueNoise(count: number, random: () => number): (x: number) => number {
  const values = Float64Array.from({ length: count }, () => random());
  return (x) => wbGeom().ink_value_noise(count, values, x);
}

/** Pen pressure and sideways stray along an outline, as functions of the position (0–1). */
export interface InkPressure {
  press(at: number): number;
  stray(at: number): number;
}

/**
 * Seeded pressure for an outline of `length`: noise whose frequency grows
 * with the length (two octaves blended), scaled by `strength`.
 */
export function createInkPressure(length: number, strength: number, seed: string): InkPressure {
  const seedUnits = utf16(seed);
  return {
    press: (at) => wbGeom().ink_pressure(length, strength, seedUnits, 0, at),
    stray: (at) => wbGeom().ink_pressure(length, strength, seedUnits, 1, at),
  };
}

/** One side of a ribbon as smooth quadratic segments (continuing a path). */
export function inkSidePath(points: readonly InkPoint[]): string {
  return wbGeom().ink_side_path(encodePoints(points));
}

/** A closed smooth loop through points (quadratics through midpoints). */
export function closedInkLoopPath(points: readonly InkPoint[]): string {
  return wbGeom().closed_ink_loop_path(encodePoints(points));
}

/** A small round blob at a corner, hiding where two ribbons meet. */
export function inkCornerBlob([x, y]: InkPoint, size: number): string {
  return wbGeom().ink_corner_blob(x, y, size);
}

/** The filled ribbon (path data) of one polyline. */
export function inkPolylineOutline({ pts, corners, closed }: InkPolyline, strength: number, seed: string): string {
  return wbGeom().ink_polyline_outline(encodePoints(pts), Uint32Array.from(corners), closed, strength, utf16(seed));
}

/**
 * The hand-drawn outline of a shape as filled path data (fill it with the
 * stroke color; use `fill-rule: nonzero`). Deterministic for a seed.
 */
export function handDrawnShapeOutline(kind: OutlineKind, w: number, h: number, seed: string): string {
  return wbGeom().hand_drawn_shape_outline(kindCode(kind), w, h, utf16(seed));
}

/** {@link handDrawnShapeOutline} of many shapes in one call. */
export function handDrawnShapeOutlines(shapes: ReadonlyArray<{ kind: OutlineKind; w: number; h: number; seed: string }>): string[] {
  if (shapes.length === 0) return [];
  const sizes = new Float64Array(shapes.length * 3);
  const lengths = new Uint32Array(shapes.length);
  let total = 0;
  shapes.forEach((shape, index) => {
    sizes.set([kindCode(shape.kind), shape.w, shape.h], index * 3);
    lengths[index] = shape.seed.length;
    total += shape.seed.length;
  });
  const seeds = new Uint16Array(total);
  let at = 0;
  for (const shape of shapes) for (let index = 0; index < shape.seed.length; index++) seeds[at++] = shape.seed.charCodeAt(index);
  return wbGeom().hand_drawn_shape_outlines(sizes, seeds, lengths).split('\n');
}

/* -------------------------------------------------------------------------- */
/* Pen strokes                                                                */
/* -------------------------------------------------------------------------- */

/** Points closer than this to the previous one are skipped while drawing. */
export const MIN_PEN_POINT_DISTANCE = 1.5;
/** Spacing of the points of a straightened tail. */
export const PEN_LINE_STEP = 16;
/** Most points a straightened tail adds. */
export const PEN_LINE_MAX_STEPS = 200;
/** Width a sketch stroke is drawn with when it has no width of its own. */
export const DEFAULT_STROKE_WIDTH = 4;

/**
 * Appends a point to a flat point list while drawing. Returns `false` when
 * it was too close to the last point or the stroke is full.
 */
export function appendPenPoint(points: number[], x: number, y: number): boolean {
  const length = points.length;
  if (length >= MAX_STROKE_POINTS * 2) return false;
  if (length >= 2) {
    const dx = x - (points[length - 2] ?? 0);
    const dy = y - (points[length - 1] ?? 0);
    if (dx * dx + dy * dy < MIN_PEN_POINT_DISTANCE * MIN_PEN_POINT_DISTANCE) return false;
  }
  points.push(x, y);
  return true;
}

/**
 * Replaces the points after `tailStart` (a flat index) with a straight line
 * to (x, y): holding still while drawing snaps the tail straight.
 */
export function straightenPenTail(points: number[], tailStart: number, x: number, y: number): void {
  const startX = points[tailStart - 2] ?? x;
  const startY = points[tailStart - 1] ?? y;
  const distance = Math.hypot(x - startX, y - startY);
  const steps = Math.min(PEN_LINE_MAX_STEPS, Math.ceil(distance / PEN_LINE_STEP));
  if (tailStart + 2 * (steps + 2) > MAX_STROKE_POINTS * 2) return;
  points.length = tailStart;
  if (distance < MIN_PEN_POINT_DISTANCE) return;
  points.push(startX, startY);
  for (let step = 1; step < steps; step++) points.push(startX + ((x - startX) * step) / steps, startY + ((y - startY) * step) / steps);
  points.push(x, y, x, y);
}

/**
 * SVG `d` of a stroke's flat points: quadratics through midpoints, so the
 * line is smooth; a single point becomes a dot.
 */
export function strokePointsToPath(points: readonly number[]): string {
  // Stays in TypeScript: it is only number formatting, which V8 does faster
  // than the WebAssembly module can.
  if (points.length < 2) return '';
  const at = (index: number): number => points[index] ?? 0;
  if (points.length < 6) {
    let path = `M ${at(0)} ${at(1)}`;
    for (let index = 2; index + 1 < points.length; index += 2) path += ` L ${at(index)} ${at(index + 1)}`;
    if (points.length === 2) path += ' l 0.01 0';
    return path;
  }
  let path = `M ${at(0)} ${at(1)}`;
  for (let index = 2; index + 3 < points.length; index += 2) {
    const x = at(index);
    const y = at(index + 1);
    path += ` Q ${x} ${y} ${(x + at(index + 2)) / 2} ${(y + at(index + 3)) / 2}`;
  }
  return `${path} L ${at(points.length - 2)} ${at(points.length - 1)}`;
}

const strokePathCache = new WeakMap<readonly number[], string>();

/** {@link strokePointsToPath}, cached per points array. */
export function cachedStrokePath(points: readonly number[]): string {
  let path = strokePathCache.get(points);
  if (path === undefined) strokePathCache.set(points, (path = strokePointsToPath(points)));
  return path;
}

/**
 * A finished stroke: absolute flat points become a position (the top-left
 * corner) and points relative to it, rounded to 0.1.
 */
export function normalizeStrokePoints(points: readonly number[]): { x: number; y: number; points: number[] } {
  const values = wbGeom().normalize_stroke_points(Float64Array.from(points));
  return { x: values[0]!, y: values[1]!, points: Array.from(values.subarray(2)) };
}

/** Bounds of a stroke's relative points, padded by half its width. */
export function strokeBounds(stroke: { x: number; y: number; points: readonly number[]; width?: number }): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = wbGeom().stroke_bounds(stroke.x, stroke.y, Float64Array.from(stroke.points, (value) => value ?? 0), stroke.width ?? DEFAULT_STROKE_WIDTH) as unknown as [number, number, number, number];
  return { x, y, w, h };
}

/** Re-exported for callers that only import ink: the kinds a hand-drawn outline accepts. */
export type HandDrawnKind = ShapeKind | 'frame';
