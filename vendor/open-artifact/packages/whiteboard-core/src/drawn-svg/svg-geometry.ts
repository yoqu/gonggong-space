/**
 * SVG geometry without a DOM: affine matrices and `transform` lists, path
 * data flattened to polylines (lines, cubic and quadratic Béziers, elliptic
 * arcs), and basic shapes (`rect`, `circle`, …) flattened through their
 * equivalent path. The drawn-SVG vetting, hand-drawn restyling and contrast
 * layering all measure shapes with these.
 *
 * Polylines are flat `[x0, y0, x1, y1, …]` arrays. A sharp corner (a turn
 * of more than 38°) repeats its point, which is how the brush knows to
 * start a new stroke there.
 */

import { MAX_SVG_SOURCE_CHARS } from '../image-source.ts';

/** An affine matrix `[a, b, c, d, e, f]` (as in SVG `matrix(…)`). */
export type SvgMatrix = readonly [number, number, number, number, number, number];

/** A flattened polyline: `[x0, y0, x1, y1, …]`. */
export type SvgPolyline = number[];

/** A point in user space. */
export type SvgPoint = readonly [number, number];

/** The read-only slice of an element that geometry needs (an `XmlElement` or a DOM `Element`). */
export interface SvgShapeSource {
  readonly localName: string;
  getAttribute(name: string): string | null;
}

/** A flattened path point; `smooth` points are inside a curve (never corners). */
export interface SvgPathPoint {
  x: number;
  y: number;
  smooth: boolean;
}

