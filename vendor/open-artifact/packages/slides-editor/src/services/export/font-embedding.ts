/**
 * Embedding the deck's fonts in a PowerPoint file ("PowerPoint, embedded
 * fonts").
 *
 * PowerPoint embeds TrueType faces only, up to four per family (regular,
 * bold, italic, bold italic). For each family the exported text uses that
 * the deck declares as a face:
 *
 * - a Google Fonts family is looked up in the Fontsource catalog (which
 *   republishes Google Fonts as static TrueType cuts per unicode subset,
 *   with each family's license): only families under a license that allows
 *   embedding (OFL, Apache, UFL, MIT, CC0) are carried, regular and bold,
 *   plus the italics when the deck sets the family in italic, from the
 *   subset that covers most of the family's text;
 * - an uploaded font file is carried as it is when it is TrueType.
 *
 * Every face must also allow embedding itself (OS/2 `fsType`), and must not
 * be a variable font. The families with the most text get the size budget
 * first; what is left out is reported per family as an export note.
 *
 * Why Fontsource: Google Fonts serves browsers WOFF2 only (the format is
 * chosen by user agent, which a page cannot set), and this editor ships no
 * WOFF2 decoder (Brotli plus glyph transforms). Fontsource's CDN serves the
 * same families as plain `.ttf`, cross-origin readable. A WOFF2 decoder can
 * be passed in (`unpackWoff2`) for files that come as WOFF2.
 *
 * Network access goes through the injected `fetchJson` / `fetchBytes`, so
 * the selection logic is unit-tested without a network.
 */

import { parseUnicodeRange } from '@open-artifact/export-kit';
import { fetchRetrying } from './assets.ts';
import { fontClass, fontFamilies } from './css.ts';
import { containsGlyph, fsTypeAllowsEmbedding, panoseHex, readFontTables, wrapEot, type FontTables } from './font-tables.ts';
import type { ExportNotes } from './notes.ts';
import type { PptxSlide, TextBody, TextRun } from './ooxml.ts';

/** The four faces PowerPoint embeds per family. */
export type EmbeddedStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';

/** The order faces are listed in `p:embeddedFont`. */
export const EMBEDDED_STYLES: readonly EmbeddedStyle[] = ['regular', 'bold', 'italic', 'boldItalic'];

/** One face to write into the package. */
export interface EmbeddedFont {
  typeface: string;
  style: EmbeddedStyle;
  covered?: ReadonlySet<number>;
  /** EOT-wrapped TrueType (`.fntdata`). */
  data: Uint8Array;
  panose?: string;
  pitchFamily?: number;
  charset?: number;
}

/** What became of one family. */
export type FontOutcome = 'carried' | 'licence' | 'variable' | 'format' | 'budget' | 'slow' | 'fetch';

export interface FamilyOutcome {
  family: string;
  outcome: FontOutcome;
  /** Budget: left out after families with more text went in. */
  afterOthers?: boolean;
}

/** The result of embedding. */
export interface FontEmbedding {
  fonts: EmbeddedFont[];
  families: FamilyOutcome[];
  /** Carried, but from a subset that misses some of the family's characters. */
  partial: string[];
  /** Carried, but some of its styles could not be. */
  stylesMissing: string[];
  /** License lines of the carried families, for the file's description. */
  notices: string[];
  /** Bytes of font data carried. */
  bytes: number;
}

/** How one family is used in the exported text. */
export interface FontUse {
  family: string;
  codePoints: Set<number>;
  italic: boolean;
  /** Characters set in it (the budget goes to the most used first). */
  chars: number;
}

/** A face the deck declares (from `deck.json` `faces`). */
export interface DeclaredFace {
  family: string;
  href?: string;
  src?: string;
}

export interface EmbeddingOptions {
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>;
  fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array>;
  /** Reads an uploaded font file (`/_blob/…`, `project/…`); null when it cannot be read. */
  readFile?(src: string): Promise<Uint8Array | null>;
  unpackWoff2?(bytes: Uint8Array): Promise<Uint8Array>;
  /** Most bytes of font data carried. */
  budget?: number;
  /** Give up on fetching after this long, ms. */
  deadlineMs?: number;
}

/** Default size budget of embedded fonts. */
export const FONT_BUDGET = 8 * 1024 * 1024;
/** Default time allowed for fetching fonts. */
const DEADLINE_MS = 20_000;
/** Licenses (SPDX-style ids) that allow embedding a font in a document. */
const EMBEDDABLE_LICENCE = /^(OFL|Apache|UFL|MIT|CC0|CC-BY|Ubuntu)/i;

