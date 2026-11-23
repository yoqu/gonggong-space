/**
 * Color math for the editors' color controls, with no DOM: parsing and
 * formatting CSS colors (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`,
 * `oklch()`, named colors), conversion to and from HSV, HSL and OKLCH, and
 * WCAG 2 contrast.
 *
 * Channels: {@link Rgba} holds sRGB `r`, `g`, `b` in 0–255 (fractions kept)
 * and alpha in 0–1. Hue is in degrees everywhere.
 */

/** An sRGB color: channels 0–255, alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hue (degrees), saturation and value (0–1), alpha (0–1). The picker's model. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** Hue (degrees), saturation and lightness (0–1), alpha (0–1). */
export interface Hsla {
  h: number;
  s: number;
  l: number;
  a: number;
}

/** OKLCH: lightness 0–1, chroma (0 to about 0.4), hue in degrees, alpha 0–1. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

/** The notations {@link formatColor} writes. */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

/** How a color was written, so an edit can be written back the same way. */
export interface ColorNotation {
  /** The notation; a named color reports `'named'`. */
  format: ColorFormat | 'named';
  /** `rgba(255, 0, 0, 0.5)` style commas rather than `rgb(255 0 0 / 0.5)`. */
  legacy?: boolean;
  /** `rgba(`/`hsla(` rather than `rgb(`/`hsl(` (legacy notation only). */
  alphaName?: boolean;
  /** Uppercase hex digits. */
  upper?: boolean;
  /** Short hex (`#f80`) when the color allows it. */
  short?: boolean;
}

/** A parsed CSS color. */
export interface ParsedColor {
  rgba: Rgba;
  notation: ColorNotation;
  /** The exact OKLCH channels when the text was `oklch()` (no sRGB clipping). */
  oklch?: Oklch;
}

/* --------------------------------- named ---------------------------------- */

/** The CSS named colors (lowercase name → `#rrggbb`). */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
  beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
  blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
  darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f',
  darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
  firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080', green: '#008000',
  greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6',
  magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
  mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
  orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
  paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
  sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0',
  skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
  whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** The name of a color that is exactly a named color (opaque), else null. `transparent` for alpha 0. */
export function colorName(rgba: Rgba): string | null {
  if (rgba.a === 0) return 'transparent';
  if (rgba.a < 1) return null;
  const hex = formatHex(rgba);
  for (const [name, value] of Object.entries(NAMED_COLORS)) if (value === hex) return name;
  return null;
}

/* --------------------------------- helpers -------------------------------- */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Rounds to `digits` decimals, without `-0`. */
const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  const out = Math.round(value * factor) / factor;
  return Object.is(out, -0) ? 0 : out;
};
/** Hue into [0, 360). */
const wrapHue = (h: number) => (h >= 0 && h < 360 ? h : ((h % 360) + 360) % 360);

/** Clamps every channel into range (alpha too). */
export function clampRgba(rgba: Rgba): Rgba {
  return { r: clamp(rgba.r, 0, 255), g: clamp(rgba.g, 0, 255), b: clamp(rgba.b, 0, 255), a: clamp(rgba.a, 0, 1) };
}

/* --------------------------------- parsing -------------------------------- */

/** One numeric token of a color function: a number with an optional unit. */
interface Token {
  value: number;
  unit: string;
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i;

function token(text: string): Token | null {
  if (text.toLowerCase() === 'none') return { value: 0, unit: '' };
  const match = NUMBER.exec(text);
  return match ? { value: Number(match[1]), unit: (match[2] ?? '').toLowerCase() } : null;
}

/** Degrees of a hue token (bare numbers are degrees). */
function hueOf(t: Token): number | null {
  switch (t.unit) {
    case '':
    case 'deg':
      return t.value;
    case 'grad':
      return (t.value * 360) / 400;
    case 'rad':
      return (t.value * 180) / Math.PI;
    case 'turn':
      return t.value * 360;
    default:
      return null;
  }
}

/** Alpha of a token: a number or a percentage. */
function alphaOf(t: Token | undefined): number | null {
  if (!t) return 1;
  if (t.unit === '%') return clamp(t.value / 100, 0, 1);
  if (t.unit === '') return clamp(t.value, 0, 1);
  return null;
}

/**
 * Splits the arguments of a color function. Returns the channel tokens, the
 * alpha token and whether commas were used.
 */
function splitArgs(body: string): { channels: string[]; alpha?: string; legacy: boolean } | null {
  const text = body.trim();
  if (text.includes(',')) {
    const parts = text.split(',').map((part) => part.trim());
    if (parts.some((part) => !part || /\s/.test(part)) || parts.length < 3 || parts.length > 4) return null;
    return { channels: parts.slice(0, 3), alpha: parts[3], legacy: true };
  }
  const [main, alpha, ...rest] = text.split('/');
  if (rest.length || main === undefined) return null;
  const channels = main.trim().split(/\s+/).filter(Boolean);
  if (channels.length !== 3) return null;
  const a = alpha?.trim();
  if (alpha !== undefined && !a) return null;
  return { channels, alpha: a, legacy: false };
}

function parseHex(text: string): ParsedColor | null {
  const digits = text.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return null;
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
  const channel = (i: number) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16);
  const rgba = { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) / 255 : 1 };
  const upper = /[A-F]/.test(digits) && !/[a-f]/.test(digits);
  return { rgba, notation: { format: 'hex', upper, short: digits.length <= 4 } };
}

