/**
 * Fonts for the font picker: the Google Fonts catalog (loaded on demand from
 * `data/google-fonts.json`), search, stylesheet URLs, and which families
 * render on this computer.
 *
 * Everything here except {@link isFontAvailable}, {@link detectInstalledFonts}
 * and {@link ensureFontPreview} runs without a DOM.
 */

/** Google Fonts' categories, as CSS-ish names. */
export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

/** Categories in the order the picker groups them. */
export const FONT_CATEGORIES: readonly { value: FontCategory; label: string }[] = [
  { value: 'sans-serif', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: 'Handwriting' },
  { value: 'monospace', label: 'Monospace' },
];

/** A variable font axis and its range. */
export interface FontAxis {
  tag: string;
  min: number;
  max: number;
}

/** One family of the Google Fonts catalog. */
export interface GoogleFont {
  family: string;
  category: FontCategory;
  /** Upright weights (100…1000). */
  weights: number[];
  /** Italic weights; empty when the family has no italics. */
  italics: number[];
  /** Variable axes (`wght`, `wdth`, `opsz`…); empty for static families. */
  axes: FontAxis[];
  /** Popularity rank, 0 the most used. */
  rank: number;
}

/** The catalog file as stored: rows of `[family, category, weights, italics, axes?]`. */
export interface GoogleFontCatalogFile {
  source: string;
  categories: string[];
  families: (string | number)[][];
}

/** Digit-string weights ("3457", "a" for 1000) to numbers. */
function weightsOf(digits: string): number[] {
  return [...digits].map((d) => (d === 'a' ? 1000 : Number(d) * 100));
}

/** Expands the stored catalog into {@link GoogleFont} records, in popularity order. */
export function decodeFontCatalog(file: GoogleFontCatalogFile): GoogleFont[] {
  return file.families.map((row, rank) => {
    const [family, category, weights, italics, axes] = row as [string, number, string, string, string?];
    return {
      family,
      category: (file.categories[category] ?? 'sans-serif') as FontCategory,
      weights: weightsOf(weights),
      italics: weightsOf(italics),
      axes: axes
        ? axes.split(',').map((axis) => {
            const [tag, min, max] = axis.split(':');
            return { tag: tag!, min: Number(min), max: Number(max) };
          })
        : [],
      rank,
    };
  });
}

let catalogPromise: Promise<GoogleFont[]> | null = null;

/**
 * The Google Fonts catalog, loaded once on first use (the JSON is a separate
 * chunk, about 64 KB, 15 KB gzipped).
 */
export function loadGoogleFontCatalog(): Promise<GoogleFont[]> {
  // Bundlers (Vite) serve JSON as a JS module and the browser then rejects
  // a `type: 'json'` attribute; Node needs it. Try the plain import first.
  catalogPromise ??= import('./data/google-fonts.json')
    .catch(() => import('./data/google-fonts.json', { with: { type: 'json' } }))
    .then((module) => decodeFontCatalog((module as { default: GoogleFontCatalogFile }).default))
    .catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
}

/* --------------------------------- search --------------------------------- */

/** Lowercase, accents and punctuation dropped, spaces collapsed. */
export function normalizeFontName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How well `family` matches `query` (already normalized); higher is better,
 * 0 for no match. Exact > prefix > word prefix > substring > initials
 * ("ibm" for "IBM Plex Sans", "pf" for "Playfair").
 */
export function fontMatchScore(family: string, query: string): number {
  if (!query) return 1;
  const name = normalizeFontName(family);
  if (name === query) return 100;
  const compact = name.replace(/ /g, '');
  const q = query.replace(/ /g, '');
  if (name.startsWith(query) || compact.startsWith(q)) return 80;
  const words = name.split(' ');
  if (words.some((word) => word.startsWith(query))) return 60;
  if (query.includes(' ')) {
    // Every query word starts some word of the name, in order.
    const parts = query.split(' ');
    let at = 0;
    if (parts.every((part) => {
      while (at < words.length && !words[at]!.startsWith(part)) at++;
      return at++ < words.length;
    })) return 50;
  }
  if (compact.includes(q)) return 40;
  const initials = words.map((word) => word[0]).join('');
  if (q.length >= 2 && initials.startsWith(q)) return 30;
  return 0;
}

/** Options of {@link searchFonts}. */
export interface FontSearchOptions {
  category?: FontCategory | null;
  /** At most this many results. */
  limit?: number;
}

