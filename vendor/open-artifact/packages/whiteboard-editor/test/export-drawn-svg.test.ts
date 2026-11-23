/**
 * Tests of how the exporter draws drawn SVGs: the pen per color scheme,
 * restyling vetted drawings, and the placeholder for unreadable ones.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_THEME_COLORS, decodeSvgDataUrl, svgToBase64DataUrl, UNREADABLE_DRAWING_SVG } from '@open-artifact/whiteboard-core';
import { applyPenToDrawnSvg, drawnImagePen, drawnImageSrcForPen, normalizeSvgPaintColor } from '../src/export/drawn-svg.ts';

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">';
const penDrawing = `${SVG_OPEN}<path d="M10 10L90 90" stroke="currentColor" stroke-width="4" fill="none"/></svg>`;
const coloredDrawing = `${SVG_OPEN}<path d="M10 10L90 90" stroke="#ff0000" stroke-width="4" fill="none"/></svg>`;

/** The `color` attribute on a drawing's root tag. */
const rootColor = (svg: string): string | undefined => /^<svg\b[^>]*\scolor="([^"]*)"/.exec(svg)?.[1];

describe('drawnImagePen', () => {
  it('uses ink on light boards and chalk on dark ones', () => {
    assert.equal(drawnImagePen('light'), 'ink');
    assert.equal(drawnImagePen('dark'), 'chalk');
  });
});

describe('normalizeSvgPaintColor', () => {
  it('writes rgb() and color names as hex', () => {
    assert.equal(normalizeSvgPaintColor('rgb(255, 0, 16)'), '#ff0010');
    assert.equal(normalizeSvgPaintColor('Black'), '#000000');
  });

  it('leaves other values alone', () => {
    assert.equal(normalizeSvgPaintColor('#abc'), '#abc');
    assert.equal(normalizeSvgPaintColor('currentColor'), 'currentColor');
  });
});

describe('applyPenToDrawnSvg', () => {
  it('colors drawings that paint in currentColor', () => {
    assert.equal(rootColor(applyPenToDrawnSvg(penDrawing, 'ink')), BOARD_THEME_COLORS.light.ink);
    assert.equal(rootColor(applyPenToDrawnSvg(penDrawing, 'chalk')), BOARD_THEME_COLORS.dark.ink);
  });

  it('leaves drawings with their own colors as they are', () => {
    assert.equal(applyPenToDrawnSvg(coloredDrawing, 'chalk'), coloredDrawing);
    const ownColor = penDrawing.replace('<svg ', '<svg color="#123456" ');
    assert.equal(applyPenToDrawnSvg(ownColor, 'chalk'), ownColor);
  });
});

describe('drawnImageSrcForPen', () => {
  it('passes pictures and uploads through', () => {
    for (const src of ['/_blob/abc', 'https://example.com/a.png', 'data:image/png;base64,iVBORw0KGgo=']) assert.equal(drawnImageSrcForPen(src, 'ink'), src);
  });

  it('applies the pen to drawings', () => {
    const drawn = decodeSvgDataUrl(drawnImageSrcForPen(svgToBase64DataUrl(penDrawing), 'chalk'));
    assert.ok(drawn);
    assert.equal(rootColor(drawn), BOARD_THEME_COLORS.dark.ink);
  });

  it('keeps a drawing that needs no pen unchanged', () => {
    const src = svgToBase64DataUrl(coloredDrawing);
    assert.equal(drawnImageSrcForPen(src, 'chalk'), src);
  });

  it('shows the placeholder for drawings that fail vetting', () => {
    const src = svgToBase64DataUrl(`${SVG_OPEN}<script>alert(1)</script><path d="M0 0L1 1"/></svg>`);
    assert.equal(decodeSvgDataUrl(drawnImageSrcForPen(src, 'ink')), UNREADABLE_DRAWING_SVG);
  });
});
