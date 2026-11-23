/**
 * The board file: a self-contained JSON download of a board that people can
 * keep, share or hand to an agent, and that boards can import again.
 *
 * ```
 * {
 *   "format": "open-artifact-whiteboard",
 *   "version": 1,
 *   "title": "Retro",
 *   "url": "https://…",          optional: where the board lives
 *   "preview": "data:image/png…", optional: a rendered picture (editor-made)
 *   "outline": "line\nline…",     the board's text in reading order
 *   "items": [ {id, type, …} ]    the elements, without authorship
 * }
 * ```
 *
 * Building the file is data-only: the editor supplies the reading order and
 * the preview picture (both need layout and rendering). Web embeds keep
 * only their `<title>`, so a file never carries runnable markup.
 */

import { parseBoardContent } from './normalize.ts';
import { omitAuthorshipFields, type Board, type BoardElement } from './schema.ts';
import { stripInlineMarkers, stripMarkdownLinks, tableCellGrid } from './table.ts';

/** The `format` marker of a board file. */
export const BOARD_FILE_FORMAT = 'open-artifact-whiteboard';

/** The current board file version. */
export const BOARD_FILE_VERSION = 1;

/** The title a file gets when the board has none. */
export const BOARD_FILE_DEFAULT_TITLE = 'Whiteboard';

/** Longest file name stem, in characters. */
export const BOARD_FILE_NAME_MAX_CHARS = 100;

/** A board file. */
export interface BoardFile {
  format: typeof BOARD_FILE_FORMAT;
  version: typeof BOARD_FILE_VERSION;
  title: string;
  url?: string;
  /** A PNG data URL of the board, when the editor rendered one. */
  preview?: string;
  /** The board's text in reading order, one line per text (tables one line per row). */
  outline: string;
  items: BoardElement[];
}

/** Options of {@link buildBoardFile}. */
export interface BoardFileOptions {
  /** Where the board lives (a share link). */
  url?: string;
  /** A rendered picture of the board (PNG data URL). */
  preview?: string;
  /**
   * The elements in reading order, for the outline (the editor passes its
   * layout-aware reading order). Default: drawing order.
   */
  readingOrder?: (elements: readonly BoardElement[]) => readonly BoardElement[];
  /** Plain text of element markup. Default: drops link targets and inline markers. */
  plainText?: (markup: string) => string;
}

/** Image data URLs the file keeps byte for byte (everything else is made well-formed). */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/;

/** A lone surrogate half (which JSON encoders and decoders disagree about). */
const UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `text` with unpaired surrogates replaced by U+FFFD. */
function replaceUnpairedSurrogates(text: string): string {
  return text.replace(UNPAIRED_SURROGATE_PATTERN, '\uFFFD');
}

