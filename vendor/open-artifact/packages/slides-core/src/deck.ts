/**
 * The deck index, `project/deck.json`.
 *
 * A deck is a folder: the index (title, slide order, outline sections, cover,
 * typefaces, installed design systems) plus one `project/slides/<id>.html`
 * per slide. A slide exists while its file exists; `order` only places it,
 * and files `order` does not list come last. Keys this editor does not know
 * are kept as they were.
 */

import { FAMILY_PATTERN, ID_PATTERN, LIMITS, NAMESPACE_PATTERN, BLOB_PATTERN, normalizeDeckSize, type DeckSize } from './limits.ts';

/** Path of the index. */
export const DECK_PATH = 'project/deck.json';
/** Folder of slide files. */
export const SLIDES_DIR = 'project/slides/';
/** Folder of installed design systems. */
export const DS_DIR = 'project/ds/';
/** The index format version this editor writes. */
export const DECK_VERSION = 4;
/** `v` of a source deck (one with a `format` key); the newest version this editor reads. */
export const SOURCE_DECK_VERSION = 5;

/** deck.json `format`: the deck's slides are HTML with classes, sharing these stylesheets. */
export interface DeckFormat {
  v: number;
  /** Shared stylesheets by project path; `project/deck.css` is the one this editor reads. */
  shared: string[];
  [key: string]: unknown;
}

/** The file of a slide. */
export function slidePath(id: string): string {
  return `${SLIDES_DIR}${id}.html`;
}

/** The slide id of a slide file path, or undefined. */
export function slideIdFromPath(path: string): string | undefined {
  if (!path.startsWith(SLIDES_DIR) || !path.endsWith('.html')) return undefined;
  const id = path.slice(SLIDES_DIR.length, -5);
  return ID_PATTERN.test(id) ? id : undefined;
}

/** One typeface: a Google Fonts link or an uploaded / installed font file. */
export interface DeckFace {
  family: string;
  /** `https://fonts.googleapis.com/css2?…` */
  href?: string;
  /** `/_blob/<id>` or `project/ds/<folder>/….woff2|woff|ttf|otf` */
  src?: string;
}

/** An outline section: a run of slides with a one-sentence description. */
export interface DeckSection {
  description: string;
  /** The first slide of the run. */
  start?: string;
  /** An empty section sits before this slide (null: at the end). */
  before?: string | null;
  /** Tie-break between empty sections at the same place. */
  seq?: number;
}

/** A design system installed in the deck. */
export interface DesignSystemRecord {
  title: string;
  /** The folder under `project/ds/`. */
  namespace: string;
  /** The design system artifact's address. */
  artifact: string;
  /** Its version id when copied (null when unknown). */
  version: string | null;
  /** RFC 3339 time of the copy. */
  copiedAt: string;
  /** The files were sent as bytes, not copied from the artifact. */
  unpinned?: boolean;
  [key: string]: unknown;
}

/** `project/deck.json`. */
export interface DeckIndex {
  v: number;
  /** When the index was first written (the cover picture keys on it). */
  createdOnFiles?: { v: number; at: string };
  /** `"css"`: lists render as CSS lists (every deck this editor creates). */
  lists?: string;
  /** Present on a source deck (`project/deck.css` plus slides with classes); see `source.ts`. */
  format?: DeckFormat;
  title: string;
  /** `"4:3"` makes every slide 1440×1080; absent is 16:9. */
  size?: DeckSize;
  cover?: string;
  order: string[];
  sections: Record<string, DeckSection>;
  faces: Record<string, DeckFace>;
  designSystems: DesignSystemRecord[];
  attachments: Record<string, unknown>;
  /** Any other key, kept as read. */
  [key: string]: unknown;
}

/** The keys in the order they are written. */
const KEY_ORDER = ['v', 'createdOnFiles', 'lists', 'format', 'title', 'size', 'cover', 'order', 'sections', 'faces', 'designSystems', 'attachments', 'style'];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `faces` key of a family: lower case, spaces → `-`. */
export function faceKey(family: string): string {
  return family.trim().toLowerCase().replace(/ /g, '-');
}

/** Options of {@link newDeckIndex}. */
export interface NewDeckOptions {
  /** A source deck: `"v":5` and a `format` key (send `project/deck.css` with it). */
  source?: boolean;
  size?: DeckSize;
}

