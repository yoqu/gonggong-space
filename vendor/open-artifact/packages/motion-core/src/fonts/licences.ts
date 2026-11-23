import { isPlainObject } from '../json.ts';
import { builtinFontLicenceStem, type BuiltinFontLicenceStem } from './files.ts';
import { ALLOWED_FONT_LICENCES, type FontLicence } from './google.ts';
import { FONT_LICENCE_INVENTORY_GZIP } from './licence-inventory-data.ts';
import { OFL_1_1_TEXT } from './ofl-text.ts';
import { GOOGLE_FONT_FILE_NOTICE, MANROPE_FONT_NOTICE, MODIFIED_FONT_NOTICE } from './words.ts';

interface BuiltinLicenceSource {
  name: string;
  copyright: string;
  faq: string;
  /** Most of the families' files keep a space after "embedded," in the licence's text. */
  spaced: boolean;
  files: string;
}

const BUILTIN_LICENCE_SOURCES: Readonly<Record<BuiltinFontLicenceStem, BuiltinLicenceSource>> = {
  DepartureMono: {
    name: 'Departure Mono',
    copyright: 'Copyright 2022–2024 Helena Zhang (helenazhang.com).',
    faq: 'https://openfontlicense.org',
    spaced: false,
    files: MODIFIED_FONT_NOTICE,
  },
  DMMono: {
    name: 'DM Mono',
    copyright: 'Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono)',
    faq: 'http://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
  Fraunces: {
    name: 'Fraunces',
    copyright: 'Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)',
    faq: 'http://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
  InstrumentSans: {
    name: 'Instrument Sans',
    copyright: 'Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans)',
    faq: 'https://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
  InterDisplay: {
    name: 'Inter Display',
    copyright: 'Copyright 2016 The Inter Project Authors',
    faq: 'http://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
  Manrope: {
    name: 'Manrope',
    copyright: 'Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope)',
    faq: 'http://scripts.sil.org/OFL',
    spaced: false,
    files: MANROPE_FONT_NOTICE,
  },
  PlusJakartaSans: {
    name: 'Plus Jakarta Sans',
    copyright: 'Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)',
    faq: 'http://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
  ShantellSans: {
    name: 'Shantell Sans',
    copyright: 'Copyright 2022 The Shantell Sans Project Authors (https://github.com/arrowtype/shantell-sans)',
    faq: 'http://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
  SpaceGrotesk: {
    name: 'Space Grotesk',
    copyright: 'Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)',
    faq: 'http://scripts.sil.org/OFL',
    spaced: true,
    files: MODIFIED_FONT_NOTICE,
  },
};

/** A built-in family's licence: its name, the text of its `-OFL.txt` file, and what was done to its files. */
export interface BuiltinFontLicence {
  stem: BuiltinFontLicenceStem;
  name: string;
  licence: string;
  files: string;
}

function builtinLicenceText({ copyright, faq, spaced }: BuiltinLicenceSource): string {
  const body = spaced ? OFL_1_1_TEXT.replace('embedded,\nredistributed', 'embedded, \nredistributed') : OFL_1_1_TEXT;
  return `${copyright}\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\nThis license is copied below, and is also available with a FAQ at:\n${faq}\n\n\n${body}`;
}

export function builtinFontLicence(stem: BuiltinFontLicenceStem): BuiltinFontLicence {
  const source = BUILTIN_LICENCE_SOURCES[stem];
  return { stem, name: source.name, licence: builtinLicenceText(source), files: source.files };
}

/** The licence of a built-in font file (`Manrope-500.woff2`), else `undefined`. */
export function builtinFontLicenceOf(file: string): BuiltinFontLicence | undefined {
  const stem = builtinFontLicenceStem(file);
  return stem === undefined ? undefined : builtinFontLicence(stem);
}

/** The licence file a family's text goes in, by its licence. */
export const FONT_LICENCE_FILE_NAMES: Readonly<Record<FontLicence, string>> = {
  'OFL-1.1': 'OFL.txt',
  'OFL-1.0': 'OFL.txt',
  'Apache-2.0': 'LICENSE.txt',
  'UFL-1.0': 'UFL.txt',
};

/** One licence file of an export, and the faces it covers. */
export interface FontLicenceRecord<Face = unknown> {
  name: string;
  from: 'built-in' | 'film';
  file: string;
  text: string;
  faces: Face[];
}

export function fontLicenceRecord<Face = unknown>(name: string, from: 'built-in' | 'film', file: string, filesNotice: string, licence: string): FontLicenceRecord<Face> {
  return { name, from, file, text: `${name}\n${filesNotice}\n\n${licence.trim()}\n`, faces: [] };
}

export const builtinFontLicenceRecord = <Face = unknown>(licence: BuiltinFontLicence): FontLicenceRecord<Face> =>
  fontLicenceRecord<Face>(licence.name, 'built-in', 'OFL.txt', licence.files, licence.licence);

/** A Google Fonts family's licence and its copyright lines with the licence's text. */
export interface FontLicenceNotice {
  licence: FontLicence;
  notice: string;
}

export const googleFontLicenceRecord = <Face = unknown>(family: string, notice: FontLicenceNotice): FontLicenceRecord<Face> =>
  fontLicenceRecord<Face>(family, 'film', FONT_LICENCE_FILE_NAMES[notice.licence], GOOGLE_FONT_FILE_NOTICE, notice.notice);

/**
 * Why a family's files may not go into an export: no licence text known, or a licence (the Ubuntu Font Licence)
 * whose reserved name a renamed copy would break; `null` when they may.
 */
export function fontLicenceProblem(notice: FontLicenceNotice | undefined): 'no-license-text' | 'reserved-name' | null {
  if (notice === undefined) return 'no-license-text';
  return notice.licence === 'UFL-1.0' ? 'reserved-name' : null;
}

/** Each family's copyright lines and licence text, as the package carries them. */
export interface FontLicenceInventory {
  families: Record<string, readonly [number, string]>;
  texts: ReadonlyArray<readonly [FontLicence, string]>;
}

const isLicence = (value: unknown): value is FontLicence => typeof value === 'string' && (ALLOWED_FONT_LICENCES as readonly string[]).includes(value);

/** The inventory from its JSON, or `null` when it is not one. */
export function parseFontLicenceInventory(value: unknown): FontLicenceInventory | null {
  if (!isPlainObject(value) || !isPlainObject(value.families) || !Array.isArray(value.texts)) return null;
  const texts: Array<readonly [FontLicence, string]> = [];
  for (const entry of value.texts) {
    if (!Array.isArray(entry) || !isLicence(entry[0]) || typeof entry[1] !== 'string') return null;
    texts.push([entry[0], entry[1]]);
  }
  const families: Record<string, readonly [number, string]> = {};
  for (const [family, entry] of Object.entries(value.families)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || texts[entry[0]] === undefined || typeof entry[1] !== 'string') return null;
    families[family] = [entry[0], entry[1]];
  }
  return { families, texts };
}

/** Gunzips base64 text; the default uses the platform's DecompressionStream. */
export type GunzipText = (base64: string) => Promise<string>;

export const gunzipBase64Text: GunzipText = async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
};

let inventory: Promise<FontLicenceInventory | null> | undefined;

/** The inventory the package carries, decoded once. */
export function readFontLicenceInventory(gunzip: GunzipText = gunzipBase64Text): Promise<FontLicenceInventory | null> {
  inventory ??= gunzip(FONT_LICENCE_INVENTORY_GZIP)
    .then((text) => parseFontLicenceInventory(JSON.parse(text)))
    .catch(() => null);
  return inventory;
}

/** The licence and notice of each family the inventory has. */
export function fontLicenceNotices(source: FontLicenceInventory, families: readonly string[]): Map<string, FontLicenceNotice> {
  return new Map(
    families.flatMap((family) => {
      if (!Object.hasOwn(source.families, family)) return [];
      const [index, copyright] = source.families[family]!;
      const [licence, text] = source.texts[index]!;
      return [[family, { licence, notice: `${copyright}\n\n${text}` }] as const];
    }),
  );
}

/** The notices of the families, or `null` when the inventory cannot be read. */
export async function readFontLicenceNotices(families: readonly string[], gunzip?: GunzipText): Promise<Map<string, FontLicenceNotice> | null> {
  const source = await readFontLicenceInventory(gunzip);
  return source === null ? null : fontLicenceNotices(source, families);
}
