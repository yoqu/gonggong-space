import type { FilmModule, ModuleDocument } from '../documents.ts';
import { storeBytes } from '../json.ts';
import { MAX_DOC_BYTES, MAX_MODULE_PARTS } from '../limits.ts';
import {
  NON_SCENE_MODULE_BASES,
  SCENES_MODULE,
  isUnsplitModule,
  modulePartName,
  modulePartOf,
  sceneModuleName,
  type ModuleKind,
} from '../names.ts';
import { parseScenesFile } from '../scenes-file.ts';

/** One document of a module as it is stored. */
export interface ModulePart {
  name: string;
  document: ModuleDocument;
}

/** The bytes one character adds to a document's JSON as the store measures it. */
function storedCharBytes(character: string): number {
  const code = character.codePointAt(0)!;
  if (character === '"' || character === '\\' || character === '\n' || character === '\r' || character === '\t' || character === '\b' || character === '\f')
    return 2;
  if (code < 0x20) return 6;
  if (character === '<' || character === '>' || character === '&') return 6;
  if (code === 0x2028 || code === 0x2029) return 6;
  if (code >= 0xd800 && code <= 0xdfff) return 6;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * A module as the documents to store: the whole module when it fits one document, else its parts `name~1` …
 * `name~n`, each under `maxBytes` and cut after a line break where one is near. `null` when it needs more than 99
 * parts, or when it is a record the page never splits and does not fit.
 */
export function splitModule(name: string, kind: ModuleKind, text: string, maxBytes: number = MAX_DOC_BYTES): ModulePart[] | null {
  const whole: ModuleDocument = { kind, text };
  if (storeBytes(whole) <= maxBytes) return [{ name, document: whole }];
  if (isUnsplitModule(name)) return null;
  const budget = maxBytes - storeBytes({ kind, text: '' });
  if (budget < 8) return null;
  const chunks: string[] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;
  let lastBreak = -1;
  for (const character of text) {
    const bytes = storedCharBytes(character);
    if (chunkBytes + bytes > budget) {
      const cut = lastBreak >= chunk.length / 2 ? lastBreak + 1 : chunk.length;
      chunks.push(chunk.slice(0, cut).join(''));
      chunk = chunk.slice(cut);
      chunkBytes = chunk.reduce((sum, kept) => sum + storedCharBytes(kept), 0);
      lastBreak = chunk.lastIndexOf('\n');
    }
    chunk.push(character);
    chunkBytes += bytes;
    if (character === '\n') lastBreak = chunk.length - 1;
  }
  if (chunk.length > 0) chunks.push(chunk.join(''));
  if (chunks.length > MAX_MODULE_PARTS) return null;
  return chunks.map((part, index) => ({ name: modulePartName(name, index + 1), document: { kind, text: part } }));
}

/**
 * The modules as the player runs them: a whole module wins over parts of the same name; parts (never of a record
 * the page keeps whole) are joined in number order, with the first part's kind; a scene's code stored as `<id>.js`
 * is run as `scene-<id>.js` (see {@link renameUnprefixedSceneModules}). Sorted by name.
 */
export function joinSplitModules(modules: readonly FilmModule[]): FilmModule[] {
  const whole = new Map<string, FilmModule>();
  const parts = new Map<string, { n: number; module: FilmModule }[]>();
  for (const module of modules) {
    const part = modulePartOf(module.name);
    if (part === null) whole.set(module.name, module);
    else if (!isUnsplitModule(part.base)) parts.set(part.base, [...(parts.get(part.base) ?? []), { n: part.n, module }]);
  }
  const joined = [...whole.values()];
  for (const [base, list] of parts) {
    if (whole.has(base)) continue;
    list.sort((a, b) => a.n - b.n);
    joined.push({ name: base, kind: list[0]!.module.kind, text: list.map((item) => item.module.text).join(''), parts: list.length });
  }
  return sortModules(renameUnprefixedSceneModules(joined));
}

/** The text of one module as the player reads it: the whole document, else its parts joined; `null` when neither. */
export function joinModule(name: string, modules: readonly FilmModule[]): FilmModule | null {
  const found = modules.find((module) => module.name === name);
  if (found) return found;
  if (isUnsplitModule(name)) return null;
  const list = modules
    .map((module) => ({ part: modulePartOf(module.name), module }))
    .filter((item): item is { part: { base: string; n: number }; module: FilmModule } => item.part?.base === name)
    .sort((a, b) => a.part.n - b.part.n);
  if (list.length === 0) return null;
  return { name, kind: list[0]!.module.kind, text: list.map((item) => item.module.text).join(''), parts: list.length };
}

/**
 * A module `<id>.js` holding `kit.scene('<id>', …)` for a scene of `scenes.json` is run as `scene-<id>.js` when that
 * module is missing: films written before the naming rule still play.
 */
export function renameUnprefixedSceneModules(modules: readonly FilmModule[]): FilmModule[] {
  const scenes = parseScenesFile(modules.find((module) => module.name === SCENES_MODULE)?.text);
  if (!scenes.ok) return [...modules];
  const ids = new Set(scenes.file.scenes.map((scene) => scene.id));
  const names = new Set(modules.map((module) => module.name));
  return modules.map((module) => {
    const match = /^(.+)\.js$/.exec(module.name);
    const id = match?.[1];
    if (
      id === undefined ||
      module.kind !== 'js' ||
      !ids.has(id) ||
      NON_SCENE_MODULE_BASES.includes(id) ||
      names.has(sceneModuleName(id)) ||
      !new RegExp(`\\bkit\\.scene\\s*\\(\\s*['"\`]${id}['"\`]`).test(module.text)
    )
      return module;
    return { ...module, name: sceneModuleName(id), storedAs: module.name };
  });
}

export function sortModules(modules: FilmModule[]): FilmModule[] {
  return modules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