/** A new, empty index. */
export function newDeckIndex(title = 'Untitled', now: Date = new Date(), options: NewDeckOptions = {}): DeckIndex {
  return {
    v: options.source ? SOURCE_DECK_VERSION : DECK_VERSION,
    createdOnFiles: { v: 1, at: now.toISOString().replace(/\.\d{3}Z$/, 'Z') },
    lists: 'css',
    ...(options.source ? { format: { v: 1, shared: ['project/deck.css'] } } : {}),
    title,
    ...(options.size === '4:3' ? { size: options.size } : {}),
    order: [],
    sections: {},
    faces: {},
    designSystems: [],
    attachments: {},
  };
}

/**
 * Reads any JSON value as an index: wrong-typed fields are replaced with
 * defaults, unknown keys kept. Never throws.
 */
export function normalizeDeckIndex(raw: unknown): DeckIndex {
  const value: Json = isObject(raw) ? raw : {};
  const sections: Record<string, DeckSection> = {};
  if (isObject(value.sections)) {
    for (const [key, entry] of Object.entries(value.sections)) {
      if (!isObject(entry)) continue;
      const section: DeckSection = { description: typeof entry.description === 'string' ? entry.description : '' };
      if (typeof entry.start === 'string') section.start = entry.start;
      else if (typeof entry.before === 'string' || entry.before === null) section.before = entry.before as string | null;
      if (typeof entry.seq === 'number' && Number.isFinite(entry.seq)) section.seq = entry.seq;
      sections[key] = { ...entry, ...section };
    }
  }
  const faces: Record<string, DeckFace> = {};
  if (isObject(value.faces)) {
    for (const [key, entry] of Object.entries(value.faces)) {
      if (!isObject(entry) || typeof entry.family !== 'string') continue;
      const face: DeckFace = { family: entry.family };
      if (typeof entry.href === 'string') face.href = entry.href;
      if (typeof entry.src === 'string' && !entry.src.startsWith('data:')) face.src = entry.src;
      faces[key] = face;
    }
  }
  const systems = Array.isArray(value.designSystems)
    ? value.designSystems
    : isObject(value.designSystems)
      ? Object.values(value.designSystems)
      : [];
  const order = [...new Set((Array.isArray(value.order) ? value.order : []).filter((id): id is string => typeof id === 'string'))];
  const index: DeckIndex = {
    ...value,
    v: typeof value.v === 'number' ? value.v : DECK_VERSION,
    title: typeof value.title === 'string' ? value.title : '',
    order,
    sections,
    faces,
    designSystems: systems.filter(isObject).map((record) => ({
      ...record,
      title: typeof record.title === 'string' ? record.title : '',
      namespace: typeof record.namespace === 'string' ? record.namespace : '',
      artifact: typeof record.artifact === 'string' ? record.artifact : '',
      version: typeof record.version === 'string' ? record.version : null,
      copiedAt: typeof record.copiedAt === 'string' ? record.copiedAt : '',
    })),
    attachments: isObject(value.attachments) ? value.attachments : {},
  };
  if (typeof value.cover === 'string') index.cover = value.cover;
  else delete index.cover;
  if (!isObject(value.createdOnFiles)) delete index.createdOnFiles;
  if (typeof value.lists !== 'string') delete index.lists;
  if (isObject(value.format)) {
    const shared = Array.isArray(value.format.shared) ? value.format.shared.filter((p): p is string => typeof p === 'string') : [];
    index.format = { ...value.format, v: typeof value.format.v === 'number' ? value.format.v : 0, shared };
  } else delete index.format;
  const size = normalizeDeckSize(value.size);
  if (size) index.size = size;
  else delete index.size;
  return index;
}

/** Parses the index file's text. A parse failure yields an empty index and the error. */
export function parseDeckIndex(text: string | undefined): { index: DeckIndex; error?: string } {
  if (text === undefined || text.trim() === '') return { index: normalizeDeckIndex({}) };
  try {
    return { index: normalizeDeckIndex(JSON.parse(text)) };
  } catch (error) {
    return { index: normalizeDeckIndex({}), error: `project/deck.json is not valid JSON (${(error as Error).message})` };
  }
}

