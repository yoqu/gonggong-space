/**
 * Vetting drawn SVGs: a drawing is shown only when every part of it is on a
 * small allowlist of inert shapes, groups, gradients and presentation
 * attributes, within budgets that keep rendering cheap (depth, gradient
 * stops, dash segments, opacity layers, local references). Anything else is
 * reported by name so the author (often an agent) can fix it, and the
 * drawing is replaced by a placeholder.
 *
 * Parsing uses the environment-independent XML parser, so vetting gives the
 * same answer in the page, a worker and the server.
 */

import { SVG_NAMESPACE } from '../image-source.ts';
import { flattenSvgShape, splitSvgPathArcs, SVG_GEOMETRY_ATTRIBUTES } from './svg-geometry.ts';
import { parseSvgTree, type XmlAttribute, type XmlElement } from './xml.ts';

/** Elements that draw geometry. */
export const SVG_SHAPE_TAGS: ReadonlySet<string> = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/** Accessible descriptions (allowed when they hold plain text only). */
export const SVG_DESCRIPTION_TAGS: ReadonlySet<string> = new Set(['title', 'desc']);

/** Every element a drawing may use. */
export const SVG_ALLOWED_TAGS: ReadonlySet<string> = new Set([...SVG_SHAPE_TAGS, ...SVG_DESCRIPTION_TAGS, 'svg', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop']);

/** Every attribute a drawing may use (plus `data-*` and `aria-*`). */
export const SVG_ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...SVG_GEOMETRY_ATTRIBUTES,
  'id',
  'class',
  'role',
  'xmlns',
  'xmlns:xlink',
  'version',
  'viewBox',
  'preserveAspectRatio',
  'transform',
  'opacity',
  'color',
  'display',
  'visibility',
  'fill',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'paint-order',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'href',
  'xlink:href',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'fx',
  'fy',
]);

/** What may come right before a `(` in an attribute value: one of these functions (or nothing). */
export const SVG_FUNCTION_PREFIX_PATTERN = /(?:^|[^\w-])(?:url|rgba?|hsla?|translate|scale|rotate|matrix|skew[xy])?$/i;

/** Attributes allowed only as `none` (or empty). */
export const SVG_NONE_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set(['clip-path', 'mask', 'filter']);

/** Parts reported by their own name; anything else is {@link UNKNOWN_SVG_PART}. */
export const SVG_NAMEABLE_PARTS: ReadonlySet<string> = new Set([
  ...SVG_ALLOWED_TAGS,
  ...SVG_ALLOWED_ATTRIBUTES,
  ...SVG_NONE_ONLY_ATTRIBUTES,
  ...'text tspan use symbol image foreignObject style script filter mask clipPath marker pattern a switch animate animateTransform animateMotion set textPath metadata'.split(' '),
  ...'font-family font-size font-weight marker-start marker-mid marker-end pathLength vector-effect'.split(' '),
]);

/** How an unnameable part is reported. */
export const UNKNOWN_SVG_PART = 'a part the page does not know';
/** Deepest element nesting allowed (the root is depth 1). */
export const MAX_SVG_DEPTH = 6;
/** Most stops per gradient. */
export const MAX_GRADIENT_STOPS = 8;
/** Gradients are refused in drawings with more shapes than this. */
export const MAX_SHAPES_WITH_GRADIENTS = 150;
/** Most dash segments in a whole drawing. */
export const MAX_DASH_BUDGET = 2000;
/** Most `opacity` attributes (each can cost an offscreen layer). */
export const MAX_OPACITY_LAYERS = 64;
/** Most local `href` references. */
export const MAX_LOCAL_HREFS = 64;
/** Reported when the drawing cannot be read at all. */
export const WHOLE_SVG_PART = 'all of it';
/** Vetting results are cached until their sources add up to this many characters. */
export const SVG_VET_CACHE_MAX_CHARS = 4194304;

/** What a drawing may still spend while being vetted. */
export interface SvgVetBudget {
  dashes: number;
  hrefs: number;
  layers: number;
}

