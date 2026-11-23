import { GOOGLE_FONT_FILE_URL_PATTERN, GOOGLE_FONT_LIMITS, parseUnicodeRanges } from './google.ts';

/** One face a Google Fonts stylesheet declares: a weight, its woff2 file, and the characters it holds (none: all). */
export interface GoogleFontFace {
  weight: number;
  url: string;
  ranges: Array<[number, number]>;
}

/** Every weight is asked for first: a variable family then answers with one file per subset. */
export const GOOGLE_FONT_QUERY_WEIGHTS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export const googleFontStylesheetUrl = (family: string, weights: readonly number[] = GOOGLE_FONT_QUERY_WEIGHTS): string =>
  `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weights.join(';')}`;

const FONT_FACE_PROPERTIES = ['font-family', 'font-style', 'font-weight', 'src', 'unicode-range'] as const;
const FONT_FACE_PROPERTY_PATTERNS = FONT_FACE_PROPERTIES.map((name) => new RegExp(`(?:^|;)\\s*${name}\\s*:([^;]*)`, 'g'));

/** A property's value in a face block: `undefined` when it is missing, `null` when it is given twice. */
function uniqueFontFaceProperty(block: string, pattern: RegExp): string | null | undefined {
  const matches = [...block.matchAll(pattern)];
  return matches.length === 0 ? undefined : matches.length === 1 ? matches[0]![1]!.trim() : null;
}

/**
 * The faces of a css2 stylesheet that are the family's own, upright, whole-hundred weights, woff2 files on
 * fonts.gstatic.com: anything else in a block drops the block, and a sheet too long or not plain ASCII gives none.
 */
export function parseGoogleFontStylesheet(stylesheet: string, family: string): GoogleFontFace[] {
  if (stylesheet.length > GOOGLE_FONT_LIMITS.sheetChars || /[^\x09\x0a\x0d\x20-\x7e]/.test(stylesheet)) return [];
  const blocks = [...stylesheet.matchAll(/@font-face\s*\{([^{}]*)\}/g)];
  if (blocks.length > GOOGLE_FONT_LIMITS.blocks) return [];
  return blocks.flatMap(([, block = '']) => {
    const [name, style, weight, src, range] = FONT_FACE_PROPERTY_PATTERNS.map((pattern) => uniqueFontFaceProperty(block, pattern));
    if (name !== `'${family}'` || style !== 'normal' || typeof weight !== 'string' || typeof src !== 'string' || range === null) return [];
    const url = /^url\(([^()'"\s]+)\) format\('woff2'\)$/.exec(src)?.[1];
    const ranges = range === undefined ? [] : parseUnicodeRanges(range);
    return /^[1-9]00$/.test(weight) && url !== undefined && GOOGLE_FONT_FILE_URL_PATTERN.test(url) && ranges !== null
      ? [{ weight: Number(weight), url, ranges }]
      : [];
  });
}

/** The longest stylesheet a preview request reads. */
export const GOOGLE_FONT_PREVIEW_SHEET_BYTES = 65_536;
/** The largest preview file: one holding just the letters of the family's name. */
export const GOOGLE_FONT_PREVIEW_FILE_BYTES = 32_768;

/** One request for files that hold just the letters of each family's name, to show the name in its own face. */
export function googleFontPreviewUrl(families: readonly string[]): string {
  const text = [...new Set(families.join(''))].sort().join('');
  return `https://fonts.googleapis.com/css2?${families
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}`)
    .join('&')}&text=${encodeURIComponent(text)}`;
}

/** The file a preview stylesheet gives each family it names. */
export function parseGoogleFontPreviewSheet(stylesheet: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const [, block = ''] of stylesheet.matchAll(/@font-face\s*\{([^}]{0,600})\}/g)) {
    const family = /font-family:\s*'([^']{1,40})'/.exec(block)?.[1];
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[\w/?=&.%~-]{1,400})\)/.exec(block)?.[1];
    if (family !== undefined && url !== undefined && !files.has(family)) files.set(family, url);
  }
  return files;
}