/** Attributes holding geometry (they must be plain numbers for a shape to be measured). */
export const SVG_GEOMETRY_ATTRIBUTES: readonly string[] = ['d', 'points', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2'];

/** A number as allowed in a `transform` (no exponents, bounded digits). */
export const SVG_NUMBER_SOURCE = '-?(?:\\d{1,5}(?:\\.\\d{1,17})?|\\.\\d{1,17})';
/** A separator between `transform` arguments. */
export const SVG_SEPARATOR_SOURCE = '(?: *, *| +)';
/** One `translate`/`scale`/`rotate`/`matrix` call. */
export const SVG_TRANSFORM_FUNCTION_SOURCE = `(?:translate|scale|rotate|matrix)\\( *${SVG_NUMBER_SOURCE}(?:${SVG_SEPARATOR_SOURCE}${SVG_NUMBER_SOURCE}){0,5} *\\)`;
/** A whole `transform` list (skew and exotic syntax are not accepted). */
export const SVG_TRANSFORM_LIST_PATTERN = new RegExp(`^${SVG_TRANSFORM_FUNCTION_SOURCE}(?: +${SVG_TRANSFORM_FUNCTION_SOURCE})*$`);

/**
 * The identity matrix. Code compares matrices against this exact instance to
 * skip work, and {@link parseSvgTransform} returns its input unchanged for
 * an empty transform, so identity survives untransformed groups.
 */
export const IDENTITY_MATRIX: SvgMatrix = [1, 0, 0, 1, 0, 0];

/** Each transform function: the argument counts it takes and the matrix it builds. */
export const SVG_TRANSFORM_FUNCTIONS: Readonly<Record<string, readonly [readonly number[], (args: number[]) => SvgMatrix]>> = {
  translate: [[1, 2], ([tx = 0, ty = 0]) => [1, 0, 0, 1, tx, ty]],
  scale: [[1, 2], ([sx = 0, sy = sx]) => [sx, 0, 0, sy, 0, 0]],
  rotate: [
    [1, 3],
    ([degrees = 0, cx = 0, cy = 0]) => {
      const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
      return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    },
  ],
  matrix: [[6], ([a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]) => [a, b, c, d, e, f]],
};

/** Area scale factor of a matrix (|determinant|). */
export function matrixAreaScale([a, b, c, d]: SvgMatrix): number {
  return Math.abs(a * d - b * c);
}

/** The larger of the matrix's axis scale factors. */
export function matrixMaxScale([a, b, c, d]: SvgMatrix): number {
  return Math.max(Math.hypot(a, b), Math.hypot(c, d));
}

/** A power of ten to round coordinates by so they stay at ~0.1px once transformed. */
export function matrixRoundingScale(matrix: SvgMatrix): number {
  return 10 ** Math.max(1, Math.ceil(Math.log10(5 * matrixMaxScale(matrix))));
}

/** True when the matrix keeps shapes (uniform scale, rotation, translation; no skew or squash). */
export function isSimilarityMatrix([a, b, c, d]: SvgMatrix): boolean {
  return Math.abs(Math.hypot(a, b) - Math.hypot(c, d)) < 0.001 * Math.hypot(a, b) && Math.abs(a * c + b * d) < 0.001 * matrixAreaScale([a, b, c, d, 0, 0]);
}

/** The inverse of an (invertible) matrix. */
export function invertMatrix([a, b, c, d, e, f]: SvgMatrix): SvgMatrix {
  const determinant = a * d - b * c;
  return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

/** Applies a matrix to flat polylines. */
export function transformPolylines(polylines: readonly SvgPolyline[], [a, b, c, d, e, f]: SvgMatrix): SvgPolyline[] {
  return polylines.map((polyline) => polyline.map((value, index) => (index % 2 === 0 ? a * value + c * polyline[index + 1]! + e : b * polyline[index - 1]! + d * value + f)));
}

/**
 * Composes `matrix` with an SVG `transform` list (`matrix · t1 · t2 …`).
 * Returns `matrix` itself for an empty list, and `undefined` for anything
 * not accepted (unknown functions, bad arity, non-finite or degenerate
 * results).
 */
export function parseSvgTransform(matrix: SvgMatrix, transform: string): SvgMatrix | undefined {
  if (transform === '') return matrix;
  if (!SVG_TRANSFORM_LIST_PATTERN.test(transform)) return undefined;
  let result: SvgMatrix = matrix;
  for (const [, name = '', args = ''] of transform.matchAll(/([a-z]+)\(([^)]*)\)/g)) {
    const values = args.trim().split(/[ ,]+/).map(Number);
    const entry = SVG_TRANSFORM_FUNCTIONS[name];
    if (entry === undefined || !entry[0].includes(values.length)) return undefined;
    const [a, b, c, d, e, f] = result;
    const [a2, b2, c2, d2, e2, f2] = entry[1](values);
    result = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
  }
  return result.every(Number.isFinite) && matrixAreaScale(result) > 0.000001 ? result : undefined;
}

/** Largest coordinate a flattened drawing may reach. */
export const MAX_SVG_COORDINATE = 1e4;
/** Most points one flattened shape may have. */
export const MAX_FLATTENED_POINTS = 5000;

/** A number rounded to 0.1 for path data. */
export function formatSvgNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** `x y` rounded to 0.1. */
export function formatSvgPoint(x: number, y: number): string {
  return `${formatSvgNumber(x)} ${formatSvgNumber(y)}`;
}

/* -------------------------------------------------------------------------- */
/* Path flattening                                                             */
/* -------------------------------------------------------------------------- */

/** Path data tokens: a command letter or a number. */
export const SVG_PATH_TOKEN_PATTERN = /([MLHVQCSTAZ])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;

/** Arguments per path command. */
export const SVG_PATH_ARG_COUNTS: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, S: 4, T: 2, A: 7, Z: 0 };

/** The point a fraction of the way from one point to another. */
export function lerpPoint(from: SvgPoint, to: SvgPoint, amount: number): SvgPoint {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount];
}

