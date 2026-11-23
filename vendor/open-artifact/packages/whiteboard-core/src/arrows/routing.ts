/**
 * Elbow arrow routing: orthogonal routes between two boxes (or free points)
 * that leave and arrive square to a side, keep a stub clear of each box,
 * never turn back on themselves and never run through their own ends.
 *
 * - {@link planElbowRoute} picks the simplest valid automatic route (a
 *   straight level line, a Z, a U, a corner, or a loop around the boxes)
 *   and applies the arrow's `jog` to the middle leg of a Z.
 * - {@link buildRouteFromBends} turns a manual route (`bends`: first axis
 *   and the coordinates of the legs between the ends) into points, or says
 *   why it is invalid.
 * - {@link bendsThroughPoints} finds bends that pass through points a
 *   person (or the agent) asked the route to visit.
 * - {@link moveRouteSegment} drags one leg sideways, keeping stubs valid.
 * - {@link roundedRoutePath} draws a route with rounded corners.
 *
 * All coordinates are board units; a box with zero width and height is a
 * free point.
 *
 * The algorithms run in WebAssembly (`crates/open-artifact-wb-geom/src/routing.rs`);
 * this module encodes the arguments as flat number arrays and decodes the
 * results. Only one-line definitions stay in TypeScript.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import type { ArrowSide } from '../schema.ts';

/** A route point `[x, y]`. */
export type RoutePoint = readonly [number, number];

/** A box an arrow end attaches to; `w = h = 0` marks a free point. */
export interface RouteBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One straight leg of a route (consecutive legs in the same direction are merged). */
export interface RouteSegment {
  a: RoutePoint;
  b: RoutePoint;
  dx: number;
  dy: number;
  len: number;
  /** Unit direction, each component -1, 0 or 1. */
  dir: readonly [number, number];
}

/** Why a route is not valid. */
export type RouteProblem = 'leg_too_short' | 'turns_back' | 'crosses_itself' | 'wrong_side' | 'hits_its_own_end' | 'ends_overlap' | 'too_many_turns';

/** The family of an automatic route. */
export type ElbowShape = 'level' | 'Z' | 'U' | 'loop' | 'corner' | 'four';

/** An automatic route. */
export interface ElbowPlan {
  pts: RoutePoint[];
  shape: ElbowShape;
  /** The jog actually applied to a Z's middle leg, relative to the midline. */
  jog?: number;
}

/** The axis a manual route starts on: `h` horizontal, `v` vertical. */
export type BendAxis = 'h' | 'v';

/** A manual route: its first axis and the coordinates of its inner legs. */
export interface RouteBends {
  first: BendAxis;
  at: number[];
}

/** Unit vector pointing out of each side. */
export const SIDE_DIRECTIONS: Readonly<Record<ArrowSide, readonly [number, number]>> = {
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Shortest first and last leg of a route. */
export const MIN_ARROW_END_LEG = 16;
/** Free arrow ends this close to an element snap to it. */
export const ARROW_POINT_SNAP_DISTANCE = 12;
/** A manual route whose middle leg is shorter than this straightens. */
export const MANUAL_ARROW_STRAIGHTEN_LIMIT = 12;
/** Room the arrow head needs at an attached end. */
export const ARROW_HEAD_CLEARANCE = 10;

// Codes shared with crates/open-artifact-wb-geom/src/routing.rs.
const SIDES: readonly ArrowSide[] = ['top', 'bottom', 'left', 'right'];
const PROBLEMS: readonly RouteProblem[] = ['leg_too_short', 'turns_back', 'crosses_itself', 'wrong_side', 'hits_its_own_end', 'ends_overlap', 'too_many_turns'];
const SHAPES: readonly ElbowShape[] = ['level', 'Z', 'U', 'loop', 'corner', 'four'];
const NO_SIDE = 255;

/** A side's code; anything that is not a side is "none". */
function sideCode(side: ArrowSide | undefined): number {
  const index = side === undefined ? -1 : SIDES.indexOf(side);
  return index < 0 ? NO_SIDE : index;
}

function encodePoints(points: readonly RoutePoint[]): Float64Array {
  const out = new Float64Array(points.length * 2);
  for (let index = 0; index < points.length; index++) {
    out[index * 2] = points[index]![0];
    out[index * 2 + 1] = points[index]![1];
  }
  return out;
}

function encodeBoxes(from: RouteBox, to: RouteBox): Float64Array {
  return Float64Array.of(from.x, from.y, from.w, from.h, to.x, to.y, to.w, to.h);
}

function decodePoints(values: Float64Array, start = 0): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = start; index + 1 < values.length; index += 2) points.push([values[index]!, values[index + 1]!]);
  return points;
}

