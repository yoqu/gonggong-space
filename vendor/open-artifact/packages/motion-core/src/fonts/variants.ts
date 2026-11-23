import { FONT_WEIGHT_WORDS, ITALIC_FONT_WEIGHT_WORDS } from './words.ts';

export type FontGeneric = 'sans' | 'serif' | 'mono';

/** What the style menus know of a family: its kind, its weight axis or static weights, and whether it has italics. */
export interface FontFamilyMetadata {
  family: string;
  generic: FontGeneric;
  /** The weights fetched for it by default. */
  weights?: readonly number[];
  /** A variable family's weight range. */
  wght?: readonly [number, number];
  statics?: readonly number[];
  italic?: boolean;
}

export const SYSTEM_FONT_FAMILIES: readonly FontFamilyMetadata[] = [
  { family: 'Arial', generic: 'sans' },
  { family: 'Helvetica', generic: 'sans' },
  { family: 'Georgia', generic: 'serif' },
  { family: 'Times New Roman', generic: 'serif' },
  { family: 'Garamond', generic: 'serif' },
  { family: 'Courier New', generic: 'mono' },
  { family: 'Verdana', generic: 'sans' },
  { family: 'Tahoma', generic: 'sans' },
  { family: 'Trebuchet MS', generic: 'sans' },
];

/** The Google Fonts families the Font panel offers by default. */
export const COMMON_GOOGLE_FONT_FAMILIES: readonly FontFamilyMetadata[] = [
  { family: 'Inter', generic: 'sans', wght: [100, 900], italic: true },
  { family: 'Roboto', generic: 'sans', weights: [400, 500, 700], wght: [100, 900], italic: true },
  { family: 'Open Sans', generic: 'sans', wght: [300, 800], italic: true },
  { family: 'Lato', generic: 'sans', weights: [400, 700], statics: [100, 300, 400, 700, 900], italic: true },
  { family: 'Montserrat', generic: 'sans', wght: [100, 900], italic: true },
  { family: 'Poppins', generic: 'sans', statics: [100, 200, 300, 400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Raleway', generic: 'sans', wght: [100, 900], italic: true },
  { family: 'Nunito', generic: 'sans', wght: [200, 1000], italic: true },
  { family: 'Playfair Display', generic: 'serif', wght: [400, 900], italic: true },
  { family: 'Merriweather', generic: 'serif', weights: [400, 700], wght: [300, 900], italic: true },
  { family: 'Work Sans', generic: 'sans', wght: [100, 900], italic: true },
  { family: 'DM Sans', generic: 'sans', wght: [100, 1000], italic: true },
  { family: 'Manrope', generic: 'sans', wght: [200, 800], italic: false },
  { family: 'Space Grotesk', generic: 'sans', wght: [300, 700], italic: false },
  { family: 'Lora', generic: 'serif', wght: [400, 700], italic: true },
  { family: 'Bebas Neue', generic: 'sans', weights: [400], statics: [400], italic: false },
  { family: 'Caveat', generic: 'sans', wght: [400, 700], italic: false },
];

export const COMMON_GOOGLE_FONT_NAMES: readonly string[] = COMMON_GOOGLE_FONT_FAMILIES.map((metadata) => metadata.family);

const commonByName = new Map(COMMON_GOOGLE_FONT_FAMILIES.map((metadata) => [metadata.family.toLowerCase(), metadata] as const));
const systemNames = new Set(SYSTEM_FONT_FAMILIES.map((metadata) => metadata.family.toLowerCase()));

export const GENERIC_FONT_FAMILY_PATTERN = /^(?:ui-)?(?:serif|sans-serif|monospace|rounded|cursive|fantasy|system-ui|math|emoji|fangsong)$/;
export const STANDARD_FONT_WEIGHTS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** A weight and whether it is italic: one entry of the weight menu. */
export interface FontVariant {
  weight: number;
  italic: boolean;
}

export interface FontVariantOption {
  /** `"400"` or `"400i"`. */
  value: string;
  label: string;
}

const SYSTEM_FONT_VARIANTS: readonly FontVariant[] = [
  { weight: 400, italic: false },
  { weight: 400, italic: true },
  { weight: 700, italic: false },
  { weight: 700, italic: true },
];

/** Every weight, upright and italic, for a family the menus know nothing of. */
export const ALL_FONT_VARIANTS: readonly FontVariant[] = STANDARD_FONT_WEIGHTS.flatMap((weight) => [
  { weight, italic: false },
  { weight, italic: true },
]);

export const findGoogleFontMetadata = (family: string): FontFamilyMetadata | undefined => commonByName.get(family.trim().toLowerCase());

export const normalizeFontWeight = (weight: number): number => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));

