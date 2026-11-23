import { documentProblem } from './documents.ts';
import { joinModule } from './film/split.ts';
import { formatKib, formatMib, isPlainObject, parseJsonRecord, storeBytes, type JsonObject } from './json.ts';
import { MAX_ASSETS, MAX_COLLECTION_BYTES, MAX_FILM_SECONDS, MAX_MODULES, MAX_MODULE_COLLECTION_BYTES, MAX_SCENES, MAX_SCENE_NAME_CHARS } from './limits.ts';
import {
  ASSETS_COLLECTION,
  BLOB_URL_PATTERN,
  FILM_COLLECTIONS,
  FILM_META_PATH,
  FILM_SCRIPT_PATH,
  LAYER_MODULE_PREFIX,
  MODULES_COLLECTION,
  NON_SCENE_MODULE_BASES,
  SCENES_MODULE,
  SCENE_ID_PATTERN,
  isJsonModuleName,
  isModuleKind,
  isUnsplitModule,
  modulePartOf,
} from './names.ts';
import { USER_DATA_COLLECTION } from './writes.ts';

export interface FilmFinding {
  /** The file under the artifact: `db/modules/scene-yard.js.json`. */
  file: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

/** A JavaScript syntax error, as the host's parser reports it. */
export interface SyntaxProblem {
  message: string;
  line?: number;
}

export interface FilmCheckContext {
  /** Parses a module or the cut as the player would run it; `null` when it parses. */
  syntaxError?: (code: string, name: string) => SyntaxProblem | null;
  blobExists?: (id: string) => boolean;
  /** The type an upload was stored as; without it, asset mimes are not checked against the uploads. */
  blobContentType?: (id: string) => string | undefined;
}

/** The file a document is stored in, relative to the artifact. */
export const filmDocumentFile = (path: string): string => `db/${path}.json`;

const collectionBudget = (collection: string): number => (collection === MODULES_COLLECTION ? MAX_MODULE_COLLECTION_BYTES : MAX_COLLECTION_BYTES);

interface Reporter {
  error(path: string, message: string, line?: number): void;
  warn(path: string, message: string): void;
}

/** Checks a film's documents (path → raw JSON text, as on disk) for what the player would refuse, drop or stop on. */
export function checkFilm(files: ReadonlyMap<string, string>, context: FilmCheckContext = {}): FilmFinding[] {
  const findings: FilmFinding[] = [];
  const report: Reporter = {
    error: (path, message, line) => findings.push({ file: filmDocumentFile(path), level: 'error', message, ...(line !== undefined ? { line } : {}) }),
    warn: (path, message) => findings.push({ file: filmDocumentFile(path), level: 'warning', message }),
  };
  const docs = new Map<string, JsonObject>();
  const totals = new Map<string, number>();
  for (const [path, text] of files) {
    if (path.startsWith(`${USER_DATA_COLLECTION}/`)) continue;
    const data = parseJsonRecord(text, Number.MAX_SAFE_INTEGER);
    if (data === null) {
      report.error(path, 'is not a JSON object; rewrite it with set.');
      continue;
    }
    docs.set(path, data);
    const segments = path.split('/');
    const collection = segments.slice(0, -1).join('/');
    totals.set(collection, (totals.get(collection) ?? 0) + storeBytes(data));
    if (!FILM_COLLECTIONS.includes(collection)) report.warn(path, 'is in a collection the player does not read.');
    const problem = documentProblem(segments, data, context.blobExists !== undefined ? { blobExists: context.blobExists } : {});
    if (problem !== null) report.error(path, problem.startsWith(path) ? problem.slice(path.length).replace(/^:\s*/, '') : problem);
  }
  for (const [collection, bytes] of totals) {
    const budget = collectionBudget(collection);
    if (bytes > budget)
      findings.push({
        file: `db/${collection}`,
        level: 'error',
        message: `holds ${formatKib(bytes)}; the store refuses ${collection === MODULES_COLLECTION ? 'a modules' : 'a'} collection over ${formatMib(budget)}.`,
      });
  }
  const script = checkMetaAndScript(docs, report, context);
  const texts = checkModules(docs, report, context);
  checkScenes(texts, script, report);
  checkAssets(docs, findings, report, context);
  return findings;
}

function checkMetaAndScript(docs: ReadonlyMap<string, JsonObject>, report: Reporter, context: FilmCheckContext): JsonObject | undefined {
  const meta = docs.get(FILM_META_PATH);
  if (meta === undefined) report.error(FILM_META_PATH, 'missing: write {"v":1, "title":"…", "updatedAt":"…"} first.');
  else if (meta.v !== 1) report.warn(FILM_META_PATH, 'v is 1.');
  const script = docs.get(FILM_SCRIPT_PATH);
  if (script === undefined) report.error(FILM_SCRIPT_PATH, 'missing: the page shows "No animation yet" until it is written (last in its batch).');
  else if (typeof script.code === 'string') {
    if (script.code.trim() === '') report.error(FILM_SCRIPT_PATH, 'code is empty.');
    const syntax = context.syntaxError?.(script.code, 'cut.js') ?? null;
    if (syntax !== null) report.error(FILM_SCRIPT_PATH, `does not parse: ${syntax.message}`, syntax.line);
    if (!/window\.CUT\b/.test(script.code)) report.warn(FILM_SCRIPT_PATH, 'never sets window.CUT.');
  }
  return script;
}

function checkModules(docs: ReadonlyMap<string, JsonObject>, report: Reporter, context: FilmCheckContext): Map<string, string> {
  const prefix = `${MODULES_COLLECTION}/`;
  const ids = [...docs.keys()].filter((path) => path.startsWith(prefix) && path.split('/').length === 2).map((path) => path.slice(prefix.length));
  if (ids.length > MAX_MODULES)
    report.error(MODULES_COLLECTION, `${ids.length} documents; the player reads ${MAX_MODULES} (in name order: ${ids.sort().slice(MAX_MODULES).join(', ')} would be dropped).`);
  const whole = new Set<string>();
  const partsOf = new Map<string, number[]>();
  for (const id of ids) {
    const part = modulePartOf(id);
    if (part !== null && !isUnsplitModule(part.base)) partsOf.set(part.base, [...(partsOf.get(part.base) ?? []), part.n]);
    else whole.add(id);
  }
  for (const [name, numbers] of partsOf) {
    if (whole.has(name)) {
      report.warn(`${prefix}${name}`, `exists whole and in parts (${name}~${numbers.join(', ~')}); the player reads the whole one and ignores the parts.`);
      continue;
    }
    numbers.sort((a, b) => a - b);
    if (numbers.some((n, index) => n !== index + 1))
      report.warn(`${prefix}${name}`, `its parts are ~${numbers.join(', ~')}; the player joins them in that order, so a gap means a missing piece.`);
    whole.add(name);
  }
  const stored = [...docs].flatMap(([path, data]) => {
    if (!path.startsWith(prefix)) return [];
    const kind = isModuleKind(data.kind) ? data.kind : 'text';
    return typeof data.text === 'string' ? [{ name: path.slice(prefix.length), kind, text: data.text }] : [];
  });
  const texts = new Map<string, string>();
  for (const name of whole) {
    const found = joinModule(name, stored);
    if (found === null) continue;
    texts.set(name, found.text);
    const label = `${prefix}${name}`;
    if (isJsonModuleName(name) || found.kind === 'json') {
      try {
        JSON.parse(found.text);
      } catch (error) {
        report.error(label, `is not JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (found.kind === 'js') {
      const syntax = context.syntaxError?.(found.text, name) ?? null;
      if (syntax !== null) report.error(label, `does not parse: ${syntax.message}`, syntax.line);
    }
    if (/\.js$/i.test(name) && found.kind !== 'js') report.warn(label, `kind is ${JSON.stringify(found.kind)}; a module the cut runs is kind "js".`);
  }
  return texts;
}

function checkScenes(texts: ReadonlyMap<string, string>, script: JsonObject | undefined, report: Reporter): void {
  const label = `${MODULES_COLLECTION}/${SCENES_MODULE}`;
  const scenesText = texts.get(SCENES_MODULE);
  if (scenesText === undefined) {
    if (typeof script?.code === 'string' && /kit\.scenes\s*\(/.test(script.code)) report.error(FILM_SCRIPT_PATH, 'calls kit.scenes() but there is no modules/scenes.json.');
    return;
  }
  let scenes: unknown;
  try {
    scenes = JSON.parse(scenesText);
  } catch {
    return;
  }
  if (!isPlainObject(scenes)) return;
  if (scenes.v !== 1) report.error(label, 'v is 1.');
  if (scenes.stage !== 'rough' && scenes.stage !== 'final') report.error(label, 'stage is "rough" until the end, then "final".');
  for (const key of ['width', 'height', 'fps']) {
    const value = scenes[key];
    if (value !== undefined && (typeof value !== 'number' || value <= 0)) report.error(label, `${key} is a positive number.`);
  }
  const list = Array.isArray(scenes.scenes) ? scenes.scenes : null;
  if (list === null || list.length === 0) {
    report.error(label, 'scenes is a list of {id, name, dur, desc}, at least one.');
    return;
  }
  if (list.length > MAX_SCENES) report.error(label, `${list.length} scenes; ${MAX_SCENES} at most.`);
  const listed = new Set(list.flatMap((scene: unknown) => (isPlainObject(scene) && typeof scene.id === 'string' ? [scene.id] : [])));
  // The player runs a module `<id>.js` as scene `<id>` when nothing else holds that scene and its code names it.
  const renamed = new Set<string>();
  for (const [name, text] of texts) {
    const match = /^(.+)\.js$/.exec(name);
    if (match === null) continue;
    const id = match[1]!;
    if (!listed.has(id) || texts.has(`scene-${id}.js`) || NON_SCENE_MODULE_BASES.includes(id)) continue;
    if (new RegExp(`\\bkit\\.scene\\s*\\(\\s*['"\`]${id.replace(/[^\w-]/g, '')}['"\`]`).test(text)) {
      renamed.add(id);
      report.warn(`${MODULES_COLLECTION}/${name}`, `the player runs it as scene "${id}" but a scene's code belongs in modules/scene-${id}.js; rename the file.`);
    }
  }
  for (const name of texts.keys()) {
    const scene = /^scene-(.+)\.js$/.exec(name);
    if (scene !== null && !listed.has(scene[1]!))
      report.warn(`${MODULES_COLLECTION}/${name}`, `scene-<id>.js is for a scene of scenes.json, and "${scene[1]}" is not one; the player runs no other module so.`);
    if (name.startsWith(LAYER_MODULE_PREFIX)) report.warn(`${MODULES_COLLECTION}/${name}`, "names that begin layer- are the player's; name no module so.");
  }
  const ids = new Set<string>();
  const missing: string[] = [];
  let seconds = 0;
  list.forEach((scene: unknown, index: number) => {
    if (!isPlainObject(scene)) return report.error(label, `scenes[${index}] is not an object.`);
    const say = (message: string): void => report.error(label, `scenes[${index}] ${message}`);
    if (typeof scene.id !== 'string' || !SCENE_ID_PATTERN.test(scene.id))
      say(`id ${JSON.stringify(scene.id)}: lower-case letters, digits and -, a letter first, 32 at most (a bad id stops the whole film).`);
    else if (ids.has(scene.id)) say(`id ${scene.id} appears twice.`);
    else ids.add(scene.id);
    if (typeof scene.name !== 'string' || scene.name.trim() === '' || scene.name.length > MAX_SCENE_NAME_CHARS)
      say(`name: one to three words, ${MAX_SCENE_NAME_CHARS} characters at most.`);
    if (typeof scene.dur !== 'number' || !Number.isFinite(scene.dur) || scene.dur <= 0) say('dur: seconds, above 0 (a bad dur stops the whole film).');
    else seconds += scene.dur;
    if (typeof scene.id === 'string' && !texts.has(`scene-${scene.id}.js`) && !renamed.has(scene.id)) missing.push(`${index + 1} (${scene.id})`);
  });
  if (seconds > MAX_FILM_SECONDS) report.error(label, `the scenes add up to ${seconds} s; a film over ${MAX_FILM_SECONDS} s won't load.`);
  if (missing.length > 0 && scenes.stage === 'final') report.error(label, `stage is "final" but scene modules are missing: ${missing.join(', ')}.`);
}

function checkAssets(docs: ReadonlyMap<string, JsonObject>, findings: FilmFinding[], report: Reporter, context: FilmCheckContext): void {
  const prefix = `${ASSETS_COLLECTION}/`;
  const assets = [...docs].filter(([path]) => path.startsWith(prefix) && path.split('/').length === 2);
  if (assets.length > MAX_ASSETS)
    findings.push({ file: `db/${ASSETS_COLLECTION}`, level: 'error', message: `${assets.length} documents; the player reads ${MAX_ASSETS}.` });
  if (context.blobContentType === undefined) return;
  for (const [path, data] of assets) {
    const blob = BLOB_URL_PATTERN.exec(typeof data.ref === 'string' ? data.ref : '');
    if (blob === null) continue;
    const stored = context.blobContentType(blob[1]!);
    const mime = String(data.mime);
    if (stored === undefined || stored === mime) continue;
    // The page refuses an asset served as audio that is not declared so, and the other way round: it is dropped.
    if (mime.startsWith('audio/') || stored.startsWith('audio/'))
      report.error(
        path,
        `mime is ${mime}, but the upload is ${stored}; the player drops an audio asset whose mime and upload type differ. Use the upload's content type, verbatim.`,
      );
    else report.warn(path, `mime is ${mime}, but the upload is ${stored}; the player trusts mime.`);
  }
}