/**
 * Catalog families matching `query`, best match first, ties by popularity.
 * An empty query lists the catalog in popularity order.
 */
export function searchFonts(catalog: readonly GoogleFont[], query: string, options: FontSearchOptions = {}): GoogleFont[] {
  const q = normalizeFontName(query);
  const pool = options.category ? catalog.filter((font) => font.category === options.category) : catalog;
  const scored: { font: GoogleFont; score: number }[] = [];
  for (const font of pool) {
    const score = fontMatchScore(font.family, q);
    if (score > 0) scored.push({ font, score });
  }
  scored.sort((a, b) => b.score - a.score || a.font.rank - b.font.rank);
  const out = scored.map((entry) => entry.font);
  return options.limit === undefined ? out : out.slice(0, options.limit);
}

/** The catalog entry for `family` (case and spacing ignored). */
export function findGoogleFont(catalog: readonly GoogleFont[], family: string): GoogleFont | undefined {
  const key = normalizeFontName(family);
  return catalog.find((font) => normalizeFontName(font.family) === key);
}

/** The catalog entry of `family`, loading the catalog if needed. */
export async function lookupGoogleFont(family: string): Promise<GoogleFont | undefined> {
  return findGoogleFont(await loadGoogleFontCatalog(), family);
}

/* ------------------------------- stylesheets ------------------------------ */

const CSS2 = 'https://fonts.googleapis.com/css2';

/** Options of {@link googleFontStylesheetUrl}. */
export interface FontStylesheetOptions {
  /** Weights wanted; those the family lacks are dropped (default: 400 and 700, or what it has). */
  weights?: readonly number[];
  /** Also load italics. */
  italic?: boolean;
  /**
   * Request the whole `wght` range of a variable family instead of single
   * weights (one file serves every weight).
   */
  variable?: boolean;
  /** Only the glyphs of this text (for previews). */
  text?: string;
  /** `font-display` (default `swap`). */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

/** Family name as the css2 API writes it. */
const familyParam = (family: string) => encodeURIComponent(family.trim()).replace(/%20/g, '+');

/**
 * The Google Fonts CSS URL for `family`. With the catalog entry, the
 * request names only weights and italics the family has (the API rejects
 * others); without one it asks for the weights given (default 400).
 */
export function googleFontStylesheetUrl(family: string, options: FontStylesheetOptions = {}, font?: GoogleFont): string {
  const display = `display=${options.display ?? 'swap'}`;
  const text = options.text ? `&text=${encodeURIComponent(options.text)}` : '';
  const head = `${CSS2}?family=${familyParam(family)}`;
  const wght = font?.axes.find((axis) => axis.tag === 'wght');
  const italic = Boolean(options.italic) && (!font || font.italics.length > 0);
  if (options.variable && wght) {
    const range = `${wght.min}..${wght.max}`;
    const spec = italic ? `:ital,wght@0,${range};1,${range}` : `:wght@${range}`;
    return `${head}${spec}&${display}${text}`;
  }
  const available = font ? font.weights : null;
  const wanted = options.weights?.length ? [...options.weights] : available ? [400, 700] : [400];
  let upright = available ? wanted.filter((w) => available.includes(w)) : wanted;
  if (!upright.length && available) upright = [available.includes(400) ? 400 : available[0]!];
  upright = [...new Set(upright)].sort((a, b) => a - b);
  if (!italic) {
    // A family with only 400 needs no axis spec.
    if (upright.length === 1 && upright[0] === 400) return `${head}&${display}${text}`;
    return `${head}:wght@${upright.join(';')}&${display}${text}`;
  }
  const slanted = font ? upright.filter((w) => font.italics.includes(w)) : upright;
  const tuples = [...upright.map((w) => `0,${w}`), ...slanted.map((w) => `1,${w}`)];
  return `${head}:ital,wght@${tuples.join(';')}&${display}${text}`;
}

/** The CSS `font-family` value for a family with a generic fallback. */
export function fontFamilyCss(family: string, category?: FontCategory): string {
  const generic = category === 'serif' ? 'serif' : category === 'monospace' ? 'monospace' : category === 'handwriting' ? 'cursive' : 'sans-serif';
  if (GENERIC_FAMILIES.has(family.toLowerCase())) return family;
  const quoted = /^[a-z][a-z0-9-]*$/i.test(family) ? family : `"${family.replace(/"/g, '\\"')}"`;
  return `${quoted}, ${generic}`;
}

/* ------------------------------ availability ------------------------------ */

/** CSS generic families and keywords, which always render. */
export const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);

