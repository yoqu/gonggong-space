import { NAMED_COLORS } from './named-colors.ts';

/** Red, green and blue, each 0 to 255. */
export type Rgb = [number, number, number];

/** A color in OKLCH: lightness 0 to 1, chroma from 0, hue in degrees. */
export interface Oklch {
  L: number;
  C: number;
  h: number;
}

/** A color as CSS gives it: its channels and an alpha from 0 to 1. */
export interface CssColor {
  rgb: Rgb;
  alpha: number;
}

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const RGB_FUNCTION_PATTERN = new RegExp(
  String.raw`^rgba?\(\s*(${NUMBER}%?)(?:\s*,\s*|\s+)(${NUMBER}%?)(?:\s*,\s*|\s+)(${NUMBER}%?)(?:\s*[,/]\s*(${NUMBER}%?))?\s*\)$`,
  'i',
);
const HSL_FUNCTION_PATTERN = new RegExp(
  String.raw`^hsla?\(\s*(${NUMBER})(deg|turn|rad|grad)?(?:\s*,\s*|\s+)(${NUMBER})%(?:\s*,\s*|\s+)(${NUMBER})%(?:\s*[,/]\s*(${NUMBER}%?))?\s*\)$`,
  'i',
);

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/** The channels of a `#rrggbb` color. */
export const hexToRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** `#rrggbb`, lower case, of channels rounded and kept within 0 to 255. */
export const rgbToHex = (rgb: readonly number[]): string => '#' + rgb.slice(0, 3).map((channel) => clampByte(channel).toString(16).padStart(2, '0')).join('');

/** A hex color of 3, 4, 6 or 8 digits as `#rrggbb` lower case (its alpha dropped), or `null`. */
export function normalizeHexColor(input: string): string | null {
  const match = HEX_COLOR_PATTERN.exec(input.trim());
  if (match === null) return null;
  const digits = match[1]!.toLowerCase();
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return '#' + full.slice(0, 6);
}

const readChannel = (text: string): number => (text.endsWith('%') ? (parseFloat(text) / 100) * 255 : parseFloat(text));
const readAlpha = (text: string | undefined): number => (text === undefined ? 1 : clampUnit(text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)));

function readHue(value: string, unit: string | undefined): number {
  const amount = parseFloat(value);
  const lower = unit?.toLowerCase();
  const degrees = lower === 'turn' ? amount * 360 : lower === 'rad' ? (amount * 180) / Math.PI : lower === 'grad' ? amount * 0.9 : amount;
  return ((degrees % 360) + 360) % 360;
}

/** The channels of an HSL color; saturation and lightness 0 to 1. */
export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const at = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return clampByte(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [at(0), at(8), at(4)];
}

/**
 * A CSS color: a hex color (3, 4, 6 or 8 digits), `rgb()`/`rgba()` (commas or spaces, numbers or percentages, an
 * alpha after `,` or `/`), `hsl()`/`hsla()`, a named color or `transparent`. `null` for anything else.
 */