export const FONTSOURCE_API = 'https://api.fontsource.org/v1/fonts/';
export const FONTSOURCE_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts/';

/* -------------------------------------------------------------------------- */
/* Use                                                                         */
/* -------------------------------------------------------------------------- */

function* textRuns(slides: readonly PptxSlide[]): Generator<TextRun> {
  function* runs(body?: TextBody): Generator<TextRun> {
    for (const paragraph of body?.paragraphs ?? []) yield* paragraph.runs;
  }
  for (const slide of slides) {
    for (const element of slide.elements) {
      if (element.type === 'shape') yield* runs(element.text);
      if (element.type === 'table') {
        for (const row of element.rows) for (const cell of row.cells) yield* runs(cell.text);
      }
    }
  }
}

/** Markers drawn in their paragraph's font, as runs of that font. */
function* markerRuns(slides: readonly PptxSlide[]): Generator<TextRun> {
  function* markers(body?: TextBody): Generator<TextRun> {
    for (const paragraph of body?.paragraphs ?? []) {
      const bullet = paragraph.bullet;
      if (bullet?.type !== 'char' || !bullet.ownFont) continue;
      const first = paragraph.runs.find((run) => run.font && !run.lineBreak);
      if (first) yield { text: bullet.char, size: first.size, font: first.font };
    }
  }
  for (const slide of slides) {
    for (const element of slide.elements) {
      if (element.type === 'shape') yield* markers(element.text);
      if (element.type === 'table') {
        for (const row of element.rows) for (const cell of row.cells) yield* markers(cell.text);
      }
    }
  }
}

/** Every family the exported text is set in, with its characters and italic use. */
export function collectFontUses(slides: readonly PptxSlide[]): Map<string, FontUse> {
  const uses = new Map<string, FontUse>();
  for (const run of [...textRuns(slides), ...markerRuns(slides)]) {
    if (!run.font || run.lineBreak) continue;
    const key = run.font.toLowerCase();
    let use = uses.get(key);
    if (!use) {
      use = { family: run.font, codePoints: new Set(), italic: false, chars: 0 };
      uses.set(key, use);
    }
    for (const char of run.text) {
      use.codePoints.add(char.codePointAt(0)!);
      use.chars++;
    }
    if (run.italic) use.italic = true;
  }
  return uses;
}

/** PowerPoint has separate Latin and East Asian faces. Use the embedded face
 * for CJK only if every cut carries the run's CJK characters. */
export function setEastAsianFonts(slides: readonly PptxSlide[], fonts: readonly EmbeddedFont[]): void {
  for (const run of textRuns(slides)) {
    if (!run.font) continue;
    const cjk = run.text.match(/[\p{Script=Han}\p{Script=Hangul}\p{Script=Katakana}\p{Script=Hiragana}]/gu);
    if (!cjk) continue;
    const cuts = fonts.filter(font => font.typeface.toLowerCase() === run.font!.toLowerCase());
    const style = styleOf(run.bold ? 700 : 400, run.italic === true);
    const cut = cuts.find(font => font.style === style) ?? cuts.find(font => font.style === 'regular');
    if (cut && cjk.every(char => cut.covered?.has(char.codePointAt(0)!))) continue;
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(run.text) || /\bJP\b/i.test(run.font)) run.eastAsianFont = 'Yu Gothic';
    else if (/\p{Script=Hangul}/u.test(run.text) || /\bKR\b/i.test(run.font)) run.eastAsianFont = 'Malgun Gothic';
    else run.eastAsianFont = /\b(TC|HK)\b/i.test(run.font) ? 'Microsoft JhengHei' : 'Microsoft YaHei';
  }
}

