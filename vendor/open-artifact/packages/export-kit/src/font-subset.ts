/**
 * A TrueType font cut down to the glyphs a document can draw, for inlining
 * into pictures of it.
 *
 * The browser parses an inlined font again for every picture, about 30 ms of
 * main thread a megabyte, and a CJK font runs to tens of megabytes, almost
 * all of it ideographs and Hangul syllables the document never shows.
 * {@link subsetFont} drops the outlines of those glyphs and nothing else:
 *
 * - only code points in the bulk ranges ({@link isBulkCodePoint}) ever lose
 *   their glyphs. Latin, kana, punctuation, symbols and private use stay, so
 *   the characters CSS makes up on its own (`text-transform`, hyphens,
 *   ellipses, quotes, list markers) never need to be known; only counter
 *   styles make ideographs, and {@link COUNTER_IDEOGRAPHS} keeps those;
 * - the shaper normalizes text before it looks glyphs up: conjoining jamo
 *   become Hangul syllables, a compatibility ideograph the font lacks
 *   becomes its unified ideograph, a syllable the font lacks may be drawn as
 *   a shorter one plus a jamo. {@link addBulkCodePoints} counts those forms
 *   as used too, or they would be drawn blank;
 * - glyph ids are kept. Only `glyf` and `loca` are written again (a dropped
 *   glyph becomes an empty one); `cmap`, `GSUB`, `GPOS`, metrics and every
 *   other table are copied byte for byte, so shaping and layout are those
 *   of the whole font;
 * - every glyph that GSUB (any lookup, any feature, any context) or a
 *   composite glyph can reach from a kept glyph is kept as well. A glyph
 *   cmap does not map is decided by that reach when GSUB or a composite
 *   leads to it (the regional and alternate forms of ideographs, most of
 *   what is left of a big CJK font), and kept when nothing does.
 *
 * A dropped glyph that is drawn anyway would be blank, so whatever is not
 * fully understood is left whole: CFF outlines, variable fonts (`gvar`),
 * AAT fonts (`morx`), color and math fonts, collections, WOFF and WOFF2
 * files, unknown cmap or GSUB formats, anything malformed.
 *
 * Pure: no DOM, loads in `node --test`.
 */

/** Code points whose glyphs a subset may drop when the document does not use them. */
export function isBulkCodePoint(codePoint: number): boolean {
  if (codePoint < 0x3400) return false;
  if (codePoint < 0xac00) return codePoint <= 0x4dbf || (codePoint >= 0x4e00 && codePoint <= 0x9fff);
  if (codePoint < 0x10000) return codePoint <= 0xd7a3 || (codePoint >= 0xf900 && codePoint <= 0xfaff);
  return (codePoint >= 0x20000 && codePoint <= 0x323af) || (codePoint >= 0x2f800 && codePoint <= 0x2fa1f);
}

/**
 * Adds to `into` the bulk code points `text` may be drawn with: its own, those
 * of its NFC form (decomposed Hangul composes to syllables, compatibility
 * ideographs decompose to unified ones; the shaper does the same before it
 * looks glyphs up), and for each Hangul syllable with a trailing consonant
 * the syllable without it (drawn with a trailing jamo when the font lacks
 * the whole syllable).
 */
export function addBulkCodePoints(text: string, into: Set<number>): void {
  // Nothing below U+1100 (Hangul jamo) normalizes into a bulk code point: plain text is read once and never normalized.
  if (addOwn(text, into)) {
    const normalized = text.normalize('NFC');
    if (normalized !== text) addOwn(normalized, into);
  }
}

/** Adds the bulk code points of `text` (and the LV syllable of each LVT one); true when it holds anything from U+1100 on. */
function addOwn(text: string, into: Set<number>): boolean {
  let high = false;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x1100) continue;
    high = true;
    if (unit < 0x3400) continue;
    let point = unit;
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = (unit - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (!isBulkCodePoint(point)) continue;
    into.add(point);
    if (point >= 0xac00 && point <= 0xd7a3) {
      const trailing = (point - 0xac00) % 28;
      if (trailing) into.add(point - trailing);
    }
  }
  return high;
}

