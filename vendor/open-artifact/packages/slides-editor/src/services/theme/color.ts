/**
 * Colour math of the Theme panel: `#rrggbb` keys, contrast, OKLCH chroma and
 * hue, mixing, and the status hue bands. Every colour is compared by its
 * opaque `#rrggbb` part; alpha travels separately (a restyled translucent
 * colour keeps its alpha).
 */

import { contrastRatio, rgbaToHex, toRgba, type Rgba } from '@open-artifact/slides-core';
import { readableShade, rgbaToOklch } from '../../lib/colorspace.ts';

/** `#rrggbb` of any subset colour, or null (transparent and unknown values included). */
export function hexOf(value: string): string | null {
  const rgba = toRgba(value);
  if (!rgba || rgba.a === 0) return null;
  return rgbaToHex(rgba);
}

/** The alpha of a colour (1 when opaque or unreadable). */
export function alphaOf(value: string): number {
  return toRgba(value)?.a ?? 1;
}

const rgb = (hex: string): Rgba => toRgba(hex) ?? { r: 0, g: 0, b: 0, a: 1 };

/** WCAG contrast of two opaque colours. */
export function contrast(a: string, b: string): number {
  return contrastRatio(rgb(a), rgb(b));
}

/** True for a dark colour (white text reads better on it than black). */
export function isDark(hex: string): boolean {
  return contrast(hex, '#ffffff') > contrast(hex, '#000000');
}

/** OKLCH chroma. */
export function chroma(hex: string): number {
  return rgbaToOklch(rgb(hex)).c;
}

/** OKLCH hue in degrees. */
export function hue(hex: string): number {
  return rgbaToOklch(rgb(hex)).h;
}

/** OKLCH lightness 0–1. */
export function lightness(hex: string): number {
  return rgbaToOklch(rgb(hex)).l;
}

/** A colour with a visible hue (not a grey). */
export function isChromatic(hex: string): boolean {
  return chroma(hex) >= 0.045;
}

/** A very light, low-chroma tint (reads as a surface, not as an accent). */
export function isPaleTint(hex: string): boolean {
  return lightness(hex) > 0.9 && chroma(hex) < 0.07;
}

/** Shortest angle between two hues. */
export function hueDifference(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** `a` mixed toward `b` by `t` (0 → a, 1 → b), as `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return rgbaToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

/** Writes `hex` with the alpha of `like` (`rgba()` when translucent). */
export function withAlphaOf(hex: string, like: string): string {
  const a = alphaOf(like);
  if (a >= 1) return hex;
  const c = rgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(a * 1000) / 1000})`;
}

/** The status meanings a colour can carry, by hue band (OKLCH hue). */
export type StatusMeaning = 'success' | 'warning' | 'danger' | 'info';

/** The status a chromatic colour's hue suggests, or null. */
export function statusBand(hex: string): StatusMeaning | null {
  if (!isChromatic(hex)) return null;
  const h = hue(hex);
  if (h < 40 || h >= 345) return 'danger';
  if (h < 100) return 'warning';
  if (h >= 125 && h < 175) return 'success';
  if (h >= 210 && h < 265) return 'info';
  return null;
}

/**
 * `color` adjusted (same hue and chroma, another lightness) until it reaches
 * `target` contrast on `ground`; the more readable of black and white when no
 * shade does.
 */
export function legibleOn(color: string, ground: string, target: number): string {
  if (contrast(color, ground) >= target) return color;
  const shade = readableShade(rgb(color), rgb(ground), target);
  if (shade) return shade;
  return contrast('#ffffff', ground) >= contrast('#000000', ground) ? '#ffffff' : '#000000';
}
