/**
 * Agent drawings (base64 SVG images) as the exporter draws them: vetted
 * first (a drawing with parts the board does not know becomes the
 * "unreadable drawing" placeholder), then given the board's pen.
 *
 * Drawings that paint in `currentColor` get the pen's color: dark ink on
 * light boards, light chalk on dark ones. Unless a drawing asks for the
 * `clean` look, solid fills become marker hatching and thin strokes become
 * brushed ink, and chalk drawings are layered so they read on dark paper.
 * That is the `plain` look; `draft`, `comic` and `blueprint` rewrite the
 * SVG (`whiteboard-core`'s `looks.ts`), and the painted looks (marker,
 * watercolor, paper) show plain here until the look service has painted
 * them. Parts the restyling cannot safely touch (gradients, references,
 * unusual attributes) are left alone. Everything runs on the core's own XML
 * tree, so no DOM is needed.
 */

import {
  BOARD_THEME_COLORS,
  MAX_CONTRAST_POINTS,
  MAX_CONTRAST_POINTS_HARD,
  MAX_SVG_SOURCE_CHARS,
  SVG_GEOMETRY_ATTRIBUTES,
  SVG_NAMESPACE,
  SVG_VET_CACHE_MAX_CHARS,
  UNREADABLE_DRAWING_SVG,
  blueprintDrawnSvg,
  brushSvgStrokes,
  comicDrawnSvg,
  decodeSvgDataUrl,
  drawingCutParts,
  drawingLookRenderer,
  imageDrawingLook,
  hatchSvgFills,
  isSvgBase64DataUrl,
  layerSvgForContrast,
  parseSvgTree,
  serializeXml,
  sketchDrawnSvg,
  svgToBase64DataUrl,
  unknownSvgParts,
  type ColorScheme,
  type DrawingStyle,
  type ImageElement,
  type XmlAttribute,
  type XmlElement,
} from '@open-artifact/whiteboard-core';

/** The pen a drawing is drawn with: `ink` on light paper, `chalk` on dark. */
export type DrawnPen = 'ink' | 'chalk';

/** The pen for drawings on a board in a color scheme. */
export function drawnImagePen(scheme: ColorScheme): DrawnPen {
  return scheme === 'light' ? 'ink' : 'chalk';
}

/** The root `<svg …>` tag at the start of a drawing. */
const SVG_OPEN_TAG_PATTERN = /^<svg(?:\s+[^\s"'<>/=]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/;

/** Elements the restyling may change. */
const RESTYLABLE_TAGS: ReadonlySet<string> = new Set(['g', 'line', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline']);

/** Paint attributes the restyling understands. */
const PAINT_ATTRIBUTES = [
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
] as const;

/** Attributes an element may carry and still be restyled. */
const RESTYLABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...SVG_GEOMETRY_ATTRIBUTES,
  ...PAINT_ATTRIBUTES,
  'xmlns',
  'viewBox',
  'data-look',
  'transform',
  'xmlns:xlink',
  'version',
  'preserveAspectRatio',
  'role',
  'aria-label',
  'aria-hidden',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
]);

/** Most elements a drawing may have and still be restyled. */
const MAX_RESTYLABLE_ELEMENTS = 1500;

/** Attributes dropped when they say `none` (or nothing). */
const ATTRIBUTES_DROPPED_WHEN_NONE = ['transform', 'clip-path', 'mask', 'filter'] as const;

/** Named colors drawings use, as hex (`transparent` as `none`). */
const NAMED_COLOR_HEX: ReadonlyMap<string, string> = new Map(
  Object.entries({
    black: '#000000',
    silver: '#c0c0c0',
    gray: '#808080',
    grey: '#808080',
    white: '#ffffff',
    maroon: '#800000',
    red: '#ff0000',
    purple: '#800080',
    fuchsia: '#ff00ff',
    green: '#008000',
    lime: '#00ff00',
    olive: '#808000',
    yellow: '#ffff00',
    navy: '#000080',
    blue: '#0000ff',
    teal: '#008080',
    aqua: '#00ffff',
    orange: '#ffa500',
    transparent: 'none',
  }),
);

/** A paint the restyling understands. */
const PAINT_VALUE_PATTERN = /^(?:none|currentcolor|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8}))$/i;
/** A plain non-negative number. */
const NUMBER_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/** A paint color with names and `rgb(…)` written as hex. */
export function normalizeSvgPaintColor(color: string): string {
  return (
    NAMED_COLOR_HEX.get(color.toLowerCase()) ??
    color.replace(/^rgb\( *(\d{1,3}) *, *(\d{1,3}) *, *(\d{1,3}) *\)$/i, (_match, ...groups: string[]) =>
      `#${groups
        .slice(0, 3)
        .map((channel) => Math.min(255, Number(channel)).toString(16).padStart(2, '0'))
        .join('')}`,
    )
  );
}

