/**
 * Reading font files for PowerPoint font embedding, and wrapping a
 * TrueType face the way PowerPoint stores it.
 *
 * PowerPoint embeds TrueType only (glyf outlines), stored in the package
 * as `ppt/fonts/fontN.fntdata`: an Embedded OpenType (EOT, version
 * 0x00020002) header followed by the uncompressed TrueType file. Whether a
 * face may be embedded at all is the face's own OS/2 `fsType`.
 *
 * Pure: no DOM, unit-tested directly.
 */

/** What kind of font file some bytes are. */
export type FontFlavor = 'unknown' | 'truetype' | 'cff' | 'collection' | 'woff' | 'woff2';

/** Names from the `name` table. */
export interface FontNames {
  family?: string;
  subfamily?: string;
  full?: string;
  version?: string;
  copyright?: string;
  licence?: string;
}

/** The parts of the OS/2 table embedding needs. */
export interface FontOs2 {
  fsType: number;
  weightClass: number;
  italic: boolean;
  panose: number[];
  unicodeRange: [number, number, number, number];
  codePageRange: [number, number];
}

/** What a font file is and holds. */
export interface FontTables {
  flavor: FontFlavor;
  /** Table tags present (sfnt files only). */
  tables: string[];
  /** Bytes the file really spans (its tables, 4-byte aligned); WOFF2: the decoded size. */
  extent?: number;
  names: FontNames;
  cmap?: DataView;
  os2?: FontOs2;
  /** `head.checkSumAdjustment`. */
  checkSumAdjustment?: number;
}

const TAG_TRUE = 0x00010000;
const TAG_TRUE_MAC = 0x74727565; // 'true'
const TAG_CFF = 0x4f54544f; // 'OTTO'
const TAG_COLLECTION = 0x74746366; // 'ttcf'
const TAG_WOFF = 0x774f4646; // 'wOFF'
const TAG_WOFF2 = 0x774f4632; // 'wOF2'
/** Name ids read: copyright, family, subfamily, full name, version, licence. */
const NAME_IDS = [0, 1, 2, 4, 5, 13];
/** Longest name read (copyright and licence may be long). */
const MAX_NAME = 510;
const MAX_LONG_NAME = 16384;

const tagText = (value: number): string => String.fromCharCode((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);

/** Reads what a font file is: its flavor, tables, names and OS/2 values. */
export function readFontTables(bytes: Uint8Array): FontTables {
  const bare = (flavor: FontFlavor): FontTables => ({ flavor, tables: [], names: {} });
  if (bytes.byteLength < 12) return bare('unknown');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = view.getUint32(0);
  if (tag === TAG_COLLECTION) return bare('collection');
  if (tag === TAG_WOFF) return bare('woff');
  if (tag === TAG_WOFF2) return bytes.byteLength >= 20 ? { ...bare('woff2'), extent: view.getUint32(16) } : bare('woff2');
  if (tag !== TAG_TRUE && tag !== TAG_TRUE_MAC && tag !== TAG_CFF) return bare('unknown');
  const count = view.getUint16(4);
  if (bytes.byteLength < 12 + count * 16) return bare('unknown');
  const tables = new Map<string, { offset: number; length: number }>();
  let end = 12 + count * 16;
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > bytes.byteLength) continue;
    tables.set(tagText(view.getUint32(at)), { offset, length });
    end = Math.max(end, offset + length);
  }
  const out: FontTables = {
    flavor: tag === TAG_CFF ? 'cff' : 'truetype',
    tables: [...tables.keys()],
    extent: Math.min(bytes.byteLength, Math.ceil(end / 4) * 4),
    names: {},
  };
  const cmap = tables.get('cmap');
  if (cmap) out.cmap = new DataView(bytes.buffer, bytes.byteOffset + cmap.offset, cmap.length);
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 78) {
    const o = os2.offset;
    out.os2 = {
      fsType: view.getUint16(o + 8),
      weightClass: view.getUint16(o + 4),
      italic: (view.getUint16(o + 62) & 1) === 1,
      panose: Array.from(bytes.subarray(o + 32, o + 42)),
      unicodeRange: [view.getUint32(o + 42), view.getUint32(o + 46), view.getUint32(o + 50), view.getUint32(o + 54)],
      codePageRange: os2.length >= 86 ? [view.getUint32(o + 78), view.getUint32(o + 82)] : [0, 0],
    };
  }
  const head = tables.get('head');
  if (head && head.length >= 12) out.checkSumAdjustment = view.getUint32(head.offset + 8);
  const name = tables.get('name');
  if (name && name.length >= 6) out.names = readNames(bytes, view, name.offset, name.length);
  return out;
}

