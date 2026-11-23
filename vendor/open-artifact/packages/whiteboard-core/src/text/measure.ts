










import { estimateLabelWordWidth } from '../arrows/labels.ts';
import { TEXT_LINE_HEIGHT, TEXT_SIZE_STYLES, type TextSize } from '../schema.ts';
import { estimateTextWidthEm } from '../table.ts';
import type { TextRunStyle } from './markup.ts';

/** A font to measure in (the family is the measurer's business). */
export interface TextFont {
  /** Size in board units. */
  px: number;
  /** CSS font weight. */
  weight: number;
  /** Italic. */
  italic?: boolean;
}

/** Measures the width of a single line of text (0 when it cannot). */
export type TextMeasurer = (text: string, font: TextFont) => number;

/**
 * Measures the gap a browser puts between a numbered list marker and its
 * item, beyond the marker's own glyphs (0 when there is none or it cannot).
 */
export type ListMarkerGapMeasurer = (px: number, weight: number) => number;

/** The style of text without a size (and of measuring defaults). */
export const DEFAULT_TEXT_STYLE = { px: 15, weight: 400 } as const;

/** Caches are dropped when they grow past this many entries. */
const MAX_CACHED_WIDTHS = 20000;

/** The measurer used until one is installed: the glyph-width table. */
export const estimateTextMeasurer: TextMeasurer = (text, font) => estimateTextWidthEm(text) * font.px;

let measureText: TextMeasurer = estimateTextMeasurer;
let measureListMarkerGap: ListMarkerGapMeasurer = () => 0;
const textWidthCache = new Map<string, number>();
const listMarkerGapCache = new Map<string, number>();
const labelWordWidths = new Map<string, number>();
let labelMeasureFontEpoch = -1;
let textMetricsEpoch = 0;
const textMetricsListeners = new Set<() => void>();

/**
 * Installs the measurers (omit one to restore its default) and resets every
 * cached width.
 */
export function setTextMeasurer(measurer?: TextMeasurer, listMarkerGapMeasurer?: ListMarkerGapMeasurer): void {
  measureText = measurer ?? estimateTextMeasurer;
  measureListMarkerGap = listMarkerGapMeasurer ?? (() => 0);
  resetTextMetrics();
}

/**
 * Drops every cached width and tells subscribers (call it when fonts
 * finish loading, since widths change).
 */
export function resetTextMetrics(): void {
  textWidthCache.clear();
  listMarkerGapCache.clear();
  labelWordWidths.clear();
  textMetricsEpoch += 1;
  for (const listener of [...textMetricsListeners]) listener();
}

/** Calls `listener` whenever metrics reset; returns the unsubscribe function. */
export function subscribeTextMetrics(listener: () => void): () => void {
  textMetricsListeners.add(listener);
  return () => void textMetricsListeners.delete(listener);
}

/** A number that changes whenever metrics reset (for memoizing on widths). */
export function getTextMetricsEpoch(): number {
  return textMetricsEpoch;
}

/** The px and weights of a text size (the default style when it has none). */
function textStyleOf(size: TextSize | undefined): { px: number; weight: number; bold: number } {
  return size === undefined ? { ...DEFAULT_TEXT_STYLE, bold: 700 } : TEXT_SIZE_STYLES[size];
}

/** Stores a width, dropping the cache first when it is full. */
function rememberWidth(key: string, width: number): number {
  if (textWidthCache.size > MAX_CACHED_WIDTHS) textWidthCache.clear();
  textWidthCache.set(key, width);
  return width;
}

/** The estimated size of a text block at 0.55 em per character. */
function estimateTextBlockSize(text: string, size: TextSize): { w: number; h: number } {
  const { px } = TEXT_SIZE_STYLES[size];
  const lines = text.length === 0 ? [''] : text.split('\n');
  const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 1);
  return { w: Math.max(px, longestLine * px * 0.55), h: lines.length * px * TEXT_LINE_HEIGHT };
}

/**
 * The size of a block of plain lines: its widest line (rounded up unless
 * `exact`) by its line count. Falls back to the per-character estimate
 * when the lines measure as nothing.
 */