/**
 * Ideographs list counters generate (`list-style-type: cjk-ideographic` …):
 * never in the DOM text, always kept. Every Han and Hangul character of the
 * CSS counter styles cjk-decimal, cjk-ideographic, simp-/trad-chinese-
 * informal and formal, japanese-informal and formal, korean-hangul-formal,
 * korean-hanja-informal and formal, cjk-heavenly-stem and cjk-earthly-branch,
 * their negative signs, and the large-number words around them.
 */
export const COUNTER_IDEOGRAPHS =
  '〇零一二三四五六七八九十百千万萬億亿兆负負' +
  '壹贰叁肆伍陆柒捌玖拾佰仟' +
  '貳參陸' +
  '壱弐参阡' +
  '영일이삼사오육칠팔구십백천만억조마이너스' +
  '甲乙丙丁戊己庚辛壬癸' +
  '子丑寅卯辰巳午未申酉戌亥';

/** Options of {@link subsetFont}. */
export interface SubsetOptions {
  /** Fewest glyphs mapped only from bulk code points for a subset to be worth it (default 512). */
  minBulkGlyphs?: number;
  /** Least share of the file the dropped outlines must make up (default 0.2). */
  minSaving?: number;
}

/** Tables whose reach over glyphs is not followed: a font with one is left whole. */
const UNFOLLOWED = new Set(['morx', 'mort', 'gvar', 'CFF ', 'CFF2', 'COLR', 'MATH']);

/** Per-glyph facts, as bits of one byte. */
const BULK = 1;
const OTHER = 2;
const USED = 4;
const KEEP = 8;
/** Made by some GSUB lookup, or a component of a composite glyph. */
const REACHED = 16;

/** Thrown on anything out of bounds or not understood; turned into null by {@link subsetFont}. */
class Unfit extends Error {}

class Reader {
  readonly view: DataView;
  readonly length: number;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.byteLength;
  }
  check(offset: number, size: number): void {
    if (!(offset >= 0 && offset + size <= this.length)) throw new Unfit('out of bounds');
  }
  u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset);
  }
  i16(offset: number): number {
    this.check(offset, 2);
    return this.view.getInt16(offset);
  }
  u24(offset: number): number {
    this.check(offset, 3);
    return (this.view.getUint16(offset) << 8) | this.view.getUint8(offset + 2);
  }
  u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset);
  }
  tag(offset: number): string {
    this.check(offset, 4);
    return String.fromCharCode(this.bytes[offset]!, this.bytes[offset + 1]!, this.bytes[offset + 2]!, this.bytes[offset + 3]!);
  }
}

interface Table {
  tag: string;
  offset: number;
  length: number;
}

/** The font with the outlines of unused bulk glyphs removed, or null when it is left whole. */
export function subsetFont(font: Uint8Array, used: ReadonlySet<number>, options: SubsetOptions = {}): Uint8Array<ArrayBuffer> | null {
  try {
    return subset(new Reader(font), used, options.minBulkGlyphs ?? 512, options.minSaving ?? 0.2);
  } catch {
    return null;
  }
}

