








import { tokenizeInlineMarkdown, type InlineToken } from './inline-markdown.ts';

/** A bullet line (`- item`, `• item` or `* item`), capturing the item text. */
export const BULLET_LINE_PATTERN = /^ *[-•*] (.*)$/;

/** A numbered line (`12. item`), capturing the number and the item text. */
export const NUMBERED_LINE_PATTERN = /^ *(\d{1,3})\. (.*)$/;

/** An escaped list marker (`\- item`, `3\. item`) that keeps a line a paragraph. */
export const ESCAPED_LIST_MARKER_PATTERN = /^( *(?:\d{1,3})?)\\([-•.](?= ))/;

/** A link target that may be serialized as a Markdown link. */
export const HTTP_LINK_HREF_PATTERN = /^https?:\/\/[^)\s]*$/;

/** A paragraph line. */
export interface NoteParagraphBlock {
  kind: 'p';
  text: string;
}

/** A run of bullet lines. */
export interface NoteBulletListBlock {
  kind: 'ul';
  items: string[];
}

/** A run of numbered lines, starting at the first line's number. */
export interface NoteNumberedListBlock {
  kind: 'ol';
  start: number;
  items: string[];
}

/** One block of note text. */
export type NoteBlock = NoteParagraphBlock | NoteBulletListBlock | NoteNumberedListBlock;

/** How note text is split into blocks. */
export interface NoteBlockOptions {
  /** Recognize list lines (default true); when false every line is a paragraph. */
  lists?: boolean;
}

/** Escapes a leading list marker so a paragraph line is not read as a list item. */
export function escapeListMarker(line: string): string {
  return line.replace(/^( *)([-•])(?= )/, '$1\\$2').replace(/^( *\d{1,3})\.(?= )/, '$1\\.');
}

/**
 * Splits note text into blocks: consecutive bullet (or numbered) lines form
 * one list, every other line is a paragraph (with escaped list markers
 * unescaped). Non-breaking spaces become spaces, escape sentinels are dropped
 * and one trailing newline is ignored.
 */
export function parseNoteBlocks(text: string, options?: NoteBlockOptions): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const listsEnabled = options?.lists !== false;
  for (const line of text.replace(/\u00A0/g, ' ').replace(/[\uFDD0-\uFDD4]/g, '').replace(/\n$/, '').split('\n')) {
    const lastBlock = blocks[blocks.length - 1];
    const bulletMatch = listsEnabled ? BULLET_LINE_PATTERN.exec(line) : null;
    const numberMatch = bulletMatch !== null || !listsEnabled ? null : NUMBERED_LINE_PATTERN.exec(line);
    if (bulletMatch !== null) {
      if (lastBlock?.kind === 'ul') lastBlock.items.push(bulletMatch[1] ?? '');
      else blocks.push({ kind: 'ul', items: [bulletMatch[1] ?? ''] });
    } else if (numberMatch !== null) {
      if (lastBlock?.kind === 'ol') lastBlock.items.push(numberMatch[2] ?? '');
      else blocks.push({ kind: 'ol', start: Number(numberMatch[1]), items: [numberMatch[2] ?? ''] });
    } else blocks.push({ kind: 'p', text: listsEnabled ? line.replace(ESCAPED_LIST_MARKER_PATTERN, '$1$2') : line });
  }
  return blocks;
}

/** Notes honor escapes and show links they may not open as their Markdown source. */
export const NOTE_INLINE_TOKEN_OPTIONS = { escapes: true, literalUnsafeLinks: true } as const;

/**
 * Tokenizes one line of note text. `linksTo` limits which targets become
 * links; `pretty` draws typed arrows.
 */
export function tokenizeNoteInline(text: string, linksTo?: ReadonlySet<string>, pretty = false): InlineToken[] {
  return tokenizeInlineMarkdown(text, { ...NOTE_INLINE_TOKEN_OPTIONS, ...(linksTo ? { linksTo } : {}), pretty });
}

/**
 * Wraps text in a code span that reads back as exactly that text (a fence
 * one backtick longer than its longest backtick run, padded with spaces
 * when needed), or `null` when no code span can hold it.
 */
export function wrapInlineCode(text: string): string | null {
  const fence = '`'.repeat((text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0) + 1);
  for (const pad of ['', ' ']) {
    const wrapped = fence + pad + text + pad + fence;
    const tokens = tokenizeNoteInline(wrapped);
    if (tokens.length === 1 && tokens[0]?.kind === 'code' && tokens[0].text === text) return wrapped;
  }
  return null;
}

/** Whether {@link wrapInlineCode} can wrap the text. */
export function canWrapInlineCode(text: string): boolean {
  return wrapInlineCode(text) !== null;
}
