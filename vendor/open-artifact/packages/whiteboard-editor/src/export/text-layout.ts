/**
 * Text layout for the PNG exporter: wraps styled inline spans to a width
 * with a caller-supplied measure, the way the board's DOM text wraps.
 *
 * - Words break at spaces, after a hyphen or dash between letters, and at
 *   zero-width spaces; a word wider than the line breaks between graphemes.
 * - Pieces of one span on one line merge back into one run, so kerning and
 *   ligatures survive; lines with right-to-left text become one run so the
 *   canvas's bidi algorithm orders them.
 * - Inline code carries 4 px of chip padding on each side.
 *
 * Everything here is pure: the measure is a function of text and span kind,
 * so tests can lay out text without a canvas.
 */

import type { InlineToken } from '@open-artifact/whiteboard-core';
import { BOARD_MONO_FONT_STACK, boardFont } from '../lib/fonts.ts';

/** The kind of an inline span (`text`, `bold`, `italic`, `bolditalic`, `code` or `link`). */
export type SpanKind = InlineToken['kind'];

/** A styled run of text to wrap. */
export interface WrapSpan {
  kind: SpanKind;
  text: string;
}

/** Measures a run of text in a span kind's font. */
export type SpanMeasure = (text: string, kind: SpanKind) => number;

/** One run of a wrapped line, with its measured width (lead and trail padding included). */
export interface LinePiece {
  text: string;
  kind: SpanKind;
  /** Padding before the text (the chip padding of inline code). */
  lead: number;
  /** Width including padding. */
  w: number;
}

/** A wrapped line: its runs and total width. */
export interface WrappedLine {
  pieces: LinePiece[];
  w: number;
}

/** A piece of a word while wrapping. */
export interface WordPiece {
  text: string;
  /** Index of the span the piece came from. */
  span: number;
  kind: SpanKind;
  /** The piece is whitespace. */
  gap: boolean;
  lead: number;
  trail: number;
}

/** Horizontal padding of an inline code chip on each side. */
export const CODE_CHIP_PAD = 4;

