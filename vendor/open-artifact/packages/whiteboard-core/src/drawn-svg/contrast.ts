/**
 * Keeping drawn SVGs legible on any theme. A drawing's `currentColor` ink
 * follows the theme, but its own hex fills do not, so ink lines drawn over a
 * dark fill (or background-colored lines over ink) can vanish. Contrast
 * layering finds, paint by paint, the regions where the drawing's color
 * swaps between "ink-like" and "background-like", turns them into clip
 * paths, and redraws the whole drawing clipped to each region with
 * `currentColor` set to whichever of ink and background contrasts there.
 *
 * Fills become outline contours and thick round strokes become capsules;
 * anything that cannot be traced exactly (patterns, even-odd fills, skewed
 * strokes, too many layers or points) leaves the drawing as it is.
 */

import { parseRgbaColor, strongerContrastColor, type Rgba } from '../theme.ts';
import {
  flattenSvgShape,
  formatSvgNumber,
  formatSvgPoint,
  IDENTITY_MATRIX,
  isSimilarityMatrix,
  matrixAreaScale,
  parseSvgTransform,
  type SvgMatrix,
  type SvgPolyline,
} from './svg-geometry.ts';
import { createSvgElement, type XmlElement } from './xml.ts';

/** Most alternating ink/background layers. */
export const MAX_CONTRAST_LAYERS = 5;
/** Most contours across all layers. */
export const MAX_CONTRAST_CONTOURS = 2000;
/** Most path-data characters across all layers. */
export const MAX_CONTRAST_POINTS = 500000;
/** A hard ceiling callers may use for drawings that are layered anyway. */
export const MAX_CONTRAST_POINTS_HARD = 700000;
/** Thinnest stroke (after transforms) that is traced. */
export const MIN_CONTRAST_STROKE_WIDTH = 8;
/** Paint at least this opaque counts as fully covering what is under it. */
export const OPAQUE_PAINT_ALPHA = 0.75;

/** WCAG relative luminance of an opaque color (channels 0…1). */
function relativeLuminance(color: Rgba): number {
  const linearize = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** A translucent foreground composited over a background (opaque result). */
function compositeRgbaColor(foreground: Rgba, background: Rgba): Rgba {
  const blend = (fg: number, bg: number): number => foreground.a * fg + (1 - foreground.a) * bg;
  return { r: blend(foreground.r, background.r), g: blend(foreground.g, background.g), b: blend(foreground.b, background.b), a: 1 };
}

/**
 * Closed contours as fill path data, all wound the same way so the nonzero
 * rule fills each one (holes included, when they do not overlap opposite
 * contours). Degenerate contours are dropped; `undefined` when contours of
 * opposite windings overlap (a hole whose fill rule matters).
 */
export function contoursToFillPaths(polylines: readonly SvgPolyline[]): string[] | undefined {
  const contours = polylines.map((polyline) => Array.from({ length: polyline.length / 2 }, (_, index): [number, number] => [polyline[2 * index]!, polyline[2 * index + 1]!]));
  const windings = contours
    .map((contour) => contour.reduce((sum, [x, y], index) => sum + x * contour[(index + 1) % contour.length]![1] - contour[(index + 1) % contour.length]![0] * y, 0))
    .map((area) => (Math.abs(area) < 1 ? 0 : Math.sign(area)));
  const bounds = contours.map((contour) =>
    [0, 1].flatMap((axis) => {
      const values = contour.map((point) => point[axis]!);
      return [Math.min(...values), Math.max(...values)];
    }),
  );
  const overlaps = (a: number[], b: number[]): boolean => a[0]! <= b[1]! && b[0]! <= a[1]! && a[2]! <= b[3]! && b[2]! <= a[3]!;
  if (windings.includes(1) && windings.includes(-1) && bounds.some((a, i) => bounds.some((b, j) => windings[i]! * windings[j]! < 0 && overlaps(a, b)))) return undefined;
  return contours.flatMap((contour, index) =>
    windings[index] === 0 ? [] : [`M${(windings[index] === 1 ? [...contour].reverse() : contour).map(([x, y]) => formatSvgPoint(x, y)).join('L')}Z`],
  );
}

/** A round-capped stroke of `radius` along polylines, as one capsule path per segment. */
export function strokeToCapsulePaths(polylines: readonly SvgPolyline[], radius: number): string[] {
  const arc = `A${formatSvgNumber(radius)} ${formatSvgNumber(radius)} 0 0 0 `;
  return polylines.flatMap((polyline) =>
    Array.from({ length: polyline.length / 2 - 1 }, (_, index) => polyline.slice(2 * index, 2 * index + 4)).flatMap(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => {
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length === 0 && polyline.length > 4) return [];
      const [nx, ny] = length === 0 ? [0, radius] : [(-(y2 - y1) / length) * radius, ((x2 - x1) / length) * radius];
      return [
        `M${formatSvgPoint(x1 + nx, y1 + ny)}L${formatSvgPoint(x2 + nx, y2 + ny)}${arc}${formatSvgPoint(x2 - nx, y2 - ny)}` +
          `L${formatSvgPoint(x1 - nx, y1 - ny)}${arc}${formatSvgPoint(x1 + nx, y1 + ny)}Z`,
      ];
    }),
  );
}

