/**
 * The typefaces the Font menu offers beyond the deck's own faces: the
 * generic families, the faces every computer has, and a short list of
 * Google fonts. Picking a Google font makes the deck carry it (a `faces`
 * entry with its stylesheet link), so the slide renders it anywhere.
 *
 * Also the weight menu's variants: which weights (and italics) a family
 * offers, and how a weight is named.
 */

import { familyList, formatFamilies, type DeckFace } from '@open-artifact/slides-core';

/** The generic family a face falls back to. */
export type Generic = 'sans-serif' | 'serif' | 'monospace';

/** A face every platform ships. */
export interface WebSafeFont {
  family: string;
  generic: Generic;
}

/** A Google font: its variable weight range or static weights, and whether it has italics. */
export interface GoogleFont extends WebSafeFont {
  /** Weights the stylesheet link asks for (default 400, 500, 600, 700). */
  weights?: number[];
  wght?: [number, number];
  statics?: number[];
  italic: boolean;
}

/** Faces every computer has (the slide compiler accepts them undeclared). */
export const WEB_SAFE_FONTS: readonly WebSafeFont[] = [
  { family: 'Arial', generic: 'sans-serif' },
  { family: 'Georgia', generic: 'serif' },
  { family: 'Times New Roman', generic: 'serif' },
  { family: 'Courier New', generic: 'monospace' },
  { family: 'Verdana', generic: 'sans-serif' },
  { family: 'Tahoma', generic: 'sans-serif' },
  { family: 'Trebuchet MS', generic: 'sans-serif' },
];

