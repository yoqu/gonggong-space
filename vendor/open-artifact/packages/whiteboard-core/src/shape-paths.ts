/**
 * Shape outlines: SVG path data for every shape kind, the edge inset an
 * arrow or a label needs at a point along a side, text insets inside a shape,
 * and default sizes.
 *
 * Paths are built from a tiny command list (`M`, `L`, cubic `C`, `Z`) in the
 * shape's local box (0,0)–(w,h), so the same outline serves the renderer,
 * hit testing and arrow end clipping.
 *
 * The outlines, their flattening and insets, and the path data are computed
 * in WebAssembly (`crates/open-artifact-wb-geom/src/shape_paths.rs`); this module
 * encodes the arguments and decodes the results. Only one-line definitions
 * stay in TypeScript.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { decodeCommands, decodePoints, encodeCommands, kindCode, sideCode, utf16 } from './geom-codec.ts';
import type { ShapeElement, ShapeKind, ArrowSide } from './schema.ts';

/** A shape kind, or `frame` (a section's rounded outline). */
export type OutlineKind = ShapeKind | 'frame';

/** One outline command in local box coordinates. */
export type PathCommand =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

/** A straight segment `[x1, y1, x2, y2]`. */
export type LineSegment = [number, number, number, number];

/** Fractions of the box (0–1) kept clear of text on each side. */
export interface ShapeInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A size in board units. */
export interface ShapeSize {
  w: number;
  h: number;
}

/** The magic number that makes a cubic Bézier approximate a quarter circle. */
export const BEZIER_CIRCLE_KAPPA = 0.5523;

/**
 * A quarter-ellipse arc from (x1, y1) to (x2, y2) as a cubic. With
 * `horizontalFirst` the curve leaves horizontally and arrives vertically.
 */
export function quarterArc(x1: number, y1: number, x2: number, y2: number, horizontalFirst: boolean): PathCommand {
  return horizontalFirst
    ? ['C', x1 + (x2 - x1) * BEZIER_CIRCLE_KAPPA, y1, x2, y2 - (y2 - y1) * BEZIER_CIRCLE_KAPPA, x2, y2]
    : ['C', x1, y1 + (y2 - y1) * BEZIER_CIRCLE_KAPPA, x2 - (x2 - x1) * BEZIER_CIRCLE_KAPPA, y2, x2, y2];
}

/** Corner radius of a rectangle-like outline: pills are fully round, others at most 12. */
export function shapeCornerRadius(kind: OutlineKind | string, width: number, height: number): number {
  const half = Math.min(width, height) / 2;
  return Math.max(0, Math.min(kind === 'pill' ? half : Math.min(12, kind === 'frame' ? half : half / 2), half));
}

/** Corner points of the polygon kinds (diamond, hexagon; anything else is a parallelogram). */
export function polygonShapePoints(kind: OutlineKind | string, width: number, height: number): Array<[number, number]> {
  return decodePoints(wbGeom().polygon_shape_points(kindCode(kind), width, height));
}

/** Depth of a cylinder's elliptical cap (database top, queue end). */
export function cylinderCapDepth(width: number, height: number): number {
  return Math.min(width * 0.1, height * 0.13);
}

/** Head radius of the person shape. */
export function personHeadRadius(width: number, height: number): number {
  return Math.min(height * 0.195, width * 0.35);
}

/** Where the person shape's shoulders start. */
export function personShoulderTop(width: number, height: number): number {
  return 2 * personHeadRadius(width, height) + height * 0.03;
}

/** Depth of the document shape's wavy bottom. */
export function documentWaveDepth(width: number, height: number): number {
  return Math.min(height * 0.08, width * 0.12);
}

/** A vertical cylinder: the body plus the front lip of the top cap. */
export function databasePath(width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_path_part(0, width, height));
}

/** The person shape's head (a circle). */
export function personHeadPath(width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_path_part(5, width, height));
}

/** The person shape's body (rounded shoulders, small feet radius). */
export function personBodyPath(width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_path_part(6, width, height));
}

/** A page with rounded top corners and a wavy bottom. */
export function documentPath(width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_path_part(2, width, height));
}

/** The cloud's four bumps as unit-box cubic control points. */
export const CLOUD_CURVES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-0.068, 0.99, -0.068, 0.46, 0.17, 0.46],
  [0.12, 0.2, 0.32, 0.07, 0.41, 0.21],
  [0.45, -0.07, 0.73, -0.07, 0.75, 0.29],
  [1.07, 0.24, 1.09, 0.99, 0.78, 0.99],
];

/** The cloud outline. */
export function cloudPath(width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_path_part(3, width, height));
}

/** A horizontal cylinder: the database outline turned on its side. */
function queuePath(width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_path_part(1, width, height));
}

/** Outlines of the kinds drawn from curves, by kind. */
export const CURVED_SHAPE_PATHS: Readonly<Record<'database' | 'queue' | 'document' | 'cloud' | 'person', (width: number, height: number) => PathCommand[]>> = {
  database: databasePath,
  queue: queuePath,
  document: documentPath,
  cloud: cloudPath,
  person: (width, height) => decodeCommands(wbGeom().shape_path_part(4, width, height)),
};

/** A kind whose outline is one of {@link CURVED_SHAPE_PATHS}. */
export type CurvedShapeKind = keyof typeof CURVED_SHAPE_PATHS;

/** True for kinds drawn from curves (database, queue, document, cloud, person). */
export function isCurvedShapeKind(kind: unknown): kind is CurvedShapeKind {
  return typeof kind === 'string' && Object.hasOwn(CURVED_SHAPE_PATHS, kind);
}

/** The outline commands of a kind in its local box. */
export function shapeOutlineCommands(kind: OutlineKind, width: number, height: number): PathCommand[] {
  return decodeCommands(wbGeom().shape_outline_commands(kindCode(kind), width, height));
}

