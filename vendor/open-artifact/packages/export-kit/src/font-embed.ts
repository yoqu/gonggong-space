/**
 * The web fonts of a rendered document, as `@font-face` rules that carry
 * their font files in `data:` URLs.
 *
 * A picture drawn from serialized markup (an SVG loaded as an image) is cut
 * off from the page it came from: it shares none of the page's loaded fonts
 * and may not request any. Text in a web font is drawn in a fallback font
 * instead, and where each line was placed by its measured position, the
 * fallback's different metrics also move it. {@link embeddedFontCss} gives
 * such a drawing the faces the document really uses:
 *
 * - every `@font-face` rule of the document's stylesheets is read: inline
 *   `<style>`s, linked and imported sheets, rules inside `@media` or
 *   `@layer`. A sheet from another origin (Google Fonts through a plain
 *   `<link>`) hides its rules from script, so its text is fetched instead;
 * - of those, only the faces the browser loaded for this document are kept
 *   (it loads a face when some text needs it), so a family split into a
 *   hundred `unicode-range` files costs the few that are in use;
 * - each kept face's first loadable source is fetched and inlined.
 *
 * The browser parses an inlined font again for every picture, about 30 ms of
 * main thread a megabyte, and a CJK font runs to tens of megabytes. So a
 * TrueType file is inlined as a subset where it can be (font-subset.ts): the
 * outlines of the ideographs and Hangul syllables the document cannot draw
 * are dropped, everything else is kept as it is. The code points it may draw
 * are read from its text, attribute values, form field values, open shadow
 * roots and stylesheet text (generated content), plus the ideographs list
 * counters make, each also in the forms the shaper normalizes it to (NFC:
 * conjoining jamo become syllables, compatibility ideographs unified ones),
 * since those are the glyphs it looks up. Left whole: CFF (OpenType-CFF) fonts, variable fonts with
 * `gvar`, WOFF and WOFF2 files, TrueType collections, AAT (`morx`) fonts,
 * and fonts with too few ideographs to be worth it.
 *
 * Font files stay cached between captures (the same fonts are drawn again
 * for every artboard and every page), within {@link FONT_CACHE_BYTES}, and
 * so do the `data:` URLs made from them, within {@link INLINED_CACHE_BYTES}.
 *
 * Needs a DOM.
 */

import { blockUnicodeRange, faceKey, familyName, fontFaceBlocks, fontFaceDescriptors, fontSources, parseUnicodeRange, rangeCovers } from './fonts.ts';
import { addBulkCodePoints, COUNTER_IDEOGRAPHS, subsetFont } from './font-subset.ts';
import { blobToDataUrl } from './pictures.ts';

/** How long a stylesheet or a font file may take, ms. */
const FETCH_TIMEOUT = 15_000;
/** Font files kept between captures, bytes. */
const FONT_CACHE_BYTES = 64 * 1024 * 1024;
/** Inlined fonts (subsets, and files inlined whole) kept between captures, characters of `data:` URL. */
const INLINED_CACHE_BYTES = 32 * 1024 * 1024;
/** Formats no current browser loads from a `data:` URL. */
const DEAD_FORMATS = /embedded-opentype|svg/;

/** A `@font-face` rule and what its relative addresses resolve against. */
interface Face {
  css: string;
  base: string;
}

/** What {@link embeddedFontCss} made. */
export interface EmbeddedFonts {
  /** Self-contained `@font-face` rules. */
  css: string;
  /** Families (as written) with a face left out: over the budget, or its file could not be read. */
  skipped: string[];
}

/** Options of {@link embeddedFontCss}. */
export interface EmbedFontsOptions {
  /** Most font data to inline, characters of `data:` URL (default: no limit). Faces that do not fit are left out. */
  maxBytes?: number;
  /** Inline TrueType fonts as subsets holding only the ideographs and Hangul the document uses (default true). */
  subset?: boolean;
}

/** What has been inlined since the page loaded: for tests and debugging. */
export interface FontEmbedStats {
  /** Fonts inlined as subsets. */
  subsets: number;
  /** Their size, characters of `data:` URL. */
  subsetBytes: number;
  /** Size of the font files inlined whole, characters of `data:` URL (sources already inline not counted). */
  wholeBytes: number;
}