function parseRgb(name: string, body: string): ParsedColor | null {
  const args = splitArgs(body);
  if (!args) return null;
  const tokens = args.channels.map(token);
  if (tokens.some((t) => t === null)) return null;
  const units = new Set(tokens.map((t) => t!.unit));
  // Mixing numbers and percentages is allowed in modern syntax only.
  if ([...units].some((u) => u !== '' && u !== '%') || (args.legacy && units.size > 1)) return null;
  const [r, g, b] = tokens.map((t) => (t!.unit === '%' ? (t!.value * 255) / 100 : t!.value)) as [number, number, number];
  const at = args.alpha === undefined ? undefined : token(args.alpha);
  if (at === null) return null;
  const a = alphaOf(at);
  if (a === null) return null;
  return {
    rgba: clampRgba({ r, g, b, a }),
    notation: { format: 'rgb', legacy: args.legacy, alphaName: args.legacy && name === 'rgba' },
  };
}

function parseHsl(name: string, body: string): ParsedColor | null {
  const args = splitArgs(body);
  if (!args) return null;
  const [ht, st, lt] = args.channels.map(token);
  if (!ht || !st || !lt) return null;
  const h = hueOf(ht);
  if (h === null) return null;
  // Legacy syntax needs percentages; modern syntax also takes bare numbers (0–100).
  if (args.legacy && (st.unit !== '%' || lt.unit !== '%')) return null;
  if ((st.unit !== '%' && st.unit !== '') || (lt.unit !== '%' && lt.unit !== '')) return null;
  const at = args.alpha === undefined ? undefined : token(args.alpha);
  if (at === null) return null;
  const a = alphaOf(at);
  if (a === null) return null;
  const hsla = { h, s: clamp(st.value / 100, 0, 1), l: clamp(lt.value / 100, 0, 1), a };
  return {
    rgba: hslaToRgba(hsla),
    notation: { format: 'hsl', legacy: args.legacy, alphaName: args.legacy && name === 'hsla' },
  };
}

function parseOklch(body: string): ParsedColor | null {
  const args = splitArgs(body);
  if (!args || args.legacy) return null;
  const [lt, ct, ht] = args.channels.map(token);
  if (!lt || !ct || !ht) return null;
  if ((lt.unit !== '' && lt.unit !== '%') || (ct.unit !== '' && ct.unit !== '%')) return null;
  const h = hueOf(ht);
  if (h === null) return null;
  const at = args.alpha === undefined ? undefined : token(args.alpha);
  if (at === null) return null;
  const a = alphaOf(at);
  if (a === null) return null;
  const oklch: Oklch = {
    l: clamp(lt.unit === '%' ? lt.value / 100 : lt.value, 0, 1),
    // 100% chroma is 0.4.
    c: Math.max(0, ct.unit === '%' ? (ct.value / 100) * 0.4 : ct.value),
    h: wrapHue(h),
    a,
  };
  return { rgba: oklchToRgba(oklch), notation: { format: 'oklch' }, oklch };
}

/**
 * Parses a CSS color: `#rgb[a]`, `#rrggbb[aa]`, `rgb()`/`rgba()` (comma or
 * space syntax, numbers or percentages), `hsl()`/`hsla()`, `oklch()`, a named
 * color or `transparent`. Returns null for anything else (`var()`,
 * `currentcolor`, `color-mix()`…).
 */
