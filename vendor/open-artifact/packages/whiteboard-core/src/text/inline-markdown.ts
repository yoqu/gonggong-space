/**
 * The board's inline Markdown: `***bold italic***`, `**bold**`, `*italic*`,
 * `` `code` `` (any backtick run length, CommonMark-style space trimming)
 * and `[label](https://…)` links, with `\` escapes for `` * ` [ ] \ ``.
 *
 * {@link tokenizeInlineMarkdown} turns a line into typed tokens; renderers
 * (React in the editor, plain text on the server) map tokens to output.
 */

import { drawArrowsInLines, TEXT_RUN_SEPARATOR } from './text-arrows.ts';

/** Plain or styled text. */
export interface InlineTextToken {
  kind: 'text' | 'bold' | 'italic' | 'bolditalic' | 'code';
  text: string;
}

/** A link with its label and target. */
export interface InlineLinkToken {
  kind: 'link';
  text: string;
  href: string;
}

/** One token of a tokenized line. */
export type InlineToken = InlineTextToken | InlineLinkToken;

/** How a line is tokenized. */
export interface InlineMarkdownOptions {
  /** Honor `\` escapes (and decode them in the tokens). */
  escapes?: boolean;
  /** Keep a link that may not be shown as its Markdown source instead of just its label. */
  literalUnsafeLinks?: boolean;
  /** When given, only links to these targets become link tokens. */
  linksTo?: ReadonlySet<string>;
  /** Draw typed arrows (`->` as `→`) in non-code tokens. */
  pretty?: boolean;
}

/** A link target that may become a link: `http(s)://` without spaces, `)` or `[`. */
export const HTTP_LINK_PATTERN = /^https?:\/\/[^\s)[]*$/;

/** Emphasis and links (code spans are found separately). */
export const INLINE_MARKDOWN_PATTERN = /(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\][]+)\]\(([^)\s[]+)\))/g;

/** Characters a `\` escapes. */
export const MARKDOWN_ESCAPABLE_CHARACTERS = '*`[]\\';

/** Private-use noncharacters that stand in for escaped characters while tokenizing. */
const MARKDOWN_ESCAPE_SENTINEL_PATTERN = /[\uFDD0-\uFDD4]/g;
/** Code point of the first escape sentinel. */
const FIRST_ESCAPE_SENTINEL = 0xfdd0;

/** A Markdown link (`[label](target)`), capturing the target. */
export const MARKDOWN_LINK_PATTERN = /\[[^\][]+\]\(([^)\s[]+)\)/g;

/** Replaces escaped characters with sentinels (dropping stray sentinels first). */
export function encodeMarkdownEscapes(text: string): string {
  return text
    .replace(MARKDOWN_ESCAPE_SENTINEL_PATTERN, '')
    .replace(/\\([*`[\]\\])/g, (_, char: string) => String.fromCharCode(FIRST_ESCAPE_SENTINEL + MARKDOWN_ESCAPABLE_CHARACTERS.indexOf(char)));
}

/** Turns sentinels back into their characters (`keepBackslash` restores the escape, for code). */
export function decodeMarkdownEscapes(text: string, keepBackslash = false): string {
  return text.replace(MARKDOWN_ESCAPE_SENTINEL_PATTERN, (sentinel) => (keepBackslash ? '\\' : '') + (MARKDOWN_ESCAPABLE_CHARACTERS[sentinel.charCodeAt(0) - FIRST_ESCAPE_SENTINEL] ?? ''));
}

/** Escapes every Markdown-significant character. */
export function escapeInlineMarkdown(text: string): string {
  return text.replace(/[*`[\]\\]/g, '\\$&');
}

/** The `http(s)` targets of every Markdown link in a text. */
export function markdownLinkUrls(text: string): Set<string> {
  const urls = new Set<string>();
  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) if (match[1] !== undefined && HTTP_LINK_PATTERN.test(match[1])) urls.add(match[1]);
  return urls;
}

/** A code span: the whole span (`start`…`end`) and its content (`from`…`to`). */
export interface CodeSpan {
  start: number;
  end: number;
  from: number;
  to: number;
}

/** The text of a code span: one surrounding space is trimmed when needed to show a backtick at an edge. */
export function codeSpanText(text: string, span: Pick<CodeSpan, 'from' | 'to'>): string {
  if (span.to - span.from > 2 && text.charCodeAt(span.from) === 32 && text.charCodeAt(span.to - 1) === 32) {
    let from = span.from;
    while (from < span.to && text.charCodeAt(from) === 32) from++;
    let to = span.to - 1;
    while (to > from && text.charCodeAt(to) === 32) to--;
    if (from < span.to && (text.charCodeAt(from) === 96 || text.charCodeAt(to) === 96)) return text.slice(span.from + 1, span.to - 1);
  }
  return text.slice(span.from, span.to);
}

/**
 * A scanner over the code spans of a text: each call returns the next span
 * starting at or after a position (a backtick run closed by the next run
 * of the same length). Positions must not decrease between calls.
 */
