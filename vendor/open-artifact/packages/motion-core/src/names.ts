export const FILM_COLLECTION = 'film';
export const MODULES_COLLECTION = 'modules';
export const ASSETS_COLLECTION = 'assets';
/** The collections the player reads. */
export const FILM_COLLECTIONS: readonly string[] = [FILM_COLLECTION, MODULES_COLLECTION, ASSETS_COLLECTION];

export const FILM_META_PATH = 'film/meta';
export const FILM_SCRIPT_PATH = 'film/script';

export const SCENES_MODULE = 'scenes.json';
export const SHARED_MODULE = 'shared.js';
export const SCORE_MODULE = 'score.js';
export const NARRATION_MODULE = 'narration.js';

export const RETYPED_MODULE = 'retyped.json';
export const RECOLORED_MODULE = 'recolored.json';
export const REFACED_MODULE = 'refaced.json';
export const FETCHED_FONTS_MODULE = 'fetched-fonts.json';
export const RECUT_MODULE = 'recut.json';
export const RETOUCHED_MODULE = 'retouched.json';

/** The records a person's hand edits live in. Only the page writes them; the agent reads them. */
export const PAGE_ONLY_RECORDS = [RETYPED_MODULE, RECOLORED_MODULE, REFACED_MODULE, FETCHED_FONTS_MODULE, RECUT_MODULE, RETOUCHED_MODULE] as const;
export type PageOnlyRecord = (typeof PAGE_ONLY_RECORDS)[number];
export const PAGE_ONLY_RECORD_PATHS: readonly string[] = PAGE_ONLY_RECORDS.map((name) => `${MODULES_COLLECTION}/${name}`);

/** Records the page writes whole and never merges field by field. */
export const REPLACE_ONLY_RECORDS: readonly string[] = [FETCHED_FONTS_MODULE, RECOLORED_MODULE, RETOUCHED_MODULE, RETYPED_MODULE];

/** Modules the player never joins from parts (`edits.json` and `tweaks.json` are older films' records). */
export const UNSPLIT_MODULES: readonly string[] = [
  'edits.json',
  FETCHED_FONTS_MODULE,
  RECOLORED_MODULE,
  RECUT_MODULE,
  REFACED_MODULE,
  RETOUCHED_MODULE,
  RETYPED_MODULE,
  'tweaks.json',
];

/** Module names that are the player's own: no module may be named so. */
export const LAYER_MODULE_PREFIX = 'layer-';
export const SCENE_MODULE_PREFIX = 'scene-';
/** Modules a scene id may not be renamed from (`<id>.js` → `scene-<id>.js`). */
export const NON_SCENE_MODULE_BASES: readonly string[] = ['shared', 'score', 'narration'];

export const DOC_SEGMENT_PATTERN = /^(?!\.\.?$)[A-Za-z0-9_\-.~:@+]{1,200}$/;
export const FILM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(~[1-9][0-9]?)?$/;
export const MODULE_PART_PATTERN = /^(.*)~([1-9][0-9]?)$/;
export const SCENE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const RESERVED_NAMES: readonly string[] = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];
/** An upload as an asset names it: `/_blob/<id>` or `_blob/<id>`. */
export const BLOB_URL_PATTERN = /^\/?_blob\/([0-9a-f]{32})$/;
/** An upload as the store keeps it. */
export const BLOB_REFERENCE_PATTERN = /^_blob\/[0-9a-f]{32}$/;
export const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;
export const ASSET_DATA_URI_PATTERN =
  /^data:(image\/(png|jpeg|gif|webp|svg\+xml)|font\/(woff2|woff|ttf|otf)|video\/(mp4|webm)|audio\/(mpeg|wav));base64,[A-Za-z0-9+/=]+$/;
const JSON_MODULE_NAME_PATTERN = /\.json(?:~[1-9][0-9]?)?$/i;

export const MODULE_KINDS = ['js', 'css', 'html', 'json', 'text'] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

export const ASSET_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'audio/mpeg',
  'audio/wav',
] as const;
export type AssetMime = (typeof ASSET_MIMES)[number];

export const isModuleKind = (value: unknown): value is ModuleKind => typeof value === 'string' && (MODULE_KINDS as readonly string[]).includes(value);
export const isAssetMime = (value: unknown): value is AssetMime => typeof value === 'string' && (ASSET_MIMES as readonly string[]).includes(value);

const isReservedName = (name: string): boolean => RESERVED_NAMES.includes(name) || name in Object.prototype;

/** An asset's name: a letter or digit, then up to 63 of A–Z a–z 0–9 _ . - */
export const isFilmName = (name: unknown): name is string => typeof name === 'string' && FILM_NAME_PATTERN.test(name) && !isReservedName(name);

/** A module document's name, a part of a split module (`name~3`) included. */
export const isModuleName = (name: unknown): name is string => typeof name === 'string' && MODULE_NAME_PATTERN.test(name) && !isReservedName(name);

export const isJsonModuleName = (name: string): boolean => JSON_MODULE_NAME_PATTERN.test(name);

export const isSceneId = (value: unknown): value is string => typeof value === 'string' && SCENE_ID_PATTERN.test(value);

export const isUnsplitModule = (name: string): boolean => UNSPLIT_MODULES.includes(name);

export const isPageOnlyRecord = (name: string): name is PageOnlyRecord => (PAGE_ONLY_RECORDS as readonly string[]).includes(name);

/** True for a page-only record's document path (`modules/recut.json`). */
export const isPageOnlyPath = (path: string): boolean => PAGE_ONLY_RECORD_PATHS.includes(path);

export const isReplaceOnlyPath = (path: string): boolean => REPLACE_ONLY_RECORDS.some((name) => path === `${MODULES_COLLECTION}/${name}`);

/** A split module's part: its module's name and its number (1 to 99). */
export interface ModulePartName {
  base: string;
  n: number;
}

/** The part a module document's name says it is, or `null` for a whole module. */
export function modulePartOf(name: string): ModulePartName | null {
  const match = MODULE_PART_PATTERN.exec(name);
  return match ? { base: match[1]!, n: Number(match[2]) } : null;
}

export const modulePartName = (base: string, n: number): string => `${base}~${n}`;

/** The module a scene's code lives in. */
export const sceneModuleName = (sceneId: string): string => `${SCENE_MODULE_PREFIX}${sceneId}.js`;

/** The scene id a `scene-<id>.js` module is for, or `null`. */
export function sceneIdOfModule(name: string): string | null {
  const match = /^scene-(.+)\.js$/.exec(name);
  return match ? match[1]! : null;
}

export const moduleDocumentPath = (name: string): string => `${MODULES_COLLECTION}/${name}`;
export const assetDocumentPath = (name: string): string => `${ASSETS_COLLECTION}/${name}`;

/** The upload id an asset ref names, or `null`. */
export function blobIdOfRef(ref: string): string | null {
  return BLOB_URL_PATTERN.exec(ref)?.[1] ?? null;
}

/** The segments of a document path (`collection/doc_id`, pairs at any depth), or `null` when it is not one. */
export function documentSegments(path: unknown): string[] | null {
  if (typeof path !== 'string') return null;
  const clean = path.replace(/^\/+|\/+$/g, '');
  const segments = clean === '' ? [] : clean.split('/');
  if (segments.length === 0 || segments.length > 16 || segments.length % 2 !== 0) return null;
  return segments.every((segment) => DOC_SEGMENT_PATTERN.test(segment)) ? segments : null;
}
