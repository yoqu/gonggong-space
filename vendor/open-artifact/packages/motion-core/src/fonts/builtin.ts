/** The typeface slots a film's text wears: `kit.fonts.<slot>` in code, `var(--<slot>)` in css. */
export const FONT_SLOTS = ['sans', 'serif', 'mono', 'display'] as const;
export type FontSlot = (typeof FONT_SLOTS)[number];

export const isFontSlot = (value: unknown): value is FontSlot => typeof value === 'string' && (FONT_SLOTS as readonly string[]).includes(value);

/** The family names the stage gives each slot's stack. */
export const FILM_FONT_FAMILY_NAMES: Readonly<Record<FontSlot, string>> = {
  sans: 'Film Sans',
  serif: 'Film Serif',
  mono: 'Film Mono',
  display: 'Film Display',
};

/** One file of a built-in typeface: a weight range (`"400 600"`) and, for an italic face, its style. */
export interface BuiltinFontFile {
  file: string;
  weight: string;
  style?: 'italic';
}

/** A typeface the player carries (the files are the type's own `fonts/`). */
export interface BuiltinFont {
  id: string;
  /** Its Google Fonts slug when that differs from the id. */
  slug?: string;
  name: string;
  /** The weights it has, as people read them ("500 to 800"). */
  weights: string;
  /** Average advance of a letter, in ems: how a fallback is matched in width. */
  width?: number;
  /** False when its figures are not tabular. */
  figures?: boolean;
  serif?: boolean;
  files: readonly BuiltinFontFile[];
}

/** The typefaces a film's sans text may fall back to while its own loads. */
export const BUILTIN_FALLBACK_FONTS: readonly BuiltinFont[] = [
  {
    id: 'manrope',
    name: 'Manrope',
    width: 0.483,
    weights: '500 to 800',
    figures: false,
    files: [
      { file: 'Manrope-500.woff2', weight: '1 549' },
      { file: 'Manrope-600.woff2', weight: '550 649' },
      { file: 'Manrope-700.woff2', weight: '650 749' },
      { file: 'Manrope-800.woff2', weight: '750 1000' },
    ],
  },
  {
    id: 'instrument',
    slug: 'instrument-sans',
    name: 'Instrument Sans',
    width: 0.475,
    weights: '400 to 700',
    files: [
      { file: 'InstrumentSansVar.woff2', weight: '400 600' },
      { file: 'InstrumentSans-700.woff2', weight: '601 1000' },
    ],
  },
  {
    id: 'space',
    slug: 'space-grotesk',
    name: 'Space Grotesk',
    width: 0.497,
    weights: '400 to 700',
    files: [
      { file: 'SpaceGrotesk-400.woff2', weight: '1 449' },
      { file: 'SpaceGrotesk-500.woff2', weight: '450 549' },
      { file: 'SpaceGrotesk-600.woff2', weight: '550 649' },
      { file: 'SpaceGrotesk-700.woff2', weight: '650 1000' },
    ],
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    width: 0.486,
    weights: '400 to 700',
    figures: false,
    serif: true,
    files: [{ file: 'FrauncesText.woff2', weight: '400 700' }],
  },
];

/** Every typeface the player carries. */
export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  ...BUILTIN_FALLBACK_FONTS,
  {
    id: 'plus-jakarta-sans',
    name: 'Plus Jakarta Sans',
    width: 0.484,
    weights: '500 to 700',
    files: [
      { file: 'PlusJakartaSans-500.woff2', weight: '1 549' },
      { file: 'PlusJakartaSans-600.woff2', weight: '550 649' },
      { file: 'PlusJakartaSans-700.woff2', weight: '650 1000' },
    ],
  },
  {
    id: 'inter-display',
    name: 'Inter Display',
    weights: '600, 800, 900',
    files: [
      { file: 'InterDisplay-600.woff2', weight: '1 699' },
      { file: 'InterDisplay-800.woff2', weight: '700 849' },
      { file: 'InterDisplay-900.woff2', weight: '850 1000' },
    ],
  },
  {
    id: 'fraunces-display',
    name: 'Fraunces Display',
    weights: 'one, light',
    figures: false,
    serif: true,
    files: [
      { file: 'FrauncesOpsz360.woff2', weight: '1 1000' },
      { file: 'FrauncesOpsz360-i.woff2', weight: '1 1000', style: 'italic' },
    ],
  },
  {
    id: 'shantell-sans',
    name: 'Shantell Sans',
    weights: '480, 650',
    figures: false,
    files: [
      { file: 'ShantellSans-480.woff2', weight: '1 599' },
      { file: 'ShantellSans-650i.woff2', weight: '600 1000' },
    ],
  },
  {
    id: 'dm-mono',
    name: 'DM Mono',
    weights: '500',
    files: [{ file: 'DMMono-500.woff2', weight: '1 1000' }],
  },
  {
    id: 'departure-mono',
    name: 'Departure Mono',
    weights: '400',
    files: [{ file: 'DepartureMono-400.woff2', weight: '1 1000' }],
  },
];

