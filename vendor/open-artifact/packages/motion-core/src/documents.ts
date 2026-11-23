import { clipCharacters, formatKib, isFiniteNumber, isPlainObject, storeBytes } from './json.ts';
import {
  FILM_SCHEMA_VERSION,
  MAX_ASSET_NOTE_CHARS,
  MAX_ASSET_REF_CHARS,
  MAX_ASSET_SIDE,
  MAX_DOC_BYTES,
  MAX_MODULE_CHARS,
  MAX_SCRIPT_CHARS,
  MAX_TITLE_CHARS,
  MAX_UPDATED_AT_CHARS,
} from './limits.ts';
import {
  ASSET_DATA_URI_PATTERN,
  ASSET_MIMES,
  BLOB_REFERENCE_PATTERN,
  BLOB_URL_PATTERN,
  MODULE_KINDS,
  isAssetMime,
  isFilmName,
  isJsonModuleName,
  isModuleKind,
  isModuleName,
  isUnsplitModule,
  modulePartOf,
  type AssetMime,
  type ModuleKind,
} from './names.ts';

/** `film/meta`: what people call the film. */
export interface FilmMetaDocument {
  v: typeof FILM_SCHEMA_VERSION;
  title: string;
  updatedAt: string;
}

/** `film/script`: the cut, a program that sets `window.CUT`. */
export interface FilmScriptDocument {
  code: string;
}

/** `modules/<name>`: a file the cut loads. */
export interface ModuleDocument {
  kind: ModuleKind;
  text: string;
}

/** `assets/<name>`: an upload (`/_blob/<id>`) or a small `data:` URI. */
export interface AssetDocument {
  ref: string;
  mime: AssetMime;
  w?: number;
  h?: number;
  note?: string;
}

export interface FilmMeta {
  title: string;
  updatedAt: string;
}

/** A module as the player reads it. `parts` counts the documents it was joined from (0: one whole document). */
export interface FilmModule {
  name: string;
  kind: ModuleKind;
  text: string;
  parts?: number;
  /** The name it was stored under when the player runs it under another (`yard.js` run as `scene-yard.js`). */
  storedAs?: string;
}

export interface FilmAsset {
  name: string;
  /** `_blob/<id>` or a `data:` URI. */
  ref: string;
  mime: AssetMime;
  w?: number;
  h?: number;
  note?: string;
}

export const isFilmMetaDocument = (value: unknown): value is FilmMetaDocument =>
  isPlainObject(value) && value.v === FILM_SCHEMA_VERSION && typeof value.title === 'string' && typeof value.updatedAt === 'string';

export const isFilmScriptDocument = (value: unknown): value is FilmScriptDocument => isPlainObject(value) && typeof value.code === 'string';

export const isModuleDocument = (value: unknown): value is ModuleDocument =>
  isPlainObject(value) && typeof value.text === 'string' && isModuleKind(value.kind);

export const isAssetDocument = (value: unknown): value is AssetDocument =>
  isPlainObject(value) && typeof value.ref === 'string' && isAssetMime(value.mime);

export function newFilmMeta(title: string, now: Date): FilmMetaDocument {
  return { v: FILM_SCHEMA_VERSION, title: clipCharacters(title.trim(), MAX_TITLE_CHARS), updatedAt: now.toISOString() };
}

export function parseFilmMeta(value: unknown): FilmMeta | null {
  if (!isPlainObject(value)) return null;
  return { title: clipCharacters(value.title, MAX_TITLE_CHARS).trim(), updatedAt: clipCharacters(value.updatedAt, MAX_UPDATED_AT_CHARS) };
}

/** The cut's code (the document's `code`, or a bare string), cut off past the player's limit. */
export function parseFilmScript(value: unknown): string {
  return clipCharacters(isPlainObject(value) ? value.code : value, MAX_SCRIPT_CHARS);
}

/** The kind a module is read as: a `.json` name is always JSON, an unknown kind is text. */
export function moduleKindOf(name: string, kind: unknown): ModuleKind {
  if (isJsonModuleName(name)) return 'json';
  return isModuleKind(kind) ? kind : 'text';
}

export function parseFilmModule(name: string, value: unknown): FilmModule | null {
  if (!isModuleName(name) || !isPlainObject(value)) return null;
  return { name, kind: moduleKindOf(name, value.kind), text: clipCharacters(value.text, MAX_MODULE_CHARS) };
}

/** An asset's ref as the player keeps it (`_blob/<id>` or a `data:` URI), or `''` when it reads none. */
export function parseAssetReference(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_ASSET_REF_CHARS) return '';
  const ref = value.startsWith('/_blob/') ? value.slice(1) : value;
  return BLOB_REFERENCE_PATTERN.test(ref) || ASSET_DATA_URI_PATTERN.test(ref) ? ref : '';
}

function clampSide(value: unknown): number | undefined {
  return isFiniteNumber(value) ? Math.round(Math.min(MAX_ASSET_SIDE, Math.max(1, value))) : undefined;
}

