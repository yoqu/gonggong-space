/**
 * Board colors: the named fills and inks, their light and dark variants, and
 * the contrast rules that pick readable text on any fill.
 *
 * Elements store color *names* (or a `#rrggbb`); everything here turns a
 * name into paint for a color scheme. Functions take the scheme explicitly,
 * so they are pure and work in Node (exports, checks) as in the page.
 */

import { HEX_COLOR_PATTERN, type FillColor, type InkColor, type InkColorName, type NoteColor, type ShapeElement } from './schema.ts';

/** Light or dark board. */
export type ColorScheme = 'light' | 'dark';

/** Fills of notes, sections and table headers (light theme). */
export const BLOCK_COLORS: Readonly<Record<NoteColor, string>> = {
  yellow: '#F9E56F',
  peach: '#F9BD85',
  pink: '#F7ABC9',
  green: '#AEE2AB',
  blue: '#9DC8F7',
  purple: '#C6BDFA',
  white: '#EFEFEF',
};

/** Named inks on a light board. */
export const INK_COLORS: Readonly<Record<InkColorName, string>> = {
  ink: '#0B0B0B',
  terracotta: '#CC6B49',
  blue: '#2F7CC4',
  green: '#2E8B57',
  purple: '#7C5CBF',
};

/** The default ink on a dark board. */
export const DARK_THEME_INK = '#EFEFEF';

/** Named inks on a dark board. */
export const DARK_INK_COLORS: Readonly<Record<InkColorName, string>> = {
  ink: DARK_THEME_INK,
  terracotta: '#F0A77F',
  blue: '#9CCDE8',
  green: '#B7DFA4',
  purple: '#CDB6EC',
};

/** Shape fills (stronger than note fills). */
export const SHAPE_FILL_COLORS: Readonly<Record<NoteColor, string>> = {
  yellow: '#F5D515',
  peach: '#ED953D',
  pink: '#EE7FAC',
  green: '#72D071',
  blue: '#6AABF1',
  purple: '#A89AF0',
  white: DARK_THEME_INK,
};

/** A white shape is drawn light gray so it shows on the paper. */
export const WHITE_SHAPE_FILL = '#D1D1D1';

/** Paper, grid and default ink of each scheme. */
export const BOARD_THEME_COLORS: Readonly<Record<ColorScheme, { paper: string; grid: string; ink: string; labelPill: string }>> = {
  light: { paper: '#FFFFFF', grid: 'rgba(0,0,0,0.02)', ink: '#0B0B0B', labelPill: '#FFFFFF' },
  dark: { paper: '#191919', grid: 'rgba(255,255,255,0.035)', ink: DARK_THEME_INK, labelPill: '#191919' },
};

/** Dot-grid spacing, board units. */
export const GRID_SPACING = 24;

/** Older stored hexes that read as named fills. */
const LEGACY_BLOCK_COLOR_HEXES: Readonly<Record<string, NoteColor>> = {
  '#fdfdfb': 'white',
  '#fcfcfc': 'white',
  '#e0e0e0': 'white',
  '#f4e187': 'yellow',
  '#fad7b8': 'peach',
  '#f9cfe0': 'pink',
  '#cdebd2': 'green',
  '#bfdff6': 'blue',
  '#dcd3f4': 'purple',
};

