/**
 * Board text markup: how each kind of text field treats Markdown (text
 * profiles), how text splits into rows and nested lists, and the typed tree
 * a renderer draws ({@link parseRichText}).
 *
 * Text is stored as Markdown-flavored source: bullet (`- `) and numbered
 * (`1. `) lines nest by indentation, inline marks are those of
 * {@link tokenizeInlineMarkdown}, and `\` escapes keep marker-like text
 * literal. Everything here is pure; the editor owns the DOM round trip.
 */

import type { ElementType } from '../schema.ts';
import { MAX_LABEL_CHARS, MAX_TEXT_CHARS } from '../schema.ts';
import { breakMarkdownLinkSyntax } from '../text-limits.ts';
import { escapeInlineMarkdown, markdownLinkUrls, tokenizeInlineMarkdown, type InlineLinkToken, type InlineToken } from './inline-markdown.ts';
import { parseNoteBlocks, tokenizeNoteInline, type NoteBlock } from './note-markdown.ts';
import { dropArrowJoiners } from './text-arrows.ts';

// ---------------------------------------------------------------------------
// Text profiles
// ---------------------------------------------------------------------------

/**
 * What a key does while editing: start a new `line`, go to the `next`
 * element, `indent` a list item, `end` editing, `step` to the next field,
 * or hand the key to the `host` (a table cell's grid).
 */
export type TextKeyAction = 'line' | 'next' | 'indent' | 'end' | 'step' | 'host';

/** How a kind of text field treats its text. */
export interface TextProfile {
  /** Inline marks: rendered (`on`), kept as typed but not offered (`kept`), or escaped (`off`). */
  marks: 'on' | 'kept' | 'off';
  /** Whether list lines are recognized. */
  lists: boolean;
  /** Whether the field holds many lines or one. */
  lines: 'many' | 'one';
  /** Most characters the field holds. */
  cap: number;
  /** What keys do while editing (by key chord). */
  keys?: Readonly<Record<string, TextKeyAction>>;
  /** Placeholder shown while the field is empty. */
  hint?: string;
}

/** Shared by every multi-line field. */
export const BASE_TEXT_PROFILE: TextProfile = { marks: 'on', lists: true, lines: 'many', cap: MAX_TEXT_CHARS };

/** Notes, shapes and free text. */
export const BLOCK_TEXT_PROFILE: TextProfile = {
  ...BASE_TEXT_PROFILE,
  keys: { Return: 'line', 'Shift+Return': 'line', 'Alt+Return': 'line', 'Mod+Return': 'next', Tab: 'indent', Escape: 'end' },
};

/** Keys of single-line fields (titles and labels). */
export const SINGLE_LINE_TEXT_KEYS: Readonly<Record<string, TextKeyAction>> = {
  Return: 'end',
  'Shift+Return': 'end',
  'Alt+Return': 'end',
  'Mod+Return': 'end',
  Tab: 'step',
  Escape: 'end',
};

/** The text profiles by name. */
export const TEXT_PROFILES = {
  note: BLOCK_TEXT_PROFILE,
  block: BLOCK_TEXT_PROFILE,
  text: BLOCK_TEXT_PROFILE,
  cell: {
    ...BASE_TEXT_PROFILE,
    keys: { Return: 'host', 'Shift+Return': 'line', 'Alt+Return': 'line', 'Mod+Return': 'host', Tab: 'host', Escape: 'host', Menu: 'host' },
  },
  title: { marks: 'kept', lists: false, lines: 'one', cap: MAX_TEXT_CHARS, keys: SINGLE_LINE_TEXT_KEYS, hint: 'Title' },
  label: { marks: 'off', lists: false, lines: 'one', cap: MAX_LABEL_CHARS, keys: SINGLE_LINE_TEXT_KEYS, hint: 'Label' },
} as const satisfies Record<string, TextProfile>;

/** The profile of each element type's main text. */
export const TEXT_PROFILE_BY_ELEMENT_TYPE: Readonly<Partial<Record<ElementType, TextProfile>>> = {
  note: TEXT_PROFILES.note,
  shape: TEXT_PROFILES.block,
  text: TEXT_PROFILES.text,
  table: TEXT_PROFILES.cell,
  container: TEXT_PROFILES.title,
  arrow: TEXT_PROFILES.label,
};