/** Google fonts the menu offers. */
export const GOOGLE_FONTS: readonly GoogleFont[] = [
  { family: 'Inter', generic: 'sans-serif', wght: [100, 900], italic: true },
  { family: 'Roboto', generic: 'sans-serif', weights: [400, 500, 700], wght: [100, 900], italic: true },
  { family: 'Open Sans', generic: 'sans-serif', wght: [300, 800], italic: true },
  { family: 'Lato', generic: 'sans-serif', weights: [400, 700], statics: [100, 300, 400, 700, 900], italic: true },
  { family: 'Montserrat', generic: 'sans-serif', wght: [100, 900], italic: true },
  { family: 'Poppins', generic: 'sans-serif', statics: [100, 200, 300, 400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Raleway', generic: 'sans-serif', wght: [100, 900], italic: true },
  { family: 'Nunito', generic: 'sans-serif', wght: [200, 1000], italic: true },
  { family: 'Playfair Display', generic: 'serif', wght: [400, 900], italic: true },
  { family: 'Merriweather', generic: 'serif', weights: [400, 700], wght: [300, 900], italic: true },
  { family: 'Work Sans', generic: 'sans-serif', wght: [100, 900], italic: true },
  { family: 'DM Sans', generic: 'sans-serif', wght: [100, 1000], italic: true },
  { family: 'Manrope', generic: 'sans-serif', wght: [200, 800], italic: false },
  { family: 'Space Grotesk', generic: 'sans-serif', wght: [300, 700], italic: false },
  { family: 'Lora', generic: 'serif', wght: [400, 700], italic: true },
  { family: 'Bebas Neue', generic: 'sans-serif', statics: [400], italic: false },
  { family: 'Caveat', generic: 'sans-serif', wght: [400, 700], italic: false },
];

/** Generic entries of the Font menu: their label and the stack they write. */
export const GENERIC_CHOICES: ReadonlyArray<{ key: string; label: string; css: string }> = [
  { key: 'sans-serif', label: 'Sans-serif', css: 'sans-serif' },
  { key: 'serif', label: 'Serif', css: 'serif' },
  { key: 'monospace', label: 'Monospace', css: 'monospace' },
  { key: 'helvetica', label: 'Helvetica', css: formatFamilies(['Helvetica', 'Arial', 'sans-serif']) },
];

const lower = (s: string): string => s.trim().toLowerCase();

/** The Google font named `family`, if the catalog has it. */
export function googleFont(family: string): GoogleFont | undefined {
  return GOOGLE_FONTS.find((f) => lower(f.family) === lower(family));
}

/** The web-safe face named `family`, if it is one. */
export function webSafeFont(family: string): WebSafeFont | undefined {
  return WEB_SAFE_FONTS.find((f) => lower(f.family) === lower(family));
}

/** The stylesheet link of a Google font. */
export function googleFontHref(font: GoogleFont): string {
  return `https://fonts.googleapis.com/css2?family=${font.family.replace(/ +/g, '+')}:wght@${(font.weights ?? [400, 500, 600, 700]).join(';')}&display=swap`;
}

/** The deck face a Google font is carried as. */
export function googleFace(font: GoogleFont): DeckFace {
  return { family: font.family, href: googleFontHref(font) };
}

/** The stack a named face is written with: the face, then its generic family. */
export function faceStack(family: string, generic: Generic = webSafeFont(family)?.generic ?? googleFont(family)?.generic ?? 'sans-serif'): string {
  return formatFamilies([family, generic]);
}

/** The first family of a `font-family` value. */
export function firstFamily(value: string | undefined): string | null {
  return value ? (familyList(value)[0] ?? null) : null;
}

/** Adds every Google font's stylesheet to this document (for the menu's previews). */
export function loadMenuFonts(doc: Document = document): void {
  for (const font of GOOGLE_FONTS) {
    const href = googleFontHref(font);
    if (doc.head.querySelector(`link[href="${CSS.escape(href)}"]`)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    doc.head.appendChild(link);
  }
}

/* -------------------------------------------------------------------------- */
/* Weights                                                                     */
/* -------------------------------------------------------------------------- */

/** A weight with or without italics. */
export interface FontVariant {
  weight: number;
  italic: boolean;
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

/** A weight rounded to the nearest hundred, 100–900. */
export function normalizeWeight(weight: number): number {
  return Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
}

/** "Semibold", "Semibold italic", "Italic" (regular italic). */
export function variantLabel({ weight, italic }: FontVariant): string {
  const name = NAMES[normalizeWeight(weight)] ?? String(weight);
  if (!italic) return name;
  return normalizeWeight(weight) === 400 ? 'Italic' : `${name} italic`;
}

/** The menu key of a variant: `600`, `600i`. */
export function variantKey({ weight, italic }: FontVariant): string {
  return `${normalizeWeight(weight)}${italic ? 'i' : ''}`;
}

/** Reads {@link variantKey}. */
export function parseVariantKey(key: string): FontVariant | null {
  const m = /^(\d{3})(i?)$/.exec(key);
  return m ? { weight: Number(m[1]), italic: m[2] === 'i' } : null;
}

const both = (weights: readonly number[], italic: boolean): FontVariant[] => weights.flatMap((weight) => (italic ? [{ weight, italic: false }, { weight, italic: true }] : [{ weight, italic: false }]));

/**
 * The variants `family` offers: a Google font's range or statics, the four
 * of a web-safe face, else every weight with italics.
 */
export function familyVariants(family: string | null): FontVariant[] {
  const google = family ? googleFont(family) : undefined;
  if (google) {
    const weights = google.wght ? WEIGHTS.filter((w) => w >= google.wght![0] && w <= google.wght![1]) : [...(google.statics ?? [400])];
    return both(weights, google.italic);
  }
  const name = family ? lower(family) : '';
  if (webSafeFont(name) || name === 'helvetica' || name === 'helvetica neue') return both([400, 700], true);
  return both(WEIGHTS, true);
}

/** The weight menu: the family's variants, with `current` added when it is not one of them. */
export function variantChoices(family: string | null, current: FontVariant | null): FontVariant[] {
  const list = familyVariants(family);
  if (current && !list.some((v) => v.weight === normalizeWeight(current.weight) && v.italic === current.italic)) {
    list.push({ weight: normalizeWeight(current.weight), italic: current.italic });
  }
  return list.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
}