const stats: FontEmbedStats = { subsets: 0, subsetBytes: 0, wholeBytes: 0 };

/** Fonts inlined as subsets and whole since the page loaded. */
export function fontEmbedStats(): FontEmbedStats {
  return { ...stats };
}

async function fetched(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

/** Text of stylesheets whose rules script may not read, by address. */
const sheetTexts = new Map<string, Promise<string | null>>();

function sheetText(url: string): Promise<string | null> {
  let text = sheetTexts.get(url);
  if (!text) {
    text = fetched(url).then((response) => response?.text() ?? null, () => null);
    sheetTexts.set(url, text);
    // A sheet that could not be read is asked for again next time.
    void text.then((value) => value === null && sheetTexts.delete(url));
  }
  return text;
}

/**
 * Values made on demand and kept, least recently used first, within a size.
 * A request still in flight is shared; a null result (a failure) is not kept.
 */
class Lru<T> {
  private readonly entries = new Map<string, { value: Promise<T | null>; size: number }>();
  private bytes = 0;
  private readonly limit: number;
  private readonly sizeOf: (value: T) => number;

  constructor(limit: number, sizeOf: (value: T) => number) {
    this.limit = limit;
    this.sizeOf = sizeOf;
  }

  get(key: string, make: () => Promise<T | null>): Promise<T | null> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    const entry = { value: make().catch(() => null), size: 0 };
    this.entries.set(key, entry);
    void entry.value.then((value) => {
      if (this.entries.get(key) !== entry) return;
      if (value === null) {
        this.entries.delete(key);
        return;
      }
      entry.size = this.sizeOf(value);
      this.bytes += entry.size;
      for (const [old, other] of this.entries) {
        if (this.bytes <= this.limit) break;
        if (other === entry || !other.size) continue;
        this.entries.delete(old);
        this.bytes -= other.size;
      }
    });
    return entry.value;
  }
}

/** A font file's bytes and media type. */
interface FontFile {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}

/** Font files by address. */
const fontFiles = new Lru<FontFile>(FONT_CACHE_BYTES, (file) => file.bytes.byteLength);

function fontFile(url: string): Promise<FontFile | null> {
  return fontFiles.get(url, async () => {
    const response = await fetched(url);
    if (!response) return null;
    const blob = await response.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  });
}

/** Inlined fonts as `data:` URLs: by address for a whole file, by address and code points for a subset. */
const inlinedFonts = new Lru<string>(INLINED_CACHE_BYTES, (data) => data.length);

/** The bulk code points (font-subset.ts) a document may draw, and one string naming them in a fixed order. */
interface UsedPoints {
  points: ReadonlySet<number>;
  key: string;
}

/** A font file as a `data:` URL: a subset when `used` is given and the font allows one, else the whole file. */
async function inlinedFont(address: string, used: UsedPoints | null): Promise<{ data: string; subset: boolean } | null> {
  const file = await fontFile(address);
  if (!file) return null;
  if (used) {
    const data = await inlinedFonts.get(`${address}\n${used.key}`, async () => {
      const smaller = subsetFont(file.bytes, used.points);
      return smaller ? blobToDataUrl(new Blob([smaller], { type: 'font/ttf' })) : null;
    });
    if (data) return { data, subset: true };
  }
  const data = await inlinedFonts.get(address, () => blobToDataUrl(new Blob([file.bytes], { type: file.type })));
  return data ? { data, subset: false } : null;
}

/** Adds the bulk code points of a document's (or a shadow root's) text, attribute values and form field values. */
function addDocumentBulk(root: Document | ShadowRoot, into: Set<number>): void {
  addBulkCodePoints(('documentElement' in root ? root.documentElement?.textContent : root.textContent) ?? '', into);
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) addBulkCodePoints(attribute.value, into);
    // Told apart by tag, not `instanceof`: the element may belong to another frame's realm.
    if (element.localName === 'input' || element.localName === 'textarea') addBulkCodePoints((element as HTMLInputElement).value ?? '', into);
    if (element.shadowRoot) addDocumentBulk(element.shadowRoot, into);
  }
}

