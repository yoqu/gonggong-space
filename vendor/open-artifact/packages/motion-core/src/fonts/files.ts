import { BUILTIN_FONTS, type BuiltinFont } from './builtin.ts';

/** One woff2 file in the package's `fonts/` folder, and the typeface it belongs to. */
export interface BuiltinFontFileInfo {
  fontId: string;
  family: string;
  /** The weight range it is declared with. */
  weight: string;
  style: 'normal' | 'italic';
  bytes: number;
  /** Its licence file in the same folder. */
  licence: string;
}

const FILE_BYTES: Readonly<Record<string, number>> = {
  'DMMono-500.woff2': 9176,
  'DepartureMono-400.woff2': 6748,
  'FrauncesOpsz360-i.woff2': 42968,
  'FrauncesOpsz360.woff2': 35748,
  'FrauncesText.woff2': 33948,
  'InstrumentSans-700.woff2': 16476,
  'InstrumentSansVar.woff2': 27896,
  'InterDisplay-600.woff2': 36504,
  'InterDisplay-800.woff2': 36928,
  'InterDisplay-900.woff2': 34688,
  'Manrope-500.woff2': 14264,
  'Manrope-600.woff2': 14352,
  'Manrope-700.woff2': 14464,
  'Manrope-800.woff2': 13900,
  'PlusJakartaSans-500.woff2': 15416,
  'PlusJakartaSans-600.woff2': 15432,
  'PlusJakartaSans-700.woff2': 15420,
  'ShantellSans-480.woff2': 29356,
  'ShantellSans-650i.woff2': 31372,
  'SpaceGrotesk-400.woff2': 16128,
  'SpaceGrotesk-500.woff2': 16020,
  'SpaceGrotesk-600.woff2': 16000,
  'SpaceGrotesk-700.woff2': 15268,
};

/** The licence files' name stems: a font file belongs to the one its name starts with. */
export const BUILTIN_FONT_LICENCE_STEMS = [
  'DepartureMono',
  'DMMono',
  'Fraunces',
  'InstrumentSans',
  'InterDisplay',
  'Manrope',
  'PlusJakartaSans',
  'ShantellSans',
  'SpaceGrotesk',
] as const;
export type BuiltinFontLicenceStem = (typeof BUILTIN_FONT_LICENCE_STEMS)[number];

/** The licence stem a built-in font file name (`Manrope-500.woff2`) starts with. */
export const builtinFontLicenceStem = (file: string): BuiltinFontLicenceStem | undefined =>
  BUILTIN_FONT_LICENCE_STEMS.find((stem) => file.startsWith(stem));

function fileEntries(font: BuiltinFont): Array<[string, BuiltinFontFileInfo]> {
  return font.files.map((file) => {
    const stem = builtinFontLicenceStem(file.file);
    const bytes = FILE_BYTES[file.file];
    if (stem === undefined || bytes === undefined) throw new Error(`no file for ${file.file}`);
    return [file.file, { fontId: font.id, family: font.name, weight: file.weight, style: file.style ?? 'normal', bytes, licence: `${stem}-OFL.txt` }];
  });
}

/** Every font file the package carries, by file name. */
export const BUILTIN_FONT_FILES: ReadonlyMap<string, BuiltinFontFileInfo> = new Map(BUILTIN_FONTS.flatMap(fileEntries));

export const BUILTIN_FONT_FILES_TOTAL_BYTES: number = [...BUILTIN_FONT_FILES.values()].reduce((sum, file) => sum + file.bytes, 0);

const FONTS_FOLDER = '../../fonts/';

/** The package's `fonts/` folder (font files and their licences), for a build that copies it. */
export const BUILTIN_FONT_FILES_DIR: URL = new URL(FONTS_FOLDER, import.meta.url);

/**
 * A built-in font file's URL. The literal template lets a bundler (Vite) find every file under `fonts/` and emit it
 * as an asset; in Node it is a `file:` URL.
 */
export const builtinFontFileUrl = (file: string): URL => new URL(`../../fonts/${file}`, import.meta.url);

/** A licence file's URL (`Manrope-OFL.txt`). */
export const builtinFontLicenceFileUrl = (stem: BuiltinFontLicenceStem): URL => new URL(`../../fonts/${stem}-OFL.txt`, import.meta.url);