/** The names of a `name` table: Windows English first, then Unicode, then Mac Roman. */
function readNames(bytes: Uint8Array, view: DataView, start: number, length: number): FontNames {
  const count = view.getUint16(start + 2);
  const strings = start + view.getUint16(start + 4);
  const found = new Map<number, { rank: number; text: string }>();
  for (let i = 0; i < count; i++) {
    const at = start + 6 + i * 12;
    if (at + 12 > start + length) break;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const language = view.getUint16(at + 4);
    const id = view.getUint16(at + 6);
    const size = view.getUint16(at + 8);
    const offset = strings + view.getUint16(at + 10);
    if (!NAME_IDS.includes(id) || offset + size > bytes.byteLength || size > (id === 0 || id === 13 ? MAX_LONG_NAME : MAX_NAME)) continue;
    let rank = 0;
    if (platform === 3 && (encoding === 1 || encoding === 10) && language === 1033) rank = 3;
    else if (platform === 0) rank = 2;
    else if (platform === 1 && encoding === 0 && language === 0) rank = 1;
    else continue;
    if ((found.get(id)?.rank ?? 0) >= rank) continue;
    let text = '';
    if (platform === 1) for (let j = 0; j < size; j++) text += String.fromCharCode(bytes[offset + j]!);
    else for (let j = 0; j + 1 < size; j += 2) text += String.fromCharCode(view.getUint16(offset + j));
    found.set(id, { rank, text });
  }
  return {
    family: found.get(1)?.text,
    subfamily: found.get(2)?.text,
    full: found.get(4)?.text,
    version: found.get(5)?.text,
    copyright: found.get(0)?.text,
    licence: found.get(13)?.text,
  };
}

/**
 * OS/2 `fsType` allows embedding in a document that stays editable: not
 * "bitmap only", and installable (0) or editable (bit 3). Restricted (bit
 * 1) and preview & print (bit 2) are not enough to edit the deck.
 */
export function fsTypeAllowsEmbedding(fsType: number): boolean {
  if ((fsType & 0x200) !== 0) return false;
  if ((fsType & 0x8) !== 0) return true;
  return (fsType & 0x6) === 0;
}