/** Every `@font-face` rule of the document, in stylesheet order. Adds the bulk code points of every rule's text to `used`. */
async function documentFaces(doc: Document, used: Set<number>): Promise<Face[]> {
  const found: (Face | Promise<Face[]>)[] = [];
  const seen = new Set<CSSStyleSheet>();
  const unreadable = (href: string): void => {
    found.push(
      sheetText(href).then((text) => {
        if (!text) return [];
        addBulkCodePoints(text, used);
        return fontFaceBlocks(text).map((css) => ({ css, base: href }));
      }),
    );
  };
  const sheet = (styles: CSSStyleSheet, base: string): void => {
    if (seen.has(styles)) return;
    seen.add(styles);
    const own = styles.href ?? base;
    let rules: CSSRuleList;
    try {
      rules = styles.cssRules;
    } catch {
      // Another origin's sheet, loaded without CORS.
      if (styles.href) unreadable(styles.href);
      return;
    }
    walk(rules, own);
  };
  const walk = (rules: CSSRuleList, base: string): void => {
    // Rules belong to the frame's realm: told apart by what they hold, not by `instanceof`.
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      if (/^@font-face\b/i.test(text)) found.push({ css: text, base });
      else if ('styleSheet' in rule && 'href' in rule) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) sheet(imported, base);
      } else if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules, base);
      // Generated content (`content: "…"`, `quotes`, counter `symbols`) draws text no element holds.
      else addBulkCodePoints(text, used);
    }
  };
  for (const styles of [...Array.from(doc.styleSheets), ...(doc.adoptedStyleSheets ?? [])]) sheet(styles, doc.baseURI);
  return (await Promise.all(found)).flat();
}

/** The faces the browser loaded for the document, as {@link faceKey}s by family; null when it does not say. */
function loadedFaces(doc: Document): Map<string, Set<string>> | null {
  const fonts = doc.fonts;
  if (!fonts || typeof fonts.forEach !== 'function') return null;
  const loaded = new Map<string, Set<string>>();
  fonts.forEach((face) => {
    if (face.status !== 'loaded') return;
    const family = familyName(face.family);
    let keys = loaded.get(family);
    if (!keys) loaded.set(family, (keys = new Set()));
    keys.add(faceKey({ family: face.family, weight: face.weight, style: face.style, unicodeRange: face.unicodeRange }));
  });
  return loaded;
}

/** The faces the document draws text with. */
async function usedFaces(doc: Document, used: Set<number>): Promise<Face[]> {
  const faces = await documentFaces(doc, used);
  if (!faces.length) return faces;
  const loaded = loadedFaces(doc);
  let points: Set<number> | undefined;
  /** By `unicode-range` alone: when the browser's own account cannot be matched to the rules. */
  const coversText = (css: string): boolean => {
    points ??= new Set(Array.from(doc.documentElement.textContent ?? '', (char) => char.codePointAt(0)!));
    return rangeCovers(parseUnicodeRange(blockUnicodeRange(css)), points);
  };
  if (!loaded) return faces.filter((face) => coversText(face.css));
  const read = faces.map((face) => {
    const descriptors = fontFaceDescriptors(face.css);
    const family = familyName(descriptors.get('font-family'));
    const key = faceKey({ family, weight: descriptors.get('font-weight'), style: descriptors.get('font-style'), unicodeRange: descriptors.get('unicode-range') });
    return { face, family, key, exact: Boolean(loaded.get(family)?.has(key)) };
  });
  // A loaded face no rule accounts for (traits spelled in a way the keys do not level): its family goes by range.
  const ruleKeys = new Set(read.map((item) => item.key));
  const loose = new Set<string>();
  for (const [family, keys] of loaded) for (const key of keys) if (!ruleKeys.has(key)) loose.add(family);
  return read.filter((item) => item.exact || (loose.has(item.family) && coversText(item.face.css))).map((item) => item.face);
}

