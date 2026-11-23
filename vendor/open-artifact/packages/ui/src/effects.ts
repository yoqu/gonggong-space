/**
 * Parsing and writing the CSS values the effect editors edit: gradients
 * (`linear-gradient()`, `radial-gradient()` and their `repeating-` forms),
 * `box-shadow` lists and `filter` chains. No DOM.
 *
 * Each parser returns null for a value it cannot represent faithfully (a
 * `var()`, a length in `em`, a color hint…), so an editor can fall back to
 * a plain text field instead of silently rewriting it.
 */
import { formatLike, toRgba, type Rgba } from './color.ts';

/* --------------------------------- tokens --------------------------------- */

/**
 * Splits `text` at top-level separators (outside parentheses): commas, or
 * runs of whitespace. Empty pieces are dropped for whitespace and kept for
 * commas (so `a,,b` can be rejected).
 */
export function splitTopLevel(text: string, separator: ',' | 'space'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    const splits = depth === 0 && (separator === ',' ? ch === ',' : /\s/.test(ch));
    if (splits) {
      if (separator === ',' || current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (separator === ',' || current.trim()) parts.push(current.trim());
  return parts;
}

const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/i;

/** A px length (or a bare 0), else null. */
function px(text: string): number | null {
  const match = LENGTH.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!match[2] && value !== 0) return null;
  return value;
}

/** Rounds for output, without `-0`. */
const num = (value: number, digits = 2) => {
  const out = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(out, -0) ? 0 : out;
};
const pxText = (value: number) => `${num(value)}px`;

/** True for text that can stand as a color in a shadow or stop (a color, `var()`, `currentcolor`). */
function isColorToken(text: string): boolean {
  return toRgba(text) !== null || /^(?:var|color-mix|color|light-dark|hwb|lab|lch|oklab)\(.*\)$/i.test(text) || text.toLowerCase() === 'currentcolor';
}

/* --------------------------------- shadows -------------------------------- */

/** One `box-shadow` layer; lengths in px. */
export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  /** Any CSS color text; `currentcolor` when the value named none. */
  color: string;
  inset: boolean;
}

/** A `drop-shadow()` filter or `text-shadow` layer: no spread, no inset. */
export interface DropShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

/** A new shadow layer: a soft drop shadow. */
export const DEFAULT_SHADOW: ShadowLayer = { x: 0, y: 4, blur: 12, spread: 0, color: 'rgb(0 0 0 / 0.15)', inset: false };

/** Parses one shadow. `full` allows spread and `inset` (box-shadow). */
function parseShadow(text: string, full: boolean): ShadowLayer | null {
  const lengths: number[] = [];
  const colors: string[] = [];
  let inset = false;
  let lengthsDone = false;
  for (const part of splitTopLevel(text, 'space')) {
    const length = px(part);
    if (length !== null) {
      if (lengthsDone) return null;
      lengths.push(length);
      continue;
    }
    if (lengths.length) lengthsDone = true;
    if (part.toLowerCase() === 'inset') {
      if (!full || inset) return null;
      inset = true;
      continue;
    }
    if (!isColorToken(part) || colors.length) return null;
    colors.push(part);
  }
  if (lengths.length < 2 || lengths.length > (full ? 4 : 3)) return null;
  const [x, y, blur = 0, spread = 0] = lengths as [number, number, number?, number?];
  if (blur < 0) return null;
  return { x, y, blur, spread, color: colors[0] ?? 'currentcolor', inset };
}

/**
 * Parses a `box-shadow` value into layers (front first). `none` or empty
 * gives `[]`; null when a layer is not `[inset] x y [blur [spread]] [color]`
 * in px.
 */
export function parseBoxShadow(css: string): ShadowLayer[] | null {
  const text = css.trim();
  if (!text || text.toLowerCase() === 'none') return [];
  const layers: ShadowLayer[] = [];
  for (const part of splitTopLevel(text, ',')) {
    const layer = part ? parseShadow(part, true) : null;
    if (!layer) return null;
    layers.push(layer);
  }
  return layers;
}

/** Writes one box-shadow layer: `[inset] x y blur spread color`. */
export function formatShadowLayer(layer: ShadowLayer): string {
  const parts = [pxText(layer.x), pxText(layer.y), pxText(layer.blur), pxText(layer.spread), layer.color];
  return (layer.inset ? ['inset', ...parts] : parts).join(' ');
}

/** Writes a `box-shadow` value; `none` for no layers. */
export function formatBoxShadow(layers: readonly ShadowLayer[]): string {
  return layers.length ? layers.map(formatShadowLayer).join(', ') : 'none';
}

