/**
 * The page's side of the film's typefaces: built-in font files (emitted with the page) read as data URIs, Google
 * Fonts reached from the page, stored uploads read back, and the store loop that uploads fetched font files and
 * writes `fetched-fonts.json`, so the film keeps its families when Google Fonts cannot be reached.
 */

import {
  FETCHED_FONTS_MODULE,
  FONT_UPLOAD_COOLDOWN_MS,
  FONT_UPLOAD_IDLE_WAIT_MS,
  FONT_UPLOAD_MAX_FILES,
  FONT_UPLOAD_TIMEOUT_MS,
  builtinFontFileUrl,
  canStoreFonts,
  createGoogleFontFetcher,
  fetchedFontsText,
  isFontStoreUnchanged,
  keptFetchedFontsText,
  licensedStoreFamilies,
  moduleDocumentPath,
  pendingFontUploads,
  readFontLicenceNotices,
  uploadedFontRef,
  woff2DataUri,
  type FontFetcher,
  type FontModule,
  type FontStoreUpdate,
} from '@open-artifact/motion-core';
import type { AssetsCapability } from '@open-artifact/runtime';
import type { FilmFontsIo } from '../engine/film-faces.ts';
import { assetBytes } from './assets.ts';
import { writeFilmDocument } from './live-film.ts';
import { maybeSession } from './session.ts';

const builtinUris = new Map<string, Promise<string | null>>();

async function readBuiltin(file: string): Promise<string | null> {
  try {
    const response = await fetch(builtinFontFileUrl(file));
    if (!response.ok) return null;
    return woff2DataUri(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

function builtin(file: string): Promise<string | null> {
  const known = builtinUris.get(file);
  if (known !== undefined) return known;
  const reading = readBuiltin(file);
  builtinUris.set(file, reading);
  void reading.then((uri) => {
    if (uri === null) builtinUris.delete(file);
  });
  return reading;
}

let fetcher: FontFetcher | undefined;

/** Upload refs by the fetched bytes they were made from, for this page's life. */
const uploaded = new Map<Uint8Array, string>();
let uploads = 0;
let storing = false;
let quietUntil = 0;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => (clearTimeout(timer), resolve(value)),
      () => (clearTimeout(timer), resolve(null)),
    );
  });
}

function writeRecord(text: string | null): void {
  writeFilmDocument(moduleDocumentPath(FETCHED_FONTS_MODULE), text === null ? null : { kind: 'json', text });
}

/** Uploads what is new and writes the record; `true` when it wrote. */
async function store(update: FontStoreUpdate, modules: readonly FontModule[], assets: AssetsCapability): Promise<boolean> {
  if (update.idle === true) await pause(FONT_UPLOAD_IDLE_WAIT_MS);
  const notices = await readFontLicenceNotices(update.families.map((family) => family.family));
  const families = licensedStoreFamilies(update, notices);
  const refOf = (bytes: Uint8Array): string | undefined => uploaded.get(bytes);
  if (families.length === 0) {
    if (update.wrong.length === 0) return false;
    writeRecord(keptFetchedFontsText(update.from, update.wrong));
    return true;
  }
  if (isFontStoreUnchanged(families, notices, update.from, refOf)) return false;
  if (!canStoreFonts(update, families, notices, modules)) return false;
  const pending = pendingFontUploads(families, refOf);
  if (uploads + pending.length > FONT_UPLOAD_MAX_FILES) return false;
  for (const bytes of pending) {
    uploads += 1;
    const record = await within(assets.upload(new Blob([bytes.slice()], { type: 'font/woff2' }), { name: 'font.woff2' }), FONT_UPLOAD_TIMEOUT_MS);
    if (record === null) return true;
    uploaded.set(bytes, uploadedFontRef(record.url));
  }
  writeRecord(fetchedFontsText(families, notices, (bytes) => uploaded.get(bytes) ?? ''));
  return true;
}

/** Stores fetched families when this viewer may upload; one store at a time, then a pause. */
function storeFetched(update: FontStoreUpdate, modules: readonly FontModule[]): void {
  const current = maybeSession();
  if (current === null || !current.canEdit || current.assets === null) return;
  if (storing || Date.now() < quietUntil) return;
  storing = true;
  store(update, modules, current.assets)
    .then((wrote) => {
      if (wrote) quietUntil = Date.now() + FONT_UPLOAD_COOLDOWN_MS;
    })
    .catch((error: unknown) => console.warn('video: fetched fonts could not be stored', error))
    .finally(() => {
      storing = false;
    });
}

export const pageFontsIo: FilmFontsIo = {
  builtin,
  fetcher: () => (fetcher ??= createGoogleFontFetcher()),
  stored: async (ref) => assetBytes(ref),
  store: storeFetched,
};
