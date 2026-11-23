import { DEFAULT_NARRATION_LIMITS } from '@open-artifact/motion-audio';
import { EXPORT_SETTINGS, RETOUCHED_MODULE, type Film, type FilmAsset, type FilmModule } from '@open-artifact/motion-core';
import type { RenderMode, StageAsset, StageFaces, StageFilm, StageModule } from '@open-artifact/motion-stage';

/** Reads an asset's bytes (`null`: not to be had) and the URL a clip streams from. */
export interface AssetReader {
  bytes(ref: string): Promise<ArrayBuffer | null>;
  url(ref: string): string | null;
}

/** Clips and sound stream from their URL; pictures, fonts and documents arrive as bytes, which a snapshot can see. */
export const streamsFromUrl = (mime: string): boolean => mime.startsWith('video/') || mime.startsWith('audio/');

/**
 * Modules the stage runs. `retouched.json` is left out: the stage takes it as a `retouch` message, so a change by
 * hand to how things look shows without a reload.
 */
export function stageModules(film: { modules: readonly FilmModule[] }): StageModule[] {
  return film.modules.filter((module) => module.name !== RETOUCHED_MODULE).map((module) => ({ name: module.name, kind: module.kind, text: module.text }));
}

async function stageAsset(asset: FilmAsset, reader: AssetReader): Promise<StageAsset | null> {
  const base = { name: asset.name, mime: asset.mime, w: asset.w ?? 0, h: asset.h ?? 0 };
  if (streamsFromUrl(asset.mime)) {
    const url = reader.url(asset.ref);
    return url === null ? null : { ...base, url };
  }
  const bytes = await reader.bytes(asset.ref);
  // The port transfers nothing, so the kept buffer is copied by structured clone, never detached.
  return bytes === null ? null : { ...base, bytes };
}

/** The code the stage runs (records applied, see `applied-film.ts`) and the typefaces it declares. */
export interface StageCode {
  script: string;
  modules: readonly FilmModule[];
  faces: StageFaces | null;
}

/** What the stage loads for a film; assets that cannot be had are left out (the film's own code then says so). */
export async function buildStageFilm(film: Film, code: StageCode, mode: RenderMode, reader: AssetReader): Promise<{ stageFilm: StageFilm; missing: string[] }> {
  const loaded = await Promise.all(film.assets.map((asset) => stageAsset(asset, reader)));
  const assets: StageAsset[] = [];
  const missing: string[] = [];
  loaded.forEach((asset, index) => {
    if (asset !== null) assets.push(asset);
    else missing.push(film.assets[index]?.name ?? '');
  });
  return {
    stageFilm: {
      script: code.script,
      modules: stageModules(code),
      assets,
      faces: code.faces,
      narration: { maxLines: DEFAULT_NARRATION_LIMITS.maxLines, maxLineSeconds: DEFAULT_NARRATION_LIMITS.maxLineSeconds },
      clippedTextWaitMs: EXPORT_SETTINGS.clippedTextWaitMs,
      mode,
    },
    missing,
  };
}

/** A key that changes whenever what the stage loads changes (the retouch record aside; the records it applies are modules). */
export function stageKey(film: Film): string {
  const modules = stageModules(film).map((module) => `${module.name}\u0000${module.kind}\u0000${module.text}`);
  const assets = film.assets.map((asset) => `${asset.name}\u0000${asset.ref}\u0000${asset.mime}\u0000${asset.w ?? ''}x${asset.h ?? ''}`);
  return [film.script, modules.join('\u0001'), assets.join('\u0001')].join('\u0002');
}
