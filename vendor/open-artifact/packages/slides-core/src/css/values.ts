/**
 * Value grammars of the slide CSS subset. Every parser returns either the
 * canonical text the serializer writes (plus whether it had to heal the
 * input) or a reason the value is outside the subset.
 */

import { formatNumber, parseColor } from './color.ts';
import { LIMITS } from '../limits.ts';

/** A successfully parsed value. */
export interface Parsed<T = string> {
  ok: true;
  value: T;
  /** An equivalent rewrite happened (e.g. `pt` → `px`). */
  note?: string;
  /** A visible repair happened (e.g. a value clamped into range). */
  warning?: string;
}

/** A value outside the subset. */
export interface Rejected {
  ok: false;
  reason: string;
}

export type ParseResult<T = string> = Parsed<T> | Rejected;

export function ok<T>(value: T, extra: { note?: string; warning?: string } = {}): Parsed<T> {
  return { ok: true, value, ...extra };
}

export function reject(reason: string): Rejected {
  return { ok: false, reason };
}

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const LENGTH_RE = new RegExp(`^(${NUM})(px|pt)?$`, 'i');
const PERCENT_RE = new RegExp(`^(${NUM})%$`);
const NUMBER_RE = new RegExp(`^${NUM}$`);

/** Formats px. */
export function px(value: number): string {
  return value === 0 ? '0' : `${formatNumber(value, 2)}px`;
}

/** Options of {@link parseLength}. */
export interface LengthOptions {
  min?: number;
  max?: number;
  /** Clamp an out-of-range value with a warning instead of rejecting it. */
  clamp?: boolean;
}

/** Reads `Npx`, bare `N` (px) or `Npt` (converted, a note). */
export function parseLength(raw: string, options: LengthOptions = {}): ParseResult<number> {
  const value = raw.trim().toLowerCase();
  const match = LENGTH_RE.exec(value);
  if (!match) return reject(`"${raw.trim()}" is not a length (Npx)`);
  let n = Number(match[1]);
  let note: string | undefined;
  if (match[2] === 'pt') {
    n = (n * 4) / 3;
    note = `${value} → ${px(n)}`;
  }
  const { min = -Infinity, max = Infinity } = options;
  if (n < min || n > max) {
    if (!options.clamp) return reject(`${px(n)} is outside ${min}–${max}px`);
    const clamped = Math.min(max, Math.max(min, n));
    return ok(clamped, { warning: `${px(n)} clamped to ${px(clamped)}`, note });
  }
  return ok(n, note ? { note } : {});
}

/** Reads `N%`. */
export function parsePercent(raw: string): ParseResult<number> {
  const match = PERCENT_RE.exec(raw.trim());
  if (!match) return reject(`"${raw.trim()}" is not a percentage`);
  return ok(Number(match[1]));
}

/** Reads a plain number. */
export function parseNumber(raw: string, min = -Infinity, max = Infinity): ParseResult<number> {
  const value = raw.trim();
  if (!NUMBER_RE.test(value)) return reject(`"${value}" is not a number`);
  const n = Number(value);
  if (n < min || n > max) return reject(`${value} is outside ${min}–${max}`);
  return ok(n);
}

/** Reads an angle (`Ndeg`, `Nturn`, `Nrad`, bare 0) in degrees. */
export function parseAngle(raw: string): ParseResult<number> {
  const match = new RegExp(`^(${NUM})(deg|turn|rad)?$`, 'i').exec(raw.trim());
  if (!match) return reject(`"${raw.trim()}" is not an angle`);
  const n = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!unit && n !== 0) return reject(`"${raw.trim()}" needs a unit (deg)`);
  return ok(unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : n);
}

/** Formats an angle in degrees. */
export function deg(value: number): string {
  return `${formatNumber(value, 2)}deg`;
}