/** Distance between two points. */
export function pointDistance(a: SvgPoint, b: SvgPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Segments to flatten a curve of a given length into (≥ 3, ≤ `maxSegments`). */
export function curveSegmentCount(length: number, maxSegments = 28): number {
  return Math.max(3, Math.min(maxSegments, Math.ceil(length / 3.5)));
}

/** Appends a flattened cubic Bézier (without its start point) to `points`. */
export function flattenCubicBezier(points: SvgPathPoint[], start: SvgPoint, control1: SvgPoint, control2: SvgPoint, end: SvgPoint, detail = 1): void {
  const segments = curveSegmentCount((pointDistance(start, control1) + pointDistance(control1, control2) + pointDistance(control2, end)) * detail);
  for (let step = 1; step <= segments; step++) {
    const t = step / segments;
    const [ab, bc, cd] = [lerpPoint(start, control1, t), lerpPoint(control1, control2, t), lerpPoint(control2, end, t)];
    const point = lerpPoint(lerpPoint(ab, bc, t), lerpPoint(bc, cd, t), t);
    points.push({ x: point[0], y: point[1], smooth: step < segments });
  }
}

/** Appends a flattened elliptic arc (SVG endpoint parameterization, without its start point) to `points`. */
export function flattenSvgArc(
  points: SvgPathPoint[],
  start: SvgPoint,
  radiusX: number,
  radiusY: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  end: SvgPoint,
  detail = 1,
): void {
  let [rx, ry] = [Math.abs(radiusX), Math.abs(radiusY)];
  if (rx < 0.000001 || ry < 0.000001 || pointDistance(start, end) < 0.000000001) {
    points.push({ x: end[0], y: end[1], smooth: false });
    return;
  }
  const rotation = (rotationDegrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
  const [halfDx, halfDy] = [(start[0] - end[0]) / 2, (start[1] - end[1]) / 2];
  const [x1p, y1p] = [cos * halfDx + sin * halfDy, -sin * halfDx + cos * halfDy];
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) [rx, ry] = [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)];
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const coefficient = (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / (rx * rx * y1p * y1p + ry * ry * x1p * x1p));
  const [cxp, cyp] = [(coefficient * rx * y1p) / ry, (-coefficient * ry * x1p) / rx];
  const [centerX, centerY] = [cos * cxp - sin * cyp + (start[0] + end[0]) / 2, sin * cxp + cos * cyp + (start[1] + end[1]) / 2];
  const startAngle = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  let sweepAngle = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - startAngle;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  const segments = Math.max(Math.ceil(Math.abs(sweepAngle) / (Math.PI / 7)), curveSegmentCount(Math.abs(sweepAngle) * Math.max(rx, ry) * detail, 40));
  for (let step = 1; step <= segments; step++) {
    const angle = startAngle + (sweepAngle * step) / segments;
    const [ex, ey] = [rx * Math.cos(angle), ry * Math.sin(angle)];
    points.push(step === segments ? { x: end[0], y: end[1], smooth: false } : { x: centerX + cos * ex - sin * ey, y: centerY + sin * ex + cos * ey, smooth: true });
  }
}

/** The angle (0…π) a path turns at `point`. */
function turnAngle(previous: { x: number; y: number }, point: { x: number; y: number }, next: { x: number; y: number }): number {
  const turn = Math.abs(Math.atan2(next.y - point.y, next.x - point.x) - Math.atan2(point.y - previous.y, point.x - previous.x));
  return Math.min(turn, 2 * Math.PI - turn);
}

/** Corners sharper than this repeat their point in a polyline. */
const SHARP_TURN = (38 * Math.PI) / 180;

/** Flattens path points to a polyline, repeating sharp corners. */
export function pathPointsToPolyline(points: readonly SvgPathPoint[]): SvgPolyline {
  const flat: number[] = [];
  points.forEach((point, index) => {
    flat.push(point.x, point.y);
    const [previous, next] = [points[index - 1], points[index + 1]];
    if (point.smooth || previous === undefined || next === undefined) return;
    if (turnAngle(previous, point, next) > SHARP_TURN) flat.push(point.x, point.y);
  });
  return flat;
}

/**
 * Flattens SVG path data to polylines, one per subpath. Returns `undefined`
 * for anything malformed, too long (`maxChars`) or out of range
 * (`coordinateLimit` on every argument). `keepDots` keeps a lone `M` as a
 * two-point polyline; `detail` scales how finely curves are sampled.
 */