/** The profile of an element's main text (undefined for elements without text). */
export function textProfileForElement(element: { type: ElementType }): TextProfile | undefined {
  return TEXT_PROFILE_BY_ELEMENT_TYPE[element.type];
}

/** The profile used when none is given. */
export const DEFAULT_TEXT_PROFILE: TextProfile = TEXT_PROFILES.block;

// ---------------------------------------------------------------------------
// Rows and nested lists
// ---------------------------------------------------------------------------

/** Deepest list nesting (levels 0…4). */
export const MAX_LIST_INDENT_LEVEL = 4;

/**
 * Places a list line's indent on the stack of open indents and returns its
 * level: deeper indents open a level (up to the maximum), shallower ones
 * close levels.
 */
export function pushListIndent(stack: number[], indent: number): number {
  while (stack.length > 0 && stack[stack.length - 1]! > indent) stack.pop();
  if (stack.length === 0 || (stack[stack.length - 1]! < indent && stack.length <= MAX_LIST_INDENT_LEVEL)) stack.push(indent);
  return stack.length - 1;
}

/**
 * Strips the indentation of list lines, returning the flat text and each
 * line's nesting level. An indented list line with no list above it is
 * left as it is (level 0).
 */
export function flattenListIndents(text: string): { flat: string; levels: number[] } {
  const stack: number[] = [];
  const levels: number[] = [];
  const flat = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const indent = /^([ \u00A0]*)(?:[-•*]|\d{1,3}\.)[ \u00A0]/.exec(line)?.[1]?.length;
      if (indent === undefined || (indent > 0 && stack.length === 0)) {
        stack.length = 0;
        levels.push(0);
        return line;
      }
      levels.push(pushListIndent(stack, indent));
      return line.slice(indent);
    })
    .join('\n');
  return { flat, levels };
}

/** The `http(s)` link targets of a text, both as written and unescaped. */
export function linkTargetsInText(text: string): Set<string> {
  return new Set([...markdownLinkUrls(text)].flatMap((href) => [href, unescapeMarkdownChars(href)]));
}

/**
 * Normalizes text for a profile: `\n` newlines, plain spaces, no escape
 * sentinels; every mark escaped when marks are off; and, when lists are on,
 * indented list markers escaped (indentation is only meaningful once
 * {@link flattenListIndents} has run).
 */
export function normalizeTextForProfile(text: string, profile: TextProfile): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ').replace(/[\uFDD0-\uFDD4]/g, '');
  const unmarked = profile.marks === 'off' ? escapeInlineMarkdown(normalized) : normalized;
  return !profile.lists
    ? unmarked
    : unmarked.replace(/(?<=^|\n)( +)(?:([-•*])|(\d{1,3})\.)(?= )/g, (_, indent: string, bullet: string | undefined, number: string | undefined) => indent + (bullet !== undefined ? '\\' + bullet : String(number) + '\\.'));
}

/**
 * The flat blocks of a text, with numbered lists split wherever numbering
 * does not continue (`1. 2. 5.` is two lists).
 */
export function parseMarkdownBlocks(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE): NoteBlock[] {
  const normalized = normalizeTextForProfile(text, profile);
  const lines = normalized.split('\n');
  let lineIndex = 0;
  return parseNoteBlocks(normalized, profile).flatMap((block): NoteBlock[] => {
    const firstLine = lineIndex;
    lineIndex += block.kind === 'p' ? 1 : block.items.length;
    if (block.kind !== 'ol') return [block];
    const lists: Extract<NoteBlock, { kind: 'ol' }>[] = [];
    block.items.forEach((item, index) => {
      const number = Number.parseInt(lines[firstLine + index] ?? '', 10);
      const previous = lists[lists.length - 1];
      if (previous !== undefined && number === previous.start + previous.items.length) previous.items.push(item);
      else lists.push({ kind: 'ol', start: number, items: [item] });
    });
    return lists;
  });
}

/** One line of text: a paragraph or a list item at a nesting level (`n` is an item's number). */
export interface TextRow {
  kind: 'p' | 'ul' | 'ol';
  n: number;
  level: number;
  text: string;
}