/** Parses the argument of `drop-shadow()` (or one `text-shadow` layer). */
export function parseDropShadow(text: string): DropShadow | null {
  const layer = parseShadow(text, false);
  return layer ? { x: layer.x, y: layer.y, blur: layer.blur, color: layer.color } : null;
}

/** Writes the argument of `drop-shadow()`: `x y blur color`. */
export function formatDropShadow(shadow: DropShadow): string {
  return `${pxText(shadow.x)} ${pxText(shadow.y)} ${pxText(shadow.blur)} ${shadow.color}`;
}

/* --------------------------------- filters -------------------------------- */

/** Filter functions whose argument is one number. */
export type FilterAmountKind = 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'saturate' | 'hue-rotate' | 'invert' | 'sepia' | 'opacity';
/** Every filter function the editor handles. */
export type FilterKind = FilterAmountKind | 'drop-shadow';

/** One function of a `filter` chain. Amounts: blur in px, hue-rotate in degrees, the rest in percent. */
export type FilterFunction = { kind: FilterAmountKind; value: number } | { kind: 'drop-shadow'; shadow: DropShadow };

/** How a numeric filter is edited. */
export interface FilterSpec {
  label: string;
  unit: 'px' | '%' | 'deg';
  min: number;
  /** Upper bound of the field (CSS clamps grayscale, invert, sepia and opacity at 100%). */
  max: number;
  step: number;
  /** The value that changes nothing. */
  identity: number;
  /** The value a newly added filter starts at. */
  initial: number;
}

/** Field settings of the numeric filters, in menu order. */
export const FILTER_SPECS: Readonly<Record<FilterAmountKind, FilterSpec>> = {
  blur: { label: 'Blur', unit: 'px', min: 0, max: 200, step: 1, identity: 0, initial: 4 },
  brightness: { label: 'Brightness', unit: '%', min: 0, max: 500, step: 1, identity: 100, initial: 120 },
  contrast: { label: 'Contrast', unit: '%', min: 0, max: 500, step: 1, identity: 100, initial: 120 },
  grayscale: { label: 'Grayscale', unit: '%', min: 0, max: 100, step: 1, identity: 0, initial: 100 },
  saturate: { label: 'Saturate', unit: '%', min: 0, max: 500, step: 1, identity: 100, initial: 150 },
  'hue-rotate': { label: 'Hue rotate', unit: 'deg', min: -360, max: 360, step: 1, identity: 0, initial: 90 },
  invert: { label: 'Invert', unit: '%', min: 0, max: 100, step: 1, identity: 0, initial: 100 },
  sepia: { label: 'Sepia', unit: '%', min: 0, max: 100, step: 1, identity: 0, initial: 100 },
  opacity: { label: 'Opacity', unit: '%', min: 0, max: 100, step: 1, identity: 100, initial: 50 },
};

/** The drop shadow a newly added `drop-shadow()` starts as. */
export const DEFAULT_DROP_SHADOW: DropShadow = { x: 0, y: 4, blur: 8, color: 'rgb(0 0 0 / 0.25)' };

/** A new filter function of `kind` at its initial value. */
export function newFilter(kind: FilterKind): FilterFunction {
  return kind === 'drop-shadow' ? { kind, shadow: { ...DEFAULT_DROP_SHADOW } } : { kind, value: FILTER_SPECS[kind].initial };
}

const ANGLE = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i;

/** Degrees of an angle (a bare 0 allowed). */
function degrees(text: string): number | null {
  const match = ANGLE.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  switch ((match[2] ?? '').toLowerCase()) {
    case '':
      return value === 0 ? 0 : null;
    case 'deg':
      return value;
    case 'grad':
      return (value * 360) / 400;
    case 'rad':
      return (value * 180) / Math.PI;
    default:
      return value * 360;
  }
}

/** A number-or-percentage amount as a percentage. */
function percent(text: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(%)?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (value < 0) return null;
  return match[2] ? value : value * 100;
}

/**
 * Parses a `filter` chain. `none` or empty gives `[]`; null for `url()`,
 * unknown functions or arguments it cannot read.
 */