export function parseFilmAsset(name: string, value: unknown): FilmAsset | null {
  if (!isFilmName(name) || !isPlainObject(value)) return null;
  const ref = parseAssetReference(value.ref);
  const mime = isAssetMime(value.mime) ? value.mime : null;
  if (ref === '' || mime === null) return null;
  if (mime === 'image/svg+xml' && !ref.startsWith('data:')) return null;
  if (ref.startsWith('data:') && (mime.startsWith('audio/') || ref.startsWith('data:audio/')) && !ref.startsWith(`data:${mime};`)) return null;
  const asset: FilmAsset = { name, ref, mime };
  const w = clampSide(value.w);
  const h = clampSide(value.h);
  if (w !== undefined) asset.w = w;
  if (h !== undefined) asset.h = h;
  const note = clipCharacters(value.note, MAX_ASSET_NOTE_CHARS);
  if (note !== '') asset.note = note;
  return asset;
}

export interface DocumentProblemOptions {
  /** Whether an upload exists; without it, `/_blob/<id>` refs are not checked against the uploads. */
  blobExists?: (id: string) => boolean;
}

/**
 * What the player would refuse or silently drop of one document as it would be written, or `null`.
 * `segments` is its path split at `/`.
 */
export function documentProblem(segments: readonly string[], data: Record<string, unknown>, options: DocumentProblemOptions = {}): string | null {
  const path = segments.join('/');
  const bytes = storeBytes(data);
  if (bytes > MAX_DOC_BYTES)
    return `${path} would be ${formatKib(bytes)}; the store refuses a document over 200 KiB. Split a module as name~1 … name~n (joined in order on read).`;
  if (segments.length !== 2) return null;
  const [collection, id] = segments as [string, string];
  switch (collection) {
    case 'film':
      return filmDocumentProblem(id, data);
    case 'modules':
      return moduleDocumentProblem(id, data);
    case 'assets':
      return assetDocumentProblem(id, data, options);
    default:
      return null;
  }
}

function filmDocumentProblem(id: string, data: Record<string, unknown>): string | null {
  if (id === 'meta') {
    if (typeof data.title !== 'string' || !data.title.trim())
      return 'film/meta needs {"v":1, "title":"…", "updatedAt":"…"}: the title is what people call the film.';
    if (Array.from(data.title).length > MAX_TITLE_CHARS) return `film/meta: the title is over ${MAX_TITLE_CHARS} characters.`;
  } else if (id === 'script') {
    if (typeof data.code !== 'string') return 'film/script needs {"code":"…"}: the cut, a JavaScript program that sets window.CUT.';
  }
  return null;
}

function moduleDocumentProblem(id: string, data: Record<string, unknown>): string | null {
  if (!isModuleName(id))
    return `modules/${id}: a module name is a letter or digit, then up to 63 of A–Z a–z 0–9 _ . - (a part of a split module ends ~1 … ~99); the player drops any other.`;
  if (typeof data.text !== 'string') return `modules/${id} needs {"kind":"css"|"html"|"js"|"json"|"text", "text":"…"}.`;
  if (data.kind !== undefined && !isModuleKind(data.kind))
    return `modules/${id}: kind ${JSON.stringify(data.kind)} is not one of ${MODULE_KINDS.join(', ')}.`;
  const part = modulePartOf(id);
  if (part && isUnsplitModule(part.base)) return `modules/${id}: ${part.base} is the page's own and is never split.`;
  return null;
}

function assetDocumentProblem(id: string, data: Record<string, unknown>, options: DocumentProblemOptions): string | null {
  if (!isFilmName(id)) return `assets/${id}: an asset name is a letter or digit, then up to 63 of A–Z a–z 0–9 _ . -; the player drops any other.`;
  const mime = typeof data.mime === 'string' ? data.mime : '';
  if (!isAssetMime(mime))
    return `assets/${id}: mime ${JSON.stringify(data.mime)} is not one the player reads (${ASSET_MIMES.join(', ')}); it would drop the asset. Use the upload's content type, verbatim.`;
  const ref = typeof data.ref === 'string' ? data.ref : '';
  const blob = BLOB_URL_PATTERN.exec(ref);
  if (blob) {
    if (mime === 'image/svg+xml')
      return `assets/${id}: an SVG is never uploaded; put its <svg> markup in an html module, or a data:image/svg+xml;base64,… ref.`;
    if (options.blobExists && !options.blobExists(blob[1]!))
      return `assets/${id}: ${ref} is not one of this video's uploads. Upload the file first and use the url the upload gives.`;
  } else if (ref.startsWith('data:')) {
    if (mime.startsWith('audio/'))
      return `assets/${id}: the player plays no audio stored inside the film's data (a data: ref). Upload the file and use the url the upload gives.`;
    if (!ASSET_DATA_URI_PATTERN.test(ref)) return `assets/${id}: the data: ref is not data:<image, font, video or audio type>;base64,…; the player drops it.`;
    if (!ref.startsWith(`data:${mime};`)) return `assets/${id}: mime ${mime} does not match the data: URI's own type (${ref.slice(5, ref.indexOf(';'))}).`;
  } else return `assets/${id}: ref must be this video's own /_blob/<32 hex> (from an upload) or a small data:…;base64, URI; never an external URL.`;
  for (const side of ['w', 'h'] as const) {
    const value = data[side];
    if (value !== undefined && (!isFiniteNumber(value) || value < 1)) return `assets/${id}: ${side} is a number of pixels (optional).`;
  }
  return null;
}