/**
 * Total outline length of a shape (or of the shapes in a group), used to
 * count dash segments. A path's arc counts as the full circle of its larger
 * radius, plus the straight line between its ends. `Infinity` when it
 * cannot be measured cheaply (non-numeric geometry) or has an arc with a
 * radius under 1.
 */
export function svgShapeLength(element: XmlElement): number {
  if (!SVG_SHAPE_TAGS.has(element.localName)) return element.children.reduce((total, child) => total + svgShapeLength(child), 0);
  if (!SVG_GEOMETRY_ATTRIBUTES.every((name) => name === 'd' || name === 'points' || /^-?(?:\d+|\d*\.\d+)$/.test(element.getAttribute(name) ?? '0'))) return Infinity;
  const num = (name: string): number => Number(element.getAttribute(name) ?? 0);
  if (element.localName === 'line') return Math.hypot(num('x2') - num('x1'), num('y2') - num('y1'));
  if (element.localName === 'rect') return 2 * (Math.abs(num('width')) + Math.abs(num('height')));
  if (element.localName === 'circle' || element.localName === 'ellipse') return 2 * Math.PI * Math.max(...['r', 'rx', 'ry'].map((name) => Math.abs(num(name))));
  const d = element.localName === 'path' ? (element.getAttribute('d') ?? '') : '';
  const arcs = /a/i.test(d) ? splitSvgPathArcs(d) : undefined;
  if (/a/i.test(d) && (arcs === undefined || arcs.radii.some((radius) => radius < 1))) return Infinity;
  const polylines = flattenSvgShape(arcs === undefined ? element : { localName: 'path', getAttribute: (name) => (name === 'd' ? arcs.lines : element.getAttribute(name)) });
  let length = polylines === undefined ? Infinity : (arcs?.radii ?? []).reduce((total, radius) => total + 2 * Math.PI * radius, 0);
  for (const polyline of polylines ?? [])
    for (let index = 2; index + 1 < polyline.length; index += 2) length += Math.hypot((polyline[index] ?? 0) - (polyline[index - 2] ?? 0), (polyline[index + 1] ?? 0) - (polyline[index - 1] ?? 0));
  return length;
}

/** How many dash segments `dasharray` cuts the element's outline into (`Infinity` when unbounded or unreadable). */
export function dashSegmentCount(element: XmlElement, dasharray: string): number {
  const dashes = /^[\d.\s,]+$/.test(dasharray) ? (dasharray.match(/\d*\.?\d+/g) ?? []).map(Number) : [];
  const total = dashes.reduce((sum, dash) => sum + dash, 0);
  return total > 0 && total < Infinity ? (svgShapeLength(element) * dashes.length) / total : Infinity;
}

/**
 * Walks an element's subtree, adding the name of every disallowed part to
 * `unknown` and spending `budget` on dashes, references and opacity layers.
 */