/** What each inlinable `style` property may say. */
const STYLE_PROPERTY_PATTERNS: ReadonlyMap<string, { test(value: string): boolean }> = new Map(
  Object.entries({
    fill: { test: (value: string) => PAINT_VALUE_PATTERN.test(normalizeSvgPaintColor(value)) },
    stroke: { test: (value: string) => PAINT_VALUE_PATTERN.test(normalizeSvgPaintColor(value)) },
    opacity: NUMBER_PATTERN,
    'fill-opacity': NUMBER_PATTERN,
    'stroke-opacity': NUMBER_PATTERN,
    'stroke-width': NUMBER_PATTERN,
    'stroke-miterlimit': NUMBER_PATTERN,
    'stroke-dashoffset': NUMBER_PATTERN,
    'fill-rule': /^(?:nonzero|evenodd)$/,
    'stroke-linecap': /^(?:butt|round|square)$/,
    'stroke-linejoin': /^(?:miter|round|bevel)$/,
    'stroke-dasharray': /^(?:none|\d+(?:\.\d+)?(?:[ ,]\d+(?:\.\d+)?)*)$/,
  }),
);

/** Moves a short, simple `style` attribute into presentation attributes (left alone otherwise). */
function inlineStyleAttribute(element: XmlElement): void {
  const style = element.getAttribute('style');
  if (style === null || style.length > 300) return;
  const declarations = style.split(';').map((part) => /^[ \t\r\n]*(?:([a-z-]+)[ \t\r\n]*:[ \t\r\n]*(\S(?:.*\S)?))?[ \t\r\n]*$/.exec(part));
  if (declarations.some((match) => match === null || (match[1] !== undefined && STYLE_PROPERTY_PATTERNS.get(match[1])?.test(match[2] ?? '') !== true))) return;
  for (const match of declarations) if (match?.[1] !== undefined) element.setAttribute(match[1], match[2] ?? '');
  element.removeAttribute('style');
}

/** A drawing ready to restyle, and the elements the restyling must leave alone. */
interface RestylableDrawing {
  root: XmlElement;
  shut: ReadonlySet<XmlElement>;
  /** Parts marked as section cuts (`class="cut"`; the class itself is dropped). */
  cuts: ReadonlySet<XmlElement>;
}

/**
 * Parses a vetted drawing for restyling: empty text, titles and
 * descriptions dropped, simple `style` attributes inlined and paint
 * colors written as hex. `undefined` when the drawing is too big, animated
 * or already layered by the board.
 */