/** The face's PANOSE as the 20 hex digits `p:font panose` takes (undefined when all zero). */
export function panoseHex(info: FontTables): string | undefined {
  const panose = info.os2?.panose;
  if (!panose || panose.every((n) => n === 0)) return undefined;
  return panose.map((n) => n.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/** UTF-16LE bytes of a string. */
function utf16le(text = ''): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return out;
}

/** Magic number of an EOT header ('LP'). */
export const EOT_MAGIC = 0x504c;
/** EOT version written (2.2: names, root string, EUDC and signature fields). */
export const EOT_VERSION = 0x00020002;

/**
 * Wraps an uncompressed TrueType face in an EOT header, which is what
 * PowerPoint stores as `.fntdata`. No MTX compression, no XOR obfuscation.
 */
export function wrapEot(ttf: Uint8Array, info: FontTables = readFontTables(ttf)): Uint8Array {
  const names = [info.names.family, info.names.subfamily, info.names.version, info.names.full].map((name) => utf16le(name));
  const header = 80 + names.reduce((sum, name) => sum + 4 + name.byteLength, 0) + 24;
  const out = new Uint8Array(header + ttf.byteLength);
  const view = new DataView(out.buffer);
  const os2 = info.os2;
  let at = 0;
  view.setUint32(at, out.byteLength, true);
  at += 4;
  view.setUint32(at, ttf.byteLength, true);
  at += 4;
  view.setUint32(at, EOT_VERSION, true);
  at += 4;
  view.setUint32(at, 0, true); // Flags: not compressed, not XOR-ed.
  at += 4;
  out.set(os2?.panose.slice(0, 10) ?? new Array(10).fill(0), at);
  at += 10;
  out[at++] = 1; // Charset: DEFAULT_CHARSET.
  out[at++] = os2?.italic ? 1 : 0;
  view.setUint32(at, os2?.weightClass ?? 400, true);
  at += 4;
  view.setUint16(at, os2?.fsType ?? 0, true);
  at += 2;
  view.setUint16(at, EOT_MAGIC, true);
  at += 2;
  for (const range of os2?.unicodeRange ?? [0, 0, 0, 0]) {
    view.setUint32(at, range, true);
    at += 4;
  }
  for (const range of os2?.codePageRange ?? [0, 0]) {
    view.setUint32(at, range, true);
    at += 4;
  }
  view.setUint32(at, info.checkSumAdjustment ?? 0, true);
  at += 4;
  at += 16; // Reserved 1–4.
  for (const name of names) {
    at += 2; // Padding.
    view.setUint16(at, name.byteLength, true);
    at += 2;
    out.set(name, at);
    at += name.byteLength;
  }
  at += 2; // Padding.
  view.setUint16(at, 0, true); // Root string size.
  at += 2;
  view.setUint32(at, 0x50475342, true); // Root string checksum (no root string).
  at += 4;
  view.setUint32(at, 0, true); // EUDC code page.
  at += 4;
  at += 2; // Padding.
  view.setUint16(at, 0, true); // Signature size.
  at += 2;
  view.setUint32(at, 0, true); // EUDC flags.
  at += 4;
  view.setUint32(at, 0, true); // EUDC font size.
  at += 4;
  out.set(ttf, at);
  return out;
}

/** Unicode cmap lookup for TrueType's segmented BMP and full-Unicode tables.
 * Only inspect characters the slide actually uses. Invalid offsets mean no glyph. */
export function containsGlyph(cmap: DataView | undefined, code: number): boolean {
  if (!cmap || cmap.byteLength < 4) return false;
  const count = cmap.getUint16(2);
  for (let record = 4; record < 4 + count * 8 && record + 8 <= cmap.byteLength; record += 8) {
    const platform = cmap.getUint16(record);
    const encoding = cmap.getUint16(record + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const table = cmap.getUint32(record + 4);
    if (table + 16 > cmap.byteLength) continue;
    const format = cmap.getUint16(table);
    if (format !== 4 && format !== 12) continue;
    const full = format === 12;
    const length = full ? cmap.getUint32(table + 4) : cmap.getUint16(table + 2);
    const segments = full ? cmap.getUint32(table + 12) : cmap.getUint16(table + 6) / 2;
    if (!Number.isInteger(segments) || table + length > cmap.byteLength || length < 16 + segments * (full ? 12 : 8)) continue;
    let low = 0;
    let high = segments;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const end = full ? cmap.getUint32(table + 20 + mid * 12) : cmap.getUint16(table + 14 + mid * 2);
      if (end < code) low = mid + 1;
      else high = mid;
    }
    if (low === segments) continue;
    if (full) {
      const group = table + 16 + low * 12;
      const start = cmap.getUint32(group);
      if (code >= start && cmap.getUint32(group + 8) + code - start !== 0) return true;
    } else {
      const startAt = table + 16 + 2 * (segments + low);
      const start = cmap.getUint16(startAt);
      if (code < start) continue;
      const delta = cmap.getInt16(startAt + 2 * segments);
      const rangeAt = startAt + 4 * segments;
      const range = cmap.getUint16(rangeAt);
      const glyphAt = rangeAt + range + 2 * (code - start);
      if (range && glyphAt + 2 > table + length) continue;
      const base = range ? cmap.getUint16(glyphAt) : code;
      if ((!range || base) && ((base + delta) & 0xffff)) return true;
    }
  }
  return false;
}
