/**
 * Whole-board checks over the stored documents (see `codec.ts` for the
 * layout): what the editor would drop, refuse to sync or quietly repair.
 * Used by the type server's project check and by agent-side tools before
 * writing documents directly.
 *
 * Errors are what the board drops or refuses; warnings are what it repairs
 * on its own; info notes are harmless oddities.
 */

import {
  BOARD_CLAIM_PREFIX,
  BOARD_INKS_PATH,
  BOARD_META_PATH,
  BOARD_TIMER_PATH,
  ELEMENTS_COLLECTION,
  MAX_SYNC_BOARD_BYTES,
  composeBoard,
  elementIdOfPath,
  refuseDocument,
  type DocumentValue,
} from './codec.ts';
import { UNKNOWN_SVG_PART, unknownSvgParts } from './drawn-svg/vetting.ts';
import { savedIdeaPath, VERSION_OPTION_LIMITS } from './ideas.ts';
import { MAX_SVG_DATA_URL_CHARS, MAX_SVG_SOURCE_CHARS, UPLOADED_BLOB_PATH_PATTERN, normalizeImageSource } from './image-source.ts';
import { escapedJsonByteLength } from './json.ts';
import { normalizeClaimedAreas, normalizeElement } from './normalize.ts';
import { DRAWING_STYLES, ELEMENT_ID_PATTERN, MAX_BOARD_ELEMENTS, NOTE_COLORS, arrowEndIds, isBoxElement, type BoardElement, type ElementId, type TableElement } from './schema.ts';
import { COLUMN_WIDTH_GUIDE, COLUMN_WIDTH_LIMITS, suggestedColumnWidth, tableRowIds, tableTintColor, toFiniteNumber, type TableData } from './table.ts';

/** Severity of a board finding. */
export type BoardCheckLevel = 'error' | 'warning' | 'info';

/** One finding, tied to a document path (`elements/n1`, `board/meta`, …) or a collection (`elements/`). */
export interface BoardCheckFinding {
  path: string;
  level: BoardCheckLevel;
  message: string;
}

/** Options of {@link checkBoardDocuments}. */
export interface BoardCheckOptions {
  /** How messages name a document (the type server passes `db/<path>.json`). Default: the path. */
  describe?: (path: string) => string;
  /** Whether an upload exists (`/_blob/<id>`); without it uploads are not checked. */
  blobExists?: (id: string) => boolean;
}

/* -------------------------------------------------------------------------- */
/* Drawings                                                                   */
/* -------------------------------------------------------------------------- */

/** More nested `<g>` than this and the page shows a grey box. */
export const MAX_DRAWING_GROUP_DEPTH = 5;
/** More `opacity` attributes than this and the page shows a grey box. */
export const MAX_DRAWING_OPACITY = 64;

/** The SVG text of a drawing's data URI: `undefined` when it does not decode. */
function drawingText(src: string): string | undefined {
  const comma = src.indexOf(',');
  if (comma < 0) return undefined;
  const body = src.slice(comma + 1);
  try {
    if (src.slice(0, comma).endsWith(';base64')) {
      const binary = atob(body.replace(/\s+/g, ''));
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    }
    // The page drops line breaks and tabs before decoding.
    return decodeURIComponent(body.replace(/[\t\n\r]/g, ''));
  } catch {
    return undefined;
  }
}

/** Deepest nesting of `<g>` in an SVG text. */
function groupDepth(svg: string): number {
  let depth = 0;
  let deepest = 0;
  for (const match of svg.matchAll(/<(\/?)g(?=[\s/>])[^>]*?(\/?)>/g)) {
    if (match[1]) depth = Math.max(0, depth - 1);
    else if (!match[2]) deepest = Math.max(deepest, ++depth);
  }
  return deepest;
}

const countText = (count: number): string => count.toLocaleString('en-US');

