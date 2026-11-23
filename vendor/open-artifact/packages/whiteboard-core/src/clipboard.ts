/**
 * Board clipboard data: how copied elements travel between boards (and
 * between artifacts) and what plain text a copy carries for other apps.
 *
 * DOM-free. The editor owns the clipboard events: on copy it collects the
 * elements that move together, calls {@link boardClipboardCopy} and writes
 * `text/plain` plus {@link artifactClipboardHtml}; on paste it reads
 * `text/html` with {@link parseArtifactClipboardHtml} and hands the data to
 * {@link readBoardClipboardElements} and the paste edits.
 *
 * The payload rides inside the HTML flavor as a base64 attribute on a
 * `<span>` wrapping the escaped plain text, so other apps paste the text and
 * artifacts get the structured data back.
 */

import { parseBoardContent } from './normalize.ts';
import { arrowEndIds, omitAuthorshipFields, type BoardElement, type ElementId } from './schema.ts';
import { stripInlineMarkers, stripMarkdownLinks, tableToTsv } from './table.ts';

/* -------------------------------------------------------------------------- */
/* Artifact clipboard payload                                                 */
/* -------------------------------------------------------------------------- */

/** The payload kind whiteboard copies carry. */
export const BOARD_CLIPBOARD_KIND = 'whiteboard-elements';

/** The HTML attribute holding an artifact clipboard payload. */
export const ARTIFACT_CLIPBOARD_ATTRIBUTE = 'data-appifact-object';

/** Finds the payload attribute in clipboard HTML; group 1 is the base64 payload. */
export const ARTIFACT_CLIPBOARD_PATTERN = /\bdata-(?:open-artifact|appifact)-object="([A-Za-z0-9+/=]+)"/;

/** The version marker inside every payload (bumped on incompatible changes). */
export const ARTIFACT_CLIPBOARD_VERSION = 1;

/** A clipboard payload: what kind of thing was copied and its data. */
export interface ClipboardPayload<T = unknown> {
  kind: string;
  data: T;
}

/** The JSON stored in the payload attribute. */
interface StoredClipboardPayload {
  openArtifact?: typeof ARTIFACT_CLIPBOARD_VERSION;
  appifact?: typeof ARTIFACT_CLIPBOARD_VERSION;
  kind: string;
  data: unknown;
}

/** Bytes per `String.fromCharCode` call, so large payloads do not overflow the stack. */
const BASE64_CHUNK = 32768;

/** Base64 of a string's UTF-8 bytes (or of raw bytes). */
export function encodeClipboardUtf8(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** The UTF-8 text of base64, or `undefined` when it is not valid base64. */
export function decodeClipboardUtf8(base64: string): string | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/** Escapes text for HTML content and double-quoted attributes. */
export function escapeClipboardHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The `text/html` flavor of a copy: a `<span>` carrying the payload in
 * {@link ARTIFACT_CLIPBOARD_ATTRIBUTE} and showing `text`.
 */
export function artifactClipboardHtml(payload: ClipboardPayload, text: string): string {
  const stored: StoredClipboardPayload = { appifact: ARTIFACT_CLIPBOARD_VERSION, openArtifact: ARTIFACT_CLIPBOARD_VERSION, kind: payload.kind, data: payload.data };
  const encoded = encodeClipboardUtf8(JSON.stringify(stored));
  return `<span ${ARTIFACT_CLIPBOARD_ATTRIBUTE}="${encoded}" data-open-artifact-object="${encoded}">${escapeClipboardHtml(text)}</span>`;
}

/** The payload inside clipboard HTML, or `undefined` when it carries none (or a broken one). */
export function parseArtifactClipboardHtml(html: string): ClipboardPayload | undefined {
  const encoded = html === '' ? undefined : ARTIFACT_CLIPBOARD_PATTERN.exec(html)?.[1];
  if (encoded === undefined) return undefined;
  const json = decodeClipboardUtf8(encoded);
  if (json === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as Partial<StoredClipboardPayload>;
    if ((record.appifact ?? record.openArtifact) !== ARTIFACT_CLIPBOARD_VERSION || typeof record.kind !== 'string' || !Object.hasOwn(record, 'data')) return undefined;
    return { kind: record.kind, data: record.data };
  } catch {
    return undefined;
  }
}

/**
 * True when pasted text is just the names (or paths) of the pasted files,
 * as file managers put them beside the files themselves, or a lone URL; the
 * files then win over the text.
 */
export function clipboardTextIsFileNames(files: readonly { name: string }[], text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || /^https?:\/\/\S+$/.test(trimmed)) return true;
  const names = new Set(files.map((file) => file.name));
  return trimmed.split(/\r\n|\r|\n/).every((line) => names.has(clipboardFileBaseName(line)));
}

