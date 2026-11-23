/**
 * Hand-drawn restyling of vetted SVG drawings, so generated art sits with
 * the board's marker look:
 *
 * - {@link hatchSvgFills} replaces solid, unstroked fills with a few broad
 *   marker passes (hatching) along the shape's longest edge.
 * - {@link brushSvgStrokes} replaces thin `currentColor` strokes with filled
 *   brush outlines that taper, wobble and swell like ink.
 *
 * Both work on the parsed tree from `xml.ts`, are seeded by the geometry (so
 * a drawing always looks the same), stay within budgets, and either restyle
 * a drawing or leave it untouched.
 */

import { seededRandomFromString } from '../shape-paths.ts';
import {
  flattenSvgPath,
  flattenSvgShape,
  IDENTITY_MATRIX,
  invertMatrix,
  isSimilarityMatrix,
  matrixAreaScale,
  matrixMaxScale,
  matrixRoundingScale,
  parseSvgTransform,
  transformPolylines,
  type SvgMatrix,
  type SvgPolyline,
} from './svg-geometry.ts';
import { createSvgElement, type XmlElement } from './xml.ts';

/** A 2D point. */
type Point = [number, number];

/** Hatch spacing for a drawing `width` wide (in viewBox units). */
export function hatchSpacingForWidth(width: number): number {
  return width <= 480 ? 38 : Math.min(72, Math.round(width * 0.085));
}

/** How much consecutive hatch passes overlap (as a fraction of a pass). */
export const HATCH_PASS_OVERLAP = 0.8;
/** Narrowest hatch pass. */
export const MIN_HATCH_SPACING = 26;
/** Shortest translucent shape that is still hatched. */
export const MIN_SOFT_HATCH_HEIGHT = 6;
/** Most hatch passes in a drawing. */
export const MAX_HATCH_PASSES = 1200;
/** Most outline points of a hatched shape. */
export const MAX_HATCH_OUTLINE_POINTS = 1000;
/** Most edge tests spent on hatching a drawing. */
export const MAX_HATCH_LOOKS = 150000;
/** Thickest stroke (after transforms) that is brushed. */
export const MAX_BRUSHED_STROKE_WIDTH = 4;
/** Most brushed strokes in a drawing. */
export const MAX_BRUSH_STROKES = 2500;
/** Most characters of brushed path data in a drawing. */
export const MAX_BRUSH_PATH_CHARS = 300000;
/** Most samples along one brushed stroke. */
export const MAX_BRUSH_SAMPLES = 300;
/** Widest brush. */
export const MAX_BRUSH_WIDTH = 2.5;
/** Brush width scale for strokes that trace the drawing's frame. */
export const FRAME_BRUSH_SCALE = 0.55;