function subset(r: Reader, used: ReadonlySet<number>, minBulkGlyphs: number, minSaving: number): Uint8Array<ArrayBuffer> | null {
  const version = r.u32(0);
  if (version !== 0x00010000 && version !== 0x74727565) return null;
  const count = r.u16(4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const table = { tag: r.tag(at), offset: r.u32(at + 8), length: r.u32(at + 12) };
    r.check(table.offset, table.length);
    if (tables.has(table.tag)) return null;
    tables.set(table.tag, table);
  }
  for (const tag of UNFOLLOWED) if (tables.has(tag)) return null;
  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  const cmap = tables.get('cmap');
  if (!head || !maxp || !loca || !glyf || !cmap) return null;
  if (head.length < 54 || maxp.length < 6) return null;
  const longOffsets = r.i16(head.offset + 50);
  if (longOffsets !== 0 && longOffsets !== 1) return null;
  const glyphs = r.u16(maxp.offset + 4);
  if (!glyphs) return null;

  // Where each glyph's outline lies within glyf.
  if (loca.length < (glyphs + 1) * (longOffsets ? 4 : 2)) return null;
  const starts = new Uint32Array(glyphs + 1);
  for (let g = 0; g <= glyphs; g++) {
    const at = longOffsets ? r.u32(loca.offset + g * 4) : r.u16(loca.offset + g * 2) * 2;
    if (at > glyf.length || (g && at < starts[g - 1]!)) return null;
    starts[g] = at;
  }

  const flags = new Uint8Array(glyphs);
  readCmap(r, cmap, flags, used);

  // Every glyph a substitution or a composite glyph can lead to; the closures below decide those that cmap does not map.
  const gsub = tables.get('GSUB');
  const rules = gsub ? readGsub(r, gsub, flags) : null;
  const parts = readComposites(r, glyf.offset, starts, flags);

  // Kept to begin with: .notdef, every glyph cmap maps from a non-bulk code point, bulk glyphs in use, and unmapped
  // glyphs nothing followed here leads to (only some way not followed could draw them).
  let bulkOnly = 0;
  flags[0]! |= KEEP;
  for (let g = 0; g < glyphs; g++) {
    const f = flags[g]!;
    if (f & OTHER || f & USED || (!(f & BULK) && !(f & REACHED))) flags[g] = f | KEEP;
    if (f & BULK && !(f & OTHER)) bulkOnly++;
  }
  if (bulkOnly < minBulkGlyphs) return null;

  if (rules) closeOverGsub(rules, flags);
  closeOverComposites(parts, flags);

  let kept = 0;
  for (let g = 0; g < glyphs; g++) if (flags[g]! & KEEP) kept += starts[g + 1]! - starts[g]!;
  const dropped = starts[glyphs]! - kept;
  if (dropped <= 0 || dropped < minSaving * r.length) return null;

  // The new glyf and loca: kept outlines in glyph order, dropped ones empty.
  const newGlyf = new Uint8Array(kept);
  const newLoca = new Uint8Array((glyphs + 1) * (longOffsets ? 4 : 2));
  const locaView = new DataView(newLoca.buffer);
  let at = 0;
  for (let g = 0; g <= glyphs; g++) {
    if (longOffsets) locaView.setUint32(g * 4, at);
    else locaView.setUint16(g * 2, at / 2);
    if (g === glyphs || !(flags[g]! & KEEP)) continue;
    const from = glyf.offset + starts[g]!;
    const size = starts[g + 1]! - starts[g]!;
    newGlyf.set(r.bytes.subarray(from, from + size), at);
    at += size;
  }
  return writeFont(r, version, [...tables.values()], new Map([['glyf', newGlyf], ['loca', newLoca]]));
}

