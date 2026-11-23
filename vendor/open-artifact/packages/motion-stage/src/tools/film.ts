import {
  BLOB_URL_PATTERN,
  EXPORT_SETTINGS,
  RECOLORED_MODULE,
  RETYPED_MODULE,
  VOICE_SETTINGS,
  applyRecolored,
  applyRetyped,
  decodeFilm,
  filmModule,
  parseRecoloredRecord,
  parseRetypedRecord,
  type Film,
  type FilmAsset,
  type FilmModule,
} from '@open-artifact/motion-core';
import { fromBase64 } from '../offline/data.ts';
import type { RenderMode, StageAsset, StageFilm } from '../protocol.ts';
import type { ToolsFiles } from './types.ts';

export interface ToolsFilm {
  /** null: there is nothing to load, and `problems` says why first. */
  film: StageFilm | null;
  title: string;
  problems: string[];
}

const streams = (mime: string): boolean => mime.startsWith('video/') || mime.startsWith('audio/');

function documentsOf(given: Record<string, unknown>, problems: string[]): Map<string, unknown> {
  const documents = new Map<string, unknown>();
  for (const [path, value] of Object.entries(given)) {
    if (typeof value !== 'string') {
      documents.set(path, value);
      continue;
    }
    try {
      documents.set(path, JSON.parse(value));
    } catch {
      problems.push(`db/${path}.json is not JSON; the player ignores it.`);
    }
  }
  return documents;
}

/** The base64 of an asset's bytes: from its `data:` ref, or from the upload it names. null: not to be had. */
function base64Of(asset: FilmAsset, blobs: Record<string, string>): string | null {
  if (asset.ref.startsWith('data:')) {
    const comma = asset.ref.indexOf(',');
    return comma < 0 ? null : asset.ref.slice(comma + 1);
  }
  const id = BLOB_URL_PATTERN.exec(asset.ref)?.[1];
  return id === undefined ? null : (blobs[id] ?? null);
}

function stageAsset(asset: FilmAsset, blobs: Record<string, string>): StageAsset | null {
  const base = { name: asset.name, mime: asset.mime, w: asset.w ?? 0, h: asset.h ?? 0 };
  const data = base64Of(asset, blobs);
  if (data === null) return null;
  if (streams(asset.mime)) return { ...base, url: `data:${asset.mime};base64,${data}` };
  try {
    return { ...base, bytes: fromBase64(data) };
  } catch {
    return null;
  }
}

function recordOf<R>(film: Pick<Film, 'modules'>, name: string, parse: (input: unknown) => R): R | null {
  const module = filmModule(film, name);
  if (module === undefined) return null;
  try {
    return parse(JSON.parse(module.text));
  } catch {
    return parse(null);
  }
}

/** A person's retyped lines and colors written into the code, as the page does before the stage runs it. */
function applied(film: Film, problems: string[]): { script: string; modules: FilmModule[] } {
  let script = film.script;
  let modules: FilmModule[] = [...film.modules];
  const retyped = recordOf(film, RETYPED_MODULE, parseRetypedRecord);
  if (retyped !== null) {
    try {
      ({ script, modules } = applyRetyped({ script, modules }, retyped));
    } catch {
      problems.push(`A person's text (modules/${RETYPED_MODULE}) could not be swapped in, so the film shows its own.`);
    }
  }
  const recolored = recordOf(film, RECOLORED_MODULE, parseRecoloredRecord);
  if (recolored !== null && recolored.colors.length > 0) {
    try {
      ({ script, modules } = applyRecolored({ script, modules }, recolored));
    } catch {
      problems.push(`A person's colors (modules/${RECOLORED_MODULE}) could not be swapped in, so the film shows its own.`);
    }
  }
  return { script, modules };
}

/**
 * The film the tools page loads, read from its files as the page reads its store. `retouched.json` stays among
 * the modules: the stage lays it from there at load, as the page's own `retouch` message would.
 */
export function toolsFilm(files: ToolsFiles): ToolsFilm {
  const problems: string[] = [];
  const decoded = decodeFilm(documentsOf(files.documents, problems));
  for (const problem of decoded.problems) problems.push(`db/${problem.path}.json ${problem.message}`);
  const title = decoded.meta?.title ?? 'Film';
  if (decoded.script.trim() === '') {
    problems.unshift('The film has no code yet (db/film/script.json has no "code").');
    return { film: null, title, problems };
  }
  const blobs = files.blobs ?? {};
  const assets: StageAsset[] = [];
  for (const asset of decoded.assets) {
    const loaded = stageAsset(asset, blobs);
    if (loaded !== null) assets.push(loaded);
    else problems.push(`The asset ${asset.name} could not be loaded (${asset.ref} was not given).`);
  }
  const code = applied(decoded, problems);
  const mode: RenderMode = files.mode ?? 'final';
  return {
    film: {
      script: code.script,
      modules: code.modules.map((module) => ({ name: module.name, kind: module.kind, text: module.text })),
      assets,
      faces: null,
      narration: { maxLines: VOICE_SETTINGS.maxLines, maxLineSeconds: VOICE_SETTINGS.maxLineSeconds },
      clippedTextWaitMs: EXPORT_SETTINGS.clippedTextWaitMs,
      mode,
    },
    title,
    problems,
  };
}