export const builtinFontSlug = (font: Pick<BuiltinFont, 'id' | 'slug'>): string => font.slug ?? font.id;

/** Every built-in typeface by the name a film's code gives it (`"or": "manrope"`). */
export const BUILTIN_FONT_SLUGS: readonly string[] = BUILTIN_FONTS.map(builtinFontSlug);

/** The slots that hold a film's running text; `display` falls back to `sans`. */
export const PRIMARY_FONT_SLOTS: readonly FontSlot[] = ['sans', 'serif', 'mono'];

/**
 * The line box every built-in face is declared with (ascent and descent, in percent of the em), so that a line is as
 * tall in one typeface as in another.
 */
export const FONT_BOX_METRICS: readonly [number, number] = [97, 24];

/** How much wider than the film's own sans a stand-in may run. */
export const FALLBACK_FONT_WIDTH_TOLERANCE = 1.02;

/** A font name compared loosely: lower case, letters and digits only. */
export const normalizeBuiltinFontId = (input: string): string => input.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The built-in typeface a name (its id or slug, loosely) means, else `undefined`. */
export function resolveFontFamily(name: unknown): BuiltinFont | undefined {
  if (typeof name !== 'string' || name.length > 40 || /[^\x20-\x7e]/.test(name)) return undefined;
  const key = normalizeBuiltinFontId(name);
  return BUILTIN_FONTS.find((font) => [font.id, builtinFontSlug(font)].some((id) => normalizeBuiltinFontId(id) === key));
}

/** The built-in typeface a slot names, directly or by an object's `family`. */
export function resolveBuiltinFont(slot: unknown): BuiltinFont | undefined {
  return resolveFontFamily(typeof slot === 'object' && slot !== null && !Array.isArray(slot) ? (slot as { family?: unknown }).family : slot);
}

const looseFamilyKey = (input: string): string => input.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when a slot (a name or `{family}`) names a built-in typeface by its id, slug or name, so nothing is fetched for it. */
export function isBuiltinFontRequest(slot: unknown): boolean {
  const family = typeof slot === 'object' && slot !== null ? (slot as { family?: unknown }).family : slot;
  if (typeof family !== 'string') return false;
  const key = looseFamilyKey(family);
  return BUILTIN_FONTS.some((font) => [font.id, builtinFontSlug(font), font.name].some((name) => looseFamilyKey(name) === key));
}

/** The typefaces the Font panel offers: none when the film brings font files of its own. */
export function availableBuiltinFonts(assets: ReadonlyArray<{ mime: string }>): readonly BuiltinFont[] {
  return assets.some((asset) => asset.mime.startsWith('font/')) ? [] : BUILTIN_FONTS;
}

/**
 * The stand-ins a film's sans may take without changing how it reads: none for a film with its own font files or a
 * sans of unknown width; no typeface without tabular figures for a film that asks for them, no serif for a film that
 * sets serif text, none wider than its current sans.
 */
export function compatibleFallbackFonts(
  modules: ReadonlyArray<{ kind: string; text: string }>,
  assets: ReadonlyArray<{ mime: string }>,
  current: BuiltinFont | null = null,
): BuiltinFont[] {
  if (assets.some((asset) => asset.mime.startsWith('font/')) || (current !== null && current.width === undefined)) return [];
  const anyCode = (pattern: RegExp): boolean => modules.some((module) => ['js', 'css', 'html'].includes(module.kind) && pattern.test(module.text));
  const tabular = anyCode(/tabular-nums|["']tnum["']/);
  const serif = anyCode(/\.serif\b|--serif\b/);
  return BUILTIN_FALLBACK_FONTS.filter(
    (font) =>
      font !== current &&
      !(tabular && font.figures === false) &&
      !(serif && font.serif === true) &&
      !(current !== null && current.width !== undefined && font.width !== undefined && font.width > current.width * FALLBACK_FONT_WIDTH_TOLERANCE),
  );
}