/**
 * Walks an outline as straight segments: lines as they are, each cubic
 * flattened into 16 pieces. `visit(x1, y1, x2, y2)` gets every piece.
 */
export function walkPathSegments(commands: readonly PathCommand[], visit: (x1: number, y1: number, x2: number, y2: number) => void): void {
  const segments = wbGeom().walk_path_segments(encodeCommands(commands));
  for (let index = 0; index + 3 < segments.length; index += 4) visit(segments[index]!, segments[index + 1]!, segments[index + 2]!, segments[index + 3]!);
}

/**
 * The flattened segments of a curved outline plus its inner lines (the
 * document's side walls below the wave, the person's neck), for hit testing
 * and hand-drawn rendering. `undefined` for kinds that are not curved.
 */
export function curvedShapeLineSegments(kind: OutlineKind, width: number, height: number): LineSegment[] | undefined {
  if (!isCurvedShapeKind(kind)) return undefined;
  const values = wbGeom().curved_shape_line_segments(kindCode(kind), width, height);
  const lines: LineSegment[] = new Array(values.length >> 2);
  for (let index = 0; index < lines.length; index++) lines[index] = [values[index * 4]!, values[index * 4 + 1]!, values[index * 4 + 2]!, values[index * 4 + 3]!];
  return lines;
}

/**
 * Distance from a side of the box to the outline, measured along the line
 * that crosses that side at `lineOffset` (from the side's start). `Infinity`
 * when the outline never crosses that line.
 */
export function shapeEdgeInsetAtLine(pathCommands: readonly PathCommand[], width: number, height: number, side: ArrowSide, lineOffset: number): number {
  return wbGeom().shape_edge_inset_at_line(encodeCommands(pathCommands), width, height, sideCode(side), lineOffset);
}

/** {@link shapeEdgeInsetAtLine} for curved kinds, with their special cases. */
export function curvedShapeEdgeInset(kind: CurvedShapeKind, width: number, height: number, side: ArrowSide, lineOffset: number, fallback: number): number {
  return wbGeom().curved_shape_edge_inset(kindCode(kind), width, height, sideCode(side), lineOffset, fallback);
}

/** How far a rounded corner of `radius` pulls the edge in at `offset` from the side's middle. */
export function roundedCornerInset(radius: number, halfSpan: number, offset: number): number {
  return wbGeom().rounded_corner_inset(radius, halfSpan, offset);
}

/**
 * How far inside the box's `side` the outline is, at `offset` from the
 * side's middle (negative: toward the side's start). Arrows end there.
 */
export function shapeEdgeInset(kind: OutlineKind, width: number, height: number, side: ArrowSide, offset: number, fallback = 0): number {
  return wbGeom().shape_edge_inset(kindCode(kind), width, height, sideCode(side), offset, fallback);
}

/** Path data numbers rounded to one decimal. */
export function formatPathNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** SVG `d` of an outline in its local box. */
export function shapePathData(kind: OutlineKind, width: number, height: number): string {
  return wbGeom().shape_path_data(kindCode(kind), width, height);
}

/** Corner radius used to soften polygon corners (diamond, hexagon, parallelogram). */
export function polygonCornerRadius(kind: OutlineKind | string): number {
  return kind === 'diamond' || kind === 'hexagon' || kind === 'parallelogram' ? 6 : 0;
}

/**
 * SVG `d` of an outline whose polygon corners are softened by small arcs
 * (a stroke with round joins). Other kinds, or `rounded` false, fall back to
 * {@link shapePathData}.
 */
export function roundedPolygonPathData(kind: OutlineKind, width: number, height: number, rounded: boolean): string {
  return wbGeom().rounded_polygon_path_data(kindCode(kind), width, height, rounded);
}

/** SVG `d` of a cylinder's full cap ellipse (database top, queue right end), drawn on top of the fill. */
export function cylinderCapPathData(kind: OutlineKind, width: number, height: number): string | undefined {
  return wbGeom().cylinder_cap_path_data(kindCode(kind), width, height);
}

/** A deterministic random generator (FNV-1a seed, then a mulberry-style mix), values in [0, 1). */
export function seededRandomFromString(seedText: string): () => number {
  const geom = wbGeom();
  const state = geom.seeded_random_state(utf16(seedText));
  let draws = 0;
  return () => geom.seeded_random_value(state, draws++);
}

/** Default size of a new shape of a kind. */
export function defaultShapeSize(kind: ShapeKind): ShapeSize {
  if (kind === 'pill') return { w: 180, h: 64 };
  if (kind === 'rect') return { w: 200, h: 96 };
  if (kind === 'rounded' || kind === 'ellipse') return { w: 160, h: 160 };
  return { w: kind === 'person' ? 140 : kind === 'database' ? 160 : 240, h: 160 };
}

/** Fractions of a shape's box kept clear of its text, so text sits inside the outline. */
export function shapeTextInsets(kind: ShapeKind, width: number, height: number): ShapeInsets {
  const [left, right, top, bottom] = wbGeom().shape_text_insets(kindCode(kind), width, height) as unknown as [number, number, number, number];
  return { left, right, top, bottom };
}

/** {@link shapeTextInsets} as CSS percentages (`left`, `right`, `top`, `bottom`). */
export function shapeTextInsetStyle(shape: Pick<ShapeElement, 'kind' | 'w' | 'h'>): Record<keyof ShapeInsets, string> {
  const { left, right, top, bottom } = shapeTextInsets(shape.kind, shape.w, shape.h);
  const percent = (value: number): string => `${value * 100}%`;
  return { left: percent(left), right: percent(right), top: percent(top), bottom: percent(bottom) };
}
