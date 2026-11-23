/**
 * Board text on a 2D canvas: lays out an element's markup (lists with
 * hanging indents, inline bold, italic, code and links) into lines, and
 * draws those lines with list marks, code chips and link underlines.
 *
 * Layout mirrors the board's DOM text: list lines hang by the widest
 * top-level mark, centered or right-aligned text with lists keeps the block
 * as wide as its widest line (or the full width once it wraps), and lines in
 * a right-to-left script draw right-to-left when the alignment was not
 * picked by hand.
 */

import { lineSpanText, listMarkMeasureSample, textLinesWithHang, zeroDigits, type TextAlign } from '@open-artifact/whiteboard-core';
import { isRightToLeftText, rasterSpanFont, wrapRichText, type SpanFontStyle, type SpanKind, type WrappedLine } from './text-layout.ts';

/** How a text is set and colored. */
export interface TextLook extends SpanFontStyle {
  /** Text color. */
  ink: string;
  /** Background of inline code chips. */
  chip: string;
}

/** A laid-out line ready to draw. */
export interface RasterLine extends WrappedLine {
  /** The line's paragraph is right-to-left. */
  rtl?: true;
  /** Hanging indent of a list line. */
  hang?: number;
  /** The list mark, on the first line of a list item. */
  mark?: string;
  /** Width of the whole block, when list lines align as one block. */
  box?: number;
}

/** Where lines are aligned. */
export interface TextBox {
  side: TextAlign;
  /** Width the lines align in. */
  w: number;
  /** The alignment was not picked by hand (right-to-left lines may flip). */
  unpicked?: boolean;
}

/** What layout needs from a canvas: setting a font and measuring. */
export type MeasureContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

/** The 2D context calls drawing text needs. */
export type TextCanvas = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Lays out markup text in `width`, at most `maxLines` lines. Lines of
 * centered or right-aligned list text carry the block width (`box`).
 */
export function layoutRasterTextLines(ctx: MeasureContext, text: string, look: SpanFontStyle, width: number, align: TextAlign, maxLines = Infinity): RasterLine[] {
  const measure = (run: string, kind: SpanKind): number => {
    ctx.font = rasterSpanFont(kind, look);
    return ctx.measureText(run).width;
  };
  const lines: RasterLine[] = [];
  let wrapped = false;
  const paragraphs = textLinesWithHang(text, look.px, (sample) => measure(sample, 'text'));
  for (const { mark, spans, hang } of paragraphs) {
    if (lines.length >= maxLines) break;
    const rtl = isRightToLeftText(lineSpanText({ spans }));
    const wrappedLines = wrapRichText([spans], width - hang, measure, maxLines - lines.length);
    wrapped ||= wrappedLines.length > 1;
    wrappedLines.forEach((line, lineIndex) => {
      lines.push({
        ...line,
        ...(rtl ? { rtl: true as const } : {}),
        ...(hang === 0 ? {} : { w: line.w + hang, hang, ...(lineIndex === 0 ? { mark } : {}) }),
      });
    });
  }
  if (align === 'left' || paragraphs.every((line) => line.hang === 0)) return lines;
  const box = wrapped ? width : Math.max(...lines.map((line) => line.w));
  return lines.map((line) => ({ ...line, box }));
}

/** Traces a rounded rectangle as the current path. */
export function traceRoundedRect(ctx: TextCanvas, x: number, y: number, w: number, h: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Clips the context to a rectangle. */
export function clipToRect(ctx: TextCanvas, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

/**
 * Draws a list mark ending at `x` (left-to-right) or starting at `x`
 * (right-to-left). Digits are centered in equal-width cells, so numbered
 * marks line up like tabular figures.
 */
export function drawRasterListMark(ctx: TextCanvas, mark: string, look: TextLook, x: number, y: number, direction: 1 | -1): void {
  ctx.fillStyle = look.ink;
  ctx.font = rasterSpanFont('text', look);
  const measure = (text: string): number => ctx.measureText(text).width;
  let cursor = direction === 1 ? x - measure(listMarkMeasureSample(mark)) : x + measure(listMarkMeasureSample(mark)) - measure(zeroDigits(mark));
  const glyphs = !/\d/.test(mark) ? [mark] : direction === 1 ? [...mark] : [...mark.replace(/^(\d+)\.$/, '.$1')];
  for (const glyph of glyphs) {
    ctx.fillText(glyph, cursor + (measure(zeroDigits(glyph)) - measure(glyph)) / 2, y);
    cursor += measure(zeroDigits(glyph));
  }
}

/** Font ascent and descent of a span kind (estimates where the canvas reports none). */
function fontExtents(ctx: TextCanvas, kind: SpanKind, look: TextLook): { up: number; down: number } {
  ctx.font = rasterSpanFont(kind, look);
  const metrics = ctx.measureText('x');
  return {
    up: Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : look.px * 0.8,
    down: Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : look.px * 0.2,
  };
}

/** Share of the free width before a line, per alignment. */
const ALIGN_SHARE: Readonly<Record<TextAlign, number>> = { left: 0, center: 0.5, right: 1 };

/** The offset that aligns `inner` within `outer`. */
function alignOffset(outer: number, inner: number, side: TextAlign): number {
  return Math.max(0, outer - inner) * ALIGN_SHARE[side];
}

/**
 * Draws laid-out lines from (`x`, `y`), one per `lineHeight`, each centered
 * on its line box. `box` aligns lines within a width.
 */
export function drawRasterTextLines(ctx: TextCanvas, lines: readonly RasterLine[], look: TextLook, x: number, y: number, lineHeight: number, box?: TextBox): void {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const text = fontExtents(ctx, 'text', look);
  const code = fontExtents(ctx, 'code', look);
  lines.forEach((line, lineIndex) => {
    const baseline = y + lineIndex * lineHeight + (lineHeight + text.up - text.down) / 2;
    const rtl = line.rtl === true && (box?.unpicked === true || line.box !== undefined);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    const [left, boxWidth] = box && line.box !== undefined ? [x + alignOffset(box.w, line.box, box.side), line.box] : [x, box?.w];
    let cursor =
      left +
      (rtl ? 0 : (line.hang ?? 0)) +
      (boxWidth === undefined ? 0 : alignOffset(boxWidth, line.w, rtl ? 'right' : line.box !== undefined ? 'left' : (box?.side ?? 'left')));
    if (line.mark !== undefined) drawRasterListMark(ctx, line.mark, look, rtl ? cursor + line.w - (line.hang ?? 0) : cursor, baseline, rtl ? -1 : 1);
    ctx.direction = line.rtl === true && line.pieces.length === 1 ? 'rtl' : 'ltr';
    for (const piece of line.pieces) {
      if (piece.kind === 'code') {
        ctx.fillStyle = look.chip;
        traceRoundedRect(ctx, cursor, baseline - code.up, piece.w, code.up + code.down, 4);
        ctx.fill();
      }
      ctx.font = rasterSpanFont(piece.kind, look);
      ctx.fillStyle = look.ink;
      // `textAlign` is `left` (not `start`), so right-to-left runs also start at the cursor.
      ctx.fillText(piece.text, cursor + piece.lead, baseline);
      if (piece.kind === 'link') ctx.fillRect(cursor, baseline + 2, piece.w, Math.max(1, look.px / 10));
      cursor += piece.w;
    }
  });
  ctx.restore();
}