/** True for a free point (zero-size box). */
export function isPointBox(box: RouteBox): boolean {
  return box.w === 0 && box.h === 0;
}

/** The middle of a box side, moved `offset` along the side. */
export function sideAnchorPoint(box: RouteBox, side: ArrowSide, offset = 0): [number, number] {
  if (side === 'top') return [box.x + box.w / 2 + offset, box.y];
  if (side === 'bottom') return [box.x + box.w / 2 + offset, box.y + box.h];
  if (side === 'left') return [box.x, box.y + box.h / 2 + offset];
  return [box.x + box.w, box.y + box.h / 2 + offset];
}

/** Moves `value` along `dir` from `origin` until it is at least `minimum` away. */
export function pushPastStub(origin: number, dir: number, value: number, minimum = MIN_ARROW_END_LEG): number {
  return origin + dir * Math.max(minimum, (value - origin) * dir);
}

/** The side of a box that faces a point (relative to the box's aspect). */
export function sideFacingPoint(box: RouteBox, point: RoutePoint): ArrowSide {
  return SIDES[wbGeom().side_facing_point(Float64Array.of(box.x, box.y, box.w, box.h), point[0], point[1])]!;
}

/** True when two boxes overlap (a point overlaps a box it lies in). */
export function boxesOverlap(a: RouteBox, b: RouteBox): boolean {
  return wbGeom().boxes_overlap(encodeBoxes(a, b));
}

/** The legs of a route, merging consecutive legs that run the same way and dropping empty ones. */
export function routeSegments(points: readonly RoutePoint[]): RouteSegment[] {
  const values = wbGeom().route_segments(encodePoints(points));
  const segments: RouteSegment[] = [];
  for (let index = 0; index + 8 < values.length; index += 9)
    segments.push({
      a: [values[index]!, values[index + 1]!],
      b: [values[index + 2]!, values[index + 3]!],
      dx: values[index + 4]!,
      dy: values[index + 5]!,
      len: values[index + 6]!,
      dir: [values[index + 7]!, values[index + 8]!],
    });
  return segments;
}

/** True when two axis-aligned legs touch or overlap. */
export function segmentsOverlap(a: RouteSegment, b: RouteSegment): boolean {
  const range = (segment: RouteSegment, axis: 0 | 1): [number, number] => [Math.min(segment.a[axis], segment.b[axis]), Math.max(segment.a[axis], segment.b[axis])];
  return ([0, 1] as const).every((axis) => range(a, axis)[0] <= range(b, axis)[1] && range(b, axis)[0] <= range(a, axis)[1]);
}

/** True when a leg passes within `margin` of a box. */
export function segmentNearBox(segment: RouteSegment, box: RouteBox, margin: number): boolean {
  const minX = Math.min(segment.a[0], segment.b[0]);
  const maxX = Math.max(segment.a[0], segment.b[0]);
  const minY = Math.min(segment.a[1], segment.b[1]);
  const maxY = Math.max(segment.a[1], segment.b[1]);
  return maxX > box.x - margin && minX < box.x + box.w + margin && maxY > box.y - margin && minY < box.y + box.h + margin;
}

/**
 * Why a route is invalid, or `undefined` when it is valid: every leg
 * horizontal or vertical, no U-turns, end legs at least 16 and inner legs
 * at least 12 long, no leg crossing an earlier one, leaving `fromSide` and
 * arriving into `toSide`, and staying clear of both boxes.
 */
export function checkArrowRoute(
  points: readonly RoutePoint[],
  fromBox: RouteBox,
  fromSide: ArrowSide,
  toBox: RouteBox,
  toSide: ArrowSide,
  extraClearance = 0,
): RouteProblem | undefined {
  const code = wbGeom().check_arrow_route(encodePoints(points), encodeBoxes(fromBox, toBox), sideCode(fromSide), sideCode(toSide), extraClearance);
  if (code === -2) throw new TypeError(`Not an arrow side: ${String(sideCode(fromSide) === NO_SIDE ? fromSide : toSide)}`);
  return code < 0 ? undefined : PROBLEMS[code];
}