/** Splits text into rows; `given` is the normalized text the rows were read from. */
export function parseTextRows(text: string, profile: TextProfile): { given: string; rows: TextRow[] } {
  const { flat, levels } = !profile.lists ? { flat: text, levels: [] as number[] } : flattenListIndents(text);
  const normalized = normalizeTextForProfile(flat, profile);
  const lines = normalized.split('\n');
  let rowIndex = 0;
  const makeRow = (kind: TextRow['kind'], rowText: string): TextRow => ({
    kind,
    n: kind === 'ol' ? Number.parseInt(lines[rowIndex] ?? '', 10) : 0,
    level: levels[rowIndex++] ?? 0,
    text: rowText,
  });
  return {
    given: normalized,
    rows: parseNoteBlocks(normalized, profile).flatMap((block) => (block.kind === 'p' ? [makeRow('p', block.text)] : block.items.map((item) => makeRow(block.kind, item)))),
  };
}

/** A paragraph of nested text, with the index of its row. */
export interface NestedTextParagraph<Content = string> {
  kind: 'p';
  row: number;
  text: Content;
}

/** An item of a nested list: its row, its text and the lists nested under it. */
export interface NestedTextListItem<Content = string> {
  row: number;
  text: Content;
  lists: NestedTextList<Content>[];
}

/** A nested list (`start` is the first number of a numbered list, 0 for bullets). */
export interface NestedTextList<Content = string> {
  kind: 'ul' | 'ol';
  start: number;
  items: NestedTextListItem<Content>[];
}

/** A top-level block of nested text. */
export type NestedTextBlock<Content = string> = NestedTextParagraph<Content> | NestedTextList<Content>;

/**
 * Nests rows into lists by level. A list ends at a paragraph, at a change
 * of list kind, or where numbering does not continue.
 */
export function nestListRows(rows: readonly TextRow[]): NestedTextBlock[] {
  const blocks: NestedTextBlock[] = [];
  const openLists: NestedTextList[] = [];
  rows.forEach((row, index) => {
    if (row.kind === 'p') {
      openLists.length = 0;
      blocks.push({ kind: 'p', row: index, text: row.text });
      return;
    }
    openLists.length = Math.min(openLists.length, row.level + 1);
    let list = openLists[row.level];
    if (list === undefined || list.kind !== row.kind || (row.kind === 'ol' && row.n !== list.start + list.items.length)) {
      list = { kind: row.kind, start: row.n, items: [] };
      (openLists[row.level - 1]?.items.at(-1)?.lists ?? blocks).push(list);
      openLists[row.level] = list;
    }
    list.items.push({ row: index, text: row.text, lists: [] });
  });
  return blocks;
}

/** The nesting level of each line of a text. */
export function listLevelsOfText(text: string): number[] {
  return flattenListIndents(text).levels;
}

/** Joins non-blank lines with single spaces. */
export function joinLinesWithSpaces(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

/** Bullet marks by nesting level (deeper levels reuse the last). */
export const BULLET_MARKS = ['•', '◦', '▪\uFE0E'] as const;

/** A row with the mark it is drawn with (`''` for paragraphs, `3.` for numbered items). */
export interface MarkedTextRow {
  mark: string;
  level: number;
  text: string;
}

/** Adds each row's mark. */
export function rowsWithMarks(rows: readonly TextRow[]): MarkedTextRow[] {
  return rows.map((row) => ({
    mark: row.kind === 'p' ? '' : row.kind === 'ul' ? (BULLET_MARKS[row.level] ?? BULLET_MARKS[2]) : String(row.n) + '.',
    level: row.level,
    text: row.text,
  }));
}

/** The rows of a text with their marks. */
export function textRowsWithMarks(text: string, profile: TextProfile): MarkedTextRow[] {
  return rowsWithMarks(parseTextRows(text, profile).rows);
}

/** `\n` when the text ends with a newline, else `''`. */
export function trailingNewlineOf(text: string): string {
  return normalizeTextForProfile(text, TEXT_PROFILES.title).endsWith('\n') ? '\n' : '';
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** Removes `\` escapes from Markdown-significant characters. */
export function unescapeMarkdownChars(text: string): string {
  return text.replace(/\\([*`[\]\\])/g, '$1');
}