/** Hermite smoothstep of `x` between two edges (0 below `from`, 1 above `to`). */
export function smoothstepBetween(from: number, to: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Formats numbers rounded to `1 / scale`. */
export function svgNumberRounder(scale: number): (value: number) => string {
  return (value) => String(Math.round(value * scale) / scale);
}

/** Points joined with straight segments (`x y x y …`, after a leading command). */
export function joinPointsStraight(points: readonly Point[], format: (value: number) => string): string {
  return points.map(([x, y]) => `${format(x)} ${format(y)}`).join(' ');
}

/** Points joined with quadratic curves through the midpoints (`x y Qx y mx my …`). */
export function joinPointsSmooth(points: readonly Point[], format: (value: number) => string): string {
  return points
    .map(([x, y], index) => {
      const next = points[index + 1];
      if (index === 0) return `${format(x)} ${format(y)}`;
      if (next === undefined) return `L${format(x)} ${format(y)}`;
      return `Q${format(x)} ${format(y)} ${format((x + next[0]) / 2)} ${format((y + next[1]) / 2)}`;
    })
    .join('');
}

/** What hatching may still spend. */
export interface HatchBudget {
  passes: number;
  looks: number;
}

/** Hatch strokes for one shape: polylines and the marker width. */
export interface HatchFill {
  lines: SvgPolyline[];
  width: number;
}

/** Width or height of a set of coordinates. */
function span(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/**
 * Hatch strokes covering a closed outline (in viewBox coordinates): passes
 * parallel to the longest edge (or level/plumb for round shapes), each run
 * across the shape a marker stroke, consecutive runs joined into
 * zigzags. `soft` (translucent) shapes may be thinner. `undefined` when the
 * shape is too small, mostly off the canvas, too complex (concave in ways
 * hatching would show) or poorly covered; `'too many'` when the budget runs
 * out.
 */
export function hatchFillLines(
  outline: SvgPolyline,
  spacing: number,
  viewBox: readonly [number, number],
  soft: boolean,
  budget: HatchBudget,
  random: () => number,
): HatchFill | 'too many' | undefined {
  const points = Array.from({ length: outline.length / 2 }, (_, index): Point => [outline[2 * index]!, outline[2 * index + 1]!]);
  const [xs, ys] = [points.map((point) => point[0]), points.map((point) => point[1])];
  const [width, height] = [span(xs), span(ys)];
  const overlap = (values: readonly number[], size: number): number => Math.min(size, Math.max(...values)) - Math.max(0, Math.min(...values));
  if (overlap(xs, viewBox[0]) < width / 2 || overlap(ys, viewBox[1]) < height / 2) return undefined;
  const longestEdge = points
    .map((point, index) => {
      const next = points[(index + 1) % points.length] ?? point;
      return { len: Math.hypot(next[0] - point[0], next[1] - point[1]), angle: Math.atan2(next[1] - point[1], next[0] - point[0]) };
    })
    .reduce((best, edge) => (edge.len > best.len ? edge : best));
  const angle = longestEdge.len < Math.hypot(width, height) / 4 ? (height > 1.25 * width ? Math.PI / 2 : 0) : longestEdge.angle;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const rotated = points.map(([x, y]): Point => [x * cos + y * sin, -x * sin + y * cos]);
  const [top, bandHeight] = [Math.min(...rotated.map((point) => point[1])), span(rotated.map((point) => point[1]))];
  const bandWidth = span(rotated.map((point) => point[0]));
  const area =
    Math.abs(
      rotated.reduce((sum, point, index) => {
        const next = rotated[(index + 1) % rotated.length] ?? point;
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0),
    ) / 2;
  if (bandHeight < (soft ? MIN_SOFT_HATCH_HEIGHT : spacing / 2) || bandWidth < spacing || area < 0.2 * bandHeight * bandWidth) return undefined;
  const lineWidth = Math.min(spacing, Math.max(MIN_HATCH_SPACING, bandHeight / 3));
  const passWidth = bandHeight < 1.35 * lineWidth ? bandHeight : lineWidth;
  const passes = bandHeight <= passWidth ? 1 : Math.ceil((bandHeight - passWidth) / (HATCH_PASS_OVERLAP * passWidth)) + 1;
  if (passes > budget.passes || (budget.looks -= passes * points.length) < 0) return 'too many';
  const flip = random() < 0.5;
  const lines: Point[][] = [];
  let [lastRunCount, lastRuns] = [1, [] as Array<{ line: Point[]; from: number; to: number }>];
  let [runCount, covered, skipped] = [0, 0, 0];
  for (let pass = 0; pass < passes; pass++) {
    const y = top + passWidth / 2 + (passes > 1 ? (pass * (bandHeight - passWidth)) / (passes - 1) : 0);
    // Where the pass line crosses the outline, with the crossing direction.
    const crossings = rotated.flatMap((point, index): Array<[number, number]> => {
      const next = rotated[(index + 1) % rotated.length] ?? point;
      return point[1] <= y !== next[1] <= y ? [[point[0] + ((y - point[1]) / (next[1] - point[1])) * (next[0] - point[0]), Math.sign(next[1] - point[1])]] : [];
    });
    crossings.sort((a, b) => a[0] - b[0]);
    const merged = crossings
      .reduce<Array<[number, number]>>((list, [x, direction]) => {
        const last = list.at(-1);
        if (last?.[0] === x) last[1] += direction;
        else list.push([x, direction]);
        return list;
      }, [])
      .filter((crossing) => crossing[1] !== 0);
    let winding = 0;
    for (const [, direction] of merged) if (Math.abs((winding += direction)) > 1) return undefined;
    const runs = Array.from({ length: Math.floor(merged.length / 2) }, (_, index): Point => [merged[2 * index]![0], merged[2 * index + 1]![0]]);
    if (runs.length > 1 && (lineWidth < spacing || area < 0.4 * bandHeight * bandWidth)) return undefined;
    const passRuns: Array<{ line: Point[]; from: number; to: number }> = [];
    for (const [from, to] of runs.length === 0 ? [[0, 0] as Point] : runs) {
      const [startJitter, endJitter, tilt] = [0.15 + 0.4 * random(), 0.05 + 0.4 * random(), (random() - 0.5) * 0.12 * passWidth];
      const tooShort = passes > 1 && to - from < 0.6 * passWidth;
      if (tooShort) skipped += ((to - from) * bandHeight) / passes;
      if (runs.length === 0 || tooShort) continue;
      if (++runCount > budget.passes) return 'too many';
      covered += ((to - from) * bandHeight) / passes;
      const [inset, reach] = [Math.min(passWidth / 2, (to - from) / 2 - 1), Math.min(passWidth, (to - from) / 2)];
      const [rawStart, rawEnd] = [from + inset + (flip ? endJitter : -startJitter) * reach, to - inset + (flip ? startJitter : -endJitter) * reach];
      const [start, end] = rawEnd < rawStart + 2 ? [(rawStart + rawEnd) / 2 - 1, (rawStart + rawEnd) / 2 + 1] : [rawStart, rawEnd];
      // Continue the previous pass's line when exactly one run lines up with it.
      const touching = lastRuns.filter((run) => run.to > from && run.from < to);
      const previous =
        touching.length === 1 && runs.filter((run) => run[1] > touching[0]!.from && run[0] < touching[0]!.to).length === 1 ? touching[0]!.line : undefined;
      const backwards = previous !== undefined && (previous.length / 2) % 2 === 1;
      const joins = previous !== undefined && ((runs.length === 1 && lastRunCount === 1) || Math.abs(previous.at(-1)![0] - (backwards ? end : start)) <= 1.5 * passWidth);
      const line = previous !== undefined && joins ? previous : (lines[lines.length] = []);
      line.push(
        ...(line === previous && backwards
          ? [
              [end, y + tilt] as Point,
              [start, y - tilt] as Point,
            ]
          : [
              [start, y - tilt] as Point,
              [end, y + tilt] as Point,
            ]),
      );
      passRuns.push({ line, from, to });
    }
    [lastRunCount, lastRuns] = [runs.length, passRuns];
  }
  // Keep marker ends off the canvas edges (unless the canvas is tiny).
  const clampCoordinate = (value: number, size: number): number =>
    Math.round(size < 2 * passWidth ? value : Math.min(size - passWidth / 2 - 4, Math.max(passWidth / 2 + 4, value)));
  return lines.length === 0 || skipped > (skipped + covered) / 4
    ? undefined
    : {
        lines: lines.map((line) => line.flatMap(([x, y]) => [clampCoordinate(x * cos - y * sin, viewBox[0]), clampCoordinate(x * sin + y * cos, viewBox[1])])),
        width: Math.round(passWidth),
      };
}

/** A `0 0 W H` viewBox, or `undefined`. */
function readViewBox(root: XmlElement): [number, number] | undefined {
  const match = /^0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)$/.exec(root.getAttribute('viewBox') ?? '');
  return match === null ? undefined : [Number(match[1]), Number(match[2])];
}

/** Inherited paint state while hatching. */
interface HatchState {
  at: SvgMatrix;
  dashed: boolean;
  fill: string;
  stroke: string;
  fillOpacity: string;
  soft: boolean;
}

/**
 * Replaces solid hex fills of unstroked, undashed shapes with hatch strokes
 * (in the shape's own coordinates, keeping its transform and opacity).
 * Needs a `0 0 W H` viewBox; elements in `skip` (and their subtrees) are
 * left alone. Returns whether anything changed; nothing changes when the
 * drawing would need too many passes.
 */
export function hatchSvgFills(root: XmlElement, skip: ReadonlySet<XmlElement> = new Set()): boolean {
  const viewBox = readViewBox(root);
  if (viewBox === undefined) return false;
  let used = 0;
  const budget: HatchBudget = { passes: MAX_HATCH_PASSES, looks: MAX_HATCH_LOOKS };
  const replacements: Array<{ n: XmlElement; path: XmlElement }> = [];
  const visit = (parent: XmlElement, inherited: HatchState): void => {
    for (const element of [...parent.children]) {
      const fillOpacity = element.getAttribute('fill-opacity') ?? inherited.fillOpacity;
      const at = parseSvgTransform(inherited.at, element.getAttribute('transform') ?? '');
      if (at === undefined || !isSimilarityMatrix(at) || skip.has(element)) continue;
      const state: HatchState = {
        at,
        dashed: inherited.dashed || element.hasAttribute('stroke-dasharray'),
        fill: element.getAttribute('fill') ?? inherited.fill,
        stroke: element.getAttribute('stroke') ?? inherited.stroke,
        fillOpacity,
        soft: inherited.soft || Number(element.getAttribute('opacity') ?? 1) < 1,
      };
      if (element.localName === 'g') visit(element, state);
      if (element.localName === 'g' || element.localName === 'line' || state.stroke !== 'none' || state.dashed || !state.fill.startsWith('#') || used > MAX_HATCH_PASSES) continue;
      const polylines = flattenSvgShape(element, at);
      const outline = polylines?.length === 1 && polylines[0]!.length <= 2 * MAX_HATCH_OUTLINE_POINTS ? polylines[0] : undefined;
      const hatch =
        outline === undefined
          ? undefined
          : hatchFillLines(outline, hatchSpacingForWidth(viewBox[0]), viewBox, state.soft || Number(fillOpacity) < 1, budget, seededRandomFromString(outline.join(' ')));
      if (hatch === undefined) continue;
      used += hatch === 'too many' ? MAX_HATCH_PASSES + 1 : hatch.lines.reduce((total, line) => total + line.length / 4, 0);
      budget.passes = MAX_HATCH_PASSES - used;
      if (hatch === 'too many') continue;
      const path = createSvgElement('path');
      const roundingScale = matrixRoundingScale(at);
      const [lines, round] = [
        at === IDENTITY_MATRIX ? hatch.lines : transformPolylines(hatch.lines, invertMatrix(at)),
        (value: number): number => (at === IDENTITY_MATRIX ? value : Math.round(value * roundingScale) / roundingScale),
      ];
      const attributes: Record<string, string | null> = {
        d: lines.map((line) => `M${line.map(round).join(' ')}`).join(''),
        transform: element.getAttribute('transform'),
        fill: 'none',
        stroke: state.fill,
        'stroke-width': String(round(hatch.width / matrixMaxScale(at))),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-opacity': state.fillOpacity,
        opacity: element.getAttribute('opacity'),
      };
      for (const [name, value] of Object.entries(attributes)) if (value !== null) path.setAttribute(name, value);
      replacements.push({ n: element, path });
    }
  };
  visit(root, {
    fill: root.getAttribute('fill') ?? '#000',
    stroke: root.getAttribute('stroke') ?? 'none',
    fillOpacity: root.getAttribute('fill-opacity') ?? '1',
    soft: Number(root.getAttribute('opacity') ?? 1) < 1,
    at: IDENTITY_MATRIX,
    dashed: root.hasAttribute('stroke-dasharray'),
  });
  if (replacements.length === 0 || used > MAX_HATCH_PASSES) return false;
  for (const { n, path } of replacements) n.replaceWith(path);
  return true;
}

/**
 * Splits a flat polyline into runs of points at repeated points (sharp
 * corners), dropping single-point runs. A two-point dot stays one run.
 */
export function splitPolylineAtRepeats(points: SvgPolyline): Point[][] {
  const runs: Point[][] = [[]];
  for (let index = 0; index < points.length; index += 2) {
    const [point, run] = [[points[index]!, points[index + 1]!] as Point, runs.at(-1)!];
    const last = run.at(-1);
    if (last !== undefined && last[0] === point[0] && last[1] === point[1]) runs.push([point]);
    else run.push(point);
  }
  return points.length === 4 && runs.length === 2 ? [[...runs[0]!, ...runs[1]!]] : runs.filter((run) => run.length > 1);
}

/**
 * The filled outline (path data) of one brushed stroke through `points`
 * (in transformed coordinates; `matrix` maps the outline back to the
 * element's own coordinates). The stroke overshoots its ends a little,
 * tapers (`tapered` ends start thinner), swells and wobbles; polylines get
 * smooth sides. A stroke too short to have a direction becomes a dot.
 * `undefined` when it would need too many samples.
 */
export function brushStrokeOutline(
  points: readonly Point[],
  width: number,
  scale: number,
  tapered: readonly [boolean, boolean],
  random: () => number,
  matrix: SvgMatrix,
  format: (value: number) => string,
): string | undefined {
  const transform = (list: readonly Point[]): Point[] =>
    matrix === IDENTITY_MATRIX ? [...list] : list.map(([x, y]): Point => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
  const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const length = points.slice(1).reduce((total, point, index) => total + distance(points[index]!, point), 0);
  if (!(length > 1)) {
    const radius = (width / 2) * Math.sqrt(matrixAreaScale(matrix));
    const [x, y] = transform(points)[0]!;
    return `M${format(x - radius)} ${format(y)}${['', '-'].map((sign) => `a${format(radius)} ${format(radius)} 0 1 0 ${sign}${format(2 * radius)} 0`).join('')}Z`;
  }
  // Overshoot past an end (more when the end is tapered).
  const extend = (from: Point, to: Point, taperedEnd: boolean): Point => {
    const amount = ((taperedEnd ? 1 : 0.3) * Math.min(5 * scale, length * 0.08) * (0.5 + random())) / (distance(from, to) || 1);
    return [to[0] + (to[0] - from[0]) * amount, to[1] + (to[1] - from[1]) * amount];
  };
  // Drop points that barely turn the stroke, until enough turning or distance adds up.
  let [turned, travelledSinceKept] = [0, 0];
  const kept = points.filter((point, index) => {
    const [previous, next] = [points[index - 1], points[index + 1]];
    if (previous === undefined || next === undefined) return true;
    const turn = Math.abs(Math.atan2(next[1] - point[1], next[0] - point[0]) - Math.atan2(point[1] - previous[1], point[0] - previous[0]));
    [turned, travelledSinceKept] = [turned + Math.min(turn, 2 * Math.PI - turn), travelledSinceKept + distance(previous, point)];
    if (turned < 0.28 && travelledSinceKept < 36 * scale) return false;
    [turned, travelledSinceKept] = [0, 0];
    return true;
  });
  const extended: Point[] = [extend(points[1]!, points[0]!, tapered[0]), ...kept, extend(points.at(-2)!, points.at(-1)!, tapered[1])];
  const total = extended.slice(1).reduce((sum, point, index) => sum + distance(extended[index]!, point), 0);
  const [startTaper, endTaper] = [Math.min(9 * scale, total * 0.25), Math.min(16 * scale, total * 0.35)];
  const isPolyline = points.length > 2;
  const step = isPolyline ? Math.min(36 * scale, total / 4) : Math.max(45 * scale, total / 5);
  if (extended.length + total / step > MAX_BRUSH_SAMPLES) return undefined;
  // Resample, with extra samples where the tapers end.
  const [samples, sampleDistances]: [Point[], number[]] = [[extended[0]!], [0]];
  let travelled = 0;
  for (let index = 1; index < extended.length; index++) {
    const [from, to] = [extended[index - 1]!, extended[index]!];
    const segment = distance(from, to);
    const count = Math.max(1, Math.ceil(segment / step));
    const offsets = [...Array.from({ length: count }, (_, step2) => ((step2 + 1) * segment) / count), startTaper - travelled, total - endTaper - travelled]
      .filter((offset) => offset > 0.5 && offset <= segment)
      .sort((a, b) => a - b);
    for (const [position, offset] of offsets.entries())
      if (position === 0 || offset - offsets[position - 1]! > 0.5) {
        samples.push([from[0] + ((to[0] - from[0]) * offset) / segment, from[1] + ((to[1] - from[1]) * offset) / segment]);
        sampleDistances.push(travelled + offset);
      }
    travelled += segment;
  }
  const [wobble, bow, wobbleLength, wobblePhase, swellPhase] = [
    Math.min(0.7 * scale, total * 0.004),
    (random() - 0.5) * Math.min(3.5 * scale, total * 0.014) * (distance(points[0]!, points.at(-1)!) / length) ** 2,
    (110 + random() * 90) * scale,
    random() * 6.3,
    random() * 6.3,
  ];
  const sides = samples.map((point, index): [Point, Point] => {
    const [previous, next, along] = [samples[Math.max(0, index - 1)]!, samples[Math.min(samples.length - 1, index + 1)]!, sampleDistances[index]!];
    const normalLength = distance(previous, next) || 1;
    const [nx, ny] = [-(next[1] - previous[1]) / normalLength, (next[0] - previous[0]) / normalLength];
    const offset = wobble * Math.sin((along / wobbleLength) * 6.3 + wobblePhase) + bow * Math.sin((Math.PI * along) / total);
    const halfWidth =
      (width *
        1.12 *
        (0.5 + 0.5 * smoothstepBetween(0, startTaper, along)) *
        (0.12 + 0.88 * smoothstepBetween(0, endTaper, total - along)) *
        (1 + 0.13 * Math.sin((along / (47 * scale)) * 6.3 + swellPhase))) /
      2;
    return [
      [point[0] + nx * (offset + halfWidth), point[1] + ny * (offset + halfWidth)],
      [point[0] + nx * (offset - halfWidth), point[1] + ny * (offset - halfWidth)],
    ];
  });
  const join = isPolyline ? joinPointsSmooth : joinPointsStraight;
  return `M${join(transform(sides.map((side) => side[0])), format)}L${join(transform(sides.map((side) => side[1]).reverse()), format)}Z`;
}

/** Inherited stroke state while brushing. */
interface BrushState {
  at: SvgMatrix;
  stroke: string;
  width: number;
  fill: string;
  dashed: boolean;
  opacity: string;
  cap: string;
}

/**
 * Replaces thin, undashed `currentColor` strokes with brushed outlines
 * (filled paths inserted right after each source element, which is removed,
 * or keeps its fill with `stroke="none"`). Circles and ellipses get an
 * open, overlapping loop like a hand-drawn ring. Needs a positive
 * `0 0 W H` viewBox; elements in `skip` are left alone. Returns whether
 * anything changed.
 */
export function brushSvgStrokes(root: XmlElement, skip: ReadonlySet<XmlElement> = new Set()): boolean {
  const [width, height] = readViewBox(root) ?? [];
  if (width === undefined || height === undefined || !(width > 0 && height > 0)) return false;
  const scale = Math.max(0.8, Math.min(2, width / 400));
  // True when a polyline runs along the drawing's edges all the way round (a frame).
  const isFrameEdge = (polyline: SvgPolyline): boolean => {
    const nearEdges = (index: number): boolean[] =>
      [polyline[index]!, width - polyline[index]!, polyline[index + 1]!, height - polyline[index + 1]!].map((gap, edge) => Math.abs(gap) < 0.05 * (edge < 2 ? width : height));
    const seen = [false, false, false, false];
    for (let index = 2; index < polyline.length; index += 2) {
      const previous = nearEdges(index - 2);
      const along = nearEdges(index).map((near, edge) => near && previous[edge]!);
      if (!along.includes(true)) return false;
      along.forEach((near, edge) => void (seen[edge] ||= near));
    }
    return !seen.includes(false);
  };
  const replacements: Array<{ n: XmlElement; d: string; filled: boolean; opacity: string }> = [];
  let [strokes, chars] = [0, 0];
  const visit = (element: XmlElement, inherited: BrushState): void => {
    const at = parseSvgTransform(inherited.at, element.getAttribute('transform') ?? '');
    if (at === undefined || skip.has(element)) return;
    const state: BrushState = {
      at,
      stroke: element.getAttribute('stroke') ?? inherited.stroke,
      width: Number(element.getAttribute('stroke-width') ?? inherited.width),
      fill: element.getAttribute('fill') ?? inherited.fill,
      dashed: inherited.dashed || element.hasAttribute('stroke-dasharray'),
      opacity: element.getAttribute('stroke-opacity') ?? inherited.opacity,
      cap: element.getAttribute('stroke-linecap') ?? inherited.cap,
    };
    if (element === root || element.localName === 'g') {
      for (const child of [...element.children]) visit(child, state);
      return;
    }
    const strokeWidth = state.width * Math.sqrt(matrixAreaScale(at));
    if (state.stroke.toLowerCase() !== 'currentcolor' || !(strokeWidth > 0 && strokeWidth <= MAX_BRUSHED_STROKE_WIDTH) || state.dashed || strokes > MAX_BRUSH_STROKES || chars > MAX_BRUSH_PATH_CHARS) return;
    const roundCaps = state.cap === 'round';
    const [inverse, format] = at === IDENTITY_MATRIX ? [IDENTITY_MATRIX, svgNumberRounder(10)] : [invertMatrix(at), svgNumberRounder(matrixRoundingScale(at))];
    const num = (name: string): number => Number(element.getAttribute(name) ?? 0);
    const [rx, ry] = element.localName === 'circle' ? [num('r'), num('r')] : [num('rx'), num('ry')];
    const isRound = element.localName === 'circle' || element.localName === 'ellipse';
    // A ring drawn by hand: one loop that runs on past its start.
    const ring = !isRound
      ? undefined
      : flattenSvgPath(
          `M${format(num('cx') - 0.6 * rx)} ${format(num('cy') - 0.8 * ry)}` +
            `A${[rx, ry, 0, 1, 1, format(num('cx') - 0.8 * rx), format(num('cy') - 0.6 * ry)].join(' ')}` +
            `A${[rx, ry, 0, 0, 1, format(num('cx') - 0.28 * rx), format(num('cy') - 0.96 * ry)].join(' ')}`,
          400,
          1e4,
          false,
          matrixMaxScale(at),
        );
    const polylines = !isRound ? flattenSvgShape(element, at) : ring === undefined ? undefined : transformPolylines(ring, at);
    if (polylines === undefined) return;
    const random = seededRandomFromString(polylines.join(' '));
    let text = '';
    for (const polyline of polylines) {
      const [runs, brushWidth] = [splitPolylineAtRepeats(polyline), Math.min(strokeWidth, MAX_BRUSH_WIDTH) * (isFrameEdge(polyline) ? FRAME_BRUSH_SCALE : 1)];
      const closed = polyline.length > 5 && polyline[0] === polyline.at(-2) && polyline[1] === polyline.at(-1);
      for (const [index, run] of runs.entries()) {
        if ((strokes += 1) > MAX_BRUSH_STROKES || chars + text.length > MAX_BRUSH_PATH_CHARS) {
          chars = Infinity;
          return;
        }
        const outline = brushStrokeOutline(run, brushWidth, scale, [index > 0 || closed, index < runs.length - 1 || closed], random, inverse, format);
        if (outline === undefined) return;
        // Dots (drawn with arcs) only for round caps.
        if (roundCaps || !outline.includes('a')) text += outline;
      }
    }
    if (text === '' || text.includes('NaN')) return;
    chars += text.length;
    replacements.push({ n: element, d: text, filled: element.localName !== 'line' && state.fill.toLowerCase() !== 'none', opacity: state.opacity });
  };
  visit(root, { stroke: 'none', width: 1, fill: '#000', dashed: false, opacity: '1', cap: 'butt', at: IDENTITY_MATRIX });
  if (replacements.length === 0) return false;
  for (const { n, d, filled, opacity } of replacements) {
    const path = createSvgElement('path');
    const attributes: Array<[string, string | null]> = [
      ['d', d],
      ['fill', 'currentColor'],
      ['fill-rule', 'nonzero'],
      ['stroke', 'none'],
      ['transform', n.getAttribute('transform')],
      ['opacity', n.getAttribute('opacity')],
      ['fill-opacity', opacity],
    ];
    for (const [name, value] of attributes) if (value !== null) path.setAttribute(name, value);
    n.after(path);
    if (filled) n.setAttribute('stroke', 'none');
    else n.remove();
  }
  return true;
}