export function createCodeSpanScanner(text: string): (from: number) => CodeSpan | undefined {
  const runStarts: number[] = [];
  const runLengths: number[] = [];
  for (let index = 0; index < text.length; ) {
    if (text.charCodeAt(index) !== 96) {
      index++;
      continue;
    }
    let end = index;
    while (end < text.length && text.charCodeAt(end) === 96) end++;
    runStarts.push(index);
    runLengths.push(end - index);
    index = end;
  }
  // For each run, the next run of the same length (its closer), or -1.
  const closers: number[] = Array<number>(runStarts.length).fill(-1);
  const nextOfLength = new Map<number, number>();
  for (let run = runStarts.length - 1; run >= 0; run--) {
    closers[run] = nextOfLength.get(runLengths[run]!) ?? -1;
    nextOfLength.set(runLengths[run]!, run);
  }
  let run = 0;
  return (from) => {
    for (; run < runStarts.length; run++) {
      const start = runStarts[run]!;
      if (start < from) continue;
      const closer = closers[run]!;
      if (closer < 0) continue;
      const length = runLengths[run]!;
      return { start, end: runStarts[closer]! + length, from: start + length, to: runStarts[closer]! };
    }
    return undefined;
  };
}

/**
 * Tokenizes one line of inline Markdown. Adjacent text tokens are merged.
 * Links to targets that are not `http(s)` (or not in `linksTo`) stay text:
 * their label, or with `literalUnsafeLinks` their whole source.
 */
export function tokenizeInlineMarkdown(input: string, options?: InlineMarkdownOptions): InlineToken[] {
  const tokens: InlineToken[] = [];
  const text = options?.escapes === true ? encodeMarkdownEscapes(input) : input;
  const nextCodeSpan = createCodeSpanScanner(text);
  let match: RegExpExecArray | null | undefined;
  let index = 0;
  while (index < text.length) {
    const code = nextCodeSpan(index);
    if (match === undefined || (match !== null && match.index < index)) {
      INLINE_MARKDOWN_PATTERN.lastIndex = index;
      match = INLINE_MARKDOWN_PATTERN.exec(text);
    }
    if (match === null && code === undefined) {
      tokens.push({ kind: 'text', text: text.slice(index) });
      break;
    }
    if (code !== undefined && (match === null || code.start < match.index)) {
      if (code.start > index) tokens.push({ kind: 'text', text: text.slice(index, code.start) });
      tokens.push({ kind: 'code', text: codeSpanText(text, code) });
      index = code.end;
      continue;
    }
    const found = match!;
    if (found.index > index) tokens.push({ kind: 'text', text: text.slice(index, found.index) });
    if (found[2] !== undefined) tokens.push({ kind: 'bolditalic', text: found[2] });
    else if (found[4] !== undefined) tokens.push({ kind: 'bold', text: found[4] });
    else if (found[6] !== undefined) tokens.push({ kind: 'italic', text: found[6] });
    else if (found[8] !== undefined && found[9] !== undefined)
      if (HTTP_LINK_PATTERN.test(found[9]) && (options?.linksTo === undefined || options.linksTo.has(text === input ? found[9] : decodeMarkdownEscapes(found[9]))))
        tokens.push({ kind: 'link', text: found[8], href: found[9] });
      else tokens.push({ kind: 'text', text: options?.literalUnsafeLinks === true ? found[0] : found[8] });
    index = found.index + found[0].length;
  }
  const merged: InlineToken[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (token.kind === 'text' && last?.kind === 'text') last.text += token.text;
    else merged.push(token);
  }
  if (text !== input)
    for (const token of merged) {
      token.text = decodeMarkdownEscapes(token.text, token.kind === 'code');
      if (token.kind === 'link') token.href = decodeMarkdownEscapes(token.href);
    }
  if (options?.pretty === true) {
    const parts = drawArrowsInLines(merged.map((token) => (token.kind === 'code' ? '' : token.text)).join(TEXT_RUN_SEPARATOR), input).split(TEXT_RUN_SEPARATOR);
    if (parts.length === merged.length) merged.forEach((token, at) => void (token.kind !== 'code' && (token.text = parts[at] ?? token.text)));
  }
  return merged;
}

/** Splits text into plain text and code spans only (no emphasis or links). */
export function tokenizeCodeSpans(text: string): InlineTextToken[] {
  const tokens: InlineTextToken[] = [];
  const nextCodeSpan = createCodeSpanScanner(text);
  let index = 0;
  for (let code = nextCodeSpan(index); code !== undefined; code = nextCodeSpan(index)) {
    if (code.start > index) tokens.push({ kind: 'text', text: text.slice(index, code.start) });
    tokens.push({ kind: 'code', text: codeSpanText(text, code) });
    index = code.end;
  }
  if (index < text.length) tokens.push({ kind: 'text', text: text.slice(index) });
  return tokens;
}