/** Findings about a drawing over {@link MAX_SVG_SOURCE_CHARS} or {@link MAX_SVG_DATA_URL_CHARS}, with how much to cut. */
function drawingSizeFindings(src: string, svg: string, base64: boolean): Array<[BoardCheckLevel, string]> {
  const findings: Array<[BoardCheckLevel, string]> = [];
  if (svg.length > MAX_SVG_SOURCE_CHARS) {
    findings.push([
      'error',
      `The SVG is ${countText(svg.length)} characters, over the ${countText(MAX_SVG_SOURCE_CHARS)} limit: cut at least ${countText(svg.length - MAX_SVG_SOURCE_CHARS)}. The drawing shows as an empty picture.`,
    ]);
  }
  const stored = base64 ? src.length : 'data:image/svg+xml;base64,'.length + 4 * Math.ceil(new TextEncoder().encode(svg).length / 3);
  if (src.length > MAX_SVG_DATA_URL_CHARS) {
    findings.push([
      'error',
      `The SVG data URI is ${countText(src.length)} characters, over the ${countText(MAX_SVG_DATA_URL_CHARS)} limit: cut at least ${countText(src.length - MAX_SVG_DATA_URL_CHARS)}. The drawing shows as an empty picture.`,
    ]);
  } else if (stored > MAX_SVG_DATA_URL_CHARS) {
    findings.push([
      'error',
      `Stored as base64 this drawing takes ${countText(stored)} characters, over the ${countText(MAX_SVG_DATA_URL_CHARS)} limit: cut its SVG by at least ${countText(Math.ceil(((stored - MAX_SVG_DATA_URL_CHARS) * 3) / 4))} characters. The drawing shows as an empty picture.`,
    ]);
  }
  return findings;
}

/**
 * Findings about an image's SVG drawing (`data:image/svg+xml…`): a raw `#`,
 * a URI that does not decode or holds no `<svg>`, a drawing over the size
 * limits (saying by how much), and what makes the page
 * show a grey box instead (nesting, opacity layers, parts it does not know).
 * Empty for any other source.
 */
export function drawingFindings(src: unknown): Array<[BoardCheckLevel, string]> {
  if (typeof src !== 'string' || !src.startsWith('data:image/svg+xml')) return [];
  const base64 = src.slice(0, Math.max(0, src.indexOf(','))).endsWith(';base64');
  if (!base64 && src.includes('#')) {
    return [['error', 'A "#" in an SVG data URI ends it: write a colour as %23F6BD78 (and a lone % as %25). The drawing shows as an empty picture.']];
  }
  const svg = drawingText(src);
  if (svg === undefined) return [['error', 'The SVG data URI does not decode (a lone % is written %25).']];
  const findings = drawingSizeFindings(src, svg, base64);
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svg)) return [...findings, ['error', 'The SVG data URI holds no <svg> element.']];
  const depth = groupDepth(svg);
  if (depth > MAX_DRAWING_GROUP_DEPTH) {
    findings.push(['error', `<g> groups nest ${depth} deep; with more than ${MAX_DRAWING_GROUP_DEPTH} nested <g> the page shows a grey box instead of the drawing. Flatten the groups.`]);
  }
  const opacity = svg.match(/\sopacity\s*=/g)?.length ?? 0;
  if (opacity > MAX_DRAWING_OPACITY) {
    findings.push(['error', `${opacity} opacity attributes; from the ${MAX_DRAWING_OPACITY + 1}th the page shows a grey box instead of the drawing. Use fill-opacity / stroke-opacity, or fewer.`]);
  }
  if (normalizeImageSource(src) === undefined) return findings; // reported as a source the board does not allow
  const parts = unknownSvgParts(svg).filter((part) => !(part === UNKNOWN_SVG_PART && findings.length));
  if (parts.length) {
    findings.push([
      'error',
      `The page shows a grey box instead of this drawing: it has ${parts.join(', ')}. Keep to path, rect, circle, ellipse, line, polyline, polygon, g, defs and gradients with plain attributes.`,
    ]);
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Ideas                                                                      */
/* -------------------------------------------------------------------------- */

/** A saved idea's document path (`data/users/<id>/idea`). */
export const IDEA_DOCUMENT_PATTERN = /^data\/users\/[^/]+\/idea$/;
/** Largest saved idea the agent writes, bytes of JSON. */
export const MAX_IDEA_DOCUMENT_BYTES = 64 * 1024;
/** Fields of a saved idea and of each option. */
const IDEA_FIELDS = new Set(['says', 'about', 'read', 'options']);
const IDEA_OPTION_FIELDS = new Set(['label', 'why', 'edits']);

/** Why a write is refused: a code for programs and a sentence for the agent. */
export interface DocumentRefusal {
  code: string;
  message: string;
}

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? '').length;
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What is wrong with a saved idea (reference/ideas.md), or `undefined`.
 * Only the document's shape is checked: the page itself drops an option
 * holding a bad edit.
 */
