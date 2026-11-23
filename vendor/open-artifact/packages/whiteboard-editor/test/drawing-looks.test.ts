/**
 * Tests of drawing looks in the editor: which looks are painted, the zoom
 * steps and pixel sizes they are painted at, their cache keys, the outline
 * helpers of the painted looks, and drawings rewritten in a look.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BLUEPRINT_CUT_FILL, decodeSvgDataUrl, DRAWING_LOOK_TONES, DRAWING_STYLES, seededLookRandom, svgToBase64DataUrl, UNREADABLE_DRAWING_SVG } from '@open-artifact/whiteboard-core';
import { applyLookToDrawnSvg, applyPenToDrawnSvg, drawnImageSrc, drawnImageSrcForPen } from '../src/export/drawn-svg.ts';
import { drawingLookScale, drawingSourceId, isRasterLook, LOOK_SCALE_RANGE, lookPaintKey, lookPaintKeySource, lookPaintSize, MAX_LOOK_PX } from '../src/lib/drawing-looks.ts';
import { grownOutline, outlineArea, pointInOutline, roughOutline } from '../src/lib/look-raster.ts';

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="2">';
const drawing = `${SVG_OPEN}<rect x="20" y="20" width="80" height="50" fill="#3b82f6"/><path d="M110 20L180 80"/></svg>`;
const src = svgToBase64DataUrl(drawing);

describe('isRasterLook', () => {
  it('paints marker, watercolor and paper', () => {
    assert.deepEqual(DRAWING_STYLES.filter(isRasterLook).sort(), ['marker', 'paper', 'watercolor']);
  });
});

describe('drawingLookScale', () => {
  it('steps up to the next power of two of zoom times pixel ratio', () => {
    assert.equal(drawingLookScale(1, 1), 1);
    assert.equal(drawingLookScale(1.1, 1), 2);
    assert.equal(drawingLookScale(0.6, 2), 2);
    assert.equal(drawingLookScale(0.3, 1), 0.5);
  });

  it('stays within its range', () => {
    assert.equal(drawingLookScale(0.01, 1), LOOK_SCALE_RANGE.min);
    assert.equal(drawingLookScale(40, 2), LOOK_SCALE_RANGE.max);
    assert.equal(drawingLookScale(0, 1), LOOK_SCALE_RANGE.min);
  });
});

describe('lookPaintSize', () => {
  it('is the element size at the scale', () => {
    assert.deepEqual(lookPaintSize(300, 150, 2), { width: 600, height: 300, scale: 2 });
  });

  it('halves the scale until the painting fits', () => {
    const size = lookPaintSize(1500, 500, 4);
    assert.ok(Math.max(size.width, size.height) <= MAX_LOOK_PX);
    assert.equal(size.scale, 1);
  });
});

describe('lookPaintKey', () => {
  it('names the source, look, scheme and pixel size', () => {
    const key = lookPaintKey(src, 'watercolor', 'dark', 400, 200);
    assert.equal(key, `${drawingSourceId(src)}|watercolor|dark|400x200`);
    assert.equal(lookPaintKeySource(key), drawingSourceId(src));
  });

  it('differs for every part', () => {
    const keys = new Set([
      lookPaintKey(src, 'watercolor', 'light', 400, 200),
      lookPaintKey(src, 'paper', 'light', 400, 200),
      lookPaintKey(src, 'watercolor', 'dark', 400, 200),
      lookPaintKey(src, 'watercolor', 'light', 800, 400),
      lookPaintKey(svgToBase64DataUrl(drawing.replace('#3b82f6', '#ef4444')), 'watercolor', 'light', 400, 200),
    ]);
    assert.equal(keys.size, 5);
  });
});

describe('outlines of painted looks', () => {
  const square: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];

  it('roughens an outline without moving it far', () => {
    const rough = roughOutline(square, 4, 10, seededLookRandom('edge'));
    assert.ok(rough.length >= 40);
    assert.ok(Math.abs(outlineArea(rough) - 10_000) < 1_500);
    for (const [x, y] of rough) assert.ok(x >= -4 && x <= 104 && y >= -4 && y <= 104);
  });

  it('grows an outline about its centre', () => {
    assert.ok(outlineArea(grownOutline(square, 10)) > outlineArea(square));
    assert.ok(outlineArea(grownOutline(square, -10)) < outlineArea(square));
  });

  it('tells inside from outside', () => {
    assert.equal(pointInOutline([50, 50], square), true);
    assert.equal(pointInOutline([150, 50], square), false);
  });
});

describe('drawings in a look', () => {
  it('draws draft differently from plain for the same source', () => {
    const plain = applyLookToDrawnSvg(drawing, 'plain', 'ink');
    const draft = applyLookToDrawnSvg(drawing, 'draft', 'ink');
    assert.notEqual(draft, plain);
    assert.match(draft, new RegExp(DRAWING_LOOK_TONES.draft.light.paper ?? '#', 'i'));
  });

  it('draws plain drawings as the board always has, with the pen', () => {
    assert.equal(applyLookToDrawnSvg(drawing, 'plain', 'ink'), applyPenToDrawnSvg(drawing, 'ink'));
    assert.equal(applyLookToDrawnSvg(drawing, 'plain', 'chalk'), applyPenToDrawnSvg(drawing, 'chalk'));
    assert.equal(drawnImageSrc({ src, style: 'plain' }, 'ink'), drawnImageSrcForPen(src, 'ink'));
  });

  it('draws painted looks plain until they are painted', () => {
    for (const look of ['marker', 'watercolor', 'paper'] as const) assert.equal(applyLookToDrawnSvg(drawing, look, 'ink'), applyLookToDrawnSvg(drawing, 'plain', 'ink'));
  });

  it('draws drawings without a style, or with an unknown one, plain', () => {
    assert.equal(drawnImageSrc({ src }, 'ink'), drawnImageSrc({ src, style: 'plain' }, 'ink'));
    assert.equal(drawnImageSrc({ src, style: 'gouache' }, 'ink'), drawnImageSrc({ src, style: 'plain' }, 'ink'));
  });

  it('leaves pictures alone and draws unreadable drawings grey in every look', () => {
    assert.equal(drawnImageSrc({ src: '/_blob/photo', style: 'comic' }, 'ink'), '/_blob/photo');
    const unreadable = svgToBase64DataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>x()</script></svg>');
    for (const style of DRAWING_STYLES) assert.equal(decodeSvgDataUrl(drawnImageSrc({ src: unreadable, style }, 'ink')), UNREADABLE_DRAWING_SVG, style);
  });

  it('fills section cuts grey in blueprint only', () => {
    const plan = `${SVG_OPEN}<rect class="cut" x="20" y="20" width="20" height="60" fill="none"/><rect x="60" y="20" width="20" height="60" fill="none"/></svg>`;
    const marked = svgToBase64DataUrl(plan);
    const blueprint = decodeSvgDataUrl(drawnImageSrc({ src: marked, style: 'blueprint' }, 'ink')) ?? '';
    assert.equal(blueprint.split(BLUEPRINT_CUT_FILL.light).length - 1, 1);
    assert.doesNotMatch(blueprint, /\sclass=/);
    for (const style of ['plain', 'draft', 'comic'] as const) {
      const drawn = decodeSvgDataUrl(drawnImageSrc({ src: marked, style }, 'ink')) ?? '';
      assert.notEqual(drawn, UNREADABLE_DRAWING_SVG, style);
      assert.doesNotMatch(drawn, new RegExp(BLUEPRINT_CUT_FILL.light, 'i'), style);
    }
  });

  it('gives each look of the dark board its own tone', () => {
    const blueprint = (pen: 'ink' | 'chalk'): string => applyLookToDrawnSvg(drawing, 'blueprint', pen);
    assert.match(blueprint('ink'), new RegExp(DRAWING_LOOK_TONES.blueprint.light.paper ?? '#', 'i'));
    assert.match(blueprint('chalk'), new RegExp(DRAWING_LOOK_TONES.blueprint.dark.paper ?? '#', 'i'));
  });
});