/** Remove a share parameter without changing the other query parameters or their escaping. */
function withoutShareKeys(word: string): string {
  return word.replace(/([?&#;])(?:sk=[A-Za-z0-9_-]{16,64}&)+/gi, '$1')
    .replace(/[?&#;]sk=[A-Za-z0-9_-]{16,64}(?![A-Za-z0-9_-])/gi, '')
    .replace(/(^|[^A-Za-z0-9])sk=[A-Za-z0-9_-]{16,64}(?![A-Za-z0-9_-])/gi, '$1');
}

/** Links in board text can also be URL- or HTML-encoded. Keep ordinary text byte-for-byte. */
function scrubExportLinks(text: string): string {
  return text.replace(/\S+/g, (word) => {
    const clean = withoutShareKeys(word);
    if (!/[%&]/.test(clean)) return clean;
    let decoded = clean;
    for (let round = 0; round < 8; round++) {
      const next = decoded
        .replace(/(?:%[0-9a-f]{2})+/gi, (bytes) => {
          try { return decodeURIComponent(bytes); } catch { return bytes; }
        })
        .replace(/&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi, (_, hex: string | undefined, decimal: string) =>
          String.fromCodePoint(Math.min(0x10ffff, hex ? parseInt(hex, 16) : Number(decimal))))
        .replace(/&amp;/gi, '&');
      if (decoded === next) break;
      decoded = next;
    }
    const scrubbed = withoutShareKeys(decoded);
    return scrubbed === decoded ? clean : scrubbed;
  });
}

/**
 * `JSON.stringify` replacer for board files: strings (other than image data
 * URLs, kept as they are) lose unpaired surrogates, so every reader parses
 * the file the same way.
 */
export function boardFileJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'string' && !IMAGE_DATA_URL_PATTERN.test(value) ? replaceUnpairedSurrogates(scrubExportLinks(value)) : value;
}

/** The title of an HTML document (its `<title>`, whitespace collapsed), if any. */
export function htmlDocumentTitle(html: string): string | undefined {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
  return title === undefined || title === '' ? undefined : title;
}

/** Just the `<title>` tag of an embed's HTML (empty when it has none). */
export function htmlTitleTagFor(html: string): string {
  const title = htmlDocumentTitle(html);
  return title === undefined ? '' : `<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`;
}

/** The element as a board file stores it: no authorship, embeds reduced to their title. */
export function boardFileItem(element: BoardElement): BoardElement {
  const item = omitAuthorshipFields(element);
  return item.type === 'html' ? { ...item, html: htmlTitleTagFor(item.html) } : item;
}

const defaultPlainText = (markup: string): string => stripInlineMarkers(stripMarkdownLinks(markup));

/** Joins a text's lines with spaces, so each outline entry is one line. */
function joinLinesWithSpaces(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * The outline of a board file: each element's text on its own line in the
 * order given (tables contribute one line per row, cells joined by spaces).
 */
export function boardFileOutline(elements: readonly BoardElement[], plainText: (markup: string) => string = defaultPlainText): string {
  return elements
    .flatMap((element) => {
      if (element.type === 'table') return tableCellGrid(element).map((row) => row.map(plainText).join(' '));
      if ('text' in element && typeof element.text === 'string') return [plainText(element.text)];
      if ('label' in element && typeof element.label === 'string') return [plainText(element.label)];
      if (element.type === 'link') return [element.title ?? element.href];
      return [];
    })
    .map(joinLinesWithSpaces)
    .filter((line) => line !== '')
    .join('\n');
}

/** Builds the board file of a board. */
export function buildBoardFile(board: Board, options: BoardFileOptions = {}): BoardFile {
  const title = board.title.trim() !== '' ? board.title.trim() : BOARD_FILE_DEFAULT_TITLE;
  const items = board.content.elements.map(boardFileItem);
  const ordered = options.readingOrder?.(items) ?? items;
  return {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    title,
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.preview !== undefined ? { preview: options.preview } : {}),
    outline: boardFileOutline(ordered, options.plainText),
    items,
  };
}

/** The file's JSON text. */
export function serializeBoardFile(file: BoardFile): string {
  return JSON.stringify(file, boardFileJsonReplacer);
}

/** The download name of a board file: its title (at most 100 characters) plus `.json`. */
export function boardFileName(title: string): string {
  const stem = [...scrubExportLinks(title).trim()].slice(0, BOARD_FILE_NAME_MAX_CHARS).join('').trim();
  return `${stem !== '' ? stem : BOARD_FILE_DEFAULT_TITLE}.json`;
}

/** What {@link parseBoardFile} reads back. */
export interface ParsedBoardFile {
  title: string;
  url?: string;
  /** The items, normalized like any stored board (broken ones dropped). */
  elements: BoardElement[];
}

/**
 * Reads a board file (text or parsed JSON). Returns `undefined` when it is
 * not a board file of a version this code reads. To put the elements on a
 * board, paste them (fresh ids, offset to a free spot) with the paste edits.
 */
export function parseBoardFile(input: unknown): ParsedBoardFile | undefined {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const file = value as Partial<Record<keyof BoardFile, unknown>>;
  if (file.format !== BOARD_FILE_FORMAT || file.version !== BOARD_FILE_VERSION || !Array.isArray(file.items)) return undefined;
  const elements = parseBoardContent({ elements: file.items }).elements;
  const title = typeof file.title === 'string' && file.title.trim() !== '' ? file.title.trim() : BOARD_FILE_DEFAULT_TITLE;
  return { title, ...(typeof file.url === 'string' ? { url: file.url } : {}), elements };
}