/** Marks each glyph mapped from a bulk, a non-bulk and a used code point; keeps the variation glyphs of used ones. */
function readCmap(r: Reader, cmap: Table, flags: Uint8Array, used: ReadonlySet<number>): void {
  const base = cmap.offset;
  const glyphs = flags.length;
  const map = (codePoint: number, glyph: number): void => {
    if (glyph <= 0 || glyph >= glyphs) return;
    if (!isBulkCodePoint(codePoint)) flags[glyph]! |= OTHER;
    else flags[glyph]! |= used.has(codePoint) ? BULK | USED : BULK;
  };
  const read = new Set<number>();
  const subtables = r.u16(base + 2);
  for (let i = 0; i < subtables; i++) {
    const platform = r.u16(base + 4 + i * 8);
    const encoding = r.u16(base + 6 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const at = base + r.u32(base + 8 + i * 8);
    if (at + 2 > base + cmap.length) throw new Unfit('cmap subtable');
    // Subtables may share their data.
    if (read.has(at)) continue;
    read.add(at);
    const format = r.u16(at);
    if (format === 4) {
      const segments = r.u16(at + 6) / 2;
      const ends = at + 14;
      const startCodes = ends + segments * 2 + 2;
      const deltas = startCodes + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = r.u16(ends + s * 2);
        const start = r.u16(startCodes + s * 2);
        const delta = r.u16(deltas + s * 2);
        const rangeOffset = r.u16(rangeOffsets + s * 2);
        if (start > end) throw new Unfit('cmap segment');
        for (let c = start; c <= end && c !== 0xffff; c++) {
          if (!rangeOffset) map(c, (c + delta) & 0xffff);
          else {
            const glyph = r.u16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
            if (glyph) map(c, (glyph + delta) & 0xffff);
          }
        }
      }
    } else if (format === 6) {
      const first = r.u16(at + 6);
      const entries = r.u16(at + 8);
      for (let e = 0; e < entries; e++) map(first + e, r.u16(at + 10 + e * 2));
    } else if (format === 12) {
      const groups = r.u32(at + 12);
      r.check(at + 16, groups * 12);
      for (let n = 0; n < groups; n++) {
        const start = r.u32(at + 16 + n * 12);
        const end = r.u32(at + 20 + n * 12);
        const glyph = r.u32(at + 24 + n * 12);
        if (start > end || end > 0x10ffff) throw new Unfit('cmap group');
        for (let c = start; c <= end; c++) map(c, glyph + c - start);
      }
    } else if (format === 14) {
      const records = r.u32(at + 6);
      r.check(at + 10, records * 11);
      for (let n = 0; n < records; n++) {
        const nonDefault = r.u32(at + 10 + n * 11 + 7);
        if (!nonDefault) continue;
        const list = at + nonDefault;
        const mappings = r.u32(list);
        r.check(list + 4, mappings * 5);
        for (let m = 0; m < mappings; m++) {
          const codePoint = r.u24(list + 4 + m * 5);
          const glyph = r.u16(list + 7 + m * 5);
          // Non-bulk bases are always taken as used.
          if (glyph < glyphs && (!isBulkCodePoint(codePoint) || used.has(codePoint))) flags[glyph]! |= KEEP;
        }
      }
    } else throw new Unfit(`cmap format ${format}`);
  }
}

/** Glyph ids of a coverage table, in coverage index order. */
function coverage(r: Reader, at: number): number[] {
  const format = r.u16(at);
  const out: number[] = [];
  if (format === 1) {
    const count = r.u16(at + 2);
    r.check(at + 4, count * 2);
    for (let i = 0; i < count; i++) out.push(r.u16(at + 4 + i * 2));
  } else if (format === 2) {
    const ranges = r.u16(at + 2);
    r.check(at + 4, ranges * 6);
    for (let i = 0; i < ranges; i++) {
      const start = r.u16(at + 4 + i * 6);
      const end = r.u16(at + 6 + i * 6);
      const index = r.u16(at + 8 + i * 6);
      if (start > end) throw new Unfit('coverage range');
      for (let g = start; g <= end; g++) out[index + g - start] = g;
    }
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) throw new Unfit('coverage index');
  } else throw new Unfit(`coverage format ${format}`);
  return out;
}

/** What GSUB can make: each `from` glyph can become `to`; a ligature is made from all its parts. */
interface Rules {
  from: number[];
  to: number[];
  ligatures: { glyph: number; parts: number[] }[];
}

/**
 * Every substitution of every GSUB lookup, whatever its feature, script or
 * context: a superset of what shaping can produce. Marks what they make as
 * reached.
 */
