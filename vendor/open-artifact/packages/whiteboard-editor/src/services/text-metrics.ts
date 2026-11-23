/**
 * Text measurement for the core geometry: installs a canvas-backed width
 * measurer in place of core's glyph-width estimates, re-measures when web
 * fonts finish loading, and installs the markup-aware plain text the
 * geometry uses for size estimates and spoken labels.
 */

import { installGeometryHooks, resetTextMetrics, setTextMeasurer, textProfileForElement, textWithListPrefixes, type TextFont } from '@open-artifact/whiteboard-core';
import { boardFont, onBoardFontsLoaded } from '../lib/fonts.ts';

/** A 2D context used only for measuring, created on first use. */
let context: CanvasRenderingContext2D | null | undefined;

function measuringContext(): CanvasRenderingContext2D | null {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  return context;
}

/** The width of one line in a board font (0 when no canvas is available). */
function measureLine(text: string, font: TextFont): number {
  const ctx = measuringContext();
  if (!ctx) return 0;
  ctx.font = boardFont(font.px, { weight: font.weight, ...(font.italic ? { italic: true } : {}) });
  return ctx.measureText(text).width;
}

/**
 * The gap after a numbered list marker beyond its glyphs: browsers draw
 * the marker as `1. ` (with a trailing space), so the gap is one space.
 */
function measureListMarkerGap(px: number, weight: number): number {
  const ctx = measuringContext();
  if (!ctx) return 0;
  ctx.font = boardFont(px, { weight });
  return ctx.measureText('1. ').width - ctx.measureText('1.').width;
}

/** Starts measuring text with the page's fonts; returns a function that restores the estimates. */
export function startTextMetrics(): () => void {
  setTextMeasurer(measureLine, measureListMarkerGap);
  const uninstallHooks = installGeometryHooks({
    plainTextWithListPrefixes: (text, element) => textWithListPrefixes(text, element ? textProfileForElement(element) : undefined),
  });
  const stopFonts = onBoardFontsLoaded(() => resetTextMetrics());
  return () => {
    stopFonts();
    uninstallHooks();
    setTextMeasurer();
  };
}
