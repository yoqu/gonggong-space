/**
 * Drawing looks: how an agent drawing's `style` is drawn.
 *
 * - {@link drawingLookOf} and {@link drawingLookRenderer} pick the look and
 *   whether it is a rewrite of the SVG (`svg`) or painted pixels (`raster`).
 * - {@link DRAWING_LOOK_TONES} holds each look's paper and ink per color
 *   scheme; {@link drawingLookPaper} is what text over a drawing reads on.
 * - {@link sketchDrawnSvg}, {@link comicDrawnSvg} and
 *   {@link blueprintDrawnSvg} rewrite a parsed drawing in place.
 * - {@link drawingPaintPlan} flattens a drawing into filled and stroked
 *   parts for the raster looks.
 *
 * Everything works on the core's XML tree, so it runs in Node, the page and
 * workers alike.
 */

import { isSvgBase64DataUrl } from '../image-source.ts';
import { DRAWING_STYLES, type DrawingStyle, type ImageElement } from '../schema.ts';
import { mixHexColors, parseRgbaColor, type ColorScheme } from '../theme.ts';
import { brushSvgStrokes } from './restyle.ts';
import { flattenSvgShape, IDENTITY_MATRIX, matrixAreaScale, parseSvgTransform, type SvgMatrix, type SvgPolyline } from './svg-geometry.ts';
import { createSvgElement, XmlElement } from './xml.ts';

/** A look a drawing is drawn in (one of the styles). */
export type DrawingLook = DrawingStyle;

/** How a look is made: a rewrite of the SVG, or pixels painted from its shapes. */
export type DrawingLookRenderer = 'svg' | 'raster';

/** True for a known drawing style. */
export function isDrawingStyle(value: string): value is DrawingStyle {
  return (DRAWING_STYLES as readonly string[]).includes(value);
}

/** The look for a drawing's `style`: no style or an unknown word draws plain. */
export function drawingLookOf(style: string | undefined): DrawingLook {
  return style !== undefined && isDrawingStyle(style) ? style : 'plain';
}

/** The look of an image element, or `undefined` when it is not an SVG drawing. */
export function imageDrawingLook(image: Pick<ImageElement, 'src' | 'style'>): DrawingLook | undefined {
  return isSvgBase64DataUrl(image.src) || image.src.startsWith('data:image/svg+xml') ? drawingLookOf(image.style) : undefined;
}

/** Whether a look rewrites the SVG or paints pixels. */
export function drawingLookRenderer(look: DrawingLook): DrawingLookRenderer {
  return look === 'marker' || look === 'watercolor' || look === 'paper' ? 'raster' : 'svg';
}

/** A look's paper (what it lays behind the drawing, if anything) and ink (`currentColor`). */
export interface DrawingLookTone {
  paper: string | undefined;
  ink: string;
}

/** Paper and ink of every style, per board color scheme. */
export const DRAWING_LOOK_TONES: Readonly<Record<DrawingStyle, Readonly<Record<ColorScheme, DrawingLookTone>>>> = {
  plain: { light: { paper: undefined, ink: '#1A1A1A' }, dark: { paper: undefined, ink: '#EFEFEF' } },
  draft: { light: { paper: '#F5F0E4', ink: '#4A4A50' }, dark: { paper: '#2B2926', ink: '#D4D0C8' } },
  comic: { light: { paper: undefined, ink: '#141414' }, dark: { paper: undefined, ink: '#F4F0E6' } },
  blueprint: { light: { paper: '#1E4E8C', ink: '#F2F7FF' }, dark: { paper: '#0E2340', ink: '#CFE1FF' } },
  marker: { light: { paper: undefined, ink: '#202020' }, dark: { paper: undefined, ink: '#EFEFEF' } },
  watercolor: { light: { paper: '#F7F2E7', ink: '#5A4E44' }, dark: { paper: '#26231F', ink: '#D8CFC2' } },
  paper: { light: { paper: undefined, ink: '#2A2A2A' }, dark: { paper: undefined, ink: '#F1ECE2' } },
};

/** The paper a look lays behind a drawing in a scheme (`undefined`: the board shows through). */
export function drawingLookPaper(look: DrawingLook, scheme: ColorScheme): string | undefined {
  return DRAWING_LOOK_TONES[look][scheme].paper;
}

