import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addBulkCodePoints, COUNTER_IDEOGRAPHS, isBulkCodePoint, subsetFont, type SubsetOptions } from '../src/font-subset.ts';

// Small TrueType fonts assembled here, table by table, so each rule of the subsetter can be seen at work.

const u16 = (...values: number[]): number[] => values.flatMap((value) => [(value >> 8) & 0xff, value & 0xff]);
const u24 = (value: number): number[] => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const u32 = (...values: number[]): number[] => values.flatMap((value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
const tagBytes = (tag: string): number[] => Array.from(tag, (char) => char.charCodeAt(0));
const even = (bytes: number[]): number[] => (bytes.length % 2 ? [...bytes, 0] : bytes);

/** A simple glyph: one square contour whose size depends on `seed`, so every glyph's bytes differ. */
function square(seed: number): number[] {
  const size = 100 + seed;
  return even([...u16(1, 0, 0, size, size), ...u16(3), ...u16(0), 1, 1, 1, 1, ...u16(0, 0, size, 0), ...u16(0, size, 0, -size)]);
}

/** A composite glyph of the given components, each moved by (10, 10). */
function composite(...components: number[]): number[] {
  const parts = components.flatMap((glyph, i) => [...u16(0x0003 | (i < components.length - 1 ? 0x0020 : 0), glyph), ...u16(10, 10)]);
  return [...u16(0xffff, 0, 0, 500, 500), ...parts];
}

function checksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) word = (word << 8) | (i + j < length ? bytes[offset + i + j]! : 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/** An sfnt from its tables (in the order given, which need not be tag order), with a correct checkSumAdjustment. */
function sfnt(tables: Record<string, number[] | Uint8Array>, version = 0x00010000): Uint8Array {
  const entries = Object.entries(tables);
  const count = entries.length;
  const selector = Math.floor(Math.log2(count));
  const header = [...u32(version), ...u16(count, 16 << selector, selector, count * 16 - (16 << selector))];
  let offset = 12 + count * 16;
  const placed = entries.map(([tag, data]) => {
    const at = offset;
    offset += (data.length + 3) & ~3;
    return { tag, data: Uint8Array.from(data), at };
  });
  const out = new Uint8Array(offset);
  out.set(header);
  placed.forEach(({ tag, data, at }, i) => {
    out.set(data, at);
    out.set([...tagBytes(tag), ...u32(checksum(out, at, data.length), at, data.length)], 12 + i * 16);
  });
  const head = placed.find((table) => table.tag === 'head');
  if (head) new DataView(out.buffer).setUint32(head.at + 8, (0xb1b0afba - checksum(out, 0, out.length)) >>> 0);
  return out;
}

interface FontSpec {
  glyphs: number[][];
  cmap: [codePoint: number, glyph: number][];
  /** Format 14: [base, selector, glyph] non-default variation sequences. */
  uvs?: [number, number, number][];
  gsub?: number[];
  extra?: Record<string, number[]>;
  longLoca?: boolean;
  version?: number;
  /** A cmap subtable in this format besides the format 12 one (to test unknown formats). */
  otherFormat?: number;
}

function cmapTable(spec: FontSpec): number[] {
  const groups = [...spec.cmap].sort((a, b) => a[0] - b[0]);
  const f12 = [...u16(12, 0), ...u32(16 + groups.length * 12, 0, groups.length), ...groups.flatMap(([code, glyph]) => u32(code, code, glyph))];
  const subtables: [number, number, number[]][] = [[3, 10, f12]];
  if (spec.uvs) {
    const mappings = spec.uvs;
    const selectors = [...new Set(mappings.map(([, selector]) => selector))].sort((a, b) => a - b);
    const lists = selectors.map((selector) => {
      const list = mappings.filter(([, s]) => s === selector).sort((a, b) => a[0] - b[0]);
      return [...u32(list.length), ...list.flatMap(([base, , glyph]) => [...u24(base), ...u16(glyph)])];
    });
    let at = 10 + selectors.length * 11;
    const records = selectors.flatMap((selector, i) => {
      const record = [...u24(selector), ...u32(0, at)];
      at += lists[i]!.length;
      return record;
    });
    const body = [...records, ...lists.flat()];
    subtables.unshift([0, 5, [...u16(14), ...u32(10 + body.length, selectors.length), ...body]]);
  }
  if (spec.otherFormat !== undefined) subtables.unshift([0, 3, [...u16(spec.otherFormat, 6, 0)]]);
  let at = 4 + subtables.length * 8;
  const records = subtables.flatMap(([platform, encoding, data]) => {
    const record = [...u16(platform, encoding), ...u32(at)];
    at += data.length;
    return record;
  });
  return [...u16(0, subtables.length), ...records, ...subtables.flatMap(([, , data]) => data)];
}

function buildFont(spec: FontSpec): Uint8Array {
  const count = spec.glyphs.length;
  const glyf = spec.glyphs.flat();
  const offsets: number[] = [0];
  for (const glyph of spec.glyphs) offsets.push(offsets.at(-1)! + glyph.length);
  const loca = spec.longLoca ? u32(...offsets) : u16(...offsets.map((offset) => offset / 2));
  const head = [...u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5), ...u16(0x0003, 1000), ...u32(0, 0, 0, 0), ...u16(0, 0, 1000, 1000, 0, 8, 2, spec.longLoca ? 1 : 0, 0)];
  const hhea = [...u32(0x00010000), ...u16(1000, 0, 0, 1000, 0, 0, 1000, 1, 0, 0, 0, 0, 0, 0, 0, count)];
  const maxp = [...u32(0x00010000), ...u16(count, 4, 1, 4, 2, 2, 0, 0, 0, 0, 0, 0, 0, 2)];
  const hmtx = spec.glyphs.flatMap((_, i) => u16(500 + i, 0));
  const post = [...u32(0x00030000, 0), ...u16(-100, 50), ...u32(0, 0, 0, 0, 0)];
  return sfnt({ glyf, cmap: cmapTable(spec), head, hhea, hmtx, loca, maxp, post, ...(spec.gsub ? { GSUB: spec.gsub } : {}), ...spec.extra }, spec.version);
}

// GSUB, assembled: a lookup per subtable, no scripts or features (the subsetter reads every lookup regardless).
const coverage = (...glyphs: number[]): number[] => u16(1, glyphs.length, ...glyphs);
const single1 = (glyphs: number[], delta: number): number[] => [...u16(1, 6, delta & 0xffff), ...coverage(...glyphs)];
const single2 = (pairs: [number, number][]): number[] => [...u16(2, 6 + pairs.length * 2, pairs.length, ...pairs.map(([, to]) => to)), ...coverage(...pairs.map(([from]) => from))];
/** Format 1 of types 2 (multiple) and 3 (alternate): one covered glyph, its output glyphs. */
const sequence = (glyph: number, outputs: number[]): number[] => [...u16(1, 8, 1, 14), ...coverage(glyph), ...u16(outputs.length, ...outputs)];
const ligature = (glyph: number, first: number, rest: number[]): number[] => [...u16(1, 8, 1, 14), ...coverage(first), ...u16(1, 4), ...u16(glyph, rest.length + 1, ...rest)];
const extension = (type: number, inner: number[]): number[] => [...u16(1, type), ...u32(8), ...inner];
const reverse = (glyph: number, substitute: number): number[] => [...u16(1, 12, 0, 0, 1, substitute), ...coverage(glyph)];

function gsub(lookups: [type: number, subtable: number[]][]): number[] {
  const tables = lookups.map(([type, subtable]) => [...u16(type, 0, 1, 8), ...subtable]);
  let at = 2 + tables.length * 2;
  const offsets = tables.map((table) => {
    const offset = at;
    at += table.length;
    return offset;
  });
  return [...u16(1, 0, 10, 12, 14), ...u16(0), ...u16(0), ...u16(tables.length, ...offsets), ...tables.flat()];
}

/** The tables of an sfnt, by tag. */
function tablesOf(font: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(at, at + 4));
    out.set(tag, font.subarray(view.getUint32(at + 8), view.getUint32(at + 8) + view.getUint32(at + 12)));
  }
  return out;
}