export function ideaDocumentProblem(data: unknown, path = savedIdeaPath('<id>')): DocumentRefusal | undefined {
  const refuse = (code: string, message: string): DocumentRefusal => ({ code, message: `${path}: ${message}` });
  if (!isPlainObject(data)) return refuse('INVALID_IDEA', 'an idea is a JSON object {says, about?, read?, options}.');
  const extra = Object.keys(data).filter((key) => !IDEA_FIELDS.has(key));
  if (extra.length) return refuse('INVALID_IDEA', `an idea holds says, about, read and options only (not ${extra.join(', ')}).`);
  if (typeof data.says !== 'string' || !data.says.trim() || data.says.length > 160) return refuse('INVALID_IDEA', 'says is one plain sentence, at most 160 characters.');
  if (data.about !== undefined && !(Array.isArray(data.about) && data.about.every((id) => typeof id === 'string'))) return refuse('INVALID_IDEA', 'about is [elementId, …].');
  if (data.read !== undefined && !(Array.isArray(data.read) && data.read.every((doc) => isPlainObject(doc) && typeof doc.id === 'string'))) {
    return refuse('INVALID_IDEA', 'read is [the whole document of each element an edit changes or removes, with its id, …].');
  }
  const options = data.options;
  if (!Array.isArray(options) || options.length < 2 || options.length > VERSION_OPTION_LIMITS.versions) {
    return refuse('IDEA_OPTIONS', `options is 2 to ${VERSION_OPTION_LIMITS.versions} options (it has ${Array.isArray(options) ? options.length : 'none'}).`);
  }
  const labels = new Set<string>();
  for (const [n, option] of options.entries()) {
    if (!isPlainObject(option)) return refuse('INVALID_IDEA', `options[${n}] is {label, why?, edits}.`);
    const extraOption = Object.keys(option).filter((key) => !IDEA_OPTION_FIELDS.has(key));
    if (extraOption.length) return refuse('INVALID_IDEA', `options[${n}] holds label, why and edits only (not ${extraOption.join(', ')}).`);
    if (typeof option.label !== 'string' || !option.label.trim() || option.label.length > 60) return refuse('INVALID_IDEA', `options[${n}].label is at most 60 characters.`);
    if (labels.has(option.label.trim())) return refuse('INVALID_IDEA', `options[${n}].label repeats another option's label; each is different.`);
    labels.add(option.label.trim());
    if (option.why !== undefined && (typeof option.why !== 'string' || option.why.length > 160)) return refuse('INVALID_IDEA', `options[${n}].why is at most 160 characters.`);
    const edits = option.edits;
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > VERSION_OPTION_LIMITS.edits || !edits.every((edit) => isPlainObject(edit) && typeof edit.id === 'string')) {
      return refuse('IDEA_EDITS', `options[${n}].edits is 1 to ${VERSION_OPTION_LIMITS.edits} edits, each with an id.`);
    }
    const bytes = jsonBytes(edits);
    if (bytes > VERSION_OPTION_LIMITS.bytes) return refuse('IDEA_EDITS_TOO_LARGE', `options[${n}].edits is ${Math.ceil(bytes / 1024)} KB; at most ${VERSION_OPTION_LIMITS.bytes / 1024} KB per option.`);
  }
  const bytes = jsonBytes(data);
  if (bytes > MAX_IDEA_DOCUMENT_BYTES) return refuse('IDEA_TOO_LARGE', `the idea is ${Math.ceil(bytes / 1024)} KB; it stays under ${MAX_IDEA_DOCUMENT_BYTES / 1024} KB.`);
  return undefined;
}

/** Hex keys of the inks document. */
const INK_KEY_PATTERN = /^[0-9a-f]{6}$/;