const SECTION_TITLE_INK = '#6B6B6B';
const LIGHT_SECTION_LINE_COLORS: Readonly<Record<NoteColor, string>> = { ...BLOCK_COLORS, white: '#E0E0E0' };
const DARK_SECTION_LINE_COLORS: Readonly<Record<NoteColor, string>> = {
  yellow: '#563301',
  peach: '#632508',
  pink: '#651838',
  green: '#0A4D10',
  blue: '#0E3D7E',
  purple: '#3A2684',
  white: '#444444',
};
/** Section outline width. */
export const SECTION_LINE_WIDTH = 1.25;
/** Section tint alpha: white sections (`plain`) and colored ones (`hue`). */
export const SECTION_FILL_ALPHA: Readonly<Record<ColorScheme, { plain: number; hue: number }>> = {
  light: { plain: 0.025, hue: 0.1 },
  dark: { plain: 0.02, hue: 0.04 },
};
/** How much of the text color mixes into a shape's edge. */
export const SHAPE_OUTLINE_MIX = 0.16;
/** Dark text on light fills. */
export const DARK_CONTRAST_TEXT = '#191919';
/** Light text on dark fills. */
export const LIGHT_CONTRAST_TEXT = '#EFEFEF';
const LIGHT_CHIP_COLOR = '#F2F2F2';
const DARK_CHIP_COLOR = '#121212';

/* -------------------------------------------------------------------------- */
/* Contrast                                                                   */
/* -------------------------------------------------------------------------- */

/** An RGBA color with channels in 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const CSS_HEX_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_RGB_PATTERN = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i;

const clampChannel = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Parses `#rgb[a]`, `#rrggbb[aa]` or `rgb[a](…)`. */
export function parseRgbaColor(cssColor: string): Rgba | undefined {
  const normalized = cssColor.trim();
  const hexDigits = CSS_HEX_PATTERN.exec(normalized)?.[1];
  if (hexDigits !== undefined) {
    const full = hexDigits.length <= 4 ? hexDigits.replace(/[0-9a-f]/gi, (digit) => digit + digit) : hexDigits;
    const channel = (index: number): number => parseInt(full.slice(index * 2, index * 2 + 2), 16) / 255;
    return { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) : 1 };
  }
  const match = CSS_RGB_PATTERN.exec(normalized);
  if (match === null) return undefined;
  const channel = (value: string | undefined, unit: string | undefined): number => clampChannel(Number(value) / (unit === '%' ? 100 : 255));
  const [r, g, b] = [channel(match[1], match[2]), channel(match[3], match[4]), channel(match[5], match[6])];
  const a = match[7] === undefined ? 1 : clampChannel(Number(match[7]) / (match[8] === '%' ? 100 : 1));
  return [r, g, b, a].every(Number.isFinite) ? { r, g, b, a } : undefined;
}

function relativeLuminance(color: Rgba): number {
  const linear = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function compositeOver(foreground: Rgba, background: Rgba): Rgba {
  const blend = (fg: number, bg: number): number => foreground.a * fg + (1 - foreground.a) * bg;
  return { r: blend(foreground.r, background.r), g: blend(foreground.g, background.g), b: blend(foreground.b, background.b), a: 1 };
}

/** WCAG contrast ratio of a (possibly translucent) foreground over a background. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const fg = relativeLuminance(compositeOver(foreground, background));
  const bg = relativeLuminance(background);
  return fg > bg ? (fg + 0.05) / (bg + 0.05) : (bg + 0.05) / (fg + 0.05);
}

/** Whichever of `a` and `b` contrasts more with `background` (`b` on ties or bad input). */
export function strongerContrastColor(background: string | Rgba, a: string, b: string): string {
  const bg = typeof background === 'string' ? parseRgbaColor(background) : background;
  const [first, second] = [parseRgbaColor(a), parseRgbaColor(b)];
  if (bg === undefined || first === undefined || second === undefined) return b;
  const opaque = { ...bg, a: 1 };
  return contrastRatio(first, opaque) > contrastRatio(second, opaque) ? a : b;
}

/* -------------------------------------------------------------------------- */
/* Names to paint                                                             */
/* -------------------------------------------------------------------------- */

/** Mixes two hex colors (`amount` 0 = `from`, 1 = `to`). */
export function mixHexColors(from: string, to: string, amount: number): string {
  const [a, b] = [parseInt(from.slice(1), 16), parseInt(to.slice(1), 16)];
  const channel = (shift: number): number => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * amount);
  return `#${(0x1000000 | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1)}`;
}