/** Characters of right-to-left scripts and bidi controls. */
export const RTL_CHAR_PATTERN =
  /[֐-ࣿ‏‪-‮⁦-⁩יִ-﷿ﹰ-ﻼ\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** Where a word may break inside: after a hyphen, dash or ellipsis between letters, and at zero-width spaces. */
export const BREAK_AFTER_PATTERN = /[\p{L}\p{N}][-?‐–—…](?=[\p{L}\p{N}])|​/gu;

/** True when the text's first strong character is right-to-left. */
export function isRightToLeftText(text: string): boolean {
  return RTL_CHAR_PATTERN.test(/[\p{L}‎‏؜]/u.exec(text)?.[0] ?? '');
}

/** The user-perceived characters of a text (code points without `Intl.Segmenter`). */
export function graphemesOf(text: string): string[] {
  if (typeof Intl.Segmenter === 'undefined') return [...text];
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
}

/** Marks every break opportunity inside a piece with a newline. */
function markBreaks(text: string): string {
  return text.replace(BREAK_AFTER_PATTERN, '$&\n');
}

/**
 * The words of a line's spans. A word is a list of pieces: a word that runs
 * across a style change (`**bold**text`) is one word of two pieces.
 */
export function wrapWordsOf(spans: readonly WrapSpan[]): WordPiece[][] {
  const words: WordPiece[][] = [];
  spans.forEach((span, spanIndex) => {
    const pieces = span.text
      .split(/(\s+)/)
      .flatMap((piece) => markBreaks(piece).split('\n'))
      .filter((piece) => piece !== '');
    const pad = span.kind === 'code' ? CODE_CHIP_PAD : 0;
    pieces.forEach((piece, index) => {
      const word: WordPiece = {
        text: piece,
        span: spanIndex,
        kind: span.kind,
        gap: piece.trim() === '',
        lead: index === 0 ? pad : 0,
        trail: index === pieces.length - 1 ? pad : 0,
      };
      const lastWord = words[words.length - 1];
      const tail = lastWord?.[lastWord.length - 1]?.text.slice(-2) ?? '';
      const breaksBetween = markBreaks(tail + piece.slice(0, 2)).startsWith(`${tail}\n`);
      if (index === 0 && !word.gap && lastWord?.[0]?.gap === false && !breaksBetween) lastWord.push(word);
      else words.push([word]);
    });
  });
  return words;
}

/**
 * One line from its pieces: trailing spaces dropped, pieces of the same span
 * merged, and right-to-left text of several runs flattened into one run.
 */
export function buildWrappedLine(pieces: readonly WordPiece[], measure: SpanMeasure): WrappedLine {
  let length = pieces.length;
  while (length > 0 && pieces[length - 1]?.gap === true) length--;
  const merged: WordPiece[] = [];
  for (const piece of pieces.slice(0, length)) {
    const last = merged[merged.length - 1];
    if (last?.span === piece.span) {
      last.text += piece.text;
      last.trail = piece.trail;
    } else merged.push({ ...piece });
  }
  const text = merged.map((piece) => piece.text).join('');
  const runs: LinePiece[] =
    merged.length > 1 && RTL_CHAR_PATTERN.test(text)
      ? [{ text, kind: 'text', lead: 0, w: measure(text, 'text') }]
      : merged.map((piece) => ({ text: piece.text, kind: piece.kind, lead: piece.lead, w: piece.lead + measure(piece.text, piece.kind) + piece.trail }));
  return { pieces: runs, w: runs.reduce((total, run) => total + run.w, 0) };
}

/**
 * Wraps paragraphs of spans to `maxWidth`, stopping after `maxLines`. Each
 * paragraph starts a new line; an empty paragraph is an empty line.
 */
export function wrapRichText(paragraphs: readonly (readonly WrapSpan[])[], maxWidth: number, measure: SpanMeasure, maxLines = Infinity): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const pieceWidth = (piece: WordPiece): number => piece.lead + measure(piece.text, piece.kind) + piece.trail;
  /** How many leading graphemes fit in `budget` (binary search over doubling bounds). */
  const fitCount = (chars: readonly string[], budget: number, kind: SpanKind): number => {
    const fits = (count: number): boolean => measure(chars.slice(0, count).join(''), kind) <= budget;
    let hi = 1;
    while (hi < chars.length && fits(hi)) hi *= 2;
    let lo = hi >> 1;
    hi = Math.min(hi, chars.length);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const paragraph of paragraphs) {
    let line: WordPiece[] = [];
    let lineWidth = 0;
    /** Ends the current line; true when the line limit is reached. */
    const pushLine = (): boolean => {
      lines.push(buildWrappedLine(line, measure));
      line = [];
      lineWidth = 0;
      return lines.length >= maxLines;
    };
    for (const word of wrapWordsOf(paragraph)) {
      const isGap = word[0]?.gap === true;
      let wordWidth = 0;
      for (const piece of word) if ((wordWidth += pieceWidth(piece)) > maxWidth) break;
      if (!isGap && lineWidth + wordWidth > maxWidth && line.length > 0 && pushLine()) return lines;
      if (isGap || wordWidth <= maxWidth) {
        line.push(...word);
        lineWidth += wordWidth;
        continue;
      }
      // A word wider than the line: break it between graphemes.
      for (const piece of word) {
        let graphemes = graphemesOf(piece.text);
        for (let lead = piece.lead; graphemes.length > 0; ) {
          const room = maxWidth - lineWidth - lead;
          let fit = fitCount(graphemes, room, piece.kind) || (line.length === 0 ? 1 : 0);
          if (fit === graphemes.length && (fit > 1 || line.length > 0) && measure(graphemes.join(''), piece.kind) + piece.trail > room) fit--;
          if (fit > 0) {
            const part: WordPiece = { ...piece, text: graphemes.slice(0, fit).join(''), lead, trail: fit === graphemes.length ? piece.trail : 0 };
            line.push(part);
            lineWidth += pieceWidth(part);
            graphemes = graphemes.slice(fit);
            lead = 0;
          }
          if (graphemes.length > 0 && pushLine()) return lines;
        }
      }
    }
    if (pushLine()) return lines;
  }
  return lines;
}

/** The text cut with an ellipsis to fit `maxWidth` (`''` when not even one character fits). */
export function truncateToWidth(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const graphemes = graphemesOf(text);
  let lo = 0;
  let hi = graphemes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(`${graphemes.slice(0, mid).join('')}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : `${graphemes.slice(0, lo).join('')}…`;
}

/** A canvas `font` in the board face at a size and weight. */
export function canvasFontFor(px: number, weight = 400): string {
  return boardFont(px, { weight });
}

/** The size and weights a text is set in. */
export interface SpanFontStyle {
  px: number;
  /** Regular weight. */
  weight: number;
  /** Bold weight (700 when absent). */
  bold?: number;
}

/**
 * The canvas `font` of a span kind: code in the monospace face at 90 %,
 * italics in the italic face, bold at the bold weight.
 */
export function rasterSpanFont(kind: SpanKind, { px, weight, bold = 700 }: SpanFontStyle): string {
  if (kind === 'code') return `${weight} ${px * 0.9}px ${BOARD_MONO_FONT_STACK}`;
  if (kind === 'italic' || kind === 'bolditalic') return boardFont(px, { weight: kind === 'italic' ? weight : bold, italic: true });
  return canvasFontFor(px, kind === 'bold' ? bold : weight);
}