/**
 * Findings about a stored table's column widths: a `w` that is not a
 * number is dropped (the column is fitted to its text instead), one
 * outside {@link COLUMN_WIDTH_LIMITS} is kept within them, and, given the
 * normalized `table`, one narrower than {@link suggestedColumnWidth}
 * breaks its longest word across lines.
 */
export function tableColumnFindings(cols: unknown, table?: TableData): Array<[BoardCheckLevel, string]> {
  if (typeof cols !== 'object' || cols === null || Array.isArray(cols)) return [];
  const findings: Array<[BoardCheckLevel, string]> = [];
  const { min, max } = COLUMN_WIDTH_LIMITS;
  for (const [id, column] of Object.entries(cols)) {
    if (typeof column !== 'object' || column === null || !('w' in column) || column.w === undefined) continue;
    const width = toFiniteNumber(column.w);
    if (width === undefined) {
      findings.push(['warning', `Column ${id}'s "w" is its width, a number from ${min} to ${max}: the board ignores ${JSON.stringify(column.w)} and fits the column to its text.`]);
    } else if (width < min || width > max) {
      findings.push(['info', `Column ${id}'s "w" of ${width} is outside ${min}–${max}: the board draws it ${Math.round(Math.min(max, Math.max(min, width)))} wide.`]);
    } else if (table?.cols[id] !== undefined) {
      const least = suggestedColumnWidth(table, id);
      if (width < least) {
        findings.push(['info', `Column ${id} is ${width} wide, narrower than its longest word wants: give it a "w" of at least ${least} (${COLUMN_WIDTH_GUIDE.perLetter} for each letter of that word, plus ${COLUMN_WIDTH_GUIDE.pad}).`]);
      }
    }
  }
  return findings;
}

/**
 * Findings about a stored table's `fills` and `heat`: colors that are not
 * a block color name or `#rrggbb`, and rows or columns the table does not
 * have (the board ignores both). `""` clears a color and is not reported.
 */
export function tableTintFindings(fills: unknown, heat: unknown, table: TableData & Pick<TableElement, 'head'>): Array<[BoardCheckLevel, string]> {
  const findings: Array<[BoardCheckLevel, string]> = [];
  const look = (where: string, value: unknown, known: boolean): void => {
    if (!known) findings.push(['warning', `${where} names a row or column the table does not have: the board ignores it.`]);
    else if (value !== '' && tableTintColor(value) === undefined) {
      findings.push(['warning', `${where} is ${JSON.stringify(value)}, not a table color (${NOTE_COLORS.join(', ')} or #rrggbb): the board ignores it.`]);
    }
  };
  for (const [rowId, cells] of isPlainObject(fills) ? Object.entries(fills) : []) {
    for (const [colId, value] of isPlainObject(cells) ? Object.entries(cells) : []) {
      look(`"fills" ${rowId} / ${colId}`, value, Object.hasOwn(table.rows, rowId) && Object.hasOwn(table.cols, colId));
    }
  }
  const heatMaps = isPlainObject(heat) ? heat : {};
  const headRowId = table.head ? tableRowIds(table)[0] : undefined;
  const shaded = { cols: 0, rows: 0 };
  for (const axis of ['cols', 'rows'] as const) {
    const colors = heatMaps[axis];
    for (const [id, value] of isPlainObject(colors) ? Object.entries(colors) : []) {
      if (axis === 'rows' && id === headRowId) findings.push(['warning', `"heat" rows ${id} is the header row, which is never shaded: the board ignores it.`]);
      else look(`"heat" ${axis} ${id}`, value, Object.hasOwn(table[axis], id));
      if (value !== '') shaded[axis] += 1;
    }
  }
  if (shaded.cols > 0 && shaded.rows > 0) {
    findings.push(['info', '"heat" shades both columns and rows; where they cross, the column\'s shade shows. Heat maps read best along one axis: keep "cols" or "rows".']);
  }
  return findings;
}

/** True for paths the board reads. */
function isKnownPath(path: string): boolean {
  return (
    path === BOARD_META_PATH ||
    path === BOARD_TIMER_PATH ||
    path === BOARD_INKS_PATH ||
    path.startsWith(BOARD_CLAIM_PREFIX) ||
    path.startsWith(`${ELEMENTS_COLLECTION}/`) ||
    IDEA_DOCUMENT_PATTERN.test(path)
  );
}