export const formatFontVariant = (weight: number, italic: boolean): string =>
  (italic ? ITALIC_FONT_WEIGHT_WORDS : FONT_WEIGHT_WORDS)[normalizeFontWeight(weight)] ?? `${weight}${italic ? ' italic' : ''}`;

export const encodeFontVariant = (weight: number, italic: boolean): string => `${normalizeFontWeight(weight)}${italic ? 'i' : ''}`;

export function decodeFontVariant(variant: string): FontVariant | undefined {
  const match = /^([1-9]00)(i?)$/.exec(variant);
  return match === null ? undefined : { weight: Number(match[1]), italic: match[2] === 'i' };
}

/** The first family of a css font-family list, unquoted. */
export const firstCssFontFamily = (fontFamily: string): string =>
  (fontFamily.split(',')[0] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();

/** The variants a family is known to have: a common Google family's, or the system's four; `undefined` otherwise. */
export function getKnownFontVariants(family: string): FontVariant[] | undefined {
  const primary = firstCssFontFamily(family);
  const metadata = findGoogleFontMetadata(primary);
  if (metadata !== undefined) {
    const wght = metadata.wght;
    const weights = wght !== undefined ? STANDARD_FONT_WEIGHTS.filter((weight) => weight >= wght[0] && weight <= wght[1]) : [...(metadata.statics ?? [400])];
    return weights.flatMap((weight) =>
      metadata.italic === true
        ? [
            { weight, italic: false },
            { weight, italic: true },
          ]
        : [{ weight, italic: false }],
    );
  }
  const name = primary.toLowerCase();
  if (systemNames.has(name) || name === 'helvetica neue' || GENERIC_FONT_FAMILY_PATTERN.test(name) || /^(?:-apple-system|blinkmacsystemfont)$/.test(name))
    return [...SYSTEM_FONT_VARIANTS];
  return undefined;
}

export const getFontVariants = (family: string, fallback?: readonly FontVariant[]): readonly FontVariant[] =>
  getKnownFontVariants(family) ?? (fallback !== undefined && fallback.length > 0 ? fallback : ALL_FONT_VARIANTS);

export const sortFontVariants = (variants: readonly FontVariant[]): FontVariant[] =>
  [...variants].sort((left, right) => left.weight - right.weight || Number(left.italic) - Number(right.italic));

/** The weight menu's options, the current variant first when the family lacks it. */
export function makeFontVariantOptions(variants: readonly FontVariant[], current: FontVariant | undefined): FontVariantOption[] {
  const sorted = sortFontVariants(variants);
  if (current !== undefined && !sorted.some((variant) => variant.weight === normalizeFontWeight(current.weight) && variant.italic === current.italic))
    sorted.unshift({ weight: normalizeFontWeight(current.weight), italic: current.italic });
  return sorted.map((variant) => ({ value: encodeFontVariant(variant.weight, variant.italic), label: formatFontVariant(variant.weight, variant.italic) }));
}

/** A css font-family that is only a generic name drops out of a label. */
export const hideGenericFontFamily = (family: string): string =>
  GENERIC_FONT_FAMILY_PATTERN.test(family.toLowerCase()) || /^(?:-apple-system|blinkmacsystemfont)$/i.test(family) ? '' : family;
