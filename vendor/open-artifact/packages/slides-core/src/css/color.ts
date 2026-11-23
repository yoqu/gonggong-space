/**
 * Colors of the subset: `#hex`, `rgb[a]()`, `hsl[a]()`, CSS named colors and
 * `transparent`. Parsing returns the canonical spelling the serializer writes;
 * `toRgba` resolves any accepted color to numbers for contrast checks,
 * exports and the color picker.
 */

/** A resolved color: channels 0–255, alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** CSS named colors (CSS Color 4), lower-case name → hex. */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
  beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
  blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
  darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000',
  darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b', darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
  deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222',
  floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff',
  gold: '#ffd700', goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082',
  ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90', lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0',
  lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000',
  mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
  mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6',
  olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
  powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f',
  royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
  seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
  tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0',
  violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
  yellowgreen: '#9acd32',
};

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const FUNCTION_RE = new RegExp(String.raw`^(rgba?|hsla?)\(\s*([^)]*)\)$`, 'i');
const NUMBER_RE = new RegExp(`^${NUMBER}$`, 'i');

/** Formats a number for CSS: at most `digits` decimals, no trailing zeros. */
export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Splits a color function's arguments, comma or space (with `/` alpha) syntax. */
function functionArgs(body: string): string[] | null {
  const trimmed = body.trim();
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim());
    return parts.every(Boolean) ? parts : null;
  }
  const [main, alpha] = trimmed.split('/').map((part) => part.trim());
  if (!main) return null;
  const parts = main.split(/\s+/);
  if (alpha !== undefined) {
    if (!alpha) return null;
    parts.push(alpha);
  }
  return parts;
}

/** Reads `N` or `N%` as a channel scaled to `scale` (percent of it). */
function channel(part: string, scale: number): number | null {
  if (part.endsWith('%')) {
    const n = part.slice(0, -1);
    return NUMBER_RE.test(n) ? (Number(n) / 100) * scale : null;
  }
  return NUMBER_RE.test(part) ? Number(part) : null;
}

/** Reads an alpha value: `N` (0–1) or `N%`. */
function alphaValue(part: string): number | null {
  if (part.endsWith('%')) {
    const n = part.slice(0, -1);
    return NUMBER_RE.test(n) ? clamp(Number(n) / 100, 0, 1) : null;
  }
  return NUMBER_RE.test(part) ? clamp(Number(part), 0, 1) : null;
}

/** Reads a hue: a bare number (degrees) or an angle. */
function hueValue(part: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i.exec(part);
  if (!match) return null;
  const n = Number(match[1]);
  switch ((match[2] ?? 'deg').toLowerCase()) {
    case 'turn':
      return n * 360;
    case 'rad':
      return (n * 180) / Math.PI;
    case 'grad':
      return n * 0.9;
    default:
      return n;
  }
}

/** HSL (h in degrees, s/l 0–1) to RGB channels 0–255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Parses a color. Returns its canonical spelling (lower-case hex as written,
 * `rgb()`/`rgba()`/`hsl()`/`hsla()` with comma syntax, a lower-case name, or
 * `transparent`), or `null` when it is not a color of the subset.
 */
export function parseColor(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'transparent') return value;
  if (Object.hasOwn(NAMED_COLORS, value)) return value;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) return value;
  const match = FUNCTION_RE.exec(value);
  if (!match) return null;
  const name = match[1]!;
  const args = functionArgs(match[2]!);
  if (!args || (args.length !== 3 && args.length !== 4)) return null;
  const alpha = args.length === 4 ? alphaValue(args[3]!) : 1;
  if (alpha === null) return null;
  if (name.startsWith('rgb')) {
    const channels = args.slice(0, 3).map((part) => channel(part, 255));
    if (channels.some((c) => c === null)) return null;
    const [r, g, b] = channels.map((c) => Math.round(clamp(c!, 0, 255)));
    return alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${formatNumber(alpha)})` : `rgb(${r}, ${g}, ${b})`;
  }
  const h = hueValue(args[0]!);
  const s = args[1]!.endsWith('%') ? channel(args[1]!, 100) : null;
  const l = args[2]!.endsWith('%') ? channel(args[2]!, 100) : null;
  if (h === null || s === null || l === null) return null;
  const hs = `${formatNumber(h)}, ${formatNumber(clamp(s, 0, 100))}%, ${formatNumber(clamp(l, 0, 100))}%`;
  return alpha < 1 ? `hsla(${hs}, ${formatNumber(alpha)})` : `hsl(${hs})`;
}

/** Resolves a color (any spelling `parseColor` accepts) to channels, or `null`. */
export function toRgba(raw: string): Rgba | null {
  const value = parseColor(raw);
  if (value === null) return null;
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = value.startsWith('#') ? value : NAMED_COLORS[value];
  if (hex) {
    const digits = hex.slice(1);
    const expand = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
    const r = parseInt(expand.slice(0, 2), 16);
    const g = parseInt(expand.slice(2, 4), 16);
    const b = parseInt(expand.slice(4, 6), 16);
    const a = expand.length === 8 ? parseInt(expand.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const match = FUNCTION_RE.exec(value)!;
  const args = functionArgs(match[2]!)!;
  const a = args.length === 4 ? alphaValue(args[3]!)! : 1;
  if (match[1]!.startsWith('rgb')) {
    const [r, g, b] = args.slice(0, 3).map((part) => channel(part, 255)!);
    return { r: r!, g: g!, b: b!, a };
  }
  const [r, g, b] = hslToRgb(hueValue(args[0]!)!, channel(args[1]!, 1)!, channel(args[2]!, 1)!);
  return { r, g, b, a };
}

/** `#rrggbb` (alpha dropped) of a resolved color. */
export function rgbaToHex(color: Rgba): string {
  const hex = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/** `#rrggbb` or `rgba()` spelling of a resolved color. */
export function formatRgba(color: Rgba): string {
  if (color.a >= 1) return rgbaToHex(color);
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${formatNumber(color.a)})`;
}

/** WCAG relative luminance of an opaque color. */
export function luminance(color: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
}

/** Composites a translucent color over an opaque backdrop. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

/** WCAG contrast ratio between a (possibly translucent) text color and an opaque background. */
export function contrastRatio(text: Rgba, background: Rgba): number {
  const fg = text.a < 1 ? composite(text, background) : text;
  const l1 = luminance(fg);
  const l2 = luminance(background);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