/** A hex color as `rgba(…)` with `alpha` (transparent for anything else). */
export function hexToRgba(hex: string, alpha: number): string {
  if (!HEX_COLOR_PATTERN.test(hex)) return 'transparent';
  const rgb = parseInt(hex.slice(1), 16);
  return `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${alpha})`;
}

function lightenTowardDarkInk(color: string, amount = 0.55): string {
  return HEX_COLOR_PATTERN.test(color) ? mixHexColors(color, DARK_THEME_INK, amount) : DARK_THEME_INK;
}

/** The palette name of a color (its hex matched case-insensitively), or the color itself. */
export function paletteColorName(color: string, palette: Readonly<Record<string, string>>): string {
  const lower = color.toLowerCase();
  for (const name in palette) if (palette[name]?.toLowerCase() === lower) return name;
  return (palette === BLOCK_COLORS ? LEGACY_BLOCK_COLOR_HEXES[lower] : undefined) ?? color;
}

/** An ink's light-theme hex. */
export function inkColorHex(color: InkColor | string): string {
  return INK_COLORS[color as InkColorName] ?? color;
}

/** A fill's light-theme hex. */
export function blockColorHex(color: FillColor | string): string {
  return BLOCK_COLORS[paletteColorName(color, BLOCK_COLORS) as NoteColor] ?? color;
}

/** An ink on a dark board. */
export function darkInkColor(color: string): string {
  return DARK_INK_COLORS[paletteColorName(color, INK_COLORS) as InkColorName] ?? lightenTowardDarkInk(color);
}

/** A fill as a dark board draws colored outlines and section tints. */
export function darkModeBlockColor(color: string): string {
  return SHAPE_FILL_COLORS[paletteColorName(color, BLOCK_COLORS) as NoteColor] ?? lightenTowardDarkInk(color, 0.35);
}

/** An ink for a scheme. */
export function themedInkColor(color: string, scheme: ColorScheme): string {
  return scheme === 'dark' ? darkInkColor(color) : inkColorHex(color);
}

/** The scheme's default ink. */
export function boardInkColor(scheme: ColorScheme): string {
  return BOARD_THEME_COLORS[scheme].ink;
}

/** Dark or light text, whichever reads better on a fill. */
export function contrastTextColorOn(fill: string): string {
  const hex = blockColorHex(fill);
  if (!HEX_COLOR_PATTERN.test(hex)) return DARK_CONTRAST_TEXT;
  return strongerContrastColor(hex, LIGHT_CONTRAST_TEXT, DARK_CONTRAST_TEXT);
}

/** An ink drawn on a fill: the plain ink switches to the readable text color. */
export function inkColorOnFill(color: string, fill: string | undefined, scheme: ColorScheme): string {
  if (fill === undefined) return themedInkColor(color, scheme);
  return strongerContrastColor(fill, paletteColorName(color, INK_COLORS) === 'ink' ? contrastTextColorOn(fill) : inkColorHex(color), themedInkColor(color, scheme));
}

/** A shape fill for a fill color. */
export function shapeFillForColor(color: string): string {
  const name = paletteColorName(color, BLOCK_COLORS);
  return name === 'white' ? WHITE_SHAPE_FILL : (SHAPE_FILL_COLORS[name as NoteColor] ?? color);
}

/** A shape's fill. */
export function shapeFillColor(shape: Pick<ShapeElement, 'color'>): string {
  return shapeFillForColor(shape.color);
}

/** A shape's fill paint (`none` when hollow). */
export function shapeFillPaint(shape: Pick<ShapeElement, 'color' | 'hollow'>): string {
  return shape.hollow === true ? 'none' : shapeFillColor(shape);
}

/** A shape's text color. */
export function shapeTextColor(shape: Pick<ShapeElement, 'color' | 'hollow' | 'ink'>, scheme: ColorScheme): string {
  if (shape.hollow === true) return shape.ink !== undefined ? themedInkColor(shape.ink, scheme) : boardInkColor(scheme);
  return shape.ink !== undefined ? inkColorHex(shape.ink) : contrastTextColorOn(shapeFillColor(shape));
}

