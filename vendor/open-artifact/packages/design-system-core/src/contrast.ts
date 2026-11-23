/**
 * WCAG 2 contrast between color tokens.
 *
 * Which tokens are text and which are backgrounds is read from their names
 * (`text-*`, `fg`, `ink`, `on-*` against `bg-*`, `surface`, `canvas`…):
 * that is how design systems name them, and it keeps the page from showing
 * hundreds of meaningless pairs. Parsing arbitrary CSS colors is left to
 * the caller (a browser canvas parses every syntax); only hex is parsed here.
 */

/** An sRGB color, channels 0–255, alpha 0–1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** WCAG thresholds. */
export const CONTRAST = {
  /** Body text. */
  text: 4.5,
  /** Large text, borders, focus rings, icons. */
  large: 3,
} as const;

/** Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
export function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!match || ![3, 4, 6, 8].includes(match[1]!.length)) return null;
  let hex = match[1]!;
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
}

/** Relative luminance of an opaque color. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Composites a translucent color over an opaque one. */
export function over(top: Rgb, bottom: Rgb): Rgb {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

/** Contrast ratio (1–21) of a foreground on a background; a translucent foreground is composited first. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const bg = background.a < 1 ? over(background, { r: 255, g: 255, b: 255, a: 1 }) : background;
  const fg = foreground.a < 1 ? over(foreground, bg) : foreground;
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The rating of a ratio for body text. */
export function contrastGrade(ratio: number): 'AAA' | 'AA' | 'AA large' | 'fail' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= CONTRAST.text) return 'AA';
  if (ratio >= CONTRAST.large) return 'AA large';
  return 'fail';
}

const FOREGROUND = /(^|[-_.])(text|fg|foreground|ink|on|content|label|heading|body|icon|link)([-_.]|$)/i;
const BACKGROUND = /(^|[-_.])(bg|background|surface|canvas|paper|base|page|card|panel|fill|container)([-_.]|$)/i;
/** `on-primary` pairs with `primary`. */
const ON = /^on[-_.](.+)$/i;
/** Most pairs shown per theme. */
const MAX_PAIRS = 40;

/** A foreground/background pair worth checking. */
export interface ContrastPair {
  foreground: string;
  background: string;
  /** Large text, icon or border: the 3:1 threshold applies. */
  large: boolean;
}

/** Infers the pairs to check from token names. */
export function contrastPairs(names: readonly string[]): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const seen = new Set<string>();
  const push = (foreground: string, background: string): void => {
    const key = `${foreground}\u0000${background}`;
    if (foreground === background || seen.has(key) || pairs.length >= MAX_PAIRS) return;
    seen.add(key);
    pairs.push({ foreground, background, large: /(^|[-_.])(icon|border|ring|focus|outline|heading|display)([-_.]|$)/i.test(foreground) });
  };
  // `on-x` against `x` first: the most explicit pairing a system declares.
  for (const name of names) {
    const target = ON.exec(name)?.[1];
    if (target && names.includes(target)) push(name, target);
  }
  const foregrounds = names.filter((name) => FOREGROUND.test(name) && !BACKGROUND.test(name) && !ON.test(name));
  const backgrounds = names.filter((name) => BACKGROUND.test(name) && !FOREGROUND.test(name));
  for (const fg of foregrounds) for (const bg of backgrounds) push(fg, bg);
  return pairs;
}