/**
 * Families commonly installed on macOS, Windows, Linux, iOS and Android.
 * {@link detectInstalledFonts} checks which of them render here.
 */
export const COMMON_SYSTEM_FONTS: readonly string[] = [
  'American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold', 'Avenir', 'Avenir Next',
  'Avenir Next Condensed', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bradley Hand', 'Calibri', 'Cambria', 'Candara', 'Chalkboard',
  'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS', 'Consolas', 'Constantia', 'Copperplate', 'Corbel', 'Courier', 'Courier New',
  'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Didot', 'Franklin Gothic Medium', 'Futura', 'Garamond', 'Geneva', 'Georgia',
  'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text', 'Impact', 'Iowan Old Style', 'Liberation Mono', 'Liberation Sans',
  'Liberation Serif', 'Lucida Console', 'Lucida Grande', 'Marker Felt', 'Menlo', 'Monaco', 'New York', 'Noteworthy', 'Optima',
  'Palatino', 'Palatino Linotype', 'Papyrus', 'Rockwell', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'SF Mono', 'SF Pro', 'SF Pro Display',
  'SF Pro Text', 'Skia', 'Snell Roundhand', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Ubuntu', 'Ubuntu Mono', 'Verdana', 'Zapfino',
];

/** Family names worth measuring: letters, digits, spaces, dashes. */
const MEASURABLE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
/** Text whose width differs between most faces. */
const SAMPLE = 'mmmmmmmmmmlli';

/**
 * True when `family` measures differently from both the monospace and the
 * serif fallback (a missing family falls back to them and measures the
 * same). `measure(font)` returns the width of a sample in a CSS `font`
 * shorthand.
 */
export function fontRenders(family: string, measure: (font: string) => number): boolean {
  const name = family.trim();
  if (GENERIC_FAMILIES.has(name.toLowerCase())) return true;
  if (!MEASURABLE.test(name)) return false;
  return ['monospace', 'serif'].some((fallback) => measure(`100px "${name}", ${fallback}`) !== measure(`100px ${fallback}`));
}

const availability = new Map<string, boolean>();
let measureContext: CanvasRenderingContext2D | null | undefined;

/** {@link fontRenders} measured on a canvas, cached per family. False outside a browser. */
export function isFontAvailable(family: string): boolean {
  const key = family.trim().toLowerCase();
  const hit = availability.get(key);
  if (hit !== undefined) return hit;
  if (measureContext === undefined) measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  const ctx = measureContext;
  if (!ctx) return GENERIC_FAMILIES.has(key);
  const available = fontRenders(family, (font) => {
    ctx.font = font;
    return ctx.measureText(SAMPLE).width;
  });
  availability.set(key, available);
  return available;
}

/**
 * Families that render here: those of `candidates` (default
 * {@link COMMON_SYSTEM_FONTS}) that are installed, plus every family the
 * page has loaded with `@font-face` (preview faces excluded). Sorted by name.
 */
export function detectInstalledFonts(candidates: readonly string[] = COMMON_SYSTEM_FONTS): string[] {
  const found = new Map<string, string>();
  for (const family of candidates) if (isFontAvailable(family)) found.set(family.toLowerCase(), family);
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.forEach((face) => {
      if (face.status !== 'loaded') return;
      const family = face.family.replace(/^["']|["']$/g, '');
      if (previewFamilies.has(family.toLowerCase())) return;
      if (!found.has(family.toLowerCase())) found.set(family.toLowerCase(), family);
    });
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/* -------------------------------- previews -------------------------------- */

const previewFamilies = new Set<string>();
const previewLinks = new Set<string>();

/**
 * Loads just the glyphs of `family`'s own name (a few KB) so a picker row
 * can show the name in its face. Adds one `<link>` per family, once.
 */
export function ensureFontPreview(family: string, font?: GoogleFont): void {
  if (typeof document === 'undefined') return;
  const href = googleFontStylesheetUrl(family, { weights: font?.weights.includes(400) ? [400] : font ? [font.weights[0]!] : [400], text: family, display: 'block' }, font);
  if (previewLinks.has(href)) return;
  previewLinks.add(href);
  previewFamilies.add(family.toLowerCase());
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.fontPreview = family;
  document.head.appendChild(link);
}