/** A shape's outline paint: none, its exact color (`solid`), or themed. */
export function shapeStrokePaint(shape: Pick<ShapeElement, 'stroke' | 'solid'>, scheme: ColorScheme): string {
  return shape.stroke === undefined ? 'none' : shape.solid === true ? inkColorHex(shape.stroke) : themedInkColor(shape.stroke, scheme);
}

/** The subtle edge of a filled shape. */
export function shapeOutlineColor(shape: Pick<ShapeElement, 'color'>): string {
  const fill = shapeFillColor(shape);
  return mixHexColors(fill, contrastTextColorOn(fill), SHAPE_OUTLINE_MIX);
}

/** An inner-edge overlay that suits the fill. */
export function shapeEdgeOverlay(fill: string): string {
  return contrastTextColorOn(fill) === DARK_CONTRAST_TEXT ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)';
}

/** A section's outline color (custom hexes fall back when they would not show). */
export function sectionLineColor(color: string, scheme: ColorScheme): string {
  const palette = scheme === 'light' ? LIGHT_SECTION_LINE_COLORS : DARK_SECTION_LINE_COLORS;
  const named = palette[paletteColorName(color, BLOCK_COLORS) as NoteColor];
  const plain = palette.white;
  if (named !== undefined || !HEX_COLOR_PATTERN.test(color)) return named ?? plain;
  const candidate = scheme === 'light' ? color : mixHexColors(BOARD_THEME_COLORS.dark.paper, darkModeBlockColor(color), 0.26);
  const paper = parseRgbaColor(BOARD_THEME_COLORS[scheme].paper)!;
  const contrast = (hex: string): number => contrastRatio(parseRgbaColor(hex)!, paper);
  return contrast(candidate) < contrast(plain) ? plain : candidate;
}

/** A section title's color. */
export function sectionInkColor(color: string, scheme: ColorScheme): string {
  return scheme === 'dark' ? darkModeBlockColor(color) : SECTION_TITLE_INK;
}

/** True when two fills are the same color. */
export function isSameBlockColor(a: string, b: string): boolean {
  return blockColorHex(a).toLowerCase() === blockColorHex(b).toLowerCase();
}

/** A section's tint. */
export function sectionFillColor(color: string, scheme: ColorScheme): string {
  const white = isSameBlockColor(color, 'white');
  return hexToRgba(scheme === 'dark' ? darkModeBlockColor(color) : white ? '#878787' : blockColorHex(color), SECTION_FILL_ALPHA[scheme][white ? 'plain' : 'hue']);
}

/** A section's opaque tint for image export. */
export function exportSectionColor(color: string): string {
  return isSameBlockColor(color, 'white') ? mixHexColors('#FFFFFF', '#878787', 0.1) : mixHexColors('#FFFFFF', blockColorHex(color), 0.25);
}

/** The fill all elements share, if they share one. */
export function sharedElementColor(elements: readonly { color?: string }[]): string | undefined {
  const first = elements[0]?.color;
  if (first === undefined) return undefined;
  return elements.every((element) => element.color !== undefined && isSameBlockColor(element.color, first)) ? first : undefined;
}

/** A small chip's background that reads on a fill. */
export function chipColorOn(fill: string): string {
  return contrastTextColorOn(fill) === DARK_CONTRAST_TEXT ? LIGHT_CHIP_COLOR : DARK_CHIP_COLOR;
}

/** The default chip background of a scheme. */
export function defaultChipColor(scheme: ColorScheme): string {
  return scheme === 'dark' ? DARK_CHIP_COLOR : LIGHT_CHIP_COLOR;
}

/** "word" → "Word". */
export function capitalizeFirstLetter(text: string): string {
  return text === '' ? text : text[0]!.toUpperCase() + text.slice(1);
}