/** Inherited paint state while layering. */
interface ContrastState {
  fill: string;
  stroke: string;
  width: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  cap: string;
  join: string;
  dashed: boolean;
  evenodd: boolean;
  /** Current transform; `undefined` once a transform could not be read. */
  at: SvgMatrix | undefined;
}

/**
 * Layers a drawing (in place) so it reads on `background` with `ink` as its
 * `currentColor`: the original content moves into `<g id="wb">`, each
 * contrast layer becomes a `<clipPath id="wb-N">`, and a `<use>` per layer
 * redraws the group clipped to it, alternating ink and background as the
 * color. Translucent paint swapped to ink also gets a background underlay.
 * Elements in `skip` must be harmless (`text`, `defs`) or the drawing is
 * left alone. Returns whether the drawing was layered.
 */
export function layerSvgForContrast(root: XmlElement, background: string, ink: string, skip: ReadonlySet<XmlElement> = new Set()): boolean {
  const layers: string[][] = [];
  const inkFills: string[] = [];
  const [inkColor, backgroundColor] = [parseRgbaColor(ink) ?? { r: 0, g: 0, b: 0, a: 1 }, parseRgbaColor(background) ?? { r: 1, g: 1, b: 1, a: 1 }];
  let failed = false;
  /** What is under later paint once ink-swapped paint covers the background. */
  let inkBackdrop: Rgba | undefined;
  let [contourCount, pointCount] = [0, 0];
  const paint = (color: string, opacity: number, contours: () => string[] | undefined): void => {
    const rgba = color.startsWith('#') ? parseRgbaColor(color) : undefined;
    failed ||= rgba === undefined && !/^(?:none|currentcolor)$/i.test(color);
    if (rgba === undefined || failed) return;
    const alpha = rgba.a * opacity;
    const over = (under: Rgba, a: number = alpha): Rgba => (alpha >= OPAQUE_PAINT_ALPHA ? rgba : compositeRgbaColor({ ...rgba, a }, under));
    const inkReads = (on: Rgba): boolean => strongerContrastColor(on, background, ink) === ink;
    const inkLike =
      inkReads(over(inkColor, alpha * (2 - alpha))) && (alpha >= OPAQUE_PAINT_ALPHA || relativeLuminance(over(backgroundColor)) < relativeLuminance(backgroundColor));
    const target = inkBackdrop !== undefined && !inkReads(over(inkBackdrop)) ? background : inkLike ? ink : undefined;
    const paths = target === undefined ? [] : contours();
    const sameLayer = (target === ink) === (layers.length % 2 === 1);
    [contourCount, pointCount] = [contourCount + (paths?.length ?? 0), (paths ?? []).reduce((total, path) => total + path.length, pointCount)];
    failed =
      !(alpha >= 0) ||
      (target === background && (paths === undefined || (paths.length > 0 && !sameLayer && layers.length >= MAX_CONTRAST_LAYERS))) ||
      contourCount > MAX_CONTRAST_CONTOURS ||
      pointCount > MAX_CONTRAST_POINTS;
    if (paths === undefined || paths.length === 0 || failed) return;
    if (target === ink) inkBackdrop = over(backgroundColor);
    if (target === ink && alpha < OPAQUE_PAINT_ALPHA) inkFills.push(...paths);
    if (sameLayer) layers.at(-1)?.push(...paths);
    else layers.push(paths);
  };
  const visit = (element: XmlElement, inherited: ContrastState): void => {
    const attr = (name: string, fallback: string): string => element.getAttribute(name) ?? fallback;
    const fraction = (name: string, fallback: number): number => Math.min(1, Number(element.getAttribute(name) ?? fallback));
    const state: ContrastState = {
      fill: attr('fill', inherited.fill),
      stroke: attr('stroke', inherited.stroke),
      width: Number(attr('stroke-width', String(inherited.width))),
      fillOpacity: fraction('fill-opacity', inherited.fillOpacity),
      strokeOpacity: fraction('stroke-opacity', inherited.strokeOpacity),
      opacity: inherited.opacity * fraction('opacity', 1),
      cap: attr('stroke-linecap', inherited.cap),
      join: attr('stroke-linejoin', inherited.join),
      dashed: inherited.dashed || element.hasAttribute('stroke-dasharray'),
      evenodd: attr('fill-rule', inherited.evenodd ? 'evenodd' : '') === 'evenodd',
      at: inherited.at === undefined ? undefined : parseSvgTransform(inherited.at, attr('transform', '')),
    };
    failed ||= skip.has(element) && element.localName !== 'text' && element.localName !== 'defs';
    if (failed || skip.has(element)) return;
    if (element === root || element.localName === 'g') {
      for (const child of [...element.children]) visit(child, state);
      return;
    }
    if (element.localName !== 'line')
      paint(state.fill, state.fillOpacity * state.opacity, () => {
        const polylines = state.evenodd || state.at === undefined ? undefined : flattenSvgShape(element, state.at);
        return polylines === undefined ? undefined : contoursToFillPaths(polylines);
      });
    const strokeWidth = state.width * Math.sqrt(matrixAreaScale(state.at ?? IDENTITY_MATRIX));
    if (strokeWidth >= MIN_CONTRAST_STROKE_WIDTH)
      paint(state.stroke, state.strokeOpacity * state.opacity, () => {
        const polylines =
          state.cap === 'round' && state.join === 'round' && !state.dashed && state.at !== undefined && isSimilarityMatrix(state.at) ? flattenSvgShape(element, state.at) : undefined;
        return polylines === undefined ? undefined : strokeToCapsulePaths(polylines, strokeWidth / 2);
      });
  };
  visit(root, {
    fill: '#000',
    stroke: 'none',
    width: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    opacity: 1,
    cap: 'butt',
    join: 'miter',
    dashed: false,
    evenodd: false,
    at: IDENTITY_MATRIX,
  });
  if (failed || layers.length === 0) return false;
  const group = createSvgElement('g');
  group.setAttribute('id', 'wb');
  if (inkFills.length > 0) {
    const underlay = group.appendChild(createSvgElement('path'));
    for (const [name, value] of Object.entries({ d: inkFills.join(''), fill: background, 'fill-opacity': '1', 'fill-rule': 'nonzero', stroke: 'none' })) underlay.setAttribute(name, value);
  }
  group.append(...root.children);
  root.append(group);
  layers.forEach((layer, index) => {
    const clipPath = root.insertBefore(createSvgElement('clipPath'), group);
    clipPath.appendChild(createSvgElement('path')).setAttribute('d', layer.join(''));
    clipPath.setAttribute('id', `wb-${String(index)}`);
    const use = root.appendChild(createSvgElement('use'));
    for (const [name, value] of [
      ['href', '#wb'],
      ['color', index % 2 === 0 ? ink : background],
      ['clip-path', `url(#wb-${String(index)})`],
    ] as const)
      use.setAttribute(name, value);
  });
  return true;
}