/** Removes the escapes that keep list-like lines paragraphs. */
export function unescapeListMarkers(text: string): string {
  return text.replace(/(?<=^|\n)( *(?:\d{1,3})?)\\([-•.](?= ))/g, '$1$2');
}

/** Breaks Markdown link syntax everywhere except in the given link sources. */
export function restoreLinkSources(text: string, links: readonly string[] = []): string {
  return links.reduce((result, link) => result.replaceAll(breakMarkdownLinkSyntax(link), () => link), breakMarkdownLinkSyntax(text));
}

/** Turns `\r\n` and `\r` into `\n`. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Told when text was cut to fit a limit. */
export function textCutNotice(limit: number): string {
  return 'This text was cut at ' + limit.toLocaleString('en-US') + ' characters.';
}

/** {@link textCutNotice} for the board's text limit. */
export const TEXT_CUT_NOTICE = textCutNotice(MAX_TEXT_CHARS);

/** Told when typing would pass a limit. */
export function textLimitNotice(limit: number): string {
  return 'This text can hold at most ' + limit.toLocaleString('en-US') + ' characters.';
}

/** The marked (non-plain) spans of a text: emphasis, code and links. */
export function textMarkSpans(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE): InlineToken[] {
  const links = linkTargetsInText(text);
  return textRowsWithMarks(text, profile).flatMap((row) => tokenizeNoteInline(row.text, links).filter((span) => span.kind !== 'text'));
}

/** A link written back as Markdown. */
export function markdownLinkSource(link: Pick<InlineLinkToken, 'text' | 'href'>): string {
  return '[' + link.text + '](' + link.href + ')';
}

/**
 * The text as a person typed it (for copying out): escapes removed,
 * typed-arrow joiners dropped, and Markdown link syntax broken everywhere
 * except in real links. Emphasis markers stay.
 */
export function plainTextOfMarkup(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE): string {
  return dropArrowJoiners(
    restoreLinkSources(
      profile.marks === 'off' ? text : unescapeMarkdownChars(profile.lists ? unescapeListMarkers(text) : text),
      textMarkSpans(text, profile).flatMap((span) => (span.kind === 'link' ? [markdownLinkSource(span)] : [])),
    ),
  );
}

/** A drawn line: its list mark (`''` for paragraphs) and its inline spans. */
export interface TextLine {
  mark: string;
  spans: InlineToken[];
}

/** Every line of a text with its mark and spans (typed arrows drawn). */
export function textLinesWithSpans(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE): TextLine[] {
  const links = linkTargetsInText(text);
  return textRowsWithMarks(text, profile).map((row) => ({ mark: row.mark, spans: tokenizeNoteInline(row.text, links, true) }));
}

// ---------------------------------------------------------------------------
// List marks and hanging indents
// ---------------------------------------------------------------------------

/** Extra indent per nesting level, in em. */
export const LIST_INDENT_PER_LEVEL = 1.5;

/** A mark with every digit as `0` (digits are measured as equally wide). */
export function zeroDigits(mark: string): string {
  return mark.replace(/\d/g, '0');
}

/** What a mark is measured as: the mark plus the gap after it. */
export function listMarkMeasureSample(mark: string): string {
  return zeroDigits(mark) + (/\d/.test(mark) ? ' ' : '  ');
}

/** The widest of some marks (with their gaps) by a measure. */
export function widestListMark(marks: readonly string[], measure: (sample: string) => number): number {
  return marks.reduce((widest, mark) => Math.max(widest, measure(listMarkMeasureSample(mark))), 0);
}

/** The marks of top-level list rows. */
export function topLevelListMarks(rows: readonly MarkedTextRow[]): string[] {
  return rows.flatMap((row) => (row.mark !== '' && row.level === 0 ? [row.mark] : []));
}

/** The CSS variable a renderer sets to the hanging indent of list text. */
export const HANG_CSS_VAR = '--wb-hang';

/** A drawn line with its hanging indent (in the measure's units). */
export interface HungTextLine extends TextLine {
  hang: number;
}

/**
 * Every line with its hanging indent: list lines hang by the widest
 * top-level mark plus {@link LIST_INDENT_PER_LEVEL} em per level.
 */