export function parseColor(input: string): ParsedColor | null {
  const text = input.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (text.startsWith('#')) return parseHex(text);
  if (lower === 'transparent') return { rgba: { r: 0, g: 0, b: 0, a: 0 }, notation: { format: 'named' } };
  const named = NAMED_COLORS[lower];
  if (named) return { ...parseHex(named)!, notation: { format: 'named' } };
  const fn = /^([a-z]+)\(([^()]*)\)$/i.exec(text);
  if (!fn) return null;
  const name = fn[1]!.toLowerCase();
  const body = fn[2]!;
  if (name === 'rgb' || name === 'rgba') return parseRgb(name, body);
  if (name === 'hsl' || name === 'hsla') return parseHsl(name, body);
  if (name === 'oklch') return parseOklch(body);
  return null;
}

/** The sRGB channels of a CSS color, or null when {@link parseColor} cannot read it. */
export function toRgba(input: string): Rgba | null {
  return parseColor(input)?.rgba ?? null;
}

/** True when {@link parseColor} reads `input`. */
export function isColor(input: string): boolean {
  return parseColor(input) !== null;
}

/** Typed text with the `#` added when it is bare hex digits of a color (`abc`, `abcd`, `aabbcc`, `aabbccdd`). */
export function withHexHash(input: string): string {
  const text = input.trim();
  return /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ? `#${text}` : text;
}

/** What a color field says when typed text is not a color and the field went back to `previous`. */
export function colorRevertMessage(previous: string): string {
  const text = previous.trim();
  return text ? `Not a color, so it went back to ${text}.` : 'Not a color, so the field stayed empty.';
}

const HUE_NAMES = ['red', 'orange', 'yellow', 'yellow-green', 'green', 'spring green', 'cyan', 'sky blue', 'blue', 'violet', 'magenta', 'pink'] as const;

/** A plain name for a hue in degrees (the nearest of twelve, 30° apart), for screen readers. */
export function hueName(degrees: number): string {
  return HUE_NAMES[Math.round(wrapHue(degrees) / 30) % HUE_NAMES.length]!;
}

/* -------------------------------- formatting ------------------------------ */

const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when translucent. */
export function formatHex(rgba: Rgba, options: { upper?: boolean; short?: boolean } = {}): string {
  let digits = hex2(rgba.r) + hex2(rgba.g) + hex2(rgba.b);
  const alpha = Math.round(clamp(rgba.a, 0, 1) * 255);
  if (alpha < 255) digits += hex2(alpha);
  if (options.short && /^(?:([0-9a-f])\1)+$/.test(digits)) digits = digits.replace(/(.)\1/g, '$1');
  return `#${options.upper ? digits.toUpperCase() : digits}`;
}

/** Alpha as written in a function: `0.5`, three decimals at most. */
const alphaText = (a: number) => String(round(clamp(a, 0, 1), 3));

/**
 * Writes `rgba` in `format`. `notation` keeps the details of how the original
 * was written (comma syntax, `rgba(`, hex case). For `oklch`, pass `oklch`
 * to write exact channels instead of converting `rgba`.
 */
export function formatColor(rgba: Rgba, format: ColorFormat, notation: Omit<ColorNotation, 'format'> = {}, oklch?: Oklch): string {
  const c = clampRgba(rgba);
  const translucent = c.a < 1;
  switch (format) {
    case 'hex':
      return formatHex(c, notation);
    case 'rgb': {
      const [r, g, b] = [c.r, c.g, c.b].map((n) => round(n));
      if (notation.legacy) {
        const name = translucent || notation.alphaName ? 'rgba' : 'rgb';
        return translucent || notation.alphaName ? `${name}(${r}, ${g}, ${b}, ${alphaText(c.a)})` : `${name}(${r}, ${g}, ${b})`;
      }
      return translucent ? `rgb(${r} ${g} ${b} / ${alphaText(c.a)})` : `rgb(${r} ${g} ${b})`;
    }
    case 'hsl': {
      const hsl = rgbaToHsla(c);
      const [h, s, l] = [round(hsl.h, 1), round(hsl.s * 100, 1), round(hsl.l * 100, 1)];
      if (notation.legacy) {
        const name = translucent || notation.alphaName ? 'hsla' : 'hsl';
        return translucent || notation.alphaName ? `${name}(${h}, ${s}%, ${l}%, ${alphaText(c.a)})` : `${name}(${h}, ${s}%, ${l}%)`;
      }
      return translucent ? `hsl(${h} ${s}% ${l}% / ${alphaText(c.a)})` : `hsl(${h} ${s}% ${l}%)`;
    }
    case 'oklch': {
      const o = oklch ?? rgbaToOklch(c);
      const l = round(o.l * 100, 2);
      const ch = round(o.c, 4);
      // An achromatic color has no meaningful hue.
      const h = ch === 0 ? 0 : round(wrapHue(o.h), 2);
      const a = oklch ? clamp(oklch.a, 0, 1) : c.a;
      return a < 1 ? `oklch(${l}% ${ch} ${h} / ${alphaText(a)})` : `oklch(${l}% ${ch} ${h})`;
    }
  }
}