export function flattenSvgPath(path: unknown, maxChars = 4000, coordinateLimit = 1000, keepDots = false, detail = 1): SvgPolyline[] | undefined {
  if (typeof path !== 'string' || path.length > maxChars) return undefined;
  if (path.replace(SVG_PATH_TOKEN_PATTERN, '').replace(/[\s,]/g, '') !== '') return undefined;
  const tokens: Array<string | number> = [...path.matchAll(SVG_PATH_TOKEN_PATTERN)].map((match) => (match[1] !== undefined ? match[1] : Number(match[2])));
  const polylines: SvgPolyline[] = [];
  let current: SvgPathPoint[] = [];
  let cursor: SvgPoint = [0, 0];
  let subpathStart: SvgPoint = [0, 0];
  let lastControl: SvgPoint | undefined;
  let lastCommand = '';
  let closed = false;
  const flush = (): void => {
    if (current.length >= 2) polylines.push(pathPointsToPolyline(current));
    else if (keepDots && !closed && current[0] !== undefined) polylines.push(pathPointsToPolyline([current[0], current[0]]));
    current = [];
  };
  let index = 0;
  let command = '';
  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token === 'string') {
      command = token;
      index += 1;
      if (command.toUpperCase() !== 'Z') continue;
    } else if (command === '') return undefined;
    else if (command.toUpperCase() === 'Z') return undefined;
    const upperCommand = command.toUpperCase();
    const relative = command !== upperCommand;
    const argCount = SVG_PATH_ARG_COUNTS[upperCommand] ?? 0;
    const args = tokens.slice(index, index + argCount);
    if (args.length < argCount || args.some((arg) => typeof arg !== 'number' || !Number.isFinite(arg) || Math.abs(arg) > coordinateLimit)) return undefined;
    index += argCount;
    const rawArgs = args as number[];
    const readPoint = (offset: number): SvgPoint => [rawArgs[offset]! + (relative ? cursor[0] : 0), rawArgs[offset + 1]! + (relative ? cursor[1] : 0)];
    const lineTo = (point: SvgPoint): void => {
      current.push({ x: point[0], y: point[1], smooth: false });
      cursor = point;
    };
    const reflectedControl = (): SvgPoint => (lastControl !== undefined ? [2 * cursor[0] - lastControl[0], 2 * cursor[1] - lastControl[1]] : cursor);
    let nextControl: SvgPoint | undefined;
    if (upperCommand === 'M') {
      flush();
      cursor = subpathStart = readPoint(0);
      current.push({ x: cursor[0], y: cursor[1], smooth: false });
      closed = false;
      // Further coordinate pairs after a moveto are implicit linetos.
      command = relative ? 'l' : 'L';
    } else if (upperCommand === 'L') lineTo(readPoint(0));
    else if (upperCommand === 'H') lineTo([rawArgs[0]! + (relative ? cursor[0] : 0), cursor[1]]);
    else if (upperCommand === 'V') lineTo([cursor[0], rawArgs[0]! + (relative ? cursor[1] : 0)]);
    else if (upperCommand === 'Z') {
      if (pointDistance(cursor, subpathStart) > 0.000001) lineTo(subpathStart);
      // A smooth closing joint repeats the second point, so the loop has no seam.
      const [first, second, beforeLast] = [current[0], current[1], current[current.length - 2]];
      if (first !== undefined && second !== undefined && beforeLast !== undefined && turnAngle(beforeLast, first, second) <= SHARP_TURN && current.length > 3) current.push({ ...second, smooth: false });
      flush();
      current.push({ x: subpathStart[0], y: subpathStart[1], smooth: false });
      closed = true;
      cursor = subpathStart;
    } else if (upperCommand === 'C' || upperCommand === 'S') {
      const control1 = upperCommand === 'C' ? readPoint(0) : lastCommand === 'C' || lastCommand === 'S' ? reflectedControl() : cursor;
      const [control2, end] = upperCommand === 'C' ? [readPoint(2), readPoint(4)] : [readPoint(0), readPoint(2)];
      flattenCubicBezier(current, cursor, control1, control2, end, detail);
      [nextControl, cursor] = [control2, end];
    } else if (upperCommand === 'Q' || upperCommand === 'T') {
      const control = upperCommand === 'Q' ? readPoint(0) : lastCommand === 'Q' || lastCommand === 'T' ? reflectedControl() : cursor;
      const end = upperCommand === 'Q' ? readPoint(2) : readPoint(0);
      flattenCubicBezier(current, cursor, lerpPoint(cursor, control, 2 / 3), lerpPoint(end, control, 2 / 3), end, detail);
      [nextControl, cursor] = [control, end];
    } else if (upperCommand === 'A') {
      const end = readPoint(5);
      flattenSvgArc(current, cursor, rawArgs[0]!, rawArgs[1]!, rawArgs[2]!, rawArgs[3] !== 0, rawArgs[4] !== 0, end, detail);
      cursor = end;
    }
    lastControl = nextControl;
    lastCommand = upperCommand;
  }
  flush();
  return polylines;
}

/** A path's arcs (each as its larger radius) and the same path with every arc drawn as a straight line. */
export interface SvgPathArcs {
  radii: number[];
  lines: string;
}