/** Each glyph's outline bytes. */
function outlines(font: Uint8Array): Uint8Array[] {
  const tables = tablesOf(font);
  const head = new DataView(tables.get('head')!.slice().buffer);
  const long = head.getInt16(50) === 1;
  const count = new DataView(tables.get('maxp')!.slice().buffer).getUint16(4);
  const loca = new DataView(tables.get('loca')!.slice().buffer);
  const glyf = tables.get('glyf')!;
  const offsets = Array.from({ length: count + 1 }, (_, g) => (long ? loca.getUint32(g * 4) : loca.getUint16(g * 2) * 2));
  for (let g = 0; g < count; g++) assert.ok(offsets[g]! <= offsets[g + 1]!, 'loca goes forward');
  assert.ok(offsets[count]! <= glyf.length, 'loca stays within glyf');
  return Array.from({ length: count }, (_, g) => glyf.subarray(offsets[g]!, offsets[g + 1]!));
}

/** Checks the sfnt's directory and checksums, and that everything but glyf, loca and head's checkSumAdjustment is unchanged. */
function assertValid(font: Uint8Array, original: Uint8Array): void {
  assert.equal(checksum(font, 0, font.length), 0xb1b0afba, 'whole-file checksum');
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  const selector = Math.floor(Math.log2(count));
  assert.deepEqual([view.getUint16(6), view.getUint16(8), view.getUint16(10)], [16 << selector, selector, count * 16 - (16 << selector)]);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tags.push(String.fromCharCode(...font.subarray(at, at + 4)));
    const offset = view.getUint32(at + 8);
    assert.equal(offset % 4, 0, 'tables start on 4-byte boundaries');
    const expected = tags.at(-1) === 'head' ? checksum(Uint8Array.from([...font.subarray(offset, offset + 8), 0, 0, 0, 0, ...font.subarray(offset + 12, offset + view.getUint32(at + 12))]), 0, view.getUint32(at + 12)) : checksum(font, offset, view.getUint32(at + 12));
    assert.equal(view.getUint32(at + 4), expected, `checksum of ${tags.at(-1)}`);
  }
  assert.deepEqual(tags, [...tags].sort(), 'tables in tag order');
  const before = tablesOf(original);
  const after = tablesOf(font);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [tag, data] of before) {
    if (tag === 'glyf' || tag === 'loca') continue;
    if (tag === 'head') {
      assert.deepEqual([...after.get(tag)!.subarray(0, 8), ...after.get(tag)!.subarray(12)], [...data.subarray(0, 8), ...data.subarray(12)]);
    } else assert.deepEqual(after.get(tag), data, `${tag} is copied as it is`);
  }
}