/** The format an edit of a color written as `notation` should come back in (named colors become hex). */
export function editFormat(notation: ColorNotation | undefined): ColorFormat {
  return !notation || notation.format === 'named' ? 'hex' : notation.format;
}

/**
 * Writes `rgba` the way `original` is written: same notation, comma syntax
 * and hex case; a named original stays named when the new color is a named
 * color, else becomes hex. An unreadable original gives hex.
 */
export function formatLike(original: string, rgba: Rgba): string {
  const parsed = parseColor(original);
  if (!parsed) return formatHex(rgba);
  const { notation } = parsed;
  if (notation.format === 'named') return colorName(rgba) ?? formatHex(rgba);
  return formatColor(rgba, notation.format, notation);
}

/**
 * Re-writes the color `text` in `format` (hex, rgb, hsl, oklch). Returns
 * null when `text` is not a color.
 */
export function convertColor(text: string, format: ColorFormat): string | null {
  const parsed = parseColor(text);
  if (!parsed) return null;
  return formatColor(parsed.rgba, format, {}, format === 'oklch' ? parsed.oklch : undefined);
}

/** True when two colors render the same (channels within half a step, alpha within 1%). */
export function sameColor(a: string | Rgba | null | undefined, b: string | Rgba | null | undefined): boolean {
  if (a == null || b == null) return a == b;
  const x = typeof a === 'string' ? toRgba(a) : a;
  const y = typeof b === 'string' ? toRgba(b) : b;
  if (!x || !y) return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (x.a === 0 && y.a === 0) return true;
  return Math.abs(x.r - y.r) < 0.5 && Math.abs(x.g - y.g) < 0.5 && Math.abs(x.b - y.b) < 0.5 && Math.abs(x.a - y.a) < 0.01;
}

/* ------------------------------- conversions ------------------------------ */

/** sRGB to HSV. `hue` is kept for grays, which have none of their own. */
export function rgbaToHsva(rgba: Rgba, hue = 0): Hsva {
  const r = rgba.r / 255;
  const g = rgba.g / 255;
  const b = rgba.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = hue;
  if (d > 1e-9) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    h = wrapHue(h);
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: rgba.a };
}

/** HSV to sRGB. */
export function hsvaToRgba(hsva: Hsva): Rgba {
  const h = wrapHue(hsva.h) / 60;
  const s = clamp(hsva.s, 0, 1);
  const v = clamp(hsva.v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: clamp(hsva.a, 0, 1) };
}

/** sRGB to HSL. `hue` is kept for grays. */
export function rgbaToHsla(rgba: Rgba, hue = 0): Hsla {
  const { h, s: sv, v } = rgbaToHsva(rgba, hue);
  const l = v * (1 - sv / 2);
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h, s, l, a: rgba.a };
}