export function parseFilter(css: string): FilterFunction[] | null {
  const text = css.trim();
  if (!text || text.toLowerCase() === 'none') return [];
  const out: FilterFunction[] = [];
  for (const part of splitTopLevel(text, 'space')) {
    const match = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(part);
    if (!match) return null;
    const kind = match[1]!.toLowerCase();
    const arg = match[2]!.trim();
    if (kind === 'drop-shadow') {
      const shadow = parseDropShadow(arg);
      if (!shadow) return null;
      out.push({ kind, shadow });
      continue;
    }
    if (!(kind in FILTER_SPECS)) return null;
    const amountKind = kind as FilterAmountKind;
    const spec = FILTER_SPECS[amountKind];
    let value: number | null;
    if (!arg) value = amountKind === 'blur' || amountKind === 'hue-rotate' ? 0 : 100;
    else if (amountKind === 'blur') value = px(arg);
    else if (amountKind === 'hue-rotate') value = degrees(arg);
    else value = percent(arg);
    if (value === null || (amountKind === 'blur' && value < 0)) return null;
    // CSS clamps these at 100%.
    if (spec.max === 100 && spec.unit === '%') value = Math.min(100, value);
    out.push({ kind: amountKind, value });
  }
  return out;
}

/** Writes one filter function. */
export function formatFilterFunction(fn: FilterFunction): string {
  if (fn.kind === 'drop-shadow') return `drop-shadow(${formatDropShadow(fn.shadow)})`;
  const unit = FILTER_SPECS[fn.kind].unit;
  return `${fn.kind}(${num(fn.value)}${unit})`;
}

/** Writes a `filter` value; `none` for an empty chain. */
export function formatFilter(chain: readonly FilterFunction[]): string {
  return chain.length ? chain.map(formatFilterFunction).join(' ') : 'none';
}

/* -------------------------------- gradients ------------------------------- */

/** One color stop; position in percent along the gradient line. */
export interface GradientStop {
  color: string;
  position: number;
}

/** A linear or radial gradient. */
export interface Gradient {
  type: 'linear' | 'radial';
  repeating: boolean;
  /** Direction of a linear gradient in degrees (CSS: 0 points up, 90 right). Kept while radial. */
  angle: number;
  /** Shape of a radial gradient. */
  shape: 'circle' | 'ellipse';
  /** Radial size as written (`closest-side`, `200px`…), when not the default. */
  size?: string;
  /** Radial center as written after `at` (`top left`, `30% 40%`), when not `center`. */
  position?: string;
  /** Sorted by position. */
  stops: GradientStop[];
}

/** A new gradient: left-to-right, from `from` to `to`. */
export function defaultGradient(from = '#000000', to = '#ffffff'): Gradient {
  return { type: 'linear', repeating: false, angle: 90, shape: 'ellipse', stops: [{ color: from, position: 0 }, { color: to, position: 100 }] };
}

const SIDE_ANGLES: Record<string, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
  'top right': 45,
  'right top': 45,
  'bottom right': 135,
  'right bottom': 135,
  'bottom left': 225,
  'left bottom': 225,
  'top left': 315,
  'left top': 315,
};

const RADIAL_SIZES = new Set(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner']);

/** Fills in missing stop positions the way CSS does: ends at 0/100, never backwards, gaps spread evenly. */
function resolvePositions(raw: (number | null)[]): number[] {
  const out = [...raw];
  if (out[0] == null) out[0] = 0;
  if (out[out.length - 1] == null) out[out.length - 1] = Math.max(100, ...out.filter((p): p is number => p != null));
  let max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) {
      max = Math.max(max, out[i]!);
      out[i] = max;
    }
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i] != null) continue;
    let j = i;
    while (out[j] == null) j++;
    const start = out[i - 1]!;
    const end = out[j]!;
    for (let k = i; k < j; k++) out[k] = start + ((end - start) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return out as number[];
}

/** Parses the stops; null when one is a color hint or uses a non-% position. */
function parseStops(parts: string[]): GradientStop[] | null {
  const colors: string[] = [];
  const positions: (number | null)[] = [];
  for (const part of parts) {
    const tokens = splitTopLevel(part, 'space');
    const [color, ...rest] = tokens;
    if (!color || !isColorToken(color) || rest.length > 2) return null;
    const at = rest.map((token) => {
      const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(%)?$/.exec(token);
      if (!match || (!match[2] && Number(match[1]) !== 0)) return null;
      return Number(match[1]);
    });
    if (at.some((p) => p === null)) return null;
    if (at.length === 0) {
      colors.push(color);
      positions.push(null);
    }
    for (const p of at) {
      colors.push(color);
      positions.push(p);
    }
  }
  if (colors.length < 2) return null;
  const resolved = resolvePositions(positions);
  return colors.map((color, i) => ({ color, position: num(resolved[i]!, 4) }));
}

/**
 * Parses a `linear-gradient()` / `radial-gradient()` (or `repeating-`) value.
 * Null for other images, color hints, stop positions not in %, or a value
 * with several layers. `to <side>` directions become angles (corners as 45°
 * steps, which matches CSS for square boxes).
 */