export function collectUnknownSvgParts(element: XmlElement, depth: number, budget: SvgVetBudget, unknown: Set<string>): void {
  for (const [index, child] of element.children.entries()) {
    const plainDescription = !SVG_DESCRIPTION_TAGS.has(child.localName) || (child.childNodes.length < 2 && child.childElementCount === 0);
    const emptyText = child.localName === 'text' && child.childElementCount === 0 && /^[ \t\r\n]*$/.test(child.textContent);
    if (
      depth < MAX_SVG_DEPTH &&
      child.namespaceURI === SVG_NAMESPACE &&
      (SVG_ALLOWED_TAGS.has(child.localName) || emptyText) &&
      (child.localName !== 'stop' || index < MAX_GRADIENT_STOPS) &&
      plainDescription
    )
      collectUnknownSvgParts(child, depth + 1, budget, unknown);
    else unknown.add(SVG_NAMEABLE_PARTS.has(child.localName) ? `<${child.localName}>` : UNKNOWN_SVG_PART);
  }
  const attributeOk = (attribute: XmlAttribute): boolean => {
    if (SVG_NONE_ONLY_ATTRIBUTES.has(attribute.name)) return /^(?:none)?$/i.test(attribute.value.trim());
    if (!SVG_ALLOWED_ATTRIBUTES.has(attribute.name) && !/^(?:data|aria)-[\w-]+$/.test(attribute.name)) return false;
    // No escapes, comments, nested calls or external URLs; every `(` belongs to an allowed function.
    if (
      /\\|\/\*|\([^)]*\(|url\((?!\s*['"]?#)/i.test(attribute.value) ||
      !attribute.value
        .split('(')
        .slice(0, -1)
        .every((before) => SVG_FUNCTION_PREFIX_PATTERN.test(before.slice(-10)))
    )
      return false;
    if (attribute.localName === 'href') return attribute.value.startsWith('#') && (budget.hrefs -= 1) >= 0;
    if (attribute.name === 'opacity') return (budget.layers -= 1) >= 0;
    if (attribute.name !== 'stroke-dasharray' || attribute.value.trim() === 'none') return true;
    const segments = dashSegmentCount(element, attribute.value);
    if (!(segments <= budget.dashes)) return false;
    budget.dashes -= segments;
    return true;
  };
  for (const attribute of [...element.attributes]) if (!attributeOk(attribute)) unknown.add(SVG_NAMEABLE_PARTS.has(attribute.name) ? attribute.name : UNKNOWN_SVG_PART);
}

/** The disallowed parts of a drawing (empty when it is fine to show). */
export function findUnknownSvgParts(svg: string): string[] {
  try {
    const root = parseSvgTree(svg);
    if (typeof root === 'string' || svg.includes('\uFFFD')) return [WHOLE_SVG_PART];
    const unknown = new Set<string>();
    collectUnknownSvgParts(root, 1, { dashes: Math.min(MAX_DASH_BUDGET, 600 + svg.length / 4), hrefs: MAX_LOCAL_HREFS, layers: MAX_OPACITY_LAYERS }, unknown);
    const descendants = root.descendants();
    if (descendants.some((element) => element.localName === 'stop') && descendants.filter((element) => SVG_SHAPE_TAGS.has(element.localName)).length > MAX_SHAPES_WITH_GRADIENTS) unknown.add('<stop>');
    return [...unknown];
  } catch {
    return [WHOLE_SVG_PART];
  }
}

const svgVetCache = new Map<string, readonly string[]>();
let svgVetCacheChars = 0;

/** {@link findUnknownSvgParts}, cached by source. */
export function unknownSvgParts(svg: string): readonly string[] {
  const cached = svgVetCache.get(svg);
  if (cached !== undefined) return cached;
  if ((svgVetCacheChars += svg.length) > SVG_VET_CACHE_MAX_CHARS) {
    svgVetCache.clear();
    svgVetCacheChars = svg.length;
  }
  const parts = findUnknownSvgParts(svg);
  svgVetCache.set(svg, parts);
  return parts;
}

/** Shown in place of a drawing that fails vetting: a faint frame with a crossed-out picture. */
export const UNREADABLE_DRAWING_SVG =
  `<svg xmlns="${SVG_NAMESPACE}"><rect width="100%" height="100%" rx="8" fill="#878787" fill-opacity=".12"/>` +
  '<svg x="50%" y="50%" overflow="visible"><g fill="none" stroke="#878787" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="-16" y="-12" width="32" height="24" rx="3"/><path d="M-16 7l9-9 7 7 5-4 11 9M-20 16 20-16"/></g></svg></svg>';

/**
 * The drawing itself when it passes vetting, otherwise the placeholder.
 * `safeMode` (the host's "show no generated drawings" switch) always gives
 * the placeholder.
 */
export function drawingSvgOrPlaceholder(svg: string, safeMode = false): string {
  return !safeMode && unknownSvgParts(svg).length === 0 ? svg : UNREADABLE_DRAWING_SVG;
}

/** Adds the SVG namespace to the root `<svg>` when it has none. */
export function ensureSvgNamespace(svg: string): string {
  return /<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/<svg/, `<svg xmlns="${SVG_NAMESPACE}"`);
}