/** True when {@link checkArrowRoute} finds no problem. */
export function isArrowRouteValid(points: readonly RoutePoint[], fromBox: RouteBox, fromSide: ArrowSide, toBox: RouteBox, toSide: ArrowSide, extraClearance = 0): boolean {
  return checkArrowRoute(points, fromBox, fromSide, toBox, toSide, extraClearance) === undefined;
}

/**
 * The automatic elbow route between two ends, or `undefined` when none is
 * valid (overlapping boxes, ends too close). `exitOffsets` slide each
 * anchor along its side (fanning several arrows out of one side).
 */
export function planElbowRoute(
  fromBox: RouteBox,
  fromSide: ArrowSide,
  toBox: RouteBox,
  toSide: ArrowSide,
  jog = 0,
  exitOffsets: readonly [number, number] = [0, 0],
): ElbowPlan | undefined {
  const values = wbGeom().plan_elbow_route(encodeBoxes(fromBox, toBox), sideCode(fromSide), sideCode(toSide), jog, exitOffsets[0], exitOffsets[1]);
  if (values.length === 0) return undefined;
  return { pts: decodePoints(values, 3), shape: SHAPES[values[0]!]!, ...(values[1] === 1 ? { jog: values[2]! } : {}) };
}

/** The sides a manual route leaves and enters, implied by its first axis and bends. */
export function sidesForBends(fromBox: RouteBox, toBox: RouteBox, firstAxis: BendAxis, bends: readonly number[]): [ArrowSide, ArrowSide] {
  const code = wbGeom().sides_for_bends(encodeBoxes(fromBox, toBox), firstAxis === 'h' ? 0 : 1, Float64Array.from(bends));
  return [SIDES[code >> 2]!, SIDES[code & 3]!];
}

/**
 * The points of a manual route, or the problem that makes it invalid. The
 * first and last bends are pushed out past the end stubs.
 */
export function buildRouteFromBends(
  fromBox: RouteBox,
  fromSide: ArrowSide | undefined,
  toBox: RouteBox,
  toSide: ArrowSide | undefined,
  firstAxis: BendAxis,
  bends: readonly number[],
  extraClearance = 0,
  exitOffsets: readonly [number, number] = [0, 0],
): RoutePoint[] | RouteProblem {
  const values = wbGeom().build_route_from_bends(
    encodeBoxes(fromBox, toBox),
    sideCode(fromSide),
    sideCode(toSide),
    firstAxis === 'h' ? 0 : 1,
    Float64Array.from(bends),
    extraClearance,
    exitOffsets[0],
    exitOffsets[1],
  );
  return values[0] === -1 ? decodePoints(values, 1) : PROBLEMS[values[0]!]!;
}

/** {@link buildRouteFromBends}, `undefined` instead of a problem. */
export function routeFromBendsOrUndefined(...args: Parameters<typeof buildRouteFromBends>): RoutePoint[] | undefined {
  const route = buildRouteFromBends(...args);
  return typeof route === 'string' ? undefined : route;
}

function decodeBends(values: Float64Array, start: number): RouteBends {
  return { first: values[start] === 0 ? 'h' : 'v', at: Array.from(values.subarray(start + 1)) };
}

/** The manual bends that reproduce a route (alternating axes), or `undefined` for a single leg. */
export function bendsFromRoute(points: readonly RoutePoint[]): RouteBends | undefined {
  const values = wbGeom().bends_from_route(encodePoints(points));
  return values.length === 0 ? undefined : decodeBends(values, 0);
}

/** Snaps route points within 12 of a neighbor's coordinate onto it, both ways. */
export function alignNearbyRoutePoints(points: readonly RoutePoint[]): Array<[number, number]> {
  return decodePoints(wbGeom().align_nearby_route_points(encodePoints(points)));
}

/** Drops middle points of three collinear (axis-aligned) points. */
export function dropCollinearPoints(points: readonly RoutePoint[]): RoutePoint[] {
  return decodePoints(wbGeom().drop_collinear_points(encodePoints(points)));
}

/**
 * An orthogonal path from `start` (leaving along `startDir`) through each
 * point of `through` to `end` (arriving against `endDir`), preferring to
 * keep its heading at each turn.
 */
export function elbowPathThroughPoints(
  start: RoutePoint,
  startDir: readonly [number, number] | undefined,
  through: readonly RoutePoint[],
  end: RoutePoint,
  endDir: readonly [number, number] | undefined,
): RoutePoint[] {
  const ends = Float64Array.of(start[0], start[1], startDir ? 1 : 0, startDir?.[0] ?? 0, startDir?.[1] ?? 0, end[0], end[1], endDir ? 1 : 0, endDir?.[0] ?? 0, endDir?.[1] ?? 0);
  return decodePoints(wbGeom().elbow_path_through_points(ends, encodePoints(through)));
}