export function parseGradient(css: string): Gradient | null {
  const match = /^(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)$/i.exec(css.trim());
  if (!match) return null;
  // Reject `a-gradient(...), b-gradient(...)`: the body must balance.
  let depth = 0;
  for (const ch of match[3]!) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  const type = match[2]!.toLowerCase() as Gradient['type'];
  const parts = splitTopLevel(match[3]!, ',');
  if (parts.some((part) => !part)) return null;
  const gradient: Gradient = { type, repeating: Boolean(match[1]), angle: 180, shape: 'ellipse', stops: [] };
  const first = parts[0]!;
  const firstTokens = splitTopLevel(first, 'space');
  let stopParts = parts;
  if (type === 'linear') {
    const angle = firstTokens.length === 1 ? degrees(first) : null;
    if (angle !== null) {
      gradient.angle = num(((angle % 360) + 360) % 360, 4);
      stopParts = parts.slice(1);
    } else if (firstTokens[0]?.toLowerCase() === 'to') {
      const side = SIDE_ANGLES[firstTokens.slice(1).join(' ').toLowerCase()];
      if (side === undefined) return null;
      gradient.angle = side;
      stopParts = parts.slice(1);
    }
  } else if (!isColorToken(firstTokens[0] ?? '')) {
    const at = firstTokens.findIndex((t) => t.toLowerCase() === 'at');
    const head = at < 0 ? firstTokens : firstTokens.slice(0, at);
    const sizes: string[] = [];
    for (const t of head) {
      const lower = t.toLowerCase();
      if (lower === 'circle' || lower === 'ellipse') gradient.shape = lower;
      else if (RADIAL_SIZES.has(lower) || /^[\d.]+(?:px|%|em|rem|vw|vh)$/.test(lower)) sizes.push(t);
      else return null;
    }
    if (sizes.length && !(sizes.length === 1 && sizes[0]!.toLowerCase() === 'farthest-corner')) gradient.size = sizes.join(' ');
    if (at >= 0) {
      const position = firstTokens.slice(at + 1).join(' ');
      if (!position) return null;
      if (position.toLowerCase() !== 'center' && position !== '50% 50%') gradient.position = position;
    }
    stopParts = parts.slice(1);
  }
  const stops = parseStops(stopParts);
  if (!stops) return null;
  gradient.stops = stops;
  return gradient;
}

/** Writes a gradient as CSS; stops are written in position order. */
export function formatGradient(gradient: Gradient): string {
  const stops = sortStops(gradient.stops).map((stop) => `${stop.color} ${num(stop.position)}%`);
  const name = `${gradient.repeating ? 'repeating-' : ''}${gradient.type}-gradient`;
  if (gradient.type === 'linear') return `${name}(${num(gradient.angle)}deg, ${stops.join(', ')})`;
  const head = [gradient.shape === 'circle' ? 'circle' : null, gradient.size ?? null, gradient.position ? `at ${gradient.position}` : null].filter(Boolean);
  return `${name}(${head.length ? `${head.join(' ')}, ` : ''}${stops.join(', ')})`;
}

/** Stops sorted by position (stable). */
export function sortStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops.map((stop, i) => ({ stop, i })).sort((a, b) => a.stop.position - b.stop.position || a.i - b.i).map(({ stop }) => stop);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The color the gradient shows at `position` (percent), interpolated in
 * premultiplied sRGB like browsers do by default, written like the nearer
 * stop. Stops whose colors cannot be read (a `var()`) are taken as-is.
 */
export function colorAtPosition(stops: readonly GradientStop[], position: number): string {
  const sorted = sortStops(stops);
  if (!sorted.length) return '#000000';
  if (position <= sorted[0]!.position) return sorted[0]!.color;
  const last = sorted[sorted.length - 1]!;
  if (position >= last.position) return last.color;
  const right = sorted.findIndex((stop) => stop.position >= position);
  const a = sorted[right - 1]!;
  const b = sorted[right]!;
  const t = b.position === a.position ? 0 : (position - a.position) / (b.position - a.position);
  const ca = toRgba(a.color);
  const cb = toRgba(b.color);
  const near = t < 0.5 ? a : b;
  if (!ca || !cb) return near.color;
  const alpha = lerp(ca.a, cb.a, t);
  const channel = (x: number, y: number) => (alpha === 0 ? 0 : lerp(x * ca.a, y * cb.a, t) / alpha);
  const mixed: Rgba = { r: channel(ca.r, cb.r), g: channel(ca.g, cb.g), b: channel(ca.b, cb.b), a: alpha };
  return formatLike(near.color, mixed);
}