/** Reads a color (wrapper over {@link parseColor}). */
export function parseColorValue(raw: string): ParseResult {
  const value = parseColor(raw);
  if (value === null) {
    const lower = raw.trim().toLowerCase();
    if (lower === 'currentcolor' || lower.startsWith('var(')) return reject(`${lower} is not supported; write the color`);
    return reject(`"${raw.trim()}" is not a color`);
  }
  return ok(value);
}

/**
 * Splits on top-level separators (commas or whitespace), ignoring separators
 * inside parentheses and quotes.
 */
export function splitTopLevel(text: string, separator: ',' | 'space'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    const isSep = separator === ',' ? ch === ',' : /\s/.test(ch);
    if (isSep && depth === 0) {
      if (current.trim() || separator === ',') parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() || (separator === ',' && parts.length > 0)) parts.push(current.trim());
  return parts.filter((part) => separator === ',' || part.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Box values                                                                  */
/* -------------------------------------------------------------------------- */

/** Collapses four sides to the shortest CSS form. */
export function collapseSides(sides: readonly [string, string, string, string]): string {
  const [t, r, b, l] = sides;
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

/** Expands a 1–4 value shorthand to `[top, right, bottom, left]`. */
export function expandSides<T>(values: readonly T[]): [T, T, T, T] {
  const [a, b = a, c = a, d = b] = values as [T, T?, T?, T?];
  return [a, b as T, c as T, d as T];
}

/** `padding`: 1–4 lengths within `0..max`. */
export function parsePadding(raw: string, max: number): ParseResult {
  const parts = splitTopLevel(raw, 'space');
  if (parts.length < 1 || parts.length > 4) return reject('padding takes 1–4 lengths');
  const values: string[] = [];
  let note: string | undefined;
  let warning: string | undefined;
  for (const part of parts) {
    const parsed = parseLength(part, { min: 0, max, clamp: true });
    if (!parsed.ok) {
      if (/%$/.test(part.trim())) return reject('padding in % is not supported (px only)');
      return parsed;
    }
    note ??= parsed.note;
    warning ??= parsed.warning;
    values.push(px(parsed.value));
  }
  return ok(collapseSides(expandSides(values)), { note, warning });
}

/** Reads a padding value back into `[top, right, bottom, left]` px. */
export function paddingSides(value: string | undefined): [number, number, number, number] {
  if (!value) return [0, 0, 0, 0];
  const values = splitTopLevel(value, 'space').map((part) => parseFloat(part) || 0);
  return expandSides(values);
}

/** `gap`: one or two lengths 0–512. */
export function parseGap(raw: string): ParseResult {
  const parts = splitTopLevel(raw, 'space');
  if (parts.length < 1 || parts.length > 2) return reject('gap takes one or two lengths');
  const out: string[] = [];
  let note: string | undefined;
  let warning: string | undefined;
  for (const part of parts) {
    const parsed = parseLength(part, { min: 0, max: 512, clamp: true });
    if (!parsed.ok) return parsed;
    note ??= parsed.note;
    warning ??= parsed.warning;
    out.push(px(parsed.value));
  }
  return ok(out.length === 2 && out[0] === out[1] ? out[0]! : out.join(' '), { note, warning });
}

/** `border-radius`: 1–4 of `LEN | PCT`. */
export function parseRadius(raw: string): ParseResult {
  const parts = splitTopLevel(raw, 'space');
  if (parts.length < 1 || parts.length > 4) return reject('border-radius takes 1–4 values (no / form)');
  const out: string[] = [];
  let note: string | undefined;
  for (const part of parts) {
    const pct = parsePercent(part);
    if (pct.ok) {
      out.push(`${formatNumber(Math.max(0, Math.min(50, pct.value)), 2)}%`);
      continue;
    }
    const len = parseLength(part, { min: 0, max: 10000, clamp: true });
    if (!len.ok) return len;
    note ??= len.note;
    out.push(px(len.value));
  }
  return ok(collapseSides(expandSides(out)), { note });
}

/** Border style words of the subset. */
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

/** A parsed `border` value. */
export interface Border {
  width: number;
  style: BorderStyle;
  color: string;
}

/** `border`: `[LEN] style [COLOR]`, the style word required. */
export function parseBorder(raw: string, maxWidth = 16): ParseResult<Border> {
  const parts = splitTopLevel(raw.trim(), 'space');
  if (parts.length === 1 && parts[0]!.toLowerCase() === 'none') return ok({ width: 0, style: 'none', color: '#000000' });
  let width: number | undefined;
  let style: BorderStyle | undefined;
  let color: string | undefined;
  let note: string | undefined;
  let warning: string | undefined;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if ((BORDER_STYLES as readonly string[]).includes(lower) && style === undefined) {
      style = lower as BorderStyle;
      continue;
    }
    if (width === undefined && /^[+-]?[\d.]/.test(part)) {
      const len = parseLength(part, { min: 0, max: maxWidth, clamp: true });
      if (!len.ok) return len;
      width = len.value;
      note ??= len.note;
      warning ??= len.warning;
      continue;
    }
    if (['thin', 'medium', 'thick'].includes(lower) && width === undefined) {
      width = lower === 'thin' ? 1 : lower === 'medium' ? 3 : 5;
      note ??= `${lower} → ${px(width)}`;
      continue;
    }
    const c = parseColorValue(part);
    if (!c.ok || color !== undefined) return reject(`"${raw.trim()}" is not a border (width style color)`);
    color = c.value;
  }
  if (style === undefined) return reject(`border "${raw.trim()}" needs a style word (solid, dashed, dotted, double)`);
  return ok({ width: width ?? 1, style, color: color ?? '#000000' }, { note, warning });
}

/** Canonical text of a border. */
export function formatBorder(border: Border): string {
  if (border.style === 'none') return 'none';
  return `${px(border.width)} ${border.style} ${border.color}`;
}

/* -------------------------------------------------------------------------- */
/* Gradients                                                                   */
/* -------------------------------------------------------------------------- */

/** One gradient stop. */
export interface GradientStop {
  color: string;
  /** Positions as written (`20%`, `40px`), 0–2 of them. */
  positions: string[];
}

/** A parsed gradient. */
export interface Gradient {
  type: 'linear' | 'repeating-linear' | 'radial';
  /** Linear: angle in degrees (the `to SIDE` forms are converted). */
  angle?: number;
  /** Radial: `circle` or `ellipse`. */
  shape?: 'circle' | 'ellipse';
  /** Radial: center in percent. */
  at?: { x: number; y: number };
  stops: GradientStop[];
}

const SIDE_ANGLES: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
};

/** Reads a gradient function. */
export function parseGradient(raw: string): ParseResult<Gradient> {
  const match = /^(repeating-linear-gradient|linear-gradient|radial-gradient)\((.*)\)$/is.exec(raw.trim());
  if (!match) return reject(`"${raw.trim()}" is not a gradient`);
  const fn = match[1]!.toLowerCase();
  const args = splitTopLevel(match[2]!, ',');
  const gradient: Gradient = {
    type: fn === 'radial-gradient' ? 'radial' : fn === 'repeating-linear-gradient' ? 'repeating-linear' : 'linear',
    stops: [],
  };
  let first = args[0]?.trim().toLowerCase() ?? '';
  if (gradient.type === 'radial') {
    const m = /^(circle|ellipse)?\s*(?:at\s+(\S+)\s+(\S+))?$/.exec(first);
    if (m && (m[1] || m[2])) {
      if (m[1]) gradient.shape = m[1] as 'circle' | 'ellipse';
      if (m[2]) {
        const x = parsePercent(m[2]);
        const y = parsePercent(m[3]!);
        const named = (word: string): number | null =>
          word === 'center' ? 50 : word === 'left' || word === 'top' ? 0 : word === 'right' || word === 'bottom' ? 100 : null;
        const xv = x.ok ? x.value : named(m[2]);
        const yv = y.ok ? y.value : named(m[3]!);
        if (xv === null || yv === null) return reject('radial-gradient position is "at X% Y%"');
        gradient.at = { x: xv, y: yv };
      }
      args.shift();
    }
  } else if (Object.hasOwn(SIDE_ANGLES, first.replace(/\s+/g, ' '))) {
    gradient.angle = SIDE_ANGLES[first.replace(/\s+/g, ' ')];
    args.shift();
  } else if (/^[+-]?[\d.]/.test(first)) {
    const angle = parseAngle(first);
    if (!angle.ok) return angle;
    gradient.angle = angle.value;
    args.shift();
  }
  first = '';
  if (args.length < 2) return reject('a gradient needs 2 or more color stops');
  if (args.length > LIMITS.gradientStops) return reject(`a gradient takes at most ${LIMITS.gradientStops} stops`);
  for (const arg of args) {
    const parts = splitTopLevel(arg, 'space');
    const color = parseColor(parts[0] ?? '');
    if (color === null) return reject(`gradient stop "${arg}" needs a color first`);
    const positions: string[] = [];
    for (const part of parts.slice(1)) {
      const pct = parsePercent(part);
      if (pct.ok) {
        positions.push(`${formatNumber(pct.value, 2)}%`);
        continue;
      }
      const len = parseLength(part);
      if (len.ok && gradient.type === 'repeating-linear') {
        positions.push(px(len.value));
        continue;
      }
      return reject(`gradient stop position "${part}" must be N%`);
    }
    if (positions.length > 2) return reject('a gradient stop takes at most two positions');
    gradient.stops.push({ color, positions });
  }
  return ok(gradient);
}

/** Canonical text of a gradient. */
export function formatGradient(gradient: Gradient): string {
  const head: string[] = [];
  if (gradient.type === 'radial') {
    const parts: string[] = [];
    if (gradient.shape) parts.push(gradient.shape);
    if (gradient.at) parts.push(`at ${formatNumber(gradient.at.x, 2)}% ${formatNumber(gradient.at.y, 2)}%`);
    if (parts.length) head.push(parts.join(' '));
  } else if (gradient.angle !== undefined) {
    head.push(deg(gradient.angle));
  }
  const stops = gradient.stops.map((stop) => [stop.color, ...stop.positions].join(' '));
  const fn = gradient.type === 'radial' ? 'radial-gradient' : gradient.type === 'repeating-linear' ? 'repeating-linear-gradient' : 'linear-gradient';
  return `${fn}(${[...head, ...stops].join(', ')})`;
}

/** A parsed `background`. */
export interface Background {
  color?: string;
  gradient?: Gradient;
  /** `url(IMG) center / cover|contain` (text image fill). */
  image?: { url: string; size: 'cover' | 'contain' };
}

/** Reads `background`: a color, one gradient (optionally with a color under it) or an image fill. */
export function parseBackground(raw: string): ParseResult<Background> {
  const value = raw.trim();
  const urlMatch = /^url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(.*)$/i.exec(value);
  if (urlMatch) {
    const rest = urlMatch[3]!.trim().toLowerCase().replace(/\s+/g, ' ');
    const size = /(?:^|\s)contain$/.test(rest) ? 'contain' : 'cover';
    if (rest && !/^(?:center\s*)?(?:\/\s*)?(?:cover|contain)?$/.test(rest)) {
      return reject('an image background is url(IMG) center / cover|contain');
    }
    return ok({ image: { url: urlMatch[2]!, size } });
  }
  const layers = splitTopLevel(value, ',');
  // A gradient's own commas are inside its parentheses, so layers are
  // "gradient" or "gradient, color".
  const out: Background = {};
  if (layers.length === 1) {
    const only = layers[0]!;
    if (/gradient\(/i.test(only)) {
      const g = parseGradient(only);
      if (!g.ok) return g;
      out.gradient = g.value;
      return ok(out);
    }
    const c = parseColorValue(only);
    if (!c.ok) return reject(`background "${value}" is not a color or gradient`);
    out.color = c.value;
    return ok(out);
  }
  if (layers.length === 2 && /gradient\(/i.test(layers[0]!)) {
    const g = parseGradient(layers[0]!);
    if (!g.ok) return g;
    const c = parseColorValue(layers[1]!);
    if (!c.ok) return reject('the layer under a gradient must be a color');
    return ok({ gradient: g.value, color: c.value });
  }
  return reject('background takes one gradient, optionally with a color under it');
}

/** Canonical text of a background. */
export function formatBackground(background: Background): string {
  if (background.image) return `url(${background.image.url}) center / ${background.image.size}`;
  if (background.gradient) {
    const g = formatGradient(background.gradient);
    return background.color ? `${g}, ${background.color}` : g;
  }
  return background.color ?? 'transparent';
}

/* -------------------------------------------------------------------------- */
/* Shadows                                                                     */
/* -------------------------------------------------------------------------- */

/** One shadow layer. */
export interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/** Reads `box-shadow` (or `text-shadow` with `text: true`). */
export function parseShadows(raw: string, text = false): ParseResult<Shadow[]> {
  if (raw.trim().toLowerCase() === 'none') return ok([]);
  const layers = splitTopLevel(raw, ',');
  if (layers.length > LIMITS.shadows) return reject(`at most ${LIMITS.shadows} shadows`);
  const shadows: Shadow[] = [];
  let warning: string | undefined;
  for (const layer of layers) {
    const parts = splitTopLevel(layer, 'space');
    let inset = false;
    let color: string | undefined;
    const lengths: number[] = [];
    for (const part of parts) {
      if (part.toLowerCase() === 'inset' && !text) {
        inset = true;
        continue;
      }
      if (/^[+-]?[\d.]/.test(part)) {
        const len = parseLength(part);
        if (!len.ok) return len;
        lengths.push(len.value);
        continue;
      }
      const c = parseColorValue(part);
      if (!c.ok) return reject(`shadow "${layer}": ${c.reason}`);
      color = c.value;
    }
    if (lengths.length < 2 || lengths.length > (text ? 3 : 4)) return reject(`shadow "${layer}" takes x y${text ? ' [blur]' : ' [blur [spread]]'} color`);
    const clampTo = (n: number, lo: number, hi: number): number => {
      const c = Math.min(hi, Math.max(lo, n));
      if (c !== n) warning ??= `shadow value ${n}px clamped to ${c}px`;
      return c;
    };
    shadows.push({
      inset,
      x: clampTo(lengths[0]!, -64, 64),
      y: clampTo(lengths[1]!, -64, 64),
      blur: clampTo(lengths[2] ?? 0, 0, text ? 64 : 160),
      spread: text ? 0 : clampTo(lengths[3] ?? 0, -32, 32),
      color: color ?? 'rgba(0, 0, 0, 0.25)',
    });
  }
  return ok(shadows, { warning });
}

/** Canonical text of shadows. */
export function formatShadows(shadows: readonly Shadow[], text = false): string {
  if (shadows.length === 0) return 'none';
  return shadows
    .map((s) => {
      const parts = [s.inset ? 'inset' : '', px(s.x), px(s.y), px(s.blur)];
      if (!text && s.spread !== 0) parts.push(px(s.spread));
      parts.push(s.color);
      return parts.filter(Boolean).join(' ');
    })
    .join(', ');
}

/* -------------------------------------------------------------------------- */
/* Transform and filters                                                       */
/* -------------------------------------------------------------------------- */

/** A parsed transform, in the subset's fixed order. */
export interface Transform {
  /** px, or the string `-50%` for centering. */
  translateX?: number | '-50%';
  translateY?: number | '-50%';
  rotate?: number;
  scale?: number;
  skewX?: number;
  skewY?: number;
}

const TRANSFORM_ORDER = ['translate', 'rotate', 'scale', 'skew'] as const;

function readTranslate(part: string): ParseResult<number | '-50%'> {
  const trimmed = part.trim();
  if (trimmed === '-50%') return ok('-50%');
  const len = parseLength(trimmed, { min: -4000, max: 4000 });
  if (!len.ok) return reject(`translate "${trimmed}" takes px (or -50% to center)`);
  return len;
}

/** Reads `transform`: translate, rotate, scale, skew — each once, in that order. */
export function parseTransform(raw: string): ParseResult<Transform> {
  const value = raw.trim();
  if (value.toLowerCase() === 'none') return ok({});
  const re = /([a-zA-Z]+)\(([^)]*)\)/g;
  const out: Transform = {};
  let last = -1;
  let consumed = '';
  let warning: string | undefined;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    consumed += m[0];
    const fn = m[1]!.toLowerCase();
    const args = splitTopLevel(m[2]!, ',');
    const family = fn.startsWith('translate') ? 'translate' : fn.startsWith('skew') ? 'skew' : fn;
    const index = (TRANSFORM_ORDER as readonly string[]).indexOf(family);
    if (index < 0) return reject(`transform ${fn}() is not supported (translate, rotate, scale, skew)`);
    if (index <= last) return reject(`transform functions go in order translate, rotate, scale, skew, each once`);
    last = index;
    if (family === 'translate') {
      if (fn === 'translate') {
        if (args.length < 1 || args.length > 2) return reject('translate() takes one or two lengths');
        const x = readTranslate(args[0]!);
        if (!x.ok) return x;
        out.translateX = x.value;
        if (args[1] !== undefined) {
          const y = readTranslate(args[1]);
          if (!y.ok) return y;
          out.translateY = y.value;
        }
      } else if (fn === 'translatex' || fn === 'translatey') {
        const v = readTranslate(args[0] ?? '');
        if (!v.ok) return v;
        if (fn === 'translatex') out.translateX = v.value;
        else out.translateY = v.value;
      } else {
        return reject(`transform ${fn}() is not supported`);
      }
    } else if (family === 'rotate') {
      const a = parseAngle(args[0] ?? '');
      if (!a.ok) return a;
      out.rotate = a.value;
    } else if (family === 'scale') {
      if (args.length !== 1) return reject('scale() takes one number (0.5–2)');
      const s = parseNumber(args[0]!);
      if (!s.ok) return s;
      const c = Math.min(2, Math.max(0.5, s.value));
      if (c !== s.value) warning = `scale(${s.value}) clamped to scale(${c})`;
      out.scale = c;
    } else {
      const clampSkew = (n: number): number => {
        const c = Math.min(60, Math.max(-60, n));
        if (c !== n) warning = `skew ${n}deg clamped to ${c}deg`;
        return c;
      };
      if (fn === 'skew') {
        const x = parseAngle(args[0] ?? '');
        if (!x.ok) return x;
        out.skewX = clampSkew(x.value);
        if (args[1] !== undefined) {
          const y = parseAngle(args[1]);
          if (!y.ok) return y;
          out.skewY = clampSkew(y.value);
        }
      } else if (fn === 'skewx' || fn === 'skewy') {
        const a = parseAngle(args[0] ?? '');
        if (!a.ok) return a;
        if (fn === 'skewx') out.skewX = clampSkew(a.value);
        else out.skewY = clampSkew(a.value);
      } else {
        return reject(`transform ${fn}() is not supported`);
      }
    }
  }
  if (consumed.replace(/\s+/g, '') !== value.replace(/\s+/g, '')) return reject(`"${value}" is not a transform of the subset`);
  return ok(out, { warning });
}

/** Canonical text of a transform (empty string = none). */
export function formatTransform(t: Transform): string {
  const parts: string[] = [];
  const tr = (v: number | '-50%'): string => (v === '-50%' ? '-50%' : px(v));
  if (t.translateX !== undefined && t.translateY !== undefined) parts.push(`translate(${tr(t.translateX)}, ${tr(t.translateY)})`);
  else if (t.translateX !== undefined) parts.push(`translateX(${tr(t.translateX)})`);
  else if (t.translateY !== undefined) parts.push(`translateY(${tr(t.translateY)})`);
  if (t.rotate !== undefined && t.rotate !== 0) parts.push(`rotate(${deg(t.rotate)})`);
  if (t.scale !== undefined && t.scale !== 1) parts.push(`scale(${formatNumber(t.scale)})`);
  if (t.skewX !== undefined && t.skewY !== undefined) parts.push(`skew(${deg(t.skewX)}, ${deg(t.skewY)})`);
  else if (t.skewX !== undefined) parts.push(`skewX(${deg(t.skewX)})`);
  else if (t.skewY !== undefined) parts.push(`skewY(${deg(t.skewY)})`);
  return parts.join(' ');
}

/** Filter functions and their ranges. */
export const FILTER_FUNCTIONS = {
  blur: { min: 0, max: 20, unit: 'px' },
  brightness: { min: 0, max: 2, unit: '' },
  contrast: { min: 0, max: 2, unit: '' },
  saturate: { min: 0, max: 3, unit: '' },
  grayscale: { min: 0, max: 1, unit: '' },
  sepia: { min: 0, max: 1, unit: '' },
  invert: { min: 0, max: 1, unit: '' },
  'hue-rotate': { min: -360, max: 360, unit: 'deg' },
} as const;
export type FilterFunction = keyof typeof FILTER_FUNCTIONS;

/** A parsed filter list: function → amount (px for blur, deg for hue-rotate). */
export type Filters = Partial<Record<FilterFunction, number>>;

/** Reads `filter` / `backdrop-filter`. */
export function parseFilters(raw: string): ParseResult<Filters> {
  const value = raw.trim();
  if (value.toLowerCase() === 'none') return ok({});
  const re = /([a-z-]+)\(([^)]*)\)/gi;
  const out: Filters = {};
  let consumed = '';
  let warning: string | undefined;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    consumed += m[0];
    const fn = m[1]!.toLowerCase() as FilterFunction;
    const spec = FILTER_FUNCTIONS[fn];
    if (!spec) return reject(`filter ${fn}() is not supported`);
    if (out[fn] !== undefined) return reject(`filter ${fn}() appears twice`);
    const arg = m[2]!.trim();
    let n: number;
    if (fn === 'blur') {
      const len = parseLength(arg || '0');
      if (!len.ok) return len;
      n = len.value;
    } else if (fn === 'hue-rotate') {
      const a = parseAngle(arg || '0');
      if (!a.ok) return a;
      n = a.value;
    } else {
      const pct = parsePercent(arg);
      const num = pct.ok ? ok(pct.value / 100) : parseNumber(arg);
      if (!num.ok) return num;
      n = num.value;
    }
    const c = Math.min(spec.max, Math.max(spec.min, n));
    if (c !== n) warning = `${fn}(${n}) clamped to ${c}`;
    out[fn] = c;
  }
  if (consumed.replace(/\s+/g, '') !== value.replace(/\s+/g, '')) return reject(`"${value}" is not a filter list of the subset`);
  return ok(out, { warning });
}