export function parseRestylableDrawnSvg(svg: string): RestylableDrawing | undefined {
  if (svg.length > MAX_SVG_SOURCE_CHARS || svg.split('xmlns:').length > 3) return undefined;
  const root = parseSvgTree(svg);
  if (typeof root === 'string') return undefined;
  for (const node of root.descendants()) {
    const empty = node.namespaceURI === SVG_NAMESPACE && node.childElementCount === 0;
    if (empty && node.localName === 'text' && /^[ \t\r\n]*$/.test(node.textContent) && node.attributes.every((attribute) => RESTYLABLE_ATTRIBUTES.has(attribute.name))) node.remove();
    else if (empty && /^(?:title|desc|metadata)$/.test(node.localName)) node.remove();
  }
  const nodes = root.descendants();
  if (nodes.length > MAX_RESTYLABLE_ELEMENTS || nodes.some((node) => node.namespaceURI !== SVG_NAMESPACE || /^(?:style|set|animate.*|discard)$/.test(node.localName))) return undefined;
  const all = [root, ...nodes];
  const cuts = drawingCutParts(root);
  const hasReferences = all.some((node) => node.attributes.some((attribute) => /href$/i.test(attribute.name) || /url\(|\\/i.test(attribute.value)));
  if (hasReferences && all.some((node) => /^wb(?:-\d+)?$/.test(node.getAttribute('id') ?? ''))) return undefined;
  for (const node of all) {
    for (const name of ATTRIBUTES_DROPPED_WHEN_NONE) if (/^(?:none)?$/i.test((node.getAttribute(name) ?? '').trim())) node.removeAttribute(name);
    for (const name of hasReferences ? ['class'] : ['class', 'id']) node.removeAttribute(name);
    inlineStyleAttribute(node);
    for (const name of ['fill', 'stroke']) {
      const value = node.getAttribute(name);
      if (value !== null) node.setAttribute(name, normalizeSvgPaintColor(value));
    }
  }
  const isUnsafe = (attribute: XmlAttribute, owner: XmlElement): boolean =>
    !RESTYLABLE_ATTRIBUTES.has(attribute.name) ||
    ((attribute.name === 'fill' || attribute.name === 'stroke') && attribute.value.startsWith('#') && !PAINT_VALUE_PATTERN.test(attribute.value)) ||
    (attribute.name === 'fill-rule' && attribute.value !== 'evenodd' && attribute.value !== 'nonzero') ||
    (attribute.name === 'stroke-width' && !Number.isFinite(Number(attribute.value))) ||
    (attribute.name === 'transform' && owner === root) ||
    (attribute.name === 'data-look' && owner !== root);
  const shut = new Set(
    all.filter(
      (node) =>
        (node !== root && (!RESTYLABLE_TAGS.has(node.localName) || (node.localName !== 'g' && node.childElementCount > 0))) ||
        node.attributes.some((attribute) => isUnsafe(attribute, node)),
    ),
  );
  if (shut.has(root)) return undefined;
  return { root, shut, cuts };
}

/** The color a pen paints `currentColor` in. */
function penColor(pen: DrawnPen): string {
  return pen === 'ink' ? BOARD_THEME_COLORS.light.ink : BOARD_THEME_COLORS.dark.ink;
}

/**
 * A vetted drawing with the pen applied. Drawings that do not paint in
 * `currentColor`, or pick their own `color`, stay as they are; drawings the
 * restyling cannot read just get the pen color.
 */
export function applyPenToDrawnSvg(svg: string, pen: DrawnPen): string {
  const openTag = /currentcolor/i.test(svg) ? SVG_OPEN_TAG_PATTERN.exec(svg)?.[0] : undefined;
  if (openTag === undefined || /\scolor\s*=/.test(openTag)) return svg;
  const color = penColor(pen);
  const fallback = `<svg color="${color}"${svg.slice(4)}`;
  try {
    const drawing = parseRestylableDrawnSvg(svg);
    if (drawing === undefined) return fallback;
    const { root, shut } = drawing;
    root.setAttribute('color', color);
    const restyled = root.getAttribute('data-look') !== 'clean' && [hatchSvgFills(root, shut), brushSvgStrokes(root, shut)].includes(true) ? serializeXml(root) : fallback;
    const chalked = pen === 'chalk' && layerSvgForContrast(root, color, BOARD_THEME_COLORS.light.ink, shut) ? serializeXml(root) : restyled;
    // Each `<use>` the layering added redraws the drawing once more.
    const uses = root.descendants().filter((node) => node.localName === 'use').length;
    if (chalked.length <= MAX_CONTRAST_POINTS && chalked.length * (uses + 1) <= MAX_CONTRAST_POINTS_HARD) return chalked;
    return restyled.length <= MAX_CONTRAST_POINTS ? restyled : fallback;
  } catch {
    return fallback;
  }
}

/** Restyled sources by pen, bounded by {@link SVG_VET_CACHE_MAX_CHARS}. */
const penCache: Record<DrawnPen, Map<string, string>> = { ink: new Map(), chalk: new Map() };
let penCacheChars = 0;

/**
 * The image source to draw for `src` with a pen: drawings vetted and
 * restyled, everything else (pictures, uploads) unchanged.
 */
export function drawnImageSrcForPen(src: string, pen: DrawnPen): string {
  const cached = penCache[pen].get(src);
  if (cached !== undefined) return cached;
  const svg = decodeSvgDataUrl(src);
  if (svg === undefined && !isSvgBase64DataUrl(src)) return src;
  const themed = svg === undefined || unknownSvgParts(svg).length > 0 ? UNREADABLE_DRAWING_SVG : applyPenToDrawnSvg(svg, pen);
  const result = themed === svg ? src : svgToBase64DataUrl(themed);
  penCacheChars += src.length + result.length;
  if (penCacheChars > SVG_VET_CACHE_MAX_CHARS) {
    penCache.ink.clear();
    penCache.chalk.clear();
    penCacheChars = src.length + result.length;
  }
  penCache[pen].set(src, result);
  return result;
}

/** Longest rewritten drawing a look may produce; longer ones draw plain. */
export const MAX_LOOK_SVG_CHARS = 1_500_000;

/** The color scheme a pen draws for. */
function penScheme(pen: DrawnPen): ColorScheme {
  return pen === 'ink' ? 'light' : 'dark';
}

/**
 * A vetted drawing in a style's look for a pen. `draft`, `comic` and
 * `blueprint` rewrite the drawing; `plain` and the painted looks draw it
 * with the pen (the painted looks are replaced once painted). A drawing a
 * look cannot rewrite draws plain.
 */
export function applyLookToDrawnSvg(svg: string, look: DrawingStyle, pen: DrawnPen): string {
  const plain = (): string => applyPenToDrawnSvg(svg, pen);
  if (look === 'plain' || drawingLookRenderer(look) === 'raster') return plain();
  try {
    const drawing = parseRestylableDrawnSvg(svg);
    if (drawing === undefined) return plain();
    const { root, shut, cuts } = drawing;
    const scheme = penScheme(pen);
    const rewritten = look === 'draft' ? sketchDrawnSvg(root, scheme, shut) : look === 'comic' ? comicDrawnSvg(root, scheme, shut) : blueprintDrawnSvg(root, scheme, shut, cuts);
    const result = rewritten ? serializeXml(root) : undefined;
    return result !== undefined && result.length <= MAX_LOOK_SVG_CHARS ? result : plain();
  } catch {
    return plain();
  }
}

/** Drawings in a look by look and pen, bounded by {@link SVG_VET_CACHE_MAX_CHARS}. */
const lookCache = new Map<string, string>();
let lookCacheChars = 0;

/** The image source of a drawing in a style's look (pictures and uploads unchanged). */
export function drawnImageSrcForLook(src: string, look: DrawingStyle, pen: DrawnPen): string {
  const key = `${look}|${pen}|${src}`;
  const cached = lookCache.get(key);
  if (cached !== undefined) return cached;
  const svg = decodeSvgDataUrl(src);
  if (svg === undefined && !isSvgBase64DataUrl(src)) return src;
  const themed = svg === undefined || unknownSvgParts(svg).length > 0 ? UNREADABLE_DRAWING_SVG : applyLookToDrawnSvg(svg, look, pen);
  const result = themed === svg ? src : svgToBase64DataUrl(themed);
  lookCacheChars += src.length + result.length;
  if (lookCacheChars > SVG_VET_CACHE_MAX_CHARS) {
    lookCache.clear();
    lookCacheChars = src.length + result.length;
  }
  lookCache.set(key, result);
  return result;
}

/**
 * The source an image element draws with a pen: a drawing in its look
 * (plain and the painted looks with the pen), anything else unchanged.
 */
export function drawnImageSrc(image: Pick<ImageElement, 'src' | 'style'>, pen: DrawnPen): string {
  const look = imageDrawingLook(image);
  return look === undefined || look === 'plain' || drawingLookRenderer(look) === 'raster' ? drawnImageSrcForPen(image.src, pen) : drawnImageSrcForLook(image.src, look, pen);
}