/** Splits the arcs out of path data; `undefined` when the data cannot be read. */
export function splitSvgPathArcs(path: string): SvgPathArcs | undefined {
  if (path.replace(SVG_PATH_TOKEN_PATTERN, '').replace(/[\s,]/g, '') !== '') return undefined;
  const tokens: Array<string | number> = [...path.matchAll(SVG_PATH_TOKEN_PATTERN)].map((match) => (match[1] !== undefined ? match[1] : Number(match[2])));
  const radii: number[] = [];
  const parts: string[] = [];
  let command = '';
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (typeof token === 'string') {
      command = token;
      index += 1;
      if (command.toUpperCase() !== 'A') parts.push(command);
      continue;
    }
    const argCount = SVG_PATH_ARG_COUNTS[command.toUpperCase()] ?? 0;
    const args = tokens.slice(index, index + argCount);
    if (argCount === 0 || args.length < argCount || args.some((arg) => typeof arg !== 'number')) return undefined;
    index += argCount;
    if (command.toUpperCase() === 'A') {
      radii.push(Math.max(Math.abs(Number(args[0])), Math.abs(Number(args[1]))));
      parts.push(command === 'a' ? 'l' : 'L', String(args[5]), String(args[6]));
    } else parts.push(...args.map(String));
    // Coordinate pairs after a moveto are implicit linetos.
    if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
  }
  return { radii, lines: parts.join(' ') };
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** The path equivalent of a basic shape element, or `undefined` for other elements. */
export function svgShapePathData(element: SvgShapeSource): string | undefined {
  const attr = (name: string): string => element.getAttribute(name) ?? '0';
  const ellipsePath = (rx: string, ry: string): string =>
    `M${String(Number(attr('cx')) - Number(rx))} ${attr('cy')}${['', '-'].map((sign) => `a${rx} ${ry} 0 1 1 ${sign}${String(2 * Number(rx))} 0`).join('')}Z`;
  switch (element.localName) {
    case 'path':
      return element.getAttribute('d') ?? '';
    case 'line':
      return `M${[attr('x1'), attr('y1'), attr('x2'), attr('y2')].join(' ')}`;
    case 'polyline':
      return `M${element.getAttribute('points') ?? ''}`;
    case 'polygon':
      return `M${element.getAttribute('points') ?? ''}Z`;
    case 'rect': {
      const [width, height, rx, ry] = ['width', 'height', 'rx', 'ry'].map((name) => Number(attr(name))) as [number, number, number, number];
      const [cornerX, cornerY] = [Math.min(rx || ry, width / 2), Math.min(ry || rx, height / 2)];
      const corner = (dx: number, dy: number): string => (cornerX > 0 && cornerY > 0 ? `a${[cornerX, cornerY, 0, 0, 1, dx * cornerX, dy * cornerY].join(' ')}` : '');
      const edge = (command: string, length: number): string => (length === 0 ? '' : command + String(length));
      return (
        `M${String(Number(attr('x')) + cornerX)} ${attr('y')}` +
        edge('h', width - 2 * cornerX) +
        corner(1, 1) +
        edge('v', height - 2 * cornerY) +
        corner(-1, 1) +
        edge('h', 2 * cornerX - width) +
        corner(-1, -1) +
        edge('v', 2 * cornerY - height) +
        corner(1, -1) +
        'Z'
      );
    }
    case 'circle':
      return ellipsePath(attr('r'), attr('r'));
    case 'ellipse':
      return ellipsePath(attr('rx'), attr('ry'));
    default:
      return undefined;
  }
}

/**
 * A basic shape (or path) flattened to polylines in the coordinates of
 * `matrix`. `undefined` when it cannot be flattened or gets too big (too
 * many points, coordinates beyond {@link MAX_SVG_COORDINATE}). A closed
 * polyline's duplicated last segment is dropped.
 */
export function flattenSvgShape(element: SvgShapeSource, matrix: SvgMatrix = IDENTITY_MATRIX): SvgPolyline[] | undefined {
  const points = flattenSvgPath(svgShapePathData(element), MAX_SVG_SOURCE_CHARS, MAX_SVG_COORDINATE, true, matrixMaxScale(matrix));
  const transformed = points === undefined || matrix === IDENTITY_MATRIX ? points : transformPolylines(points, matrix);
  if (
    transformed === undefined ||
    transformed.reduce((total, polyline) => total + polyline.length, 0) > 2 * MAX_FLATTENED_POINTS ||
    transformed.some((polyline) => polyline.some((value) => Math.abs(value) > MAX_SVG_COORDINATE))
  )
    return undefined;
  return transformed.map((polyline) =>
    polyline.length > 6 && polyline.at(-4) === polyline[0] && polyline.at(-3) === polyline[1] && polyline.at(-2) === polyline[2] && polyline.at(-1) === polyline[3]
      ? polyline.slice(0, -2)
      : polyline,
  );
}