/** The face with its first loadable source inlined; null when none could be read, `'large'` when it does not fit. */
async function embeddedFace(face: Face, budget: { left: number }, used: UsedPoints | null): Promise<string | 'large' | null> {
  const descriptors = fontFaceDescriptors(face.css);
  const sources: string[] = [];
  let inlined = false;
  for (const source of fontSources(descriptors.get('src') ?? '')) {
    if (!source.url) {
      // `local(…)` works inside a picture as it does on the page.
      sources.push(source.text);
      continue;
    }
    if (inlined || (source.format && DEAD_FORMATS.test(source.format))) continue;
    let data: string | null;
    let subset: boolean | null = null;
    if (source.url.url.startsWith('data:')) data = source.url.url;
    else {
      let address: string;
      try {
        address = new URL(source.url.url, face.base).href;
      } catch {
        continue;
      }
      const font = await inlinedFont(address, used);
      data = font?.data ?? null;
      subset = font?.subset ?? null;
    }
    if (!data) continue;
    if (data.length > budget.left) return 'large';
    budget.left -= data.length;
    if (subset) {
      stats.subsets++;
      stats.subsetBytes += data.length;
    } else if (subset === false) stats.wholeBytes += data.length;
    sources.push(source.text.replace(source.url.match, () => `url("${data}")`));
    inlined = true;
  }
  if (!inlined) return null;
  descriptors.set('src', sources.join(', '));
  return `@font-face{${Array.from(descriptors, ([name, value]) => `${name}:${value}`).join(';')}}`;
}

async function embed(faces: readonly Face[], maxBytes: number, used: UsedPoints | null): Promise<EmbeddedFonts & { unread: boolean }> {
  // Start every download at once; the pass below takes them in order, so the budget goes to the first rules.
  for (const face of faces) {
    const first = fontSources(fontFaceDescriptors(face.css).get('src') ?? '').find((source) => source.url && !(source.format && DEAD_FORMATS.test(source.format)));
    if (!first?.url || first.url.url.startsWith('data:')) continue;
    try {
      void fontFile(new URL(first.url.url, face.base).href);
    } catch {
      // An address that does not parse is passed over again below.
    }
  }
  const budget = { left: maxBytes };
  const rules: string[] = [];
  const skipped = new Set<string>();
  let unread = false;
  for (const face of faces) {
    const rule = await embeddedFace(face, budget, used);
    if (rule === null || rule === 'large') {
      skipped.add((fontFaceDescriptors(face.css).get('font-family') ?? '').replace(/^(['"])(.*)\1$/, '$2'));
      unread ||= rule === null;
    } else rules.push(rule);
  }
  return { css: rules.join('\n'), skipped: [...skipped].filter(Boolean), unread };
}

/** The last result per document, and what it was made from. */
const made = new WeakMap<Document, { from: string; fonts: Promise<EmbeddedFonts> }>();

/**
 * `@font-face` rules for the web fonts the document draws its text with,
 * their files inlined as `data:` URLs: what a picture of the document needs
 * to show the same fonts. Call it once the document's fonts have loaded
 * (`document.fonts.ready`); a face still loading is not in use yet.
 */
export async function embeddedFontCss(doc: Document, options: EmbedFontsOptions = {}): Promise<EmbeddedFonts> {
  const maxBytes = options.maxBytes ?? Infinity;
  const points = new Set<number>();
  const faces = await usedFaces(doc, points);
  if (!faces.length) return { css: '', skipped: [] };
  let used: UsedPoints | null = null;
  if (options.subset ?? true) {
    addBulkCodePoints(COUNTER_IDEOGRAPHS, points);
    addDocumentBulk(doc, points);
    used = { points, key: Array.from(points, (point) => String.fromCodePoint(point)).sort().join('') };
  }
  // A subset holds the characters of the text it was made for: an edit makes another.
  const from = `${maxBytes}\n${used ? used.key : '*'}\n${faces.map((face) => `${face.base}\n${face.css}`).join('\n')}`;
  const last = made.get(doc);
  if (last?.from === from) return last.fonts;
  const work = embed(faces, maxBytes, used);
  const fonts = work.then(({ css, skipped }) => ({ css, skipped }));
  made.set(doc, { from, fonts });
  // A font that could not be read may be there next time.
  void work.then((result) => result.unread && made.get(doc)?.fonts === fonts && made.delete(doc));
  return fonts;
}