/** The Fontsource id of a family: lower case, runs of other characters as `-`. */
export function fontsourceId(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The Google family a face links (its `css2?family=` name), else its own family name. */
export function googleFamily(face: DeclaredFace): string {
  if (face.href) {
    try {
      const name = new URL(face.href).searchParams.get('family');
      if (name) return name.split(':')[0]!.trim();
    } catch {
      // Not a URL: use the family name.
    }
  }
  return face.family;
}

/** True when a license id allows embedding. */
export function licenceAllowsEmbedding(licence: string | undefined): boolean {
  return Boolean(licence && EMBEDDABLE_LICENCE.test(licence.trim()));
}

/** PowerPoint's pitch-and-family byte for a family name (variable pitch, Roman/Swiss/Modern). */
export function pitchFamilyOf(family: string): number {
  const kind = fontClass(fontFamilies(family));
  return kind === 'serif' ? 0x12 : kind === 'mono' ? 0x31 : 0x22;
}

/** The style a cut embeds as. */
export function styleOf(weight: number, italic: boolean): EmbeddedStyle {
  if (weight >= 600) return italic ? 'boldItalic' : 'bold';
  return italic ? 'italic' : 'regular';
}

/* -------------------------------------------------------------------------- */
/* Fontsource catalog                                                          */
/* -------------------------------------------------------------------------- */

/** What the catalog says about a family. */
export interface CatalogFamily {
  id: string;
  family: string;
  licence?: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  /** `unicode-range` per subset. */
  unicodeRange: Record<string, string>;
  /** `.ttf` address of a cut, when the catalog lists it. */
  ttf(weight: number, style: 'normal' | 'italic', subset: string): string;
}

/** Reads a Fontsource `/v1/fonts/<id>` answer (null when it is not one). */
export function readCatalogFamily(json: unknown, id: string): CatalogFamily | null {
  if (typeof json !== 'object' || json === null) return null;
  const data = json as Record<string, unknown>;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  const subsets = strings(data.subsets);
  if (subsets.length === 0) return null;
  const weights = Array.isArray(data.weights) ? data.weights.map(Number).filter((n) => Number.isFinite(n)) : [];
  const licenceValue = data.license;
  const licence =
    typeof licenceValue === 'string'
      ? licenceValue
      : typeof licenceValue === 'object' && licenceValue !== null
        ? String((licenceValue as Record<string, unknown>).type ?? (licenceValue as Record<string, unknown>).id ?? '') || undefined
        : undefined;
  const ranges: Record<string, string> = {};
  if (typeof data.unicodeRange === 'object' && data.unicodeRange !== null) {
    for (const [key, value] of Object.entries(data.unicodeRange as Record<string, unknown>)) if (typeof value === 'string') ranges[key] = value;
  }
  const variants = typeof data.variants === 'object' && data.variants !== null ? (data.variants as Record<string, unknown>) : {};
  return {
    id,
    family: typeof data.family === 'string' ? data.family : id,
    licence,
    subsets,
    weights,
    styles: strings(data.styles),
    unicodeRange: ranges,
    ttf(weight, style, subset) {
      const listed = (((variants[String(weight)] as Record<string, unknown> | undefined)?.[style] as Record<string, unknown> | undefined)?.[subset] as
        | { url?: Record<string, unknown> }
        | undefined)?.url?.ttf;
      return typeof listed === 'string' && /^https:\/\//.test(listed) ? listed : `${FONTSOURCE_CDN}${id}@latest/${subset}-${weight}-${style}.ttf`;
    },
  };
}

/** The subset covering most of `codePoints` (ties: the catalog's order, so `latin` first), and whether it misses some. */
export function pickSubset(family: Pick<CatalogFamily, 'subsets' | 'unicodeRange'>, codePoints: ReadonlySet<number>): { subset: string; partial: boolean } | null {
  const ranges = family.subsets.map((subset) => ({ subset, ranges: parseUnicodeRange(family.unicodeRange[subset]) }));
  if (ranges.length === 0) return null;
  const covers = (r: [number, number][] | null, point: number): boolean => !r || r.some(([a, b]) => point >= a && point <= b);
  // Only characters some subset has count (a CJK character in a Latin family is not "missing" from the choice).
  const wanted = [...codePoints].filter((point) => point > 0x20 && ranges.some((entry) => covers(entry.ranges, point)));
  // Prefer `latin` on a tie: it is what most decks need and what the catalog lists first.
  const ordered = [...ranges].sort((a, b) => (a.subset === 'latin' ? -1 : b.subset === 'latin' ? 1 : 0));
  let best: { subset: string; covered: number } | null = null;
  for (const entry of ordered) {
    const covered = wanted.filter((point) => covers(entry.ranges, point)).length;
    if (!best || covered > best.covered) best = { subset: entry.subset, covered };
  }
  return best ? { subset: best.subset, partial: best.covered < wanted.length } : null;
}

/** The cuts to embed for a family: regular and bold, plus italics when used; only cuts the family has. */
export function wantedCuts(family: Pick<CatalogFamily, 'weights' | 'styles'>, italic: boolean): { weight: number; style: 'normal' | 'italic' }[] {
  const out: { weight: number; style: 'normal' | 'italic' }[] = [];
  const styles: ('normal' | 'italic')[] = italic && family.styles.includes('italic') ? ['normal', 'italic'] : ['normal'];
  for (const style of styles) {
    for (const weight of [400, 700]) if (family.weights.length === 0 || family.weights.includes(weight)) out.push({ weight, style });
  }
  if (out.length === 0 && family.weights.length) {
    // No regular or bold: the cut nearest 400 stands in as regular.
    const nearest = [...family.weights].sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0]!;
    out.push({ weight: nearest, style: 'normal' });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Embedding                                                                   */
/* -------------------------------------------------------------------------- */

type Attempt = { style: EmbeddedStyle; data: Uint8Array; info: FontTables; partial: boolean } | { style: EmbeddedStyle; failed: Exclude<FontOutcome, 'carried' | 'budget'> };

/** Checks fetched bytes: TrueType, not variable, embedding allowed. Unpacks WOFF2 when it can. */
async function vetFace(bytes: Uint8Array, unpack: EmbeddingOptions['unpackWoff2']): Promise<{ data: Uint8Array; info: FontTables } | { failed: 'format' | 'variable' | 'licence' }> {
  let data = bytes;
  let info = readFontTables(data);
  if (info.flavor === 'woff2' && unpack) {
    try {
      data = await unpack(data);
      info = readFontTables(data);
    } catch {
      return { failed: 'format' };
    }
  }
  if (info.flavor !== 'truetype' || !info.tables.includes('glyf') || !info.os2) return { failed: 'format' };
  if (info.tables.includes('fvar')) return { failed: 'variable' };
  if (!fsTypeAllowsEmbedding(info.os2.fsType)) return { failed: 'licence' };
  if (info.extent !== undefined && info.extent < data.byteLength) data = data.subarray(0, info.extent);
  return { data, info };
}

/** The most telling reason a family with no usable face was left out. */
function worstOutcome(failed: readonly FontOutcome[]): FontOutcome {
  return (['licence', 'variable', 'format', 'slow'] as const).find((reason) => failed.includes(reason)) ?? 'fetch';
}

/**
 * Fetches and checks the faces of every used family the deck declares, and
 * picks what fits the budget (most used families first).
 */
export async function embedDeckFonts(uses: ReadonlyMap<string, FontUse>, faces: readonly DeclaredFace[], options: EmbeddingOptions): Promise<FontEmbedding> {
  const result: FontEmbedding = { fonts: [], families: [], partial: [], stylesMissing: [], notices: [], bytes: 0 };
  const declared = new Map(faces.map((face) => [face.family.toLowerCase(), face]));
  const wanted = [...uses.values()].filter((use) => declared.has(use.family.toLowerCase()));
  if (wanted.length === 0) return result;

  const overall = new AbortController();
  const timer = setTimeout(() => overall.abort(), options.deadlineMs ?? DEADLINE_MS);
  const budget = options.budget ?? FONT_BUDGET;

  const gather = async (use: FontUse): Promise<{ use: FontUse; attempts: Attempt[]; licence?: string; catalogFailed?: FontOutcome }> => {
    const face = declared.get(use.family.toLowerCase())!;
    if (!face.href && face.src) {
      // An uploaded file: one cut, carried as it is when it may be.
      const bytes = options.readFile ? await options.readFile(face.src).catch(() => null) : null;
      if (!bytes) return { use, attempts: [], catalogFailed: 'fetch' };
      const vetted = await vetFace(bytes, options.unpackWoff2);
      if ('failed' in vetted) return { use, attempts: [], catalogFailed: vetted.failed };
      const style = styleOf(vetted.info.os2!.weightClass, vetted.info.os2!.italic);
      return { use, attempts: [{ style, data: vetted.data, info: vetted.info, partial: false }] };
    }
    const id = fontsourceId(googleFamily(face));
    let family: CatalogFamily | null = null;
    try {
      family = readCatalogFamily(await options.fetchJson(`${FONTSOURCE_API}${id}`, overall.signal), id);
    } catch {
      family = null;
    }
    if (!family) return { use, attempts: [], catalogFailed: overall.signal.aborted ? 'slow' : 'fetch' };
    if (!licenceAllowsEmbedding(family.licence)) return { use, attempts: [], catalogFailed: 'licence' };
    const subset = pickSubset(family, use.codePoints);
    if (!subset) return { use, attempts: [], catalogFailed: 'fetch' };
    const attempts = await Promise.all(
      wantedCuts(family, use.italic).map(async (cut): Promise<Attempt> => {
        const style = styleOf(cut.weight, cut.style === 'italic');
        try {
          const bytes = await options.fetchBytes(family.ttf(cut.weight, cut.style, subset.subset), overall.signal);
          const vetted = await vetFace(bytes, options.unpackWoff2);
          if ('failed' in vetted) return { style, failed: vetted.failed };
          return { style, data: vetted.data, info: vetted.info, partial: subset.partial };
        } catch {
          return { style, failed: overall.signal.aborted ? 'slow' : 'fetch' };
        }
      }),
    );
    return { use, attempts, licence: family.licence };
  };

  let gathered: Awaited<ReturnType<typeof gather>>[];
  try {
    gathered = await Promise.all(wanted.map(gather));
  } finally {
    clearTimeout(timer);
  }

  // The families with the most text get the budget first.
  gathered.sort((a, b) => b.use.chars - a.use.chars);
  for (const { use, attempts, licence, catalogFailed } of gathered) {
    const carried = attempts.filter((a): a is Extract<Attempt, { data: Uint8Array }> => 'data' in a);
    // One file per style (a family without bold may answer with the same file twice).
    const unique = carried.filter((a, i) => carried.findIndex((b) => b.style === a.style) === i);
    const failed = attempts.flatMap((a) => ('failed' in a ? [a.failed] : []));
    const size = unique.reduce((sum, a) => sum + a.data.byteLength, 0);
    if (unique.length === 0) {
      result.families.push({ family: use.family, outcome: catalogFailed ?? worstOutcome(failed) });
      continue;
    }
    if (result.bytes + size > budget) {
      result.families.push({ family: use.family, outcome: 'budget', afterOthers: result.bytes > 0 });
      continue;
    }
    result.bytes += size;
    result.families.push({ family: use.family, outcome: 'carried' });
    if (unique.some((a) => a.partial)) result.partial.push(use.family);
    if (failed.length) result.stylesMissing.push(use.family);
    for (const attempt of unique) {
      result.fonts.push({
        typeface: use.family,
        style: attempt.style,
        covered: new Set([...use.codePoints].filter(point => containsGlyph(attempt.info.cmap, point))),
        data: wrapEot(attempt.data, attempt.info),
        panose: panoseHex(attempt.info),
        pitchFamily: pitchFamilyOf(use.family),
        charset: 0,
      });
    }
    const copyright = unique.find((a) => a.info.names.copyright)?.info.names.copyright;
    result.notices.push(`${use.family}${licence ? ` (${licence})` : ''}${copyright ? `: ${copyright.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Notes and fetching                                                          */
/* -------------------------------------------------------------------------- */

/** Records what embedding could not carry as export notes. */
export function noteFontEmbedding(notes: Pick<ExportNotes, 'family'>, embedding: FontEmbedding): void {
  for (const { family, outcome, afterOthers } of embedding.families) {
    switch (outcome) {
      case 'carried':
        break;
      case 'licence':
        notes.family('fontLicence', family);
        break;
      case 'variable':
        notes.family('fontVariable', family);
        break;
      case 'format':
        notes.family('fontFormat', family);
        break;
      case 'budget':
        notes.family(afterOthers ? 'fontBudgetAfter' : 'fontBudget', family);
        break;
      case 'slow':
        notes.family('fontSlow', family);
        break;
      case 'fetch':
        notes.family('fontFetch', family);
        break;
    }
  }
  for (const family of embedding.partial) notes.family('fontPartial', family);
  for (const family of embedding.stylesMissing) notes.family('fontStyles', family);
}

/** The text of the file's description: which fonts are inside and under what terms. */
export function fontNoticeText(embedding: FontEmbedding): string | undefined {
  if (embedding.notices.length === 0) return undefined;
  return `Fonts embedded in this presentation (ppt/fonts/), each under its own license; keep this notice with the file: ${embedding.notices.join(' | ')}`;
}

/** Fetches over the network for {@link embedDeckFonts} (no credentials: these are public files). */
export const networkFetchers: Pick<EmbeddingOptions, 'fetchJson' | 'fetchBytes'> = {
  async fetchJson(url, signal) {
    const response = await fetchRetrying(url, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`fetch ${response.status}`);
    return response.json();
  },
  async fetchBytes(url, signal) {
    const response = await fetchRetrying(url, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`fetch ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
};
