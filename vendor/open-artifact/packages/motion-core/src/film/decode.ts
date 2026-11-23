import { parseFilmAsset, parseFilmMeta, parseFilmModule, parseFilmScript, type FilmAsset, type FilmMeta, type FilmModule } from '../documents.ts';
import { isPlainObject } from '../json.ts';
import { MAX_ASSETS, MAX_MODULES } from '../limits.ts';
import { ASSETS_COLLECTION, FILM_META_PATH, FILM_SCRIPT_PATH, MODULES_COLLECTION, SCENES_MODULE } from '../names.ts';
import { parseScenesFile, type ScenesFileResult } from '../scenes-file.ts';
import { joinSplitModules } from './split.ts';

/** Something of the store the player leaves out, by document path. */
export interface FilmProblem {
  path: string;
  message: string;
}

/** The film as the player reads it from the store. */
export interface Film {
  /** `null` when there is no `film/meta`. */
  meta: FilmMeta | null;
  /** The cut's code; `''` when there is none yet ("No animation yet"). */
  script: string;
  /** The modules as they run: parts joined, sorted by name. */
  modules: FilmModule[];
  /** The module documents as stored (parts apart), sorted by name. */
  storedModules: FilmModule[];
  assets: FilmAsset[];
  /** More than 500 module documents: the player read the first 500 by name and leaves the film as it is. */
  cut: boolean;
  /** `scenes.json` as read, or `null` when the film has none. */
  scenes: ScenesFileResult | null;
  problems: FilmProblem[];
}

const byName = <T extends { name: string }>(a: T, b: T): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function collectionEntries(documents: Iterable<readonly [string, unknown]>, collection: string): Array<[string, unknown]> {
  const prefix = `${collection}/`;
  const entries: Array<[string, unknown]> = [];
  for (const [path, value] of documents) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length);
    if (id !== '' && !id.includes('/')) entries.push([id, value]);
  }
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Reads a film from its documents (path → data, as the store or a live snapshot gives them): `film/meta`,
 * `film/script`, `modules/<name>` (parts `<name>~n` joined) and `assets/<name>`. What the player would drop is listed
 * in `problems`, never thrown.
 */
export function decodeFilm(documents: ReadonlyMap<string, unknown> | Iterable<readonly [string, unknown]>): Film {
  const all: Array<readonly [string, unknown]> = [...documents];
  const lookup = new Map(all);
  const problems: FilmProblem[] = [];
  const metaValue = lookup.get(FILM_META_PATH);
  const meta = metaValue === undefined ? null : parseFilmMeta(metaValue);
  if (metaValue !== undefined && meta === null) problems.push({ path: FILM_META_PATH, message: 'is not a JSON object; the player ignores it.' });
  const scriptValue = lookup.get(FILM_SCRIPT_PATH);
  if (scriptValue !== undefined && !(isPlainObject(scriptValue) && typeof scriptValue.code === 'string'))
    problems.push({ path: FILM_SCRIPT_PATH, message: 'has no "code" string; the player shows no animation.' });
  const script = scriptValue === undefined ? '' : parseFilmScript(scriptValue);

  const storedModules: FilmModule[] = [];
  let cut = false;
  for (const [name, value] of collectionEntries(all, MODULES_COLLECTION)) {
    if (storedModules.length >= MAX_MODULES) {
      cut = true;
      problems.push({ path: `${MODULES_COLLECTION}/${name}`, message: `is past the first ${MAX_MODULES} modules; the player drops it.` });
      continue;
    }
    const module = parseFilmModule(name, value);
    if (module === null) problems.push({ path: `${MODULES_COLLECTION}/${name}`, message: 'is not a module the player reads; it drops it.' });
    else storedModules.push(module);
  }
  storedModules.sort(byName);

  const assets: FilmAsset[] = [];
  for (const [name, value] of collectionEntries(all, ASSETS_COLLECTION)) {
    if (assets.length >= MAX_ASSETS) {
      problems.push({ path: `${ASSETS_COLLECTION}/${name}`, message: `is past the first ${MAX_ASSETS} assets; the player drops it.` });
      continue;
    }
    const asset = parseFilmAsset(name, value);
    if (asset === null) problems.push({ path: `${ASSETS_COLLECTION}/${name}`, message: 'is not an asset the player reads; it drops it.' });
    else assets.push(asset);
  }
  assets.sort(byName);

  const modules = joinSplitModules(storedModules);
  const scenesModule = modules.find((module) => module.name === SCENES_MODULE);
  const scenes = scenesModule === undefined ? null : parseScenesFile(scenesModule.text);
  if (scenes !== null && !scenes.ok) problems.push({ path: `${MODULES_COLLECTION}/${SCENES_MODULE}`, message: scenes.error });
  return { meta, script, modules, storedModules, assets, cut, scenes, problems };
}

/** A module of the film by the name it runs under. */
export function filmModule(film: Pick<Film, 'modules'>, name: string): FilmModule | undefined {
  return film.modules.find((module) => module.name === name);
}
