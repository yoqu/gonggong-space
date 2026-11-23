import { documentProblem, type DocumentProblemOptions } from './documents.ts';
import { isPlainObject, utf8Bytes, type JsonObject } from './json.ts';
import { MAX_BATCH_BYTES, MAX_BATCH_WRITES } from './limits.ts';
import { FILM_META_PATH, documentSegments, isPageOnlyPath } from './names.ts';

/** A batch the type refuses before the store writes any of it. */
export interface WriteRefusal {
  code: string;
  message: string;
}

/** Documents the open page writes for each person; the agent only reads them. */
export const USER_DATA_COLLECTION = 'data';

/** A JSON merge patch as the store applies it: `{"__delete__": true}` removes a key, objects merge, anything else replaces. */
export function mergeFilmPatch(current: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: JsonObject = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && value.__delete__ === true && Object.keys(value).length === 1) delete out[key];
    else out[key] = isPlainObject(value) ? mergeFilmPatch(out[key], value) : value;
  }
  return out;
}

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) count += 1;
  return count;
}

/** The document after a `str_replace` of a dot-path text field, or `undefined` when the store would refuse it itself. */
export function replaceInField(current: unknown, field: string, old: string, replacement: string): JsonObject | undefined {
  if (!isPlainObject(current) || field === '' || old === '') return undefined;
  const keys = field.split('.');
  const out: JsonObject = { ...current };
  let at: JsonObject = out;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    if (!isPlainObject(next)) return undefined;
    const copy = { ...next };
    at[key] = copy;
    at = copy;
  }
  const last = keys[keys.length - 1]!;
  const text = at[last];
  if (typeof text !== 'string' || occurrences(text, old) !== 1) return undefined;
  at[last] = text.replace(old, () => replacement);
  return out;
}

/** The path a write names (`path`, or `collection` and `doc_id`), split at `/`, or `null` when it names none. */
export function writeSegments(write: JsonObject): string[] | null {
  const named = write.path ?? (write.collection != null && write.doc_id != null ? `${String(write.collection)}/${String(write.doc_id)}` : undefined);
  return documentSegments(named);
}

/** What a document would hold after one write; `undefined` for a delete, or a write the store refuses itself. */
export function writtenDocument(write: JsonObject, current: unknown): unknown {
  switch (write.op) {
    case 'set':
      return write.data;
    case 'update':
      return isPlainObject(write.data) ? mergeFilmPatch(current ?? {}, write.data) : undefined;
    case 'str_replace':
      return typeof write.field === 'string' && typeof write.old === 'string' && typeof write.new === 'string'
        ? replaceInField(current, write.field, write.old, write.new)
        : undefined;
    default:
      return undefined;
  }
}

const PAGE_ONLY_MESSAGE =
  'is written by the film’s page from what a person changed by hand; never write or delete it. Its "about" says how to work with it.';

/**
 * Refuses an agent's batch that the player would drop part of, or that touches what only the page writes: the
 * by-hand records, a person's own documents, the film's marker. `read` gives a document's data now (path → data);
 * a write naming `file_path` must have its data already read into `data`.
 */
export function videoWritesProblem(writes: readonly unknown[], read: (path: string) => unknown, options: DocumentProblemOptions = {}): WriteRefusal | null {
  if (writes.length > MAX_BATCH_WRITES)
    return { code: 'TOO_LARGE', message: `A batch holds at most ${MAX_BATCH_WRITES} writes; this one has ${writes.length}. Split it.` };
  const batchBytes = utf8Bytes(JSON.stringify(writes));
  if (batchBytes > MAX_BATCH_BYTES)
    return { code: 'TOO_LARGE', message: `A batch is at most 1 MiB; this one is ${Math.ceil(batchBytes / 1024)} KiB. Split it into several.` };
  const seen = new Set<string>();
  for (const [index, write] of writes.entries()) {
    if (!isPlainObject(write)) continue;
    const segments = writeSegments(write);
    if (segments === null) continue;
    const path = segments.join('/');
    const where = `writes[${index}]`;
    if (seen.has(path)) return { code: 'REFUSED', message: `${where}: ${path} is written twice in one batch; write each document once.` };
    seen.add(path);
    if (isPageOnlyPath(path)) return { code: 'READ_ONLY_PATH', message: `${where}: ${path} ${PAGE_ONLY_MESSAGE}` };
    if (segments[0] === USER_DATA_COLLECTION) return { code: 'READ_ONLY_PATH', message: `${where}: ${path} is written by the open page; you only read it.` };
    if (write.op === 'delete') {
      if (path === FILM_META_PATH) return { code: 'REFUSED', message: `${where}: ${FILM_META_PATH} marks the folder as a video; never delete it.` };
      continue;
    }
    const data = writtenDocument(write, read(path));
    if (!isPlainObject(data)) continue;
    const problem = documentProblem(segments, data, options);
    if (problem !== null) return { code: problem.includes('200 KiB') ? 'TOO_LARGE' : 'REFUSED', message: `${where}: ${problem}` };
  }
  return null;
}