function readGsub(r: Reader, gsub: Table, flags: Uint8Array): Rules {
  const from: number[] = [];
  const to: number[] = [];
  const ligatures: { glyph: number; parts: number[] }[] = [];
  const rules = { from, to, ligatures };
  const base = gsub.offset;
  if (r.u16(base) !== 1) throw new Unfit('GSUB version');
  if (!r.u16(base + 8)) return rules;
  const lookupList = base + r.u16(base + 8);
  const pairs = (input: number[], outputs: (index: number) => number[]): void => {
    input.forEach((glyph, index) => {
      for (const out of outputs(index)) {
        from.push(glyph);
        to.push(out);
      }
    });
  };
  const glyphList = (at: number): number[] => {
    const count = r.u16(at);
    r.check(at + 2, count * 2);
    return Array.from({ length: count }, (_, i) => r.u16(at + 2 + i * 2));
  };
  const subtable = (type: number, at: number, extended: boolean): void => {
    const format = r.u16(at);
    switch (type) {
      case 1: {
        const covered = coverage(r, at + r.u16(at + 2));
        if (format === 1) {
          const delta = r.u16(at + 4);
          pairs(covered, (i) => [(covered[i]! + delta) & 0xffff]);
        } else if (format === 2) {
          const substitutes = glyphList(at + 4);
          if (substitutes.length !== covered.length) throw new Unfit('single substitution');
          pairs(covered, (i) => [substitutes[i]!]);
        } else throw new Unfit('single format');
        return;
      }
      case 2:
      case 3: {
        if (format !== 1) throw new Unfit('multiple format');
        const covered = coverage(r, at + r.u16(at + 2));
        const sets = r.u16(at + 4);
        if (sets !== covered.length) throw new Unfit('multiple count');
        pairs(covered, (i) => glyphList(at + r.u16(at + 6 + i * 2)));
        return;
      }
      case 4: {
        if (format !== 1) throw new Unfit('ligature format');
        const covered = coverage(r, at + r.u16(at + 2));
        const sets = r.u16(at + 4);
        if (sets !== covered.length) throw new Unfit('ligature count');
        for (let i = 0; i < sets; i++) {
          const set = at + r.u16(at + 6 + i * 2);
          const count = r.u16(set);
          for (let l = 0; l < count; l++) {
            const ligature = set + r.u16(set + 2 + l * 2);
            const glyph = r.u16(ligature);
            const components = r.u16(ligature + 2);
            if (!components) throw new Unfit('ligature components');
            const parts = [covered[i]!];
            for (let c = 1; c < components; c++) parts.push(r.u16(ligature + 2 + c * 2));
            ligatures.push({ glyph, parts });
          }
        }
        return;
      }
      case 5:
      case 6:
        // The lookups they call are followed on their own, unconditionally.
        if (format < 1 || format > 3) throw new Unfit('context format');
        return;
      case 7: {
        if (format !== 1 || extended) throw new Unfit('extension');
        const inner = r.u16(at + 2);
        if (inner === 7) throw new Unfit('nested extension');
        subtable(inner, at + r.u32(at + 4), true);
        return;
      }
      case 8: {
        if (format !== 1) throw new Unfit('reverse chaining format');
        const covered = coverage(r, at + r.u16(at + 2));
        const backtrack = r.u16(at + 4);
        const lookahead = r.u16(at + 6 + backtrack * 2);
        const substitutes = glyphList(at + 8 + (backtrack + lookahead) * 2);
        if (substitutes.length !== covered.length) throw new Unfit('reverse chaining count');
        pairs(covered, (i) => [substitutes[i]!]);
        return;
      }
      default:
        throw new Unfit(`GSUB lookup type ${type}`);
    }
  };
  const lookups = r.u16(lookupList);
  for (let l = 0; l < lookups; l++) {
    const lookup = lookupList + r.u16(lookupList + 2 + l * 2);
    const type = r.u16(lookup);
    const count = r.u16(lookup + 4);
    for (let s = 0; s < count; s++) subtable(type, lookup + r.u16(lookup + 6 + s * 2), false);
  }

  const glyphs = flags.length;
  for (const glyph of to) if (glyph < glyphs) flags[glyph]! |= REACHED;
  for (const { glyph } of ligatures) if (glyph < glyphs) flags[glyph]! |= REACHED;
  return rules;
}

/** Keeps every glyph GSUB can make from kept glyphs, until a pass adds none. */
function closeOverGsub({ from, to, ligatures }: Rules, flags: Uint8Array): void {
  const glyphs = flags.length;
  const keptGlyph = (glyph: number): boolean => glyph < glyphs && (flags[glyph]! & KEEP) !== 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < from.length; i++) {
      const out = to[i]!;
      if (out < glyphs && !(flags[out]! & KEEP) && keptGlyph(from[i]!)) {
        flags[out]! |= KEEP;
        changed = true;
      }
    }
    for (const { glyph, parts } of ligatures) {
      if (glyph < glyphs && !(flags[glyph]! & KEEP) && parts.every(keptGlyph)) {
        flags[glyph]! |= KEEP;
        changed = true;
      }
    }
  }
}