export function parseCssColor(input: string): CssColor | null {
  const text = input.trim();
  const hex = HEX_COLOR_PATTERN.exec(text);
  if (hex !== null) {
    const digits = hex[1]!;
    const alphaDigits = digits.length === 4 ? digits[3]! + digits[3]! : digits.length === 8 ? digits.slice(6) : null;
    return { rgb: hexToRgb(normalizeHexColor(text)!), alpha: alphaDigits === null ? 1 : parseInt(alphaDigits, 16) / 255 };
  }
  const rgb = RGB_FUNCTION_PATTERN.exec(text);
  if (rgb !== null) return { rgb: [clampByte(readChannel(rgb[1]!)), clampByte(readChannel(rgb[2]!)), clampByte(readChannel(rgb[3]!))], alpha: readAlpha(rgb[4]) };
  const hsl = HSL_FUNCTION_PATTERN.exec(text);
  if (hsl !== null)
    return { rgb: hslToRgb(readHue(hsl[1]!, hsl[2]), clampUnit(parseFloat(hsl[3]!) / 100), clampUnit(parseFloat(hsl[4]!) / 100)), alpha: readAlpha(hsl[5]) };
  const lower = text.toLowerCase();
  if (lower === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const named = NAMED_COLORS.get(lower);
  return named === undefined ? null : { rgb: hexToRgb(named), alpha: 1 };
}

/** `#rrggbb` when opaque, else `#rrggbbaa`. */
export function formatCssColor(color: CssColor): string {
  const alpha = clampUnit(color.alpha);
  return rgbToHex(color.rgb) + (alpha >= 1 ? '' : clampByte(alpha * 255).toString(16).padStart(2, '0'));
}

/** A CSS color as `#rrggbb` with its alpha dropped, or `null`. */
export function cssColorToHex(input: string): string | null {
  const color = parseCssColor(input);
  return color === null ? null : rgbToHex(color.rgb);
}

/** An sRGB channel (0 to 255) as linear light (0 to 1). */
export const srgbToLinear = (channel: number): number => {
  const unit = channel / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

/** Linear light (0 to 1) as an sRGB channel, rounded (0 to 255 for inputs in range). */
export const linearToSrgb = (linear: number): number => Math.round(255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));

export const linearRgbLuminance = (red: number, green: number, blue: number): number => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

/** Relative luminance (WCAG), 0 for black to 1 for white. */
export const rgbLuminance = (rgb: readonly number[]): number => linearRgbLuminance(srgbToLinear(rgb[0]!), srgbToLinear(rgb[1]!), srgbToLinear(rgb[2]!));

/** The WCAG contrast ratio of two `#rrggbb` colors, 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [rgbLuminance(hexToRgb(first)), rgbLuminance(hexToRgb(second))].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Black or white, whichever reads better on the color. */
export const readableInk = (background: string): '#000000' | '#ffffff' =>
  contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';

export function rgbToOklch(rgb: readonly number[]): Oklch {
  const [red, green, blue] = [srgbToLinear(rgb[0]!), srgbToLinear(rgb[1]!), srgbToLinear(rgb[2]!)];
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

export const hexToOklch = (hex: string): Oklch => rgbToOklch(hexToRgb(hex));

/** Linear sRGB of an OKLCH color, possibly out of range. */
export function oklchToLinearRgb({ L, C, h }: Oklch): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The last value from `low` towards `high` for which `below` holds, found in `steps` halvings. */
export function binarySearchBoundary(low: number, high: number, steps: number, below: (value: number) => boolean): number {
  for (let step = 0; step < steps; step++) {
    const middle = (low + high) / 2;
    if (below(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/** The most chroma sRGB shows at a lightness and hue. */
export const maxOklchChroma = (L: number, h: number): number =>
  binarySearchBoundary(0, 0.4, 16, (C) => oklchToLinearRgb({ L, C, h }).every((channel) => channel >= -0.0005 && channel <= 1.0005));

/** How far apart two hues are, 0 to 180 degrees. */
export const hueDistance = (first: number, second: number): number => Math.abs(((first - second + 540) % 360) - 180);

/** The color with its OKLCH hue turned by `degrees`, at the same luminance and with no more chroma than sRGB shows. */
export function rotateHueAtLuminance(hex: string, degrees: number): string {
  const rgb = hexToRgb(hex);
  const { C, h } = rgbToOklch(rgb);
  const at = (L: number): Rgb => oklchToLinearRgb({ L, C: Math.min(C, maxOklchChroma(L, h + degrees)), h: h + degrees });
  const luminance = rgbLuminance(rgb);
  const L = binarySearchBoundary(0, 1, 20, (value) => linearRgbLuminance(...at(value)) < luminance);
  return rgbToHex(at(L).map((channel) => linearToSrgb(clampUnit(channel))));
}