const HAN = 0x4e00;
const LOOSE: SubsetOptions = { minBulkGlyphs: 4, minSaving: 0.05 };

/**
 * Glyph 0 .notdef; 1–3 'A' 'B' 'C'; 4–43 forty ideographs from U+4E00; 44 unmapped and reached by nothing;
 * then whatever `more` adds (unmapped). Returns the spec, to be adjusted, and the glyph id of an ideograph.
 */
function baseSpec(more: number[][] = []): FontSpec {
  const glyphs = [square(0), square(1), square(2), square(3), ...Array.from({ length: 40 }, (_, i) => square(10 + i)), square(60), ...more];
  const cmap: [number, number][] = [[0x41, 1], [0x42, 2], [0x43, 3], ...Array.from({ length: 40 }, (_, i): [number, number] => [HAN + i, 4 + i])];
  return { glyphs, cmap };
}
const han = (i: number): number => 4 + i;
const EXTRA = 45;

describe('font subsets', () => {
  it('knows the bulk ranges and the counter ideographs', () => {
    for (const point of [0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xac00, 0xd7a3, 0xf900, 0xfaff, 0x20000, 0x323af, 0x2f800, 0x2fa1f]) assert.ok(isBulkCodePoint(point), point.toString(16));
    for (const point of [0x41, 0x3000, 0x3042, 0x30a2, 0x33ff, 0x4dc0, 0xa000, 0xab00, 0xd7a4, 0xe000, 0xff01, 0x1f600, 0x323b0]) assert.ok(!isBulkCodePoint(point), point.toString(16));
    for (const char of '一二十百千甲子零壹貳拾佰仟壱弐参萬일십백천') assert.ok(COUNTER_IDEOGRAPHS.includes(char), char);
  });

  it('reads the code points text may be drawn with, normalized forms too', () => {
    const points = (text: string): number[] => {
      const into = new Set<number>();
      addBulkCodePoints(text, into);
      return [...into].sort((a, b) => a - b);
    };
    // Decomposed Hangul (conjoining jamo, as macOS file names paste) is drawn as the composed syllables.
    assert.deepEqual(points('각힣'.normalize('NFD')), [0xac00, 0xac01, 0xd7a3 - 27, 0xd7a3]);
    // A compatibility ideograph, and the unified one it decomposes to.
    assert.deepEqual(points('\ufa30'), [0x4fae, 0xfa30]);
    assert.deepEqual(points('\u{2f800}'), [0x4e3d, 0x2f800]);
    // An LVT syllable (각) brings its LV syllable (가); an LV one only itself.
    assert.deepEqual(points('각'), [0xac00, 0xac01]);
    assert.deepEqual(points('가'), [0xac00]);
    // Astral ideographs are one code point each, not two halves.
    assert.deepEqual(points('\u{20000}\u{2a6d6}'), [0x20000, 0x2a6d6]);
    assert.deepEqual(points('汉字 and 漢字'), [0x5b57, 0x6c49, 0x6f22]);
    assert.deepEqual(points('Latin, kana かな, jamo ᄀ alone, ①, \ud840 lone surrogate'), []);
    assert.deepEqual(points(''), []);
  });

  it('drops unused ideographs and keeps everything else exactly', () => {
    for (const longLoca of [false, true]) {
      const spec = { ...baseSpec(), longLoca };
      const font = buildFont(spec);
      const out = subsetFont(font, new Set([HAN, HAN + 1, 0x41]), LOOSE);
      assert.ok(out, 'a subset');
      assertValid(out, font);
      const before = outlines(font);
      const after = outlines(out);
      assert.equal(after.length, before.length, 'glyph ids are kept');
      for (const g of [0, 1, 2, 3, han(0), han(1), 44]) assert.deepEqual(after[g], before[g], `glyph ${g} is kept`);
      for (let i = 2; i < 40; i++) assert.equal(after[han(i)]!.length, 0, `ideograph ${i} is dropped`);
      assert.ok(out.length < font.length);
    }
  });

  it('keeps what GSUB can make from kept glyphs, and only that', () => {
    const spec = baseSpec(Array.from({ length: 12 }, (_, i) => square(70 + i)));
    const [u1, u2, u3, u4, u5, u6, u7, u8, l1, l2, l3, r1] = Array.from({ length: 12 }, (_, i) => EXTRA + i) as number[] & { length: 12 };
    spec.gsub = gsub([
      // Single, transitively: 一 → u1 → u2; an unused ideograph's form u3 goes.
      [1, single2([[han(0), u1!], [han(5), u3!]])],
      [1, single1([u1!], u2! - u1!)],
      // Alternates and multiple, of a used ideograph.
      [3, sequence(han(0), [u4!, u5!])],
      [7, extension(2, sequence(han(1), [u6!, u7!]))],
      // Extension around a single substitution of an unused ideograph.
      [7, extension(1, single2([[han(6), u8!]]))],
      // Ligatures: all parts kept, one part dropped, all parts Latin.
      [4, ligature(l1!, han(0), [han(1)])],
      [4, ligature(l2!, han(0), [han(7)])],
      [4, ligature(l3!, 1, [2])],
      // Reverse chaining, from a Latin glyph.
      [8, reverse(3, r1!)],
      // Contextual lookups: nothing to follow of their own.
      [5, u16(1, 0, 0)],
      [6, u16(3, 0, 0, 0, 0)],
    ]);
    const font = buildFont(spec);
    const out = subsetFont(font, new Set([HAN, HAN + 1]), LOOSE);
    assert.ok(out);
    assertValid(out, font);
    const before = outlines(font);
    const after = outlines(out);
    for (const g of [u1, u2, u4, u5, u6, u7, l1, l3, r1]) assert.deepEqual(after[g!], before[g!], `glyph ${g} is kept`);
    for (const g of [u3, u8, l2, han(5), han(6), han(7)]) assert.equal(after[g!]!.length, 0, `glyph ${g} is dropped`);
  });

  it('keeps the components of kept composite glyphs', () => {
    // 一 is built of p1, which is built of p2; an unused ideograph of p3; 'A' of p4.
    const spec = baseSpec([square(80), square(81), square(82), square(83)]);
    const [p1, p2, p3, p4] = [EXTRA, EXTRA + 1, EXTRA + 2, EXTRA + 3];
    spec.glyphs[p1] = composite(p2);
    spec.glyphs[han(0)] = composite(p1, 1);
    spec.glyphs[han(3)] = composite(p3);
    spec.glyphs[1] = composite(p4);
    const font = buildFont(spec);
    const out = subsetFont(font, new Set([HAN]), LOOSE);
    assert.ok(out);
    assertValid(out, font);
    const before = outlines(font);
    const after = outlines(out);
    for (const g of [han(0), p1, p2, 1, p4]) assert.deepEqual(after[g], before[g], `glyph ${g} is kept`);
    for (const g of [han(3), p3]) assert.equal(after[g]!.length, 0, `glyph ${g} is dropped`);
  });

  it('keeps the variation glyphs of used ideographs', () => {
    const spec = baseSpec();
    // 一 + VS17 draws the glyph of U+4E10; U+4E11 + VS17 that of U+4E12; both of those unused themselves.
    spec.uvs = [[HAN, 0xe0100, han(0x10)], [HAN + 0x11, 0xe0100, han(0x12)]];
    const font = buildFont(spec);
    const out = subsetFont(font, new Set([HAN]), LOOSE);
    assert.ok(out);
    assertValid(out, font);
    const after = outlines(out);
    assert.deepEqual(after[han(0x10)], outlines(font)[han(0x10)]);
    assert.equal(after[han(0x12)]!.length, 0);
  });

  it('gives back a font it can read again', () => {
    const font = buildFont(baseSpec());
    const used = new Set([HAN + 3]);
    const out = subsetFont(font, used, LOOSE)!;
    const again = subsetFont(out, used, { minBulkGlyphs: 4, minSaving: 0 });
    // Nothing more to drop: left as it is, or the same font.
    assert.ok(again === null || Buffer.from(again).equals(Buffer.from(out)));
    // A subset of the subset drops more.
    const fewer = subsetFont(out, new Set<number>(), { minBulkGlyphs: 4, minSaving: 0 })!;
    assertValid(fewer, out);
    assert.equal(outlines(fewer)[han(3)]!.length, 0);
  });

  it('leaves fonts it does not fully understand whole', () => {
    const used = new Set([HAN]);
    const spec = baseSpec();
    const font = buildFont(spec);
    assert.ok(subsetFont(font, used, LOOSE), 'the plain font is subset');
    for (const version of [0x4f54544f, 0x74746366, 0x774f4632, 0x774f4646]) assert.equal(subsetFont(buildFont({ ...spec, version }), used, LOOSE), null, version.toString(16));
    assert.ok(subsetFont(buildFont({ ...spec, version: 0x74727565 }), used, LOOSE), "'true' fonts are TrueType");
    for (const tag of ['morx', 'mort', 'gvar', 'CFF ', 'CFF2', 'COLR', 'MATH']) assert.equal(subsetFont(buildFont({ ...spec, extra: { [tag]: [0, 0, 0, 0] } }), used, LOOSE), null, tag);
    assert.equal(subsetFont(buildFont({ ...spec, otherFormat: 0 }), used, LOOSE), null, 'cmap format 0');
    assert.equal(subsetFont(buildFont({ ...spec, otherFormat: 13 }), used, LOOSE), null, 'cmap format 13');
    assert.equal(subsetFont(buildFont({ ...spec, gsub: gsub([[9, u16(1)]]) }), used, LOOSE), null, 'GSUB lookup type 9');
    assert.equal(subsetFont(buildFont({ ...spec, gsub: gsub([[1, u16(3, 0, 0)]]) }), used, LOOSE), null, 'single substitution format 3');
    assert.equal(subsetFont(buildFont({ ...spec, gsub: gsub([[7, extension(7, [])]]) }), used, LOOSE), null, 'nested extension');
    // Thresholds: the defaults want 512 ideographs; a small saving is not worth it.
    assert.equal(subsetFont(font, used), null, 'too few ideographs');
    assert.equal(subsetFont(font, used, { minBulkGlyphs: 4, minSaving: 0.99 }), null, 'too small a saving');
  });

  it('never throws on broken input', () => {
    const font = buildFont({ ...baseSpec(), gsub: gsub([[1, single2([[han(0), EXTRA - 1]])]]) });
    const used = new Set([HAN]);
    assert.ok(subsetFont(font, used, LOOSE));
    for (let length = 0; length < font.length; length += 7) assert.equal(subsetFont(font.subarray(0, length), used, LOOSE), null, `cut at ${length}`);
    let seed = 1;
    const random = (): number => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    for (let n = 0; n < 200; n++) {
      // Garbage, and the font with a few bytes overwritten (whatever comes back must be a sound font).
      assert.equal(subsetFont(Uint8Array.from({ length: 64 + n * 13 }, random), used, LOOSE), null);
      const broken = font.slice();
      for (let k = 0; k < 4; k++) broken[12 + (random() * 256 + random()) % (broken.length - 12)] = random();
      const out = subsetFont(broken, used, LOOSE);
      if (out) assert.equal(checksum(out, 0, out.length), 0xb1b0afba);
    }
  });
});