/** Canonical text of filters (empty = none). */
export function formatFilters(filters: Filters): string {
  return (Object.keys(FILTER_FUNCTIONS) as FilterFunction[])
    .filter((fn) => filters[fn] !== undefined)
    .map((fn) => {
      const n = filters[fn]!;
      return fn === 'blur' ? `blur(${px(n)})` : fn === 'hue-rotate' ? `hue-rotate(${deg(n)})` : `${fn}(${formatNumber(n)})`;
    })
    .join(' ');
}

/* -------------------------------------------------------------------------- */
/* Grid tracks                                                                 */
/* -------------------------------------------------------------------------- */

/** One grid track. */
export type Track = { unit: 'px'; value: number } | { unit: 'fr'; value: number } | { unit: 'auto' };

/** Reads a track list (`LEN | Nfr | auto | repeat(INT, …)`), expanded. */
export function parseTracks(raw: string): ParseResult<Track[]> {
  const tracks: Track[] = [];
  const read = (text: string): Rejected | null => {
    for (const part of splitTopLevel(text, 'space')) {
      const lower = part.toLowerCase();
      const rep = /^repeat\(\s*(\d+)\s*,(.*)\)$/i.exec(lower);
      if (rep) {
        const count = Number(rep[1]);
        if (count < 1 || count > LIMITS.gridTracks) return reject('repeat() count is 1–24');
        for (let i = 0; i < count; i++) {
          const failed = read(rep[2]!);
          if (failed) return failed;
        }
        continue;
      }
      if (lower === 'auto') {
        tracks.push({ unit: 'auto' });
        continue;
      }
      const fr = /^([\d.]+)fr$/.exec(lower);
      if (fr) {
        tracks.push({ unit: 'fr', value: Number(fr[1]) });
        continue;
      }
      const len = parseLength(lower, { min: 0, max: 4000 });
      if (!len.ok) return reject(`grid track "${part}" is not LEN, Nfr or auto (no minmax, auto-fill, names)`);
      tracks.push({ unit: 'px', value: len.value });
    }
    return null;
  };
  const failed = read(raw.trim());
  if (failed) return failed;
  if (tracks.length === 0) return reject('a grid template needs at least one track');
  if (tracks.length > LIMITS.gridTracks) return reject(`a grid template has at most ${LIMITS.gridTracks} tracks`);
  return ok(tracks);
}