/** The components of every composite glyph (glyph g's are `list[first[g]]` up to `list[first[g + 1]]`), marked as reached. */
function readComposites(r: Reader, glyf: number, starts: Uint32Array, flags: Uint8Array): { first: Uint32Array; list: number[] } {
  const glyphs = flags.length;
  const first = new Uint32Array(glyphs + 1);
  const list: number[] = [];
  for (let g = 0; g < glyphs; g++) {
    first[g] = list.length;
    const start = starts[g]!;
    const end = starts[g + 1]!;
    if (end === start) continue;
    if (end - start < 10) throw new Unfit('glyph header');
    if (r.i16(glyf + start) >= 0) continue;
    let at = glyf + start + 10;
    for (let more = true; more; ) {
      if (at + 4 > glyf + end) throw new Unfit('composite glyph');
      const flag = r.u16(at);
      const component = r.u16(at + 2);
      at += 4 + (flag & 0x1 ? 4 : 2) + (flag & 0x8 ? 2 : flag & 0x40 ? 4 : flag & 0x80 ? 8 : 0);
      if (component >= glyphs) throw new Unfit('composite component');
      flags[component]! |= REACHED;
      list.push(component);
      more = (flag & 0x20) !== 0;
    }
  }
  first[glyphs] = list.length;
  return { first, list };
}

/** Keeps the components of every kept composite glyph, and theirs. */
function closeOverComposites({ first, list }: { first: Uint32Array; list: number[] }, flags: Uint8Array): void {
  const work: number[] = [];
  for (let g = 0; g < flags.length; g++) if (flags[g]! & KEEP && first[g + 1]! > first[g]!) work.push(g);
  while (work.length) {
    const g = work.pop()!;
    for (let i = first[g]!; i < first[g + 1]!; i++) {
      const component = list[i]!;
      if (!(flags[component]! & KEEP)) {
        flags[component]! |= KEEP;
        work.push(component);
      }
    }
  }
}

function checksum(bytes: Uint8Array, offset: number, length: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  const whole = length & ~3;
  for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(offset + i)) >>> 0;
  if (whole < length) {
    let last = 0;
    for (let i = 0; i < 4; i++) last = (last << 8) | (whole + i < length ? bytes[offset + whole + i]! : 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/** A new sfnt: tables in tag order, each on a 4-byte boundary, checksums and `head.checkSumAdjustment` worked out again. */
function writeFont(r: Reader, version: number, tables: Table[], replaced: Map<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const sorted = tables
    .map((table) => ({ tag: table.tag, data: replaced.get(table.tag) ?? r.bytes.subarray(table.offset, table.offset + table.length) }))
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const count = sorted.length;
  let size = 12 + count * 16;
  const offsets = sorted.map((table) => {
    const at = size;
    size += (table.data.length + 3) & ~3;
    return at;
  });
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const selector = Math.floor(Math.log2(count));
  view.setUint32(0, version);
  view.setUint16(4, count);
  view.setUint16(6, 16 << selector);
  view.setUint16(8, selector);
  view.setUint16(10, count * 16 - (16 << selector));
  let headAt = -1;
  sorted.forEach((table, i) => {
    const at = offsets[i]!;
    out.set(table.data, at);
    if (table.tag === 'head') {
      headAt = at;
      view.setUint32(at + 8, 0);
    }
    const entry = 12 + i * 16;
    for (let c = 0; c < 4; c++) out[entry + c] = table.tag.charCodeAt(c);
    view.setUint32(entry + 4, checksum(out, at, table.data.length));
    view.setUint32(entry + 8, at);
    view.setUint32(entry + 12, table.data.length);
  });
  view.setUint32(headAt + 8, (0xb1b0afba - checksum(out, 0, size)) >>> 0);
  return out;
}
