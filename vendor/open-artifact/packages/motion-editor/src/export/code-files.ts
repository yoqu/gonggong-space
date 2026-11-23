/**
 * The code exports: the standalone page (the film and its player in one HTML file that plays offline) and the source
 * ZIP (the film's files, its fonts with their licences, and the page as index.html). The page's film is built the way
 * the engine builds the one on show, with a person's records applied, but every asset is carried as bytes.
 */

import { RETOUCHED_MODULE, SCENES_MODULE, exportedRetouchedText, withRefacedSceneFonts, type Film } from '@open-artifact/motion-core';
import { buildSourceZip, standaloneFile, type ExportedFile, type FilmFacts, type SourceFont, type SourceZip } from '@open-artifact/motion-export';
import type { StageAsset, StageFilm } from '@open-artifact/motion-stage';
// Load the scripts with the editor so an open tab can still export after a rebuild replaces its assets.
import audioScript from 'virtual:motion-standalone-audio';
import playerScript from 'virtual:motion-stage-player';
import runtimeScript from 'virtual:motion-stage-runtime';
import { applyFilmRecords } from '../engine/applied-film.ts';
import { useCameUp } from '../engine/came-up.ts';
import { filmStageFaces } from '../engine/film-faces.ts';
import type { FilmRecords } from '../engine/records.ts';
import { readFilmRecords } from '../engine/records.ts';
import { buildStageFilm } from '../engine/stage-film.ts';
import { assetBytes, assetUrl } from '../host/assets.ts';
import { pageFontsIo } from '../host/fonts.ts';
import { exportFonts, licenceNotices } from './fonts.ts';

export interface CodeInput {
  film: Film;
  records: FilmRecords;
  facts: FilmFacts;
  /** The stage's background colour. */
  background: string | undefined;
  /** The film has sound, so the page carries its audio script. */
  sounds: boolean;
  /** The score as a MIDI file for the source ZIP; null to leave it out. */
  midi: Uint8Array | null;
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** A clip that streamed from its URL, now with its bytes; null when they cannot be read. */
async function withBytes(asset: StageAsset, film: Film): Promise<StageAsset | null> {
  if (asset.bytes !== undefined) return asset;
  const source = film.assets.find((candidate) => candidate.name === asset.name);
  const bytes = source === undefined ? null : await assetBytes(source.ref);
  if (bytes === null) return null;
  const { url: _url, ...rest } = asset;
  return { ...rest, bytes };
}

/** The records the film on show plays with: without the colors, or the colors and the lines, when it could not play with them. */
export function recordsOnShow(records: FilmRecords): FilmRecords {
  const { original, fell } = useCameUp.getState();
  if (original) return { ...records, retyped: null, recolored: null };
  if (fell) return { ...records, recolored: null };
  return records;
}

/** The film as the standalone page plays it: records applied, typefaces on, every asset inlined. */
export async function offlineStageFilm(film: Film): Promise<StageFilm> {
  const records = readFilmRecords(film);
  const applied = applyFilmRecords(film, recordsOnShow(records));
  // Storing fetched families is the editor's business, not an export's.
  const io = { builtin: pageFontsIo.builtin, fetcher: pageFontsIo.fetcher, stored: pageFontsIo.stored };
  const fonts = await filmStageFaces(applied.script, applied.modules, io);
  const { stageFilm } = await buildStageFilm(film, { script: applied.script, modules: applied.modules, faces: fonts.faces }, 'final', { bytes: assetBytes, url: assetUrl });
  const assets = await Promise.all(stageFilm.assets.map((asset) => withBytes(asset, film)));
  // The page takes the look changed by hand as a message; a page with no host reads it as a module.
  const retouched = records.retouched === null ? null : exportedRetouchedText(records.retouched);
  return {
    ...stageFilm,
    modules: retouched === null ? stageFilm.modules : [...stageFilm.modules, { name: RETOUCHED_MODULE, kind: 'json', text: retouched }],
    assets: assets.flatMap((asset) => (asset === null ? [] : [asset])),
  };
}

async function pageFile(input: CodeInput, fonts: readonly SourceFont[]): Promise<ExportedFile> {
  const film = await offlineStageFilm(input.film);
  return standaloneFile({
    title: input.facts.title,
    film,
    runtimeScript,
    playerScript,
    audioScript: input.sounds ? audioScript : null,
    ...(input.background !== undefined ? { background: input.background } : {}),
    // Only typefaces the page puts on travel with it; a film without faces shows in the viewer's own fonts.
    licences: film.faces === null ? [] : licenceNotices(fonts),
  });
}

export async function exportStandalonePage(input: CodeInput): Promise<ExportedFile> {
  return pageFile(input, await exportFonts(input.film, input.records));
}

/** The film as its code says it once a person's words, colors and typefaces are written in. */
export function sourceFilm(film: Film, records: FilmRecords): Film {
  const applied = applyFilmRecords(film, recordsOnShow(records));
  const refaced = records.refaced;
  const modules =
    refaced === null
      ? applied.modules
      : applied.modules.map((module) => (module.name === SCENES_MODULE ? { ...module, text: withRefacedSceneFonts(module.text, refaced) } : module));
  return { ...film, script: applied.script, modules };
}

/** The folder goes out without its index.html when the page cannot be made (too large, say). */
export async function exportSourceZip(input: CodeInput): Promise<SourceZip> {
  const fonts = await exportFonts(input.film, input.records);
  const page = await pageFile(input, fonts).catch(() => null);
  const standalone = page === null ? null : await page.blob.text();
  const { title: _title, ...facts } = input.facts;
  return buildSourceZip({
    title: input.facts.title,
    film: sourceFilm(input.film, input.records),
    readAsset: async (asset) => {
      const bytes = await assetBytes(asset.ref);
      return bytes === null ? null : new Uint8Array(bytes);
    },
    standalone,
    fonts,
    facts,
    midi: input.midi,
    signal: input.signal,
    ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
  });
}