/**
 * Manual bends whose route visits `points` in order (within `tolerance`),
 * trying the given sides or, when free, the side facing the first/last
 * point and every side ahead of it. `straight` when a straight line does;
 * a problem when no route works.
 */
export function bendsThroughPoints(
  fromBox: RouteBox,
  fromSide: ArrowSide | undefined,
  toBox: RouteBox,
  toSide: ArrowSide | undefined,
  points: readonly RoutePoint[],
  maxBends: number,
  tolerance: number,
): RouteBends | 'straight' | RouteProblem | undefined {
  const values = wbGeom().bends_through_points(encodeBoxes(fromBox, toBox), sideCode(fromSide), sideCode(toSide), encodePoints(points), maxBends, tolerance);
  if (values.length === 0) return undefined;
  if (values[0] === 0) return 'straight';
  if (values[0] === 1) return PROBLEMS[values[1]!]!;
  return decodeBends(values, 1);
}

/** True when leg `index` of a route is long enough to be dragged sideways. */
export function canMoveRouteSegment(points: readonly RoutePoint[], index: number, attached: readonly [boolean, boolean], stubs: readonly [number, number] = [MIN_ARROW_END_LEG, MIN_ARROW_END_LEG]): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  return wbGeom().can_move_route_segment(encodePoints(points), index, attached[0], attached[1], stubs[0], stubs[1]);
}

/**
 * The route with leg `index` dragged sideways to `target` (the leg's new
 * cross coordinate). Neighboring legs stretch; an end leg attached to a box
 * keeps its stub; the leg snaps onto a neighbor within 12.
 */
export function moveRouteSegment(
  points: readonly RoutePoint[],
  index: number,
  target: number,
  attached: readonly [boolean, boolean],
  stubs: readonly [number, number] = [MIN_ARROW_END_LEG, MIN_ARROW_END_LEG],
): RoutePoint[] {
  if (!canMoveRouteSegment(points, index, attached, stubs)) return [...points];
  return decodePoints(wbGeom().move_route_segment(encodePoints(points), index, target, attached[0], attached[1], stubs[0], stubs[1]));
}

/** A rounded corner of a route: where the curve starts (`a`) and ends (`b`) around `corner`. */
export interface RouteCorner {
  corner: RoutePoint;
  a: RoutePoint;
  /** The curve's midpoint (for hit testing and labels). */
  mid: RoutePoint;
  b: RoutePoint;
}

/**
 * The rounded corners of a route (radius up to 10, never eating into an
 * attached end's head room).
 */
export function roundedRouteCorners(points: readonly RoutePoint[], attachedEnds: readonly [boolean, boolean]): RouteCorner[] {
  const values = wbGeom().rounded_route_corners(encodePoints(points), attachedEnds[0], attachedEnds[1]);
  const corners: RouteCorner[] = [];
  for (let index = 0; index + 7 < values.length; index += 8)
    corners.push({
      corner: [values[index]!, values[index + 1]!],
      a: [values[index + 2]!, values[index + 3]!],
      mid: [values[index + 4]!, values[index + 5]!],
      b: [values[index + 6]!, values[index + 7]!],
    });
  return corners;
}

/** SVG `d` of a route with rounded corners. */
export function roundedRoutePath(points: readonly RoutePoint[], attachedEnds: readonly [boolean, boolean]): string {
  if (points.length === 0) throw new TypeError('A route needs at least one point');
  return wbGeom().rounded_route_path(encodePoints(points), attachedEnds[0], attachedEnds[1]);
}

/** The leg of a route that carries its label: the middle leg, or the longest of an even count. */
export interface RouteLabelSegment {
  a: RoutePoint;
  b: RoutePoint;
  len: number;
  /** The leg is horizontal (or more horizontal than vertical). */
  level: boolean;
}

/** {@link RouteLabelSegment} of a route. */
export function routeLabelSegment(points: readonly RoutePoint[]): RouteLabelSegment {
  const values = wbGeom().route_label_segment(encodePoints(points));
  if (values.length === 0) throw new TypeError('Reduce of empty array with no initial value');
  // The leg's own points (callers find the leg by identity).
  const index = values[6]!;
  return { a: points[index]!, b: points[index + 1]!, len: values[4]!, level: values[5] === 1 };
}