/** Canonical text of a track list (equal runs written as `repeat()`). */
export function formatTracks(tracks: readonly Track[]): string {
  const one = (t: Track): string => (t.unit === 'auto' ? 'auto' : t.unit === 'fr' ? `${formatNumber(t.value)}fr` : px(t.value));
  const texts = tracks.map(one);
  if (texts.length > 1 && texts.every((t) => t === texts[0])) return `repeat(${texts.length}, ${texts[0]})`;
  return texts.join(' ');
}

/* -------------------------------------------------------------------------- */
/* Font families                                                               */
/* -------------------------------------------------------------------------- */

/** Basic faces every computer has (fonts.md). */
export const BASIC_FACES = [
  'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Brush Script MT',
] as const;

/** Generic families a stack may end with. */
export const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'system-ui'] as const;

/** Splits a font-family list into unquoted names. */
export function familyList(raw: string): string[] {
  return splitTopLevel(raw, ',')
    .map((part) => part.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter(Boolean);
}

/** Canonical text of a font-family list: names with spaces quoted. */
export function formatFamilies(names: readonly string[]): string {
  return names
    .map((name) => {
      const lower = name.toLowerCase();
      if ((GENERIC_FAMILIES as readonly string[]).includes(lower) || lower === '-apple-system') return lower;
      return /^[A-Za-z][A-Za-z0-9-]*$/.test(name) ? name : `'${name.replace(/'/g, '')}'`;
    })
    .join(', ');
}

/**
 * Reads `font-family`. Families must be declared by the deck (`faces`), be a
 * basic face, or be generic; others heal away (a warning). An empty result
 * heals to `sans-serif`.
 */
export function parseFontFamily(raw: string, declared: ReadonlySet<string>): ParseResult {
  const names = familyList(raw);
  if (names.length === 0) return reject('font-family is empty');
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith('var(')) return reject('var() is not supported in font-family');
    const known =
      declared.has(lower) ||
      BASIC_FACES.some((face) => face.toLowerCase() === lower) ||
      (GENERIC_FAMILIES as readonly string[]).includes(lower) ||
      lower === '-apple-system' ||
      lower === 'helvetica neue' ||
      lower === 'helvetica';
    if (known) kept.push(name);
    else dropped.push(name);
  }
  if (kept.length === 0) kept.push('sans-serif');
  const value = formatFamilies(kept);
  return ok(value, dropped.length ? { warning: `font ${dropped.map((d) => `"${d}"`).join(', ')} is not declared in deck.json faces (dropped)` } : {});
}