export function textLinesWithHang(text: string, emWidth: number, measure: (sample: string) => number): HungTextLine[] {
  const rows = textRowsWithMarks(text, DEFAULT_TEXT_PROFILE);
  const markWidth = widestListMark(topLevelListMarks(rows), measure);
  return textLinesWithSpans(text).map((line, index) => ({ ...line, hang: line.mark === '' ? 0 : markWidth + LIST_INDENT_PER_LEVEL * emWidth * (rows[index]?.level ?? 0) }));
}

/** The plain text of a line's spans. */
export function lineSpanText(line: Pick<TextLine, 'spans'>): string {
  return line.spans.map((span) => span.text).join('');
}

/** A run of text and whether it is italic (and if so, whether also bold). */
export interface TextRunStyle {
  text: string;
  italic: false | 'plain' | 'bold';
}

/** A line's spans as styled runs (for measuring italics). */
export function lineSpanStyles(line: Pick<TextLine, 'spans'>): TextRunStyle[] {
  return line.spans.map((span) => ({ text: span.text, italic: span.kind === 'italic' ? 'plain' : span.kind === 'bolditalic' && 'bold' }));
}

/** The text as drawn, with each list line's original marker kept and inline marks removed. */
export function textWithListPrefixes(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE): string {
  const sourceLines = text.split(/\r\n?|\n/);
  return textLinesWithSpans(text, profile)
    .map((line, index) => (line.mark === '' ? '' : (/^[ \u00A0]*(?:[-•*]|\d{1,3}\.)[ \u00A0]/.exec(sourceLines[index] ?? '')?.[0] ?? '')) + lineSpanText(line))
    .join('\n');
}

/** Whether an element's text shows nothing. */
export function hasBlankText(element: { text: string }): boolean {
  return textWithListPrefixes(element.text).trim() === '';
}

// ---------------------------------------------------------------------------
// Rich text tree
// ---------------------------------------------------------------------------

/**
 * What a text field draws:
 * - `blocks`: text with lists, as paragraphs and nested lists (empty spans
 *   are a blank line); `hang` is the widest top-level mark in the measure's
 *   units when a measure was given.
 * - `inline`: a single line without a trailing newline.
 * - `lines`: plain lines joined by newlines, plus a trailing newline.
 */
export type RichTextTree =
  | { kind: 'blocks'; blocks: NestedTextBlock<InlineToken[]>[]; hang?: number }
  | { kind: 'inline'; spans: InlineToken[] }
  | { kind: 'lines'; lines: InlineToken[][]; trailingNewline: boolean };

/**
 * Parses text into the tree a renderer draws. Links become link tokens only when written as
 * `http(s)` Markdown links; typed arrows are drawn. `measureMark` (e.g.
 * width in `ch`) adds the hanging indent of lists.
 */
export function parseRichText(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE, measureMark?: (sample: string) => number): RichTextTree {
  const linksTo = linkTargetsInText(text);
  const spansOf = (line: string): InlineToken[] => tokenizeInlineMarkdown(line, { escapes: true, literalUnsafeLinks: true, linksTo, pretty: true });
  const { rows } = parseTextRows(text, profile);
  if (rows.some((row) => row.kind !== 'p')) {
    const blankOr = (line: string): InlineToken[] => (line === '' ? [] : spansOf(line));
    const mapList = (list: NestedTextList): NestedTextList<InlineToken[]> => ({
      kind: list.kind,
      start: list.start,
      items: list.items.map((item) => ({ row: item.row, text: blankOr(item.text), lists: item.lists.map(mapList) })),
    });
    const blocks = nestListRows(rows).map((block): NestedTextBlock<InlineToken[]> => (block.kind === 'p' ? { kind: 'p', row: block.row, text: blankOr(block.text) } : mapList(block)));
    return measureMark === undefined ? { kind: 'blocks', blocks } : { kind: 'blocks', blocks, hang: widestListMark(topLevelListMarks(rowsWithMarks(rows)), measureMark) };
  }
  const lines = rows.map((row) => row.text);
  const trailingNewline = trailingNewlineOf(text) !== '';
  if (lines.length === 1 && !trailingNewline) return { kind: 'inline', spans: spansOf(lines[0] ?? '') };
  return { kind: 'lines', lines: lines.map(spansOf), trailingNewline };
}
