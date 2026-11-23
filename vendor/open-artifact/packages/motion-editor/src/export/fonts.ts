/**
 * The typefaces the page adds to a film, for its code exports: the built-in ones its scenes name, and the Google Fonts
 * families fetched for it, each with the licence text that must travel with its files. A family whose licence text is
 * unknown, or whose licence reserves its name, is listed with no text, so the ZIP leaves it out and says so.
 */

import {
  builtinFontFileUrl,
  builtinFontLicenceOf,
  builtinFontLicenceRecord,
  fontLicenceProblem,
  googleFontLicenceRecord,
  readFilmFontSlots,
  readFontLicenceNotices,
  type BuiltinFont,
  type Film,
  type FontLicenceNotice as CoreLicenceNotice,
  type StoredFontFamily,
} from '@open-artifact/motion-core';
import type { FontLicenceNotice, SourceFont } from '@open-artifact/motion-export';
import type { FilmRecords } from '../engine/records.ts';
import { assetBytes } from '../host/assets.ts';

async function fetchBytes(url: URL): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The built-in typefaces the film's slots show, each once. */
export function builtinFontsOf(film: Pick<Film, 'modules'>): BuiltinFont[] {
  const fonts = Object.values(readFilmFontSlots(film.modules).faces);
  return fonts.filter((font, index) => fonts.findIndex((other) => other.id === font.id) === index);
}

async function builtinSourceFont(font: BuiltinFont): Promise<SourceFont> {
  const first = font.files[0];
  const licence = first === undefined ? undefined : builtinFontLicenceOf(first.file);
  const files = await Promise.all(font.files.map(async (file) => ({ name: file.file, bytes: await fetchBytes(builtinFontFileUrl(file.file)) })));
  const whole = files.every((file) => file.bytes !== null);
  return {
    family: font.name,
    licence: 'OFL-1.1',
    licenceText: licence === undefined ? null : builtinFontLicenceRecord(licence).text,
    files: whole ? files.flatMap((file) => (file.bytes === null ? [] : [{ name: file.name, bytes: file.bytes }])) : [],
  };
}

const faceFileName = (family: string, weight: string, index: number): string =>
  `${family.replace(/[^A-Za-z0-9]+/g, '')}-${weight.replace(' ', '-')}-${index + 1}.woff2`;

/** The licence a fetched family travels under: the package's inventory first, then what the record kept. */
export function fetchedFamilyNotice(family: StoredFontFamily, inventory: ReadonlyMap<string, CoreLicenceNotice> | null): CoreLicenceNotice | undefined {
  const known = inventory?.get(family.family);
  if (known !== undefined) return known;
  return family.licence !== undefined && family.notice !== undefined ? { licence: family.licence, notice: family.notice } : undefined;
}

async function fetchedSourceFont(family: StoredFontFamily, notice: CoreLicenceNotice | undefined): Promise<SourceFont> {
  const allowed = fontLicenceProblem(notice) === null && notice !== undefined;
  const files = allowed
    ? await Promise.all(
        family.faces.map(async (face, index) => {
          const bytes = await assetBytes(face.ref);
          return bytes === null ? null : { name: faceFileName(family.family, face.weight, index), bytes: new Uint8Array(bytes) };
        }),
      )
    : [];
  return {
    family: family.family,
    licence: notice?.licence ?? 'OFL-1.1',
    licenceText: allowed ? googleFontLicenceRecord(family.family, notice).text : null,
    files: files.every((file) => file !== null) ? files.flatMap((file) => (file === null ? [] : [file])) : [],
  };
}

/** Every typeface the page adds to the film, with its files and licence. */
export async function exportFonts(film: Pick<Film, 'modules'>, records: Pick<FilmRecords, 'fetchedFonts'>): Promise<SourceFont[]> {
  const fetched = records.fetchedFonts?.families ?? [];
  const inventory = fetched.length === 0 ? null : await readFontLicenceNotices(fetched.map((family) => family.family));
  const builtins = await Promise.all(builtinFontsOf(film).map(builtinSourceFont));
  const families = await Promise.all(fetched.map((family) => fetchedSourceFont(family, fetchedFamilyNotice(family, inventory))));
  return [...builtins, ...families];
}

/** The licences a standalone page carries at its end: those of the typefaces that went into it. */
export function licenceNotices(fonts: readonly SourceFont[]): FontLicenceNotice[] {
  return fonts.flatMap((font) => (font.licenceText === null || font.files.length === 0 ? [] : [{ family: font.family, licence: font.licence, text: font.licenceText }]));
}