export function measureTextBlock(text: string, size?: TextSize, exact = false): { w: number; h: number } {
  const { px, weight } = textStyleOf(size);
  const lines = text.split('\n');
  const width = Math.max(...lines.map((line) => measureText(line, { px, weight })));
  if (width > 0) return { w: exact ? width : Math.ceil(width), h: Math.round(lines.length * px * TEXT_LINE_HEIGHT) };
  const estimate = estimateTextBlockSize(text, size ?? 'body');
  const scale = size === undefined ? px / TEXT_SIZE_STYLES.body.px : 1;
  return { w: estimate.w * scale, h: estimate.h * scale };
}

/** {@link measureTextBlock}'s width, cached. */
export function measureTextWidth(text: string, size?: TextSize, exact = false): number {
  const key = (size ?? '') + (exact ? '=' : '~') + text;
  return rememberWidth(key, textWidthCache.get(key) ?? measureTextBlock(text, size, exact).w);
}

/** The width of a run in a font, cached (0 when it cannot be measured). */
export function measureRunWidth(text: string, px: number, weight: number, italic = false): number {
  const key = String(px) + '/' + String(weight) + (italic ? 'i=' : '=') + text;
  return rememberWidth(key, textWidthCache.get(key) ?? measureText(text, { px, weight, italic }));
}

/**
 * The width of styled runs: italic runs (bold italic at the bold weight)
 * are measured one by one; text without italics is measured as a whole.
 */
export function measureRunsWidth(runs: readonly TextRunStyle[], size?: TextSize, exact = false): number {
  const { px, weight, bold } = textStyleOf(size);
  const width = runs.some((run) => run.italic !== false) ? runs.reduce((sum, run) => sum + measureRunWidth(run.text, px, run.italic === 'bold' ? bold : weight, run.italic !== false), 0) : 0;
  return width > 0 ? (exact ? width : Math.ceil(width)) : measureTextWidth(runs.map((run) => run.text).join(''), size, exact);
}

/** The extra gap after a numbered list marker in a font, cached. */
export function listMarkerGap(px: number, weight: number): number {
  const key = String(px) + '/' + String(weight);
  const cached = listMarkerGapCache.get(key);
  if (cached !== undefined) return cached;
  const measured = Math.round(measureListMarkerGap(px, weight));
  const gap = measured < 2 ? 0 : measured;
  listMarkerGapCache.set(key, gap);
  return gap;
}

/** A run's width, or 0.55 em per character when it cannot be measured. */
export function runWidthOrEstimate(text: string, px: number, weight: number): number {
  return measureRunWidth(text, px, weight) || text.length * px * 0.55;
}

/** A list mark's width, plus the marker gap for numbered marks. */
export function textWidthWithListMarker(text: string, px: number, weight: number): number {
  return runWidthOrEstimate(text, px, weight) + (/\d/.test(text) ? listMarkerGap(px, weight) : 0);
}

/** A list mark's width in widths of `0` (CSS `ch`). */
export function textWidthInZeroChars(text: string, px: number, weight: number): number {
  return textWidthWithListMarker(text, px, weight) / runWidthOrEstimate('0', px, weight);
}

/** The font of arrow labels. */
export const LABEL_FONT: TextFont = { px: 14, weight: 400 };

/**
 * The width of a word in an arrow label, cached. Passing a different
 * `fontEpoch` (e.g. {@link getTextMetricsEpoch}) drops the cache first.
 */
export function measureLabelWordWidth(word: string, fontEpoch?: number): number {
  if (fontEpoch !== undefined && fontEpoch !== labelMeasureFontEpoch) {
    labelWordWidths.clear();
    labelMeasureFontEpoch = fontEpoch;
  }
  let width = labelWordWidths.get(word);
  if (width === undefined) {
    width = measureText(word, LABEL_FONT);
    if (!(width > 0)) width = estimateLabelWordWidth(word);
    labelWordWidths.set(word, width);
  }
  return width;
}

/** Drops the label word cache when it has grown too large. */
export function trimLabelWordWidths(): void {
  if (labelWordWidths.size > MAX_CACHED_WIDTHS) labelWordWidths.clear();
}