/** The file name of a pasted path or `file:` URL (other text comes back trimmed). */
export function clipboardFileBaseName(text: string): string {
  let value = text.trim().replace(/^"(.*)"$/, '$1');
  if (!/^(file:\/\/|\/|\\\\|[A-Za-z]:[\\/])/i.test(value)) return value;
  if (/^file:/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw URL when it is not valid percent-encoding.
    }
  }
  return value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);
}

/* -------------------------------------------------------------------------- */
/* Plain text for other apps                                                  */
/* -------------------------------------------------------------------------- */

/** Every line break, including the Unicode ones. */
export const CLIPBOARD_TEXT_LINE_BREAK_PATTERN = /[\t\v\f\r\n\u0085\u2028\u2029]/g;

/** Line breaks other than `\n` (and tabs), which would split spreadsheet cells. */
export const CLIPBOARD_TEXT_CONTROL_BREAK_PATTERN = /[\t\v\f\r\u0085\u2028\u2029]/g;

/** Control, invisible and bidi-override characters that never belong in copied text. */
export const CLIPBOARD_UNSAFE_TEXT_CHARACTERS_PATTERN = /[\p{Cc}­؜​‎‏‪-‮⁠-⁤⁦-⁩﻿]/gu;

/** Leading whitespace, quotes and joiners (which could hide a formula sign). */
export const CLIPBOARD_TEXT_LEADING_SPACE_PATTERN = /^[\s"‌‍]+/;

/** Zero-width joiners. */
export const CLIPBOARD_LEADING_JOINER_PATTERN = /[‌‍]/g;

/** Text that a spreadsheet would run as a formula gets a leading `'`. */
export function escapeSpreadsheetFormula(text: string): string {
  return /^[\s"]*[=+@-]/.test(text) ? `'${text}` : text;
}

/** Drops unsafe characters and joiners hiding in the leading whitespace. */
export function sanitizeClipboardText(text: string): string {
  return text
    .replace(CLIPBOARD_UNSAFE_TEXT_CHARACTERS_PATTERN, '')
    .replace(CLIPBOARD_TEXT_LEADING_SPACE_PATTERN, (lead) => lead.replace(CLIPBOARD_LEADING_JOINER_PATTERN, ''));
}

/** A table cell made safe for TSV: one line, no unsafe characters, no formula. */
export function sanitizeClipboardTableCell(text: string): string {
  return escapeSpreadsheetFormula(sanitizeClipboardText(text.replace(CLIPBOARD_TEXT_LINE_BREAK_PATTERN, ' ')));
}

/**
 * Turns element markup (inline Markdown) into plain text. The editor passes
 * its rich-text converter; the default drops link targets and inline markers.
 */
export type PlainTextOfMarkup = (markup: string, element?: BoardElement) => string;

/** The default {@link PlainTextOfMarkup}. */
export const plainTextOfInlineMarkup: PlainTextOfMarkup = (markup) => stripInlineMarkers(stripMarkdownLinks(markup));

/**
 * The plain text of copied elements, one element per line: texts and arrow
 * labels as plain text, links as their URL, tables as TSV. When a table is
 * among them every line is made spreadsheet-safe, since the paste will
 * likely land in one.
 */
export function selectionAsPlainText(elements: readonly BoardElement[], plainText: PlainTextOfMarkup = plainTextOfInlineMarkup): string {
  const hasTable = elements.some((element) => element.type === 'table');
  const cleanLines = (text: string): string =>
    hasTable
      ? text
          .split('\n')
          .map((line) => escapeSpreadsheetFormula(sanitizeClipboardText(line.replace(CLIPBOARD_TEXT_CONTROL_BREAK_PATTERN, ' '))))
          .join('\n')
      : text;
  return elements
    .map(omitAuthorshipFields)
    .map((element) => {
      if ('text' in element && typeof element.text === 'string') return cleanLines(plainText(element.text, element));
      if (element.type === 'arrow') return cleanLines(plainText(element.label ?? '', element));
      if (element.type === 'link') return cleanLines(element.href);
      if (element.type === 'table') return tableToTsv(element, (cell) => sanitizeClipboardTableCell(plainText(cell, element)));
      return '';
    })
    .filter((text) => text.trim() !== '')
    .join('\n');
}

/* -------------------------------------------------------------------------- */
/* Copying board elements                                                     */
/* -------------------------------------------------------------------------- */

/** What a board copy puts on the clipboard. */
export interface BoardClipboardCopy {
  /** The payload data: the copied elements with only wholly copied groups. */
  data: BoardElement[];
  /** The `text/plain` flavor. */
  text: string;
}

/**
 * The clipboard contents for `copied` (the elements that move together with
 * the selection, collected by the editor) taken from a board holding
 * `elements`. Groups survive only when the copy holds all their members.
 */
export function boardClipboardCopy(
  copied: readonly BoardElement[],
  elements: readonly BoardElement[],
  plainText: PlainTextOfMarkup = plainTextOfInlineMarkup,
): BoardClipboardCopy {
  return { data: keepWholeGroups(copied, elements), text: selectionAsPlainText(copied, plainText) };
}

/**
 * Board elements from a clipboard payload's data: normalized like any
 * stored board (unknown fields and broken elements dropped). Empty when the
 * data holds none.
 */
export function readBoardClipboardElements(data: unknown): BoardElement[] {
  return parseBoardContent({ elements: data }).elements;
}

/** The clipboard payload of a board copy. */
export function boardClipboardPayload(copy: BoardClipboardCopy): ClipboardPayload<BoardElement[]> {
  return { kind: BOARD_CLIPBOARD_KIND, data: copy.data };
}

/* Private group helpers (the grouping module owns the public versions). */

function groupMembers(elements: readonly BoardElement[]): Map<string, ElementId[]> {
  const members = new Map<string, ElementId[]>();
  for (const element of elements) {
    for (const group of element.groups ?? []) {
      const list = members.get(group);
      if (list === undefined) members.set(group, [element.id]);
      else list.push(element.id);
    }
  }
  return members;
}

/** Copied elements keep only groups whose members were all copied (loose arrows aside). */
function keepWholeGroups(copied: readonly BoardElement[], elements: readonly BoardElement[]): BoardElement[] {
  const members = groupMembers(elements);
  if (members.size === 0) return [...copied];
  const copiedIds = new Set(copied.map((element) => element.id));
  const looseArrows = new Set(
    elements.flatMap((element) =>
      element.type === 'arrow' && !arrowEndIds(element).every((id) => copiedIds.has(id)) ? [element.id] : [],
    ),
  );
  const whole = (group: string): boolean => members.get(group)?.every((id) => copiedIds.has(id) || looseArrows.has(id)) === true;
  return copied.map((element) => {
    if (element.groups === undefined || element.groups.every(whole)) return element;
    const { groups, ...rest } = element;
    const kept = groups.filter(whole);
    return (kept.length > 0 ? { ...rest, groups: kept } : rest) as BoardElement;
  });
}
