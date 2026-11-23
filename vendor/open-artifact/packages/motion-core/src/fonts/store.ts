import { storeBytes } from '../json.ts';
import { MAX_MODULES, MAX_MODULE_COLLECTION_BYTES } from '../limits.ts';
import { FETCHED_FONTS_MODULE } from '../names.ts';
import { parseFetchedFontsRecord, serializeFetchedFontsRecord, type StoredFontFace, type StoredFontFamily } from '../records/fetched-fonts.ts';
import { parseCatalogFontRequest } from './catalog.ts';
import type { FontLicenceNotice } from './licences.ts';
import type { FontStoreFamily, FontStoreUpdate } from './prepare.ts';

/** An upload that has not answered in this long is given up (and removed if it answers later). */
export const FONT_UPLOAD_TIMEOUT_MS = 20_000;
/** How long a save of `fetched-fonts.json` is waited for. */
export const FONT_UPLOAD_COOLDOWN_MS = 30_000;
/** An idle write waits this long for the film to finish loading. */
export const FONT_UPLOAD_IDLE_WAIT_MS = 10_000;
/** Font files uploaded in one page's life, at most: three times a film's worth. */
export const FONT_UPLOAD_MAX_FILES = 36;
/** Module slots kept free for other writes when `fetched-fonts.json` would be a new module. */
export const FONT_UPLOAD_MAX_RETRIES = 5;

/** The ref a face gets while its upload is planned, to check the record before anything is uploaded. */
export const PLACEHOLDER_FONT_REF = `_blob/${'0'.repeat(32)}`;

/** The families of an update that may be stored: those whose licence and copyright notice are known. */
export function licensedStoreFamilies(update: FontStoreUpdate, notices: ReadonlyMap<string, FontLicenceNotice> | null): FontStoreFamily[] {
  return update.families.filter((family) => notices?.has(family.family) === true);
}

/** The files of these families that still need uploading: fetched now, and not uploaded before (`uploadedRef`). */
export function pendingFontUploads(families: readonly FontStoreFamily[], uploadedRef: (bytes: Uint8Array) => string | undefined = () => undefined): Uint8Array[] {
  return families.flatMap((family) => family.faces.flatMap((face) => (face.bytes === undefined || uploadedRef(face.bytes) !== undefined ? [] : [face.bytes])));
}

/**
 * `fetched-fonts.json`'s text for these families, each with its licence and notice, each fetched face by the ref
 * `refOf` gives its bytes; `null` for no family.
 */
export function fetchedFontsText(
  families: readonly FontStoreFamily[],
  notices: ReadonlyMap<string, FontLicenceNotice> | null,
  refOf: (bytes: Uint8Array) => string,
  about = true,
): string | null {
  if (families.length === 0) return null;
  const stored: StoredFontFamily[] = families.map(({ family, weights, shown, faces }) => {
    const notice = notices?.get(family);
    return {
      family,
      weights,
      shown,
      ...(notice !== undefined ? { licence: notice.licence, notice: notice.notice } : {}),
      faces: faces.map(
        ({ url, weight, range, sample, axis, ref, bytes }): StoredFontFace => ({
          url,
          weight,
          range,
          sample,
          ...(axis !== undefined ? { axis } : {}),
          ref: ref ?? refOf(bytes!),
        }),
      ),
    };
  });
  return serializeFetchedFontsRecord({ families: stored }, { about });
}

/**
 * Whether the record may be written: every family reads back from it (with placeholder refs), there is a module
 * slot for it, and the modules with it stay within the collection's size.
 */
export function canStoreFonts(
  update: FontStoreUpdate,
  families: readonly FontStoreFamily[],
  notices: ReadonlyMap<string, FontLicenceNotice> | null,
  modules: ReadonlyArray<{ name: string; kind: string; text: string }>,
): boolean {
  const planned = fetchedFontsText(families, notices, () => PLACEHOLDER_FONT_REF);
  const readsBack = parseFetchedFontsRecord(planned, parseCatalogFontRequest).families.length === families.length;
  const hasSlot = update.from !== null || modules.length <= MAX_MODULES - 1 - FONT_UPLOAD_MAX_RETRIES;
  const fits =
    planned === null ||
    [...modules.filter((module) => module.name !== FETCHED_FONTS_MODULE), { name: FETCHED_FONTS_MODULE, kind: 'json', text: planned }].reduce(
      (sum, module) => sum + storeBytes({ kind: module.kind, text: module.text }),
      0,
    ) <= MAX_MODULE_COLLECTION_BYTES;
  return readsBack && hasSlot && fits;
}

/** The ref an upload gives: its url without the leading slash. */
export const uploadedFontRef = (url: string): string => url.replace(/^\//, '');

/**
 * What `fetched-fonts.json` keeps beside a write that found stored files wrong: the stored families but those, and
 * `null` when none is left.
 */
export function keptFetchedFontsText(from: string | null, wrong: readonly string[]): string | null {
  if (wrong.length === 0) return from;
  const kept = parseFetchedFontsRecord(from, parseCatalogFontRequest).families.filter((family) => !wrong.includes(family.family));
  return kept.length === 0 ? null : serializeFetchedFontsRecord({ families: kept }, { about: false });
}

/** True when the planned text, with no new upload, is what is stored already (with or without its about). */
export function isFontStoreUnchanged(
  families: readonly FontStoreFamily[],
  notices: ReadonlyMap<string, FontLicenceNotice> | null,
  from: string | null,
  uploadedRef: (bytes: Uint8Array) => string | undefined = () => undefined,
): boolean {
  return (
    pendingFontUploads(families, uploadedRef).length === 0 &&
    [true, false].some((about) => fetchedFontsText(families, notices, (bytes) => uploadedRef(bytes) ?? '', about) === from)
  );
}