/** Writes the index: known keys first in a fixed order, then the rest as read. */
export function serializeDeckIndex(index: DeckIndex): string {
  const out: Json = {};
  const v = Math.max(index.v, DECK_VERSION);
  for (const key of KEY_ORDER) {
    if (key === 'v') out.v = v;
    else if (index[key] !== undefined) out[key] = index[key];
  }
  for (const [key, value] of Object.entries(index)) {
    if (!(key in out) && value !== undefined) out[key] = value;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * The slide order the viewer sees: `order` filtered to slides whose files
 * exist, then every other slide file sorted by id.
 */
export function resolveOrder(order: readonly string[], slideIds: Iterable<string>): string[] {
  const existing = new Set(slideIds);
  const listed = order.filter((id, i) => existing.has(id) && order.indexOf(id) === i);
  const seen = new Set(listed);
  return [...listed, ...[...existing].filter((id) => !seen.has(id)).sort()];
}

/** The deck title shown (empty → "Untitled"). */
export function displayTitle(index: DeckIndex): string {
  return index.title.trim() || 'Untitled';
}

/* -------------------------------------------------------------------------- */
/* Three-way merge                                                             */
/* -------------------------------------------------------------------------- */

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Leaf merge of one value: one side changed → that side; both → theirs. */
function mergeLeaf<T>(base: T, mine: T, theirs: T): T {
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  return theirs;
}

/** Key-by-key merge of two maps; object values merge field by field. */
function mergeMap<T>(base: Record<string, T>, mine: Record<string, T>, theirs: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])];
  for (const key of keys) {
    const b = base[key];
    const m = mine[key];
    const t = theirs[key];
    let value: T | undefined;
    if (isObject(b) && isObject(m) && isObject(t)) {
      value = mergeMap(b as Json, m as Json, t as Json) as T;
    } else {
      value = mergeLeaf(b, m, t);
    }
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Three-way merge of slide order: their order, with my additions, removals
 * and moves applied. An item both sides moved stays where theirs put it; an
 * item they removed stays removed.
 */
export function mergeOrder(base: readonly string[], mine: readonly string[], theirs: readonly string[]): string[] {
  const predecessor = (list: readonly string[], id: string): string | null => {
    const i = list.indexOf(id);
    return i > 0 ? list[i - 1]! : null;
  };
  const inBase = new Set(base);
  const inMine = new Set(mine);
  const result = theirs.filter((id) => !(inBase.has(id) && !inMine.has(id)));
  for (const id of mine) {
    const added = !inBase.has(id);
    const movedByMe = !added && predecessor(mine, id) !== predecessor(base, id);
    if (!added && !movedByMe) continue;
    if (!added) {
      // They removed it, or moved it themselves: theirs wins.
      if (!result.includes(id)) continue;
      if (predecessor(theirs, id) !== predecessor(base, id)) continue;
    }
    const at = result.indexOf(id);
    if (at >= 0) result.splice(at, 1);
    // After the nearest item before it in my order that the result holds.
    let insert = 0;
    for (let i = mine.indexOf(id) - 1; i >= 0; i--) {
      const j = result.indexOf(mine[i]!);
      if (j >= 0) {
        insert = j + 1;
        break;
      }
    }
    result.splice(insert, 0, id);
  }
  return result;
}

/** Merges design-system records by namespace (a record is one leaf). */
function mergeSystems(base: DesignSystemRecord[], mine: DesignSystemRecord[], theirs: DesignSystemRecord[]): DesignSystemRecord[] {
  const byNs = (list: DesignSystemRecord[]): Record<string, DesignSystemRecord> => Object.fromEntries(list.map((r) => [r.namespace, r]));
  const b = byNs(base);
  const m = byNs(mine);
  const t = byNs(theirs);
  const namespaces = [...new Set([...theirs.map((r) => r.namespace), ...mine.map((r) => r.namespace)])];
  const out: DesignSystemRecord[] = [];
  for (const ns of namespaces) {
    const value = mergeLeaf(b[ns], m[ns], t[ns]);
    if (value) out.push(value);
  }
  return out;
}

/**
 * Merges my edits of the index (`mine`, made from `base`) into what someone
 * saved meanwhile (`theirs`). Where both changed the same leaf, theirs wins.
 */
export function mergeDeckIndex(base: DeckIndex, mine: DeckIndex, theirs: DeckIndex): DeckIndex {
  const out: DeckIndex = { ...theirs };
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const key of keys) {
    switch (key) {
      case 'order':
        out.order = mergeOrder(base.order, mine.order, theirs.order);
        break;
      case 'sections':
      case 'faces':
      case 'attachments':
        out[key] = mergeMap(base[key] as Json, mine[key] as Json, theirs[key] as Json) as never;
        break;
      case 'designSystems':
        out.designSystems = mergeSystems(base.designSystems, mine.designSystems, theirs.designSystems);
        break;
      default: {
        const value = mergeLeaf(base[key], mine[key], theirs[key]);
        if (value === undefined) delete out[key];
        else out[key] = value;
      }
    }
  }
  out.v = Math.max(theirs.v, mine.v);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                      */
/* -------------------------------------------------------------------------- */

/** A problem with the index. */
export interface DeckProblem {
  level: 'error' | 'warning' | 'note';
  message: string;
}

/** True for a Google Fonts css2 link. */
export function isFontHref(href: string): boolean {
  return href.length <= LIMITS.fontHref && /^https:\/\/fonts\.googleapis\.com\/css2\?[^\s"'<>]+$/.test(href);
}

/** True for a font file source the deck may name. */
export function isFontSrc(src: string): boolean {
  return (
    BLOB_PATTERN.test(src) ||
    /^project\/ds\/[a-z0-9][a-z0-9_-]{0,63}\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/){0,8}[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(?:woff2|woff|ttf|otf)$/.test(src)
  );
}

/** Checks the index against the files that exist. */
export function checkDeckIndex(index: DeckIndex, slideIds: ReadonlySet<string>): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const add = (level: DeckProblem['level'], message: string): void => {
    problems.push({ level, message: `project/deck.json: ${message}` });
  };
  if (index.v > SOURCE_DECK_VERSION) add('warning', `"v": ${index.v} is newer than this editor (${SOURCE_DECK_VERSION})`);
  if (index.format !== undefined && !(index.format.v === 1 && index.format.shared.every((p) => p === 'project/deck.css'))) {
    add('error', `"format" ${JSON.stringify(index.format).slice(0, 80)} is not one this editor reads ({"v":1,"shared":["project/deck.css"]})`);
  }
  for (const id of index.order) {
    if (!ID_PATTERN.test(id)) add('error', `order lists "${id.slice(0, 40)}" — slide ids are 1–64 letters, digits, _ or -`);
    else if (!slideIds.has(id)) add('warning', `order lists "${id}" but project/slides/${id}.html does not exist (not shown)`);
  }
  if (slideIds.size > LIMITS.slides) add('error', `${slideIds.size} slides — at most ${LIMITS.slides} in one deck`);
  if (index.cover !== undefined && !slideIds.has(index.cover)) add('warning', `cover "${index.cover}" is not a slide`);
  const sectionKeys = Object.keys(index.sections);
  if (sectionKeys.length > LIMITS.sections) add('error', `${sectionKeys.length} sections — at most ${LIMITS.sections}`);
  const starts = new Set<string>();
  for (const [key, section] of Object.entries(index.sections)) {
    if (!ID_PATTERN.test(key)) add('error', `section key "${key.slice(0, 40)}" — 1–64 letters, digits, _ or -`);
    if (section.description.length > LIMITS.sectionDescription) add('warning', `section "${key}" description is over ${LIMITS.sectionDescription} characters`);
    if (section.start !== undefined) {
      if (!slideIds.has(section.start)) add('warning', `section "${key}" starts at "${section.start}", which is not a slide`);
      if (starts.has(section.start)) add('warning', `two sections start at "${section.start}"`);
      starts.add(section.start);
    } else if (section.before === undefined) add('warning', `section "${key}" has neither start nor before`);
  }
  const faceEntries = Object.entries(index.faces);
  if (faceEntries.length > LIMITS.faces) add('error', `${faceEntries.length} faces — at most ${LIMITS.faces}`);
  for (const [key, face] of faceEntries) {
    if (!FAMILY_PATTERN.test(face.family)) add('error', `face "${key}" family "${face.family.slice(0, 40)}" — a letter, then letters, digits, spaces, _ or - (40 at most)`);
    else if (key !== faceKey(face.family)) add('note', `face key "${key}" should be "${faceKey(face.family)}"`);
    if (face.href === undefined && face.src === undefined) add('error', `face "${key}" has neither href nor src`);
    if (face.href !== undefined && !isFontHref(face.href)) add('error', `face "${key}" href is not a https://fonts.googleapis.com/css2?… link of at most ${LIMITS.fontHref} characters`);
    if (face.src !== undefined && !isFontSrc(face.src)) add('error', `face "${key}" src must be /_blob/<id> or project/ds/<folder>/….woff2|woff|ttf|otf`);
  }
  if (index.designSystems.length > LIMITS.designSystems) add('error', `${index.designSystems.length} design systems — at most ${LIMITS.designSystems}`);
  const namespaces = new Set<string>();
  for (const record of index.designSystems) {
    if (!NAMESPACE_PATTERN.test(record.namespace)) add('error', `design system namespace "${record.namespace.slice(0, 40)}" — [a-z0-9][a-z0-9_-]{0,63}`);
    if (namespaces.has(record.namespace)) add('warning', `two design systems share the folder "${record.namespace}"`);
    namespaces.add(record.namespace);
    if (!record.artifact) add('warning', `design system "${record.namespace}" names no artifact`);
  }
  return problems;
}

/** A design-system folder name from a free-form name (`Brand 2.0` → `brand-2-0`). */
export function namespaceFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
}