/**
 * Checks a board's documents (path → parsed value). Covers the meta
 * document, sync limits, element validity, drawing order, the element cap,
 * arrow ends, inks and agent claims.
 */
export function checkBoardDocuments(
  documents: ReadonlyMap<string, DocumentValue>,
  options: BoardCheckOptions = {},
): BoardCheckFinding[] {
  const describe = options.describe ?? ((path: string) => path);
  const findings: BoardCheckFinding[] = [];
  const add = (path: string, level: BoardCheckLevel, message: string): void => void findings.push({ path, level, message });

  // The meta document: title and drawing order.
  const meta = documents.get(BOARD_META_PATH);
  const order: unknown[] = Array.isArray(meta?.order) ? meta.order : [];
  if (meta === undefined) {
    add(BOARD_META_PATH, 'error', 'Missing: the board has no title or drawing order. Write {"v": 1, "title": "…", "order": []}.');
  } else {
    if (!Array.isArray(meta.order)) add(BOARD_META_PATH, 'error', '"order" must be an array of element ids, back to front.');
    if (typeof meta.title !== 'string') add(BOARD_META_PATH, 'warning', '"title" should be a string: the board shows no title.');
    const seen = new Set<unknown>();
    for (const id of order) {
      if (typeof id !== 'string' || !ELEMENT_ID_PATTERN.test(id)) add(BOARD_META_PATH, 'warning', `"order" holds ${JSON.stringify(id)}, which is not an element id: it is skipped.`);
      else if (seen.has(id)) add(BOARD_META_PATH, 'warning', `"order" lists ${id} more than once: only the first counts.`);
      seen.add(id);
    }
  }

  // Sync limits.
  let boardBytes = 0;
  for (const [path, value] of documents) {
    boardBytes += escapedJsonByteLength(value);
    const refusal = refuseDocument(path, value, 0);
    if (refusal !== undefined) add(path, 'error', refusal);
    if (!isKnownPath(path)) add(path, 'info', 'The board does not read this document.');
    else if (path.startsWith(`${ELEMENTS_COLLECTION}/`) && elementIdOfPath(path) === undefined) {
      add(path, 'error', 'Not a valid element id (1–40 of A–Z a–z 0–9 _ . ~ : @ + -): the board ignores this document.');
    }
  }
  if (boardBytes > MAX_SYNC_BOARD_BYTES) {
    add(
      `${ELEMENTS_COLLECTION}/`,
      'warning',
      `The board is ${Math.ceil(boardBytes / 1024)} KB, over the ${MAX_SYNC_BOARD_BYTES / 1024 / 1024} MB live-sync budget: pages stop saving. Remove inline images or embeds, or split the board.`,
    );
  }

  // Elements against the drawing order.
  const composed = composeBoard(documents);
  for (const path of composed.dangling) {
    add(BOARD_META_PATH, 'warning', `"order" lists ${path.slice(ELEMENTS_COLLECTION.length + 1)}, but ${describe(path)} does not exist.`);
  }
  const ordered = new Set(order.filter((id): id is string => typeof id === 'string'));
  const kept: BoardElement[] = [];
  const taken = new Set<ElementId>();
  for (const raw of composed.content.elements) {
    const path = `${ELEMENTS_COLLECTION}/${raw.id}`;
    const stored = documents.get(path);
    if (stored?.type === 'image') {
      const drawing = drawingFindings(stored.src);
      for (const [level, message] of drawing) add(path, level, message);
      if (!drawing.some(([level]) => level === 'error') && normalizeImageSource(stored.src) === undefined) {
        add(path, 'error', 'The image "src" is not allowed: use an uploaded /_blob/<id> URL, an https URL, or a small data: URL. It shows as an empty drawing.');
      }
      if (stored.style !== undefined) {
        if (typeof stored.src !== 'string' || !stored.src.startsWith('data:image/svg+xml')) {
          add(path, 'warning', 'Only SVG drawings take a "style": the board ignores it on this image.');
        } else if (!(DRAWING_STYLES as readonly unknown[]).includes(stored.style)) {
          add(path, 'error', `"style" is ${JSON.stringify(stored.style)}; a drawing's style is one of ${DRAWING_STYLES.join(', ')}. The board draws it without one.`);
        }
      }
      const blob = typeof stored.src === 'string' && UPLOADED_BLOB_PATH_PATTERN.test(stored.src) ? stored.src.slice(-32) : undefined;
      if (blob && options.blobExists && !options.blobExists(blob)) {
        add(path, 'error', `/_blob/${blob} is not an upload of this board: upload the image first and use the url it prints.`);
      }
    }
    const element = normalizeElement(raw, taken);
    if (element === undefined) {
      add(path, 'error', `Not a valid ${typeof raw.type === 'string' ? `"${raw.type}" ` : ''}element: the board drops it.`);
      continue;
    }
    if (element.id !== raw.id) add(path, 'warning', `The id ${raw.id} is taken: the board gives this element the id ${element.id}.`);
    if (element.type === 'table') {
      for (const [level, message] of [...tableColumnFindings(stored?.cols, element), ...tableTintFindings(stored?.fills, stored?.heat, element)]) add(path, level, message);
    }
    taken.add(element.id);
    kept.push(element);
    if (!ordered.has(raw.id)) add(path, 'warning', `Not listed in ${describe(BOARD_META_PATH)} "order": it is drawn on top of everything.`);
  }
  if (kept.length > MAX_BOARD_ELEMENTS) {
    add(`${ELEMENTS_COLLECTION}/`, 'warning', `${kept.length} elements; a board shows at most ${MAX_BOARD_ELEMENTS}.`);
  }

  // Arrow ends attach to boxes that exist.
  const boxes = new Set(kept.filter(isBoxElement).map((element) => element.id));
  for (const element of kept) {
    if (element.type !== 'arrow') continue;
    for (const end of arrowEndIds(element)) {
      if (!boxes.has(end)) {
        add(`${ELEMENTS_COLLECTION}/${element.id}`, 'error', `The arrow points to ${end}, which is missing or cannot hold an arrow end: the board drops the arrow.`);
      }
    }
  }

  // Custom inks.
  const colors = documents.get(BOARD_INKS_PATH)?.colors;
  if (colors !== undefined) {
    if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
      add(BOARD_INKS_PATH, 'warning', '"colors" must map "rrggbb" hex keys to times: the board ignores it.');
    } else {
      for (const [key, at] of Object.entries(colors)) {
        if (!INK_KEY_PATTERN.test(key) || typeof at !== 'number' || !Number.isFinite(at)) {
          add(BOARD_INKS_PATH, 'warning', `The ink ${JSON.stringify(key)} is not a lower-case "rrggbb" key with a time: it is skipped.`);
        }
      }
    }
  }

  // Saved ideas.
  for (const [path, value] of documents) {
    if (!IDEA_DOCUMENT_PATTERN.test(path)) continue;
    const problem = ideaDocumentProblem(value, path);
    if (problem) add(path, 'error', `${problem.message.slice(path.length + 2)} The page drops the idea.`);
  }

  // Agent claims: `{}` ends one; one that still frames something should end once the work is written.
  for (const [path, value] of documents) {
    if (!path.startsWith(BOARD_CLAIM_PREFIX)) continue;
    const key = path.slice(BOARD_CLAIM_PREFIX.length);
    const [claim] = normalizeClaimedAreas([{ ...value, key }]);
    const marks = [
      claim?.x !== undefined ? 'an area' : '',
      claim?.ids !== undefined ? `${claim.ids.length} element${claim.ids.length === 1 ? '' : 's'}` : '',
    ].filter((mark) => mark !== '');
    if (marks.length > 0) {
      add(path, 'warning', `This claim still frames ${marks.join(' and ')} for everyone: once the work is written, set it to {} so the frame goes.`);
    } else if (Object.keys(value).length > 0) {
      add(path, 'warning', 'The board reads no area or elements from this claim (x, y, w, h are numbers; ids are element ids): it frames nothing. Set it to {} once the work is written.');
    }
  }

  return findings;
}