/* -------------------------------------------------------------------------- */
/* Colors                                                                     */
/* -------------------------------------------------------------------------- */

/** Hue (0–360), saturation and lightness (0–1). */
interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** A `#rgb[a]` / `#rrggbb[aa]` color as `#rrggbb` and its alpha; `undefined` for anything else. */
export function solidHex(color: string): { hex: string; alpha: number } | undefined {
  if (!color.startsWith('#')) return undefined;
  const rgba = parseRgbaColor(color);
  if (rgba === undefined) return undefined;
  const channel = (value: number): string => Math.round(value * 255).toString(16).padStart(2, '0');
  return { hex: `#${channel(rgba.r)}${channel(rgba.g)}${channel(rgba.b)}`, alpha: rgba.a };
}

function hexToHsl(hex: string): Hsl {
  const rgba = parseRgbaColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  const [max, min] = [Math.max(rgba.r, rgba.g, rgba.b), Math.min(rgba.r, rgba.g, rgba.b)];
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rgba.r ? (rgba.g - rgba.b) / d + (rgba.g < rgba.b ? 6 : 0) : max === rgba.g ? (rgba.b - rgba.r) / d + 2 : (rgba.r - rgba.g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const channel = (value: number): string => Math.round(Math.min(1, Math.max(0, value + m)) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Saturation of a hex color (0–1). */
export function hexSaturation(hex: string): number {
  return hexToHsl(hex).s;
}

/** A hex color made flatter and bolder, as printed comic colors are. */
export function comicColor(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.08) return hslToHex({ h, s, l: Math.min(0.92, Math.max(0.12, l)) });
  return hslToHex({ h, s: Math.min(1, s * 1.3 + 0.12), l: Math.min(0.72, Math.max(0.3, l)) });
}

/** The average color of each gradient (`id` → `#rrggbb`), so painted looks can use it as a flat color. */
export function gradientColors(root: XmlElement): Map<string, string> {
  const colors = new Map<string, string>();
  for (const node of root.descendants()) {
    const id = node.getAttribute('id');
    if (id === null || !/Gradient$/.test(node.localName)) continue;
    const stops = node.children.flatMap((stop) => {
      const color = stop.localName === 'stop' ? solidHex(stop.getAttribute('stop-color') ?? '') : undefined;
      return color === undefined ? [] : [color.hex];
    });
    if (stops.length > 0) colors.set(id, stops.reduce((mixed, stop, index) => mixHexColors(mixed, stop, 1 / (index + 1))));
  }
  return colors;
}

/** A paint as `#rrggbb` (gradients averaged), `currentColor`, or `undefined` for none or unknown. */
function paintColor(value: string, gradients: ReadonlyMap<string, string>): { color: string; alpha: number } | undefined {
  if (/^currentcolor$/i.test(value)) return { color: 'currentColor', alpha: 1 };
  const reference = /^url\(\s*#([^)\s]+)\s*\)$/.exec(value)?.[1];
  if (reference !== undefined) {
    const color = gradients.get(reference);
    return color === undefined ? undefined : { color, alpha: 1 };
  }
  const solid = solidHex(value);
  return solid === undefined ? undefined : { color: solid.hex, alpha: solid.alpha };
}

/* -------------------------------------------------------------------------- */
/* Tree helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Tags that draw a shape. */
const SHAPE_TAGS: ReadonlySet<string> = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
/** Geometry attributes copied into a clip path. */
const CLIP_GEOMETRY = ['transform', 'd', 'points', 'x', 'x1', 'x2', 'y', 'y1', 'y2', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry'] as const;

/** A `0 0 W H` viewBox, or `undefined`. */
export function drawingViewBox(root: XmlElement): [number, number] | undefined {
  const match = /^\s*0[\s,]+0[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*$/.exec(root.getAttribute('viewBox') ?? '');
  const size: [number, number] | undefined = match === null ? undefined : [Number(match[1]), Number(match[2])];
  return size !== undefined && size[0] > 0 && size[1] > 0 ? size : undefined;
}

/** A deep copy of an element (elements and attributes only), without ids. */
export function cloneSvgElement(element: XmlElement): XmlElement {
  const copy = new XmlElement(element.name, element.namespaceURI);
  for (const attribute of element.attributes) if (attribute.name !== 'id') copy.setAttribute(attribute.name, attribute.value);
  for (const child of element.children) copy.appendChild(cloneSvgElement(child));
  return copy;
}

/** Sets attributes on an element (skipping `undefined` values). */
function setAttributes(element: XmlElement, attributes: Readonly<Record<string, string | number | undefined>>): XmlElement {
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined) element.setAttribute(name, String(value));
  return element;
}

/** Rounds to two decimals for path data. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Inherited paint while walking a drawing. */
interface PaintState {
  fill: string;
  stroke: string;
  width: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  dashed: boolean;
  cap: string;
  /** Transform to the root's coordinates; `undefined` once one could not be read. */
  at: SvgMatrix | undefined;
}

const ROOT_PAINT: PaintState = { fill: '#000', stroke: 'none', width: 1, fillOpacity: 1, strokeOpacity: 1, opacity: 1, dashed: false, cap: 'butt', at: IDENTITY_MATRIX };

/** The paint state of `element` under `inherited`. */
function paintStateOf(element: XmlElement, inherited: PaintState): PaintState {
  const fraction = (name: string, fallback: number): number => {
    const value = Number(element.getAttribute(name) ?? fallback);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  };
  const width = Number(element.getAttribute('stroke-width') ?? inherited.width);
  return {
    fill: element.getAttribute('fill') ?? inherited.fill,
    stroke: element.getAttribute('stroke') ?? inherited.stroke,
    width: Number.isFinite(width) ? width : inherited.width,
    fillOpacity: fraction('fill-opacity', inherited.fillOpacity),
    strokeOpacity: fraction('stroke-opacity', inherited.strokeOpacity),
    opacity: inherited.opacity * fraction('opacity', 1),
    dashed: inherited.dashed || (element.hasAttribute('stroke-dasharray') && element.getAttribute('stroke-dasharray') !== 'none'),
    cap: element.getAttribute('stroke-linecap') ?? inherited.cap,
    at: inherited.at === undefined ? undefined : parseSvgTransform(inherited.at, element.getAttribute('transform') ?? ''),
  };
}

/** Each shape element of a drawing (outside `skip`) with its paint, in drawing order. */
function paintedShapes(root: XmlElement, skip: ReadonlySet<XmlElement>): Array<{ element: XmlElement; state: PaintState }> {
  const found: Array<{ element: XmlElement; state: PaintState }> = [];
  const visit = (element: XmlElement, inherited: PaintState): void => {
    if (skip.has(element)) return;
    const state = element === root ? paintStateOf(element, ROOT_PAINT) : paintStateOf(element, inherited);
    if (element === root || element.localName === 'g') {
      for (const child of element.children) visit(child, state);
      return;
    }
    if (SHAPE_TAGS.has(element.localName)) found.push({ element, state });
  };
  visit(root, ROOT_PAINT);
  return found;
}

/** An id prefix no element of the drawing uses yet. */
function freshIdPrefix(root: XmlElement, base: string): string {
  const ids = new Set([root, ...root.descendants()].map((node) => node.getAttribute('id') ?? ''));
  let prefix = base;
  for (let attempt = 1; [...ids].some((id) => id.startsWith(prefix)); attempt++) prefix = `${base}${String(attempt)}-`;
  return prefix;
}

/** A small seeded random generator (xorshift32 over an FNV-1a hash of the seed text). */
export function seededLookRandom(seedText: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seedText.length; index++) hash = Math.imul(hash ^ seedText.charCodeAt(index), 0x01000193);
  let state = hash >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/** The bounding box `[minX, minY, maxX, maxY]` of polylines. */
function polylineBounds(polylines: readonly SvgPolyline[]): [number, number, number, number] {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polyline of polylines)
    for (let index = 0; index + 1 < polyline.length; index += 2) {
      const [x, y] = [polyline[index]!, polyline[index + 1]!];
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  return bounds;
}

/** A sheet of paper behind the whole drawing. */
function paperSheet(width: number, height: number, color: string): XmlElement {
  return setAttributes(createSvgElement('rect'), { x: 0, y: 0, width, height, rx: round2(Math.min(width, height) * 0.012), fill: color, stroke: 'none' });
}

/* -------------------------------------------------------------------------- */
/* Draft                                                                      */
/* -------------------------------------------------------------------------- */

/** Most pencil hatch lines in a drawing. */
export const MAX_SKETCH_HATCH_LINES = 4000;
/** How faint a filled area's own color stays under its hatching. */
export const SKETCH_FILL_OPACITY = 0.16;

/**
 * Pencil hatching for a box `[minX, minY, maxX, maxY]`: parallel lines at
 * `angle` (radians) `spacing` apart across the box, each a little crooked
 * and some stopping short, as path data. `undefined` past `budget` lines.
 */
export function pencilHatchPath(bounds: readonly [number, number, number, number], spacing: number, angle: number, budget: number, random: () => number): { d: string; lines: number } | undefined {
  const [minX, minY, maxX, maxY] = bounds;
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const radius = Math.hypot(maxX - minX, maxY - minY) / 2 + spacing;
  const count = Math.ceil((2 * radius) / spacing);
  if (!(count > 0) || count > budget) return undefined;
  const [dx, dy, nx, ny] = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)];
  let d = '';
  for (let index = 0; index <= count; index++) {
    const offset = -radius + index * spacing + (random() - 0.5) * spacing * 0.35;
    // Some strokes stop short, as a quick hand leaves gaps.
    const [from, to] = [-radius * (random() < 0.25 ? 0.2 + 0.6 * random() : 1), radius * (random() < 0.25 ? 0.2 + 0.6 * random() : 1)];
    const wobble = (random() - 0.5) * spacing * 0.5;
    const point = (along: number, bend: number): string => `${round2(cx + dx * along + nx * (offset + bend))} ${round2(cy + dy * along + ny * (offset + bend))}`;
    d += `M${point(from, 0)}Q${point((from + to) / 2, wobble)} ${point(to, 0)}`;
  }
  return { d, lines: count + 1 };
}

/**
 * Rewrites a drawing as a pencil sketch (in place): graphite ink, ink lines
 * brushed so they taper, wander and overshoot, with a faint second pass on
 * some of them; filled areas turned to loose hatching over a faint wash of
 * their color; a paper sheet behind. Elements in `skip` are left alone.
 * Returns whether the drawing was rewritten (it needs a `0 0 W H` viewBox).
 */
export function sketchDrawnSvg(root: XmlElement, scheme: ColorScheme, skip: ReadonlySet<XmlElement> = new Set()): boolean {
  const size = drawingViewBox(root);
  if (size === undefined) return false;
  const tone = DRAWING_LOOK_TONES.draft[scheme];
  const random = seededLookRandom(`draft|${String(size[0])}x${String(size[1])}|${String(root.descendants().length)}`);
  root.setAttribute('color', tone.ink);
  const shapes = paintedShapes(root, skip);
  // A second, fainter pass on every third ink line, a hair off the first.
  const nudge = Math.max(0.6, size[0] / 500);
  shapes.forEach(({ element, state }, index) => {
    if (index % 3 !== 1 || !/^currentcolor$/i.test(state.stroke) || state.dashed || !(state.width <= 4)) return;
    const pass = cloneSvgElement(element);
    setAttributes(pass, {
      fill: 'none',
      'stroke-opacity': round2(state.strokeOpacity * 0.38),
      transform: `translate(${String(round2(nudge * (random() - 0.3)))} ${String(round2(nudge * (random() - 0.3)))})${element.getAttribute('transform') !== null ? ` ${element.getAttribute('transform') ?? ''}` : ''}`,
    });
    element.after(pass);
  });
  // Colored lines go graphite-tinted.
  for (const { element, state } of shapes) {
    const stroke = solidHex(state.stroke);
    if (stroke !== undefined && element.hasAttribute('stroke')) element.setAttribute('stroke', mixHexColors(stroke.hex, tone.ink, 0.45));
  }
  brushSvgStrokes(root, skip);
  // Hatch the filled areas still standing (brushing may have replaced ink-only shapes).
  const prefix = freshIdPrefix(root, 'wbd-');
  const gradients = gradientColors(root);
  const spacing = Math.max(3.5, Math.min(size[0], size[1]) / 70);
  let [budget, clips] = [MAX_SKETCH_HATCH_LINES, 0];
  for (const { element, state } of paintedShapes(root, skip)) {
    if (element.parent === null || element.localName === 'line') continue;
    // Solid ink areas stay solid, as a pencil fills them in.
    const fill = paintColor(state.fill, gradients);
    if (fill === undefined || fill.color === 'currentColor') continue;
    const local = parseSvgTransform(IDENTITY_MATRIX, element.getAttribute('transform') ?? '');
    const polylines = local === undefined ? undefined : flattenSvgShape(element, local);
    const bounds = polylines === undefined || polylines.length === 0 ? undefined : polylineBounds(polylines);
    element.setAttribute('fill-opacity', String(round2(state.fillOpacity * fill.alpha * SKETCH_FILL_OPACITY)));
    if (bounds === undefined || bounds[2] - bounds[0] < spacing || bounds[3] - bounds[1] < spacing / 2) continue;
    const hatch = pencilHatchPath(bounds, spacing, Math.PI / 4 + (random() - 0.5) * 0.5, budget, random);
    if (hatch === undefined) continue;
    budget -= hatch.lines;
    const id = `${prefix}${String(clips++)}`;
    const clip = setAttributes(createSvgElement('clipPath'), { id });
    const outline = createSvgElement(element.localName);
    for (const name of CLIP_GEOMETRY) {
      const value = element.getAttribute(name);
      if (value !== null) outline.setAttribute(name, value);
    }
    clip.appendChild(outline);
    const lines = setAttributes(createSvgElement('path'), {
      d: hatch.d,
      fill: 'none',
      stroke: mixHexColors(fill.color, tone.ink, scheme === 'light' ? 0.35 : 0.25),
      'stroke-width': round2(Math.max(0.7, size[0] / 650)),
      'stroke-linecap': 'round',
      'stroke-opacity': round2(Math.min(1, 0.4 + 0.5 * state.fillOpacity * fill.alpha)),
      'clip-path': `url(#${id})`,
    });
    element.after(clip, lines);
  }
  root.insertBefore(paperSheet(size[0], size[1], tone.paper ?? '#ffffff'), root.childNodes[0] ?? null);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Comic                                                                      */
/* -------------------------------------------------------------------------- */

/** Thickness of a comic drawing's outer outline, as a share of its larger side. */
export const COMIC_OUTLINE_SHARE = 0.016;
/** How far a comic drawing's hard shadow falls, as a share of its larger side. */
export const COMIC_SHADOW_SHARE = 0.018;
/**
 * The hard shadow's tone: near-black ink on a light board; on a dark board
 * black would vanish, so the shadow is a lifted warm grey that still reads
 * as a cast shadow under the light rims.
 */
export const COMIC_SHADOW_TONES: Readonly<Record<ColorScheme, { color: string; opacity: number }>> = {
  light: { color: '#141414', opacity: 0.88 },
  dark: { color: '#5C5850', opacity: 1 },
};

/** Recolors every paint in a copied tree to `color`, keeps filled shapes only, and returns the copy. */
function silhouetteOf(
  content: XmlElement,
  inherited: PaintState,
  color: string,
  keep: (element: XmlElement, state: PaintState) => boolean,
  extra: (element: XmlElement, state: PaintState) => void,
): XmlElement {
  const copy = cloneSvgElement(content);
  const visit = (original: XmlElement, twin: XmlElement, inherited: PaintState): void => {
    const state = paintStateOf(original, inherited);
    for (const name of ['fill', 'stroke']) {
      const value = twin.getAttribute(name);
      if (value !== null && value !== 'none') twin.setAttribute(name, color);
    }
    if (/Gradient$|^clipPath$|^defs$/.test(twin.localName)) {
      twin.remove();
      return;
    }
    if (original.localName === 'g' || original === content) {
      const [sources, twins] = [original.children, twin.children];
      sources.forEach((child, index) => {
        const mirror = twins[index];
        if (mirror !== undefined) visit(child, mirror, state);
      });
      return;
    }
    if (!SHAPE_TAGS.has(original.localName) || !keep(original, state)) twin.remove();
    else extra(twin, state);
  };
  visit(content, copy, inherited);
  return copy;
}

/** True when a shape paints a visible fill. */
function isFilledShape(element: XmlElement, state: PaintState): boolean {
  return element.localName !== 'line' && state.fill !== 'none' && state.fillOpacity * state.opacity > 0.2;
}

/**
 * Rewrites a drawing as a comic panel (in place): flat, bolder fills; a
 * thick outline round the whole of each filled mass and thinner ink lines
 * inside; a hard shadow offset under the filled shapes. Elements in `skip`
 * keep their own paint. Returns whether it was rewritten.
 */
export function comicDrawnSvg(root: XmlElement, scheme: ColorScheme, skip: ReadonlySet<XmlElement> = new Set()): boolean {
  const size = drawingViewBox(root);
  if (size === undefined) return false;
  const tone = DRAWING_LOOK_TONES.comic[scheme];
  const unit = Math.max(size[0], size[1]);
  const [outline, inner, drop] = [Math.max(3, unit * COMIC_OUTLINE_SHARE), Math.max(1.4, unit * 0.005), Math.max(3, unit * COMIC_SHADOW_SHARE)];
  root.setAttribute('color', tone.ink);
  const shapes = paintedShapes(root, skip);
  // Flat, bold colors.
  for (const node of [root, ...root.descendants()]) {
    if (skip.has(node)) continue;
    for (const name of ['fill', 'stroke']) {
      const solid = solidHex(node.getAttribute(name) ?? '');
      if (solid !== undefined) node.setAttribute(name, comicColor(solid.hex));
    }
    const fillOpacity = Number(node.getAttribute('fill-opacity') ?? 1);
    if (node.hasAttribute('fill-opacity') && fillOpacity >= 0.3) node.setAttribute('fill-opacity', '1');
  }
  // Thin ink edges on filled shapes that had none.
  for (const { element, state } of shapes)
    if (isFilledShape(element, state) && state.stroke === 'none') setAttributes(element, { stroke: 'currentColor', 'stroke-width': round2(inner / Math.sqrt(matrixAreaScale(state.at ?? IDENTITY_MATRIX))), 'stroke-linejoin': 'round' });
  const content = setAttributes(createSvgElement('g'), {});
  content.append(...root.childNodes);
  const filledOnly = (element: XmlElement, state: PaintState): boolean => !skip.has(element) && isFilledShape(element, state);
  const rootPaint = paintStateOf(root, ROOT_PAINT);
  const shadowTone = COMIC_SHADOW_TONES[scheme];
  const shadow = silhouetteOf(content, rootPaint, shadowTone.color, filledOnly, (twin) => void twin.removeAttribute('stroke-dasharray'));
  setAttributes(shadow, { transform: `translate(${String(round2(drop))} ${String(round2(drop))})`, opacity: shadowTone.opacity, color: shadowTone.color });
  const rim = silhouetteOf(content, rootPaint, tone.ink, filledOnly, (twin, state) => {
    const scale = Math.sqrt(matrixAreaScale(state.at ?? IDENTITY_MATRIX)) || 1;
    setAttributes(twin, { stroke: tone.ink, 'stroke-width': round2((state.stroke !== 'none' ? state.width : 0) + outline / scale), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-opacity': 1, 'fill-opacity': 1 });
    twin.removeAttribute('stroke-dasharray');
  });
  setAttributes(rim, { color: tone.ink });
  root.append(shadow, rim, content);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Blueprint                                                                  */
/* -------------------------------------------------------------------------- */

/** Saturation above which a blueprint keeps a color (what moves or flows). */
export const BLUEPRINT_KEEP_SATURATION = 0.45;
/**
 * How a kept fill is washed on blue paper: tinted toward white and laid
 * nearly opaque, since a thin wash of a warm color over blue turns olive.
 */
export const BLUEPRINT_KEPT_WASH = { tint: 0.3, opacity: 0.85 } as const;
/** The fill of a section cut (`class="cut"`): a flat mid-grey, so walls cut through read as solid. */
export const BLUEPRINT_CUT_FILL: Readonly<Record<ColorScheme, string>> = { light: '#8E959E', dark: '#5F6772' };

/** True when an element's `class` names the `cut` marker. */
function hasCutClass(element: XmlElement): boolean {
  return /(?:^|\s)cut(?:\s|$)/.test(element.getAttribute('class') ?? '');
}

/**
 * The parts of a drawing marked as section cuts (`class="cut"` on them or
 * on a group around them). `class` is only a marker here: no CSS applies.
 */
export function drawingCutParts(root: XmlElement): Set<XmlElement> {
  const cuts = new Set<XmlElement>();
  for (const node of [root, ...root.descendants()]) if (hasCutClass(node) || (node.parent instanceof XmlElement && cuts.has(node.parent))) cuts.add(node);
  return cuts;
}

/** Grid lines for a blueprint sheet `width` × `height`: minor lines and every fifth one stronger. */
export function blueprintGridPaths(width: number, height: number): { minor: string; major: string; pitch: number } {
  const raw = Math.max(width, height) / 32;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const pitch = [1, 2, 2.5, 5, 10].map((step) => step * magnitude).find((step) => step >= raw) ?? raw;
  let [minor, major] = ['', ''];
  for (let index = 1; index * pitch < width; index++) {
    const line = `M${String(round2(index * pitch))} 0V${String(height)}`;
    if (index % 5 === 0) major += line;
    else minor += line;
  }
  for (let index = 1; index * pitch < height; index++) {
    const line = `M0 ${String(round2(index * pitch))}H${String(width)}`;
    if (index % 5 === 0) major += line;
    else minor += line;
  }
  return { minor, major, pitch };
}

/**
 * Rewrites a drawing as a blueprint (in place): blue paper with a faint
 * grid, pale lines at their own weights (dashes kept), fills as pale
 * washes outlined in line; strongly colored parts (what is meant to stand
 * out) keep their hue in a light, nearly opaque wash, and section cuts
 * (`cuts`, by default the parts marked `class="cut"`) are filled solid
 * mid-grey. Returns whether it was rewritten.
 */
export function blueprintDrawnSvg(root: XmlElement, scheme: ColorScheme, skip: ReadonlySet<XmlElement> = new Set(), cuts: ReadonlySet<XmlElement> = drawingCutParts(root)): boolean {
  const size = drawingViewBox(root);
  if (size === undefined) return false;
  const tone = DRAWING_LOOK_TONES.blueprint[scheme];
  const paper = tone.paper ?? '#1E4E8C';
  root.setAttribute('color', tone.ink);
  const shapes = paintedShapes(root, skip);
  const gradients = gradientColors(root);
  const lineWidth = round2(Math.max(1, Math.max(size[0], size[1]) / 400));
  for (const node of [root, ...root.descendants()]) {
    if (skip.has(node)) continue;
    const stroke = node.getAttribute('stroke');
    const strokeColor = stroke === null ? undefined : paintColor(stroke, gradients);
    if (strokeColor !== undefined && strokeColor.color !== 'currentColor')
      node.setAttribute('stroke', hexSaturation(strokeColor.color) >= BLUEPRINT_KEEP_SATURATION ? mixHexColors(strokeColor.color, '#ffffff', 0.4) : 'currentColor');
    const fill = node.getAttribute('fill');
    const fillColor = fill === null ? undefined : paintColor(fill, gradients);
    if (fillColor === undefined || fillColor.color === 'currentColor') continue;
    const keep = hexSaturation(fillColor.color) >= BLUEPRINT_KEEP_SATURATION;
    const darkness = 1 - hexToHsl(fillColor.color).l;
    const opacity = Number(node.getAttribute('fill-opacity') ?? 1) * fillColor.alpha;
    const shown = Number.isFinite(opacity) ? opacity : 1;
    setAttributes(node, {
      fill: keep ? mixHexColors(fillColor.color, '#ffffff', BLUEPRINT_KEPT_WASH.tint) : tone.ink,
      'fill-opacity': round2(keep ? Math.min(shown, BLUEPRINT_KEPT_WASH.opacity) : shown * (0.06 + 0.16 * darkness)),
    });
  }
  for (const { element, state } of shapes) {
    if (cuts.has(element) && element.localName !== 'line') {
      setAttributes(element, { fill: BLUEPRINT_CUT_FILL[scheme], 'fill-opacity': 1 });
      if (state.stroke === 'none') setAttributes(element, { stroke: 'currentColor', 'stroke-width': lineWidth, 'stroke-linejoin': 'round' });
      continue;
    }
    // Filled parts without a line get one.
    if (isFilledShape(element, state) && state.stroke === 'none') setAttributes(element, { stroke: 'currentColor', 'stroke-width': lineWidth, 'stroke-linejoin': 'round' });
  }
  const grid = blueprintGridPaths(size[0], size[1]);
  const gridColor = mixHexColors(paper, tone.ink, 0.28);
  const sheet = [
    paperSheet(size[0], size[1], paper),
    setAttributes(createSvgElement('path'), { d: grid.minor, fill: 'none', stroke: gridColor, 'stroke-width': round2(lineWidth * 0.45), 'stroke-opacity': 0.55 }),
    setAttributes(createSvgElement('path'), { d: grid.major, fill: 'none', stroke: gridColor, 'stroke-width': round2(lineWidth * 0.8), 'stroke-opacity': 0.7 }),
  ];
  const first = root.childNodes[0] ?? null;
  for (const part of sheet) root.insertBefore(part, first);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Paint plan (raster looks)                                                  */
/* -------------------------------------------------------------------------- */

/** One drawn shape as the raster looks paint it, in viewBox coordinates. */
export interface DrawingPaintPart {
  /** Fill color (`#rrggbb` or `currentColor`) and alpha. */
  fill: { color: string; alpha: number } | undefined;
  /** Stroke color, alpha and width (viewBox units). */
  stroke: { color: string; alpha: number; width: number; dashed: boolean; round: boolean } | undefined;
  /** Outlines (flat `x y x y …`). */
  contours: SvgPolyline[];
  /** The outline closes on itself (a stroke runs back to its start). */
  closed: boolean;
}

/** A drawing flattened for painting. */
export interface DrawingPaintPlan {
  width: number;
  height: number;
  parts: DrawingPaintPart[];
}

/** Most parts a painted drawing may have. */
export const MAX_PAINT_PARTS = 1500;
/** Most outline points a painted drawing may have. */
export const MAX_PAINT_POINTS = 80000;

/**
 * The shapes of a drawing with their resolved paint, back to front, for the
 * raster looks. `undefined` when the drawing has no `0 0 W H` viewBox or is
 * too big to paint. Shapes in `skip` or that cannot be flattened are left out.
 */
export function drawingPaintPlan(root: XmlElement, skip: ReadonlySet<XmlElement> = new Set()): DrawingPaintPlan | undefined {
  const size = drawingViewBox(root);
  if (size === undefined) return undefined;
  const gradients = gradientColors(root);
  const parts: DrawingPaintPart[] = [];
  let points = 0;
  for (const { element, state } of paintedShapes(root, skip)) {
    if (state.at === undefined) continue;
    const contours = flattenSvgShape(element, state.at);
    if (contours === undefined || contours.length === 0) continue;
    const fillPaint = element.localName === 'line' ? undefined : paintColor(state.fill, gradients);
    const strokePaint = paintColor(state.stroke, gradients);
    const width = state.width * Math.sqrt(matrixAreaScale(state.at));
    const fillAlpha = (fillPaint?.alpha ?? 0) * state.fillOpacity * state.opacity;
    const strokeAlpha = (strokePaint?.alpha ?? 0) * state.strokeOpacity * state.opacity;
    const part: DrawingPaintPart = {
      fill: fillPaint !== undefined && fillAlpha > 0.01 ? { color: fillPaint.color, alpha: fillAlpha } : undefined,
      stroke:
        strokePaint !== undefined && strokeAlpha > 0.01 && width > 0
          ? { color: strokePaint.color, alpha: strokeAlpha, width, dashed: state.dashed, round: state.cap === 'round' || state.cap === 'square' }
          : undefined,
      contours,
      closed: /^(?:rect|circle|ellipse|polygon)$/.test(element.localName) || (element.localName === 'path' && /z\s*$/i.test(element.getAttribute('d') ?? '')),
    };
    if (part.fill === undefined && part.stroke === undefined) continue;
    points += contours.reduce((total, contour) => total + contour.length / 2, 0);
    parts.push(part);
    if (parts.length > MAX_PAINT_PARTS || points > MAX_PAINT_POINTS) return undefined;
  }
  return { width: size[0], height: size[1], parts };
}
