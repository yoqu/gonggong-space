/**
 * Color math for the color picker: HSV (the picker's square and hue
 * slider), OKLCH (the readable-shade search) and the labels colors are shown
 * with.
 *
 * Channels are 0–255 like the core's {@link Rgba}; hue is in degrees,
 * saturation, value and alpha are 0–1.
 */

import { contrastRatio, rgbaToHex, toRgba, type Rgba } from '@open-artifact/slides-core';

/** A color in HSV with alpha. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** RGB → HSV. A gray keeps `hue` (the picker's hue survives dragging to gray). */
export function rgbaToHsva(color: Rgba, hue = 0): Hsva {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = hue;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: color.a };
}

/** HSV → RGB (channels rounded). */
export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255), a };
}

/** The CSS a picked color is written as: `#rrggbb`, or `rgba()` when translucent. */
export function formatPicked(color: Rgba): string {
  if (color.a >= 1) return rgbaToHex(color);
  const alpha = Math.round(clamp(color.a, 0, 1) * 100) / 100;
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

/** How a color is labelled: upper-case `#RRGGBB`, or the raw text when it is not a plain color. */
export function colorLabel(value: string): string {
  const rgba = toRgba(value);
  if (!rgba || value.trim().toLowerCase() === 'transparent') return value;
  return rgbaToHex(rgba).toUpperCase();
}

/** Two colors are the same opaque color (alpha ignored). */
export function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = toRgba(a);
  const y = toRgba(b);
  return Boolean(x && y && rgbaToHex(x) === rgbaToHex(y) && Math.abs(x.a - y.a) < 0.01);
}

/* --------------------------------- OKLCH ---------------------------------- */

/** A color in OKLCH (L 0–1, C ≥ 0, H degrees). */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;

/** sRGB → OKLCH. */
export function rgbaToOklch(color: Rgba): Oklch {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** OKLCH → sRGB, or null when the color is outside sRGB. */
function oklchToRgbExact({ l, c, h }: Oklch): Rgba | null {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m1 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s1 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = fromLinear(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1);
  const g = fromLinear(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1);
  const b = fromLinear(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1);
  const out = (n: number): boolean => n < -0.5 || n > 255.5;
  if (out(r) || out(g) || out(b)) return null;
  return { r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)), a: 1 };
}

/** OKLCH → sRGB, reducing chroma until the color fits. */
export function oklchToRgba(color: Oklch): Rgba {
  let c = color.c;
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToRgbExact({ ...color, c });
    if (rgb) return rgb;
    c *= 0.9;
  }
  return oklchToRgbExact({ ...color, c: 0 }) ?? { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * The nearest shade of `text` (same hue and chroma, other lightness) that
 * reaches `target` contrast on `background`, as `#rrggbb`; null when even
 * black or white would not.
 */
export function readableShade(text: Rgba, background: Rgba, target: number): string | null {
  const start = rgbaToOklch(text);
  for (let step = 0.005; step <= 1; step += 0.005) {
    for (const l of [start.l - step, start.l + step]) {
      if (l < 0 || l > 1) continue;
      const candidate = oklchToRgba({ ...start, l });
      if (contrastRatio(candidate, background) >= target) return rgbaToHex(candidate);
    }
  }
  return null;
}
