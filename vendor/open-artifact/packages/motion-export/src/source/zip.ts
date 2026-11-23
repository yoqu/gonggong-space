import { CODE_SETTINGS, RETOUCHED_MODULE, exportedRetouchedText, parseRetouchedRecord } from '@open-artifact/motion-core';
import type { Film, FilmAsset, FilmModule } from '@open-artifact/motion-core';
import { packZip } from '@open-artifact/wasm-export';
import { BYTES_PER_MEBIBYTE, SourceExportError, exportAbortError, isAborted, wholeMegabytes } from '../errors.ts';
import { exportFilename } from '../filename.ts';
import type { FilmFacts } from '../frame-source.ts';
import type { ExportedFile } from '../types.ts';
import { words } from '../words.ts';
import { sourceFolder } from './layout.ts';
import type { SourceAsset, SourceFolder, SourceFont, SourceModule } from './layout.ts';

export const SOURCE_MAX_BYTES = CODE_SETTINGS.maxMb * BYTES_PER_MEBIBYTE;

export interface SourceZipInput {
  title: string;
  /** The film as read from the store. */
  film: Film;
  /** An asset's bytes (an upload fetched, a `data:` URI decoded); null when it cannot be read. */
  readAsset(asset: FilmAsset): Promise<Uint8Array | null>;
  /** The standalone page to put in as index.html; null to leave it out. */
  standalone: string | null;
  fonts?: readonly SourceFont[];
  facts?: Omit<FilmFacts, 'title'>;
  /** The score as a MIDI file, put in as score.mid; null or absent to leave it out. */
  midi?: Uint8Array | null;
  date?: Date;
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface SourceZip extends ExportedFile {
  folder: Omit<SourceFolder, 'entries'>;
}

/** Reads every asset, keeping the pictures and clips within 3/7 of the limit (the page holds them again). */
async function readAssets(input: SourceZipInput, maxBytes: number): Promise<SourceAsset[]> {
  const assetLimit = Math.floor((maxBytes * 3) / 7);
  const assets: SourceAsset[] = [];
  let total = 0;
  for (const asset of input.film.assets) {
    if (isAborted(input.signal)) throw exportAbortError();
    const bytes = await input.readAsset(asset);
    if (bytes === null) throw new SourceExportError(words.assetUnreadable(asset.name), 'unreadable');
    total += bytes.byteLength;
    if (total > assetLimit) throw new SourceExportError(words.sourceTooLarge(wholeMegabytes(assetLimit)), 'too_large');
    assets.push({ name: asset.name, mime: asset.mime, bytes });
  }
  return assets;
}

function sourceModule(module: FilmModule): SourceModule[] {
  const text = module.name === RETOUCHED_MODULE ? exportedRetouchedText(parseRetouchedRecord(module.text)) : module.text;
  return text === null ? [] : [{ name: module.storedAs ?? module.name, kind: module.kind, text }];
}

/** The video's code as a ZIP of one folder, stored without compression. */
export async function buildSourceZip(input: SourceZipInput): Promise<SourceZip> {
  const maxBytes = input.maxBytes ?? SOURCE_MAX_BYTES;
  const pageLimit = Math.floor((maxBytes * 4) / 7);
  if (input.standalone !== null && input.standalone.length > pageLimit)
    throw new SourceExportError(words.standaloneTooLarge(wholeMegabytes(pageLimit)), 'too_large');
  const assets = await readAssets(input, maxBytes);
  const folder = sourceFolder({
    title: input.title,
    date: input.date ?? new Date(),
    script: input.film.script,
    modules: input.film.modules.flatMap(sourceModule),
    assets,
    fonts: input.fonts ?? [],
    standalone: input.standalone,
    ...(input.facts !== undefined ? { facts: input.facts } : {}),
    ...(input.midi != null ? { midi: input.midi } : {}),
  });
  if (isAborted(input.signal)) throw exportAbortError();
  const bytes = await packZip(
    folder.entries.map((entry) => ({ ...entry, store: true })),
    { ...(input.date !== undefined ? { date: input.date } : {}), ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}) },
  );
  if (isAborted(input.signal)) throw exportAbortError();
  if (bytes.byteLength > maxBytes) throw new SourceExportError(words.sourceTooLarge(wholeMegabytes(maxBytes)), 'too_large');
  return {
    blob: new Blob([bytes.slice()], { type: 'application/zip' }),
    filename: exportFilename(input.title, 'zip'),
    mime: 'application/zip',
    folder: { filesLeftOut: folder.filesLeftOut, fontsLeftOut: folder.fontsLeftOut },
  };
}
