import { GOOGLE_FONT_LIMITS } from './google.ts';

/** A table of a woff2 file: its known-table index, or its tag when the file spells it out. */
export type Woff2Table = number | string;

/** Bitmap and colour tables: a film carries outline fonts only. */
const DISALLOWED_WOFF2_TABLES = new Set<Woff2Table>([15, 16, 32, 33, 36, 37, 40, 41, 'EBDT', 'EBLC', 'CBDT', 'CBLC', 'SVG ', 'sbix', 'bdat', 'bloc']);
/** glyf and loca, whose transform version 0 is the transformed form (and 3 the null one). */
const OUTLINE_TABLES = new Set<Woff2Table>([10, 11, 'glyf', 'loca']);

const WOFF2_SIGNATURE = 0x774f4632;
const WOFF2_FLAVORS = [0x00010000, 0x4f54544f, 0x74727565];
const WOFF2_HEADER_BYTES = 48;
const MAX_SFNT_BYTES = 4_194_304;
const MAX_TABLES = 512;

const readUint32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;

/** The tables a woff2 file's directory lists, or `null` when the directory does not read. */
export function validateWoff2Directory(bytes: Uint8Array): Woff2Table[] | null {
  let at = WOFF2_HEADER_BYTES;
  const readBase128 = (): boolean => {
    for (let index = 0, value = 0; index < 5 && at < bytes.length; index++) {
      const byte = bytes[at++]!;
      if ((index === 0 && byte === 0x80) || value > 0x1ffffff) return false;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return true;
    }
    return false;
  };
  const count = (bytes[12]! << 8) | bytes[13]!;
  if (count === 0 || count > MAX_TABLES) return null;
  const tables: Woff2Table[] = [];
  for (let left = count; left > 0; left--) {
    if (at >= bytes.length) return null;
    const flags = bytes[at++]!;
    const [index, transform] = [flags & 0x3f, flags >> 6];
    if (index === 63 && at + 4 > bytes.length) return null;
    const table: Woff2Table = index === 63 ? String.fromCharCode(...bytes.subarray(at, (at += 4))) : index;
    const lengthsRead = readBase128();
    const transformBad = OUTLINE_TABLES.has(table)
      ? transform === 1 || transform === 2 || (transform === 0 && !readBase128())
      : transform >= 2 || (transform === 1 && !readBase128());
    if (!lengthsRead || transformBad) return null;
    tables.push(table);
  }
  return tables;
}

const hasAllowedWoff2Tables = (bytes: Uint8Array): boolean => {
  const tables = validateWoff2Directory(bytes);
  return tables !== null && !tables.some((table) => DISALLOWED_WOFF2_TABLES.has(table));
};

/** True when the file has an fvar table, which makes a font variable. */
export const hasVariationTable = (bytes: Uint8Array): boolean => validateWoff2Directory(bytes)?.some((table) => table === 47 || table === 'fvar') === true;

/** An axis (`"100 900"`, the weights one variable file covers), believed only when the file has an fvar table. */
export function confirmedFontAxis(axis: unknown, bytes: Uint8Array): string | undefined {
  if (typeof axis !== 'string') return undefined;
  const match = /^([1-9]00) ([1-9]00)$/.exec(axis);
  return match !== null && Number(match[1]) < Number(match[2]) && hasVariationTable(bytes) ? axis : undefined;
}

/** True for a woff2 file within the size limit, whole, with a readable directory and no bitmap or colour tables. */
export function isUsableWoff2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= WOFF2_HEADER_BYTES &&
    bytes.length <= GOOGLE_FONT_LIMITS.fileBytes &&
    readUint32(bytes, 0) === WOFF2_SIGNATURE &&
    WOFF2_FLAVORS.includes(readUint32(bytes, 4)) &&
    readUint32(bytes, 8) === bytes.length &&
    ((bytes[14]! << 8) | bytes[15]!) === 0 &&
    readUint32(bytes, 16) <= MAX_SFNT_BYTES &&
    hasAllowedWoff2Tables(bytes)
  );
}

const BASE64_CHUNK = 32_768;

export function woff2DataUri(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  return `data:font/woff2;base64,${btoa(binary)}`;
}