/** HSL to sRGB. */
export function hslaToRgba(hsla: Hsla): Rgba {
  const l = clamp(hsla.l, 0, 1);
  const s = clamp(hsla.s, 0, 1);
  const v = l + s * Math.min(l, 1 - l);
  return hsvaToRgba({ h: hsla.h, s: v === 0 ? 0 : 2 * (1 - l / v), v, a: hsla.a });
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB to OKLCH. `hue` is kept for grays. */
export function rgbaToOklch(rgba: Rgba, hue = 0): Oklch {
  const r = toLinear(rgba.r / 255);
  const g = toLinear(rgba.g / 255);
  const b = toLinear(rgba.b / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  return { l: L, c: c < 1e-6 ? 0 : c, h: c < 1e-6 ? hue : wrapHue((Math.atan2(B, A) * 180) / Math.PI), a: rgba.a };
}

/** OKLCH to linear-light sRGB, unclipped. */
function oklchToLinear(o: Oklch): [number, number, number] {
  const hr = (o.h * Math.PI) / 180;
  const A = o.c * Math.cos(hr);
  const B = o.c * Math.sin(hr);
  const l = (o.l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (o.l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (o.l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (linear: number[]) => linear.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** True when an OKLCH color fits in sRGB. */
export function oklchInGamut(o: Oklch): boolean {
  return inGamut(oklchToLinear(o));
}

/**
 * OKLCH to sRGB. Colors outside sRGB are brought in by lowering chroma
 * (keeping lightness and hue), as CSS Color 4 gamut mapping does.
 */
export function oklchToRgba(o: Oklch): Rgba {
  let target = { ...o, l: clamp(o.l, 0, 1), c: Math.max(0, o.c) };
  if (!inGamut(oklchToLinear(target))) {
    let lo = 0;
    let hi = target.c;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...target, c: mid }))) lo = mid;
      else hi = mid;
    }
    target = { ...target, c: lo };
  }
  const [r, g, b] = oklchToLinear(target).map((c) => clamp(fromLinear(clamp(c, 0, 1)), 0, 1) * 255) as [number, number, number];
  return { r, g, b, a: clamp(o.a, 0, 1) };
}

/* -------------------------------- contrast -------------------------------- */

/** Paints `top` over `bottom` (straight alpha). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => (t * top.a + u * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/** WCAG 2 relative luminance of an opaque color, 0–1. */
export function relativeLuminance(rgba: Rgba): number {
  return 0.2126 * toLinear(rgba.r / 255) + 0.7152 * toLinear(rgba.g / 255) + 0.0722 * toLinear(rgba.b / 255);
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * WCAG 2 contrast ratio (1–21) of `foreground` on `background`. A
 * translucent background is taken over white, then a translucent foreground
 * over that. Null when either is not a readable color.
 */
export function contrastRatio(foreground: string | Rgba, background: string | Rgba): number | null {
  const fg = typeof foreground === 'string' ? toRgba(foreground) : foreground;
  const bgRaw = typeof background === 'string' ? toRgba(background) : background;
  if (!fg || !bgRaw) return null;
  const bg = bgRaw.a < 1 ? composite(bgRaw, WHITE) : bgRaw;
  const front = fg.a < 1 ? composite(fg, bg) : fg;
  const l1 = relativeLuminance(front);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The WCAG level a contrast ratio meets. */
export type ContrastLevel = 'AAA' | 'AA' | 'AA Large' | 'Fail';

/**
 * The best WCAG 2 level `ratio` meets: AAA ≥ 7, AA ≥ 4.5, AA Large ≥ 3 (large
 * text and UI). With `large`, AAA is ≥ 4.5 and AA ≥ 3.
 */
export function contrastLevel(ratio: number, large = false): ContrastLevel {
  if (large) return ratio >= 4.5 ? 'AAA' : ratio >= 3 ? 'AA' : 'Fail';
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Fail';
}

/** The ratio a level needs: AA 4.5 (3 for large text), AAA 7 (4.5 for large text). */
export function contrastTarget(level: 'AA' | 'AAA' = 'AA', large = false): number {
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

/**
 * The shade of `color` nearest in OKLCH lightness (same hue and chroma,
 * gamut-mapped) that reaches `target` contrast on `background`, written like
 * `color`. Null when `color` already passes or no shade does.
 */
export function readableShade(color: string, background: string, target = 4.5): string | null {
  const parsed = parseColor(color);
  const bg = toRgba(background);
  if (!parsed || !bg) return null;
  const ratio = contrastRatio(parsed.rgba, bg);
  if (ratio === null || ratio >= target) return null;
  const base = parsed.oklch ?? rgbaToOklch(parsed.rgba);
  let best: Oklch | null = null;
  for (const direction of [-1, 1]) {
    // Walk lightness away from the start until it passes; keep the closer of the two directions.
    for (let step = 1; step <= 100; step++) {
      const l = base.l + direction * step * 0.01;
      if (l < 0 || l > 1) break;
      const candidate = { ...base, l };
      const r = contrastRatio(oklchToRgba(candidate), bg);
      if (r !== null && r >= target) {
        if (!best || Math.abs(l - base.l) < Math.abs(best.l - base.l)) best = candidate;
        break;
      }
    }
  }
  if (!best) return null;
  const { notation } = parsed;
  if (notation.format === 'oklch') return formatColor(oklchToRgba(best), 'oklch', notation, best);
  return formatColor(oklchToRgba(best), editFormat(notation), notation.format === 'named' ? {} : notation);
}
