/**
 * Board tools and selection transforms: registration, and the pure math
 * behind drawing boxes, stickers, strokes, constrained lines, marquees,
 * resize handles and arrow ends.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArrowElement, BoardElement, TextElement } from '@open-artifact/whiteboard-core';
import '../src/tools/index.ts';
import { toolPress } from '../src/tools/gesture.ts';
import type { ToolName } from '../src/lib/tools.ts';
import { drawnShapeBox } from '../src/tools/blocks.ts';
import { snapEndToFortyFiveDegrees } from '../src/tools/hit.ts';
import { strokeFromSamples } from '../src/tools/pen.ts';
import { rectBetween } from '../src/tools/select.ts';
import { AREA_CORNER_PX, AREA_STROKE_PX, areaMarqueeGeometry } from '../src/selection/area-marquee.ts';
import { STICKER_GROW, stickerGrowSteps, stickerSizeAfterHold } from '../src/tools/sticker.ts';
import { HANDLE_EDGES, RESIZE_FITTING, resizeHandlesFor, withArrowEnd } from '../src/selection/transform.ts';

const close = (actual: number, expected: number, epsilon = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);
};

describe('tool registration', () => {
  it('registers a press for every board tool', () => {
    const names: ToolName[] = ['select', 'hand', 'text', 'note', 'pen', 'arrow', 'sticker', 'container', 'shape', 'table'];
    for (const name of names) assert.equal(typeof toolPress(name), 'function', name);
  });
});

describe('drawnShapeBox', () => {
  it('spans the drag in any direction', () => {
    assert.deepEqual(drawnShapeBox({ x: 100, y: 100 }, { x: 40, y: 160 }, false, 8), { x: 40, y: 100, w: 60, h: 60 });
    assert.deepEqual(drawnShapeBox({ x: 0, y: 0 }, { x: 30, y: -50 }, false, 8), { x: 0, y: -50, w: 30, h: 50 });
  });

  it('squares the box (Shift) from the longer side', () => {
    assert.deepEqual(drawnShapeBox({ x: 0, y: 0 }, { x: 30, y: 80 }, true, 8), { x: 0, y: 0, w: 80, h: 80 });
    assert.deepEqual(drawnShapeBox({ x: 0, y: 0 }, { x: -30, y: -80 }, true, 8), { x: -80, y: -80, w: 80, h: 80 });
  });

  it('keeps the smallest size', () => {
    assert.deepEqual(drawnShapeBox({ x: 10, y: 10 }, { x: 12, y: 11 }, false, 8), { x: 10, y: 10, w: 8, h: 8 });
  });
});

describe('stickers', () => {
  it('grows ×1.5 every step of the hold, at most three times', () => {
    assert.equal(stickerGrowSteps(0), 0);
    assert.equal(stickerGrowSteps(STICKER_GROW.everyMs - 1), 0);
    assert.equal(stickerGrowSteps(STICKER_GROW.everyMs), 1);
    assert.equal(stickerGrowSteps(STICKER_GROW.everyMs * 10), STICKER_GROW.times);
    close(stickerSizeAfterHold(48, STICKER_GROW.everyMs * 2), 48 * 1.5 * 1.5);
    close(stickerSizeAfterHold(48, 60_000), 48 * 1.5 ** 3);
  });
});

describe('snapEndToFortyFiveDegrees', () => {
  it('projects onto the nearest 45° line through the start', () => {
    const horizontal = snapEndToFortyFiveDegrees({ x: 0, y: 0 }, { x: 100, y: 10 });
    close(horizontal.x, 100);
    close(horizontal.y, 0);
    const diagonal = snapEndToFortyFiveDegrees({ x: 10, y: 10 }, { x: 60, y: 70 });
    close(diagonal.x - 10, diagonal.y - 10);
    const vertical = snapEndToFortyFiveDegrees({ x: 0, y: 0 }, { x: -3, y: -90 });
    close(vertical.x, 0);
    close(vertical.y, -90);
  });

  it('leaves a zero-length line alone', () => {
    assert.deepEqual(snapEndToFortyFiveDegrees({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5 });
  });
});

describe('rectBetween', () => {
  it('normalizes the rubber band', () => {
    assert.deepEqual(rectBetween({ x: 50, y: 10 }, { x: 10, y: 40 }), { x: 10, y: 10, w: 40, h: 30 });
  });
});

describe('strokeFromSamples', () => {
  it('turns a lone sample into a dot', () => {
    const dot = strokeFromSamples([10, 20], 'ink', 4);
    assert.ok(dot);
    assert.equal(dot.type, 'stroke');
    assert.ok(dot.points.length >= 4);
  });

  it('keeps the stroke’s look and needs a sample', () => {
    assert.equal(strokeFromSamples([], 'ink', 4), undefined);
    const stroke = strokeFromSamples([0, 0, 10, 10, 20, 5], 'blue', 6);
    assert.ok(stroke);
    assert.equal(stroke.color, 'blue');
    assert.equal(stroke.width, 6);
  });
});

describe('resize handles', () => {
  const box = { x: 0, y: 0, w: 100, h: 80 };
  const note: BoardElement = { type: 'note', id: 'n', ...box, color: 'yellow', text: '' } as BoardElement;
  const text: BoardElement = { type: 'text', id: 't', x: 0, y: 0, text: 'hi' } as BoardElement;
  const sticker: BoardElement = { type: 'sticker', id: 's', ...box, glyph: '⭐' } as BoardElement;
  const link: BoardElement = { type: 'link', id: 'l', x: 0, y: 0, href: 'https://example.com' } as BoardElement;

  it('gives boxes all eight, texts the sides, stickers the corners', () => {
    assert.equal(resizeHandlesFor([note]).length, 8);
    assert.deepEqual(resizeHandlesFor([text]), ['w', 'e']);
    assert.deepEqual(resizeHandlesFor([sticker]), ['nw', 'ne', 'se', 'sw']);
  });

  it('gives none when something in the selection does not resize', () => {
    assert.deepEqual(resizeHandlesFor([note, link]), []);
    assert.deepEqual(resizeHandlesFor([]), []);
  });

  it('maps each handle to the edges it drags', () => {
    assert.deepEqual(HANDLE_EDGES.nw, { x: 'left', y: 'top' });
    assert.deepEqual(HANDLE_EDGES.e, { x: 'right', y: null });
    assert.deepEqual(HANDLE_EDGES.s, { x: null, y: 'bottom' });
  });

  it('re-wraps text at the new width, keeping the far edge', () => {
    const element = { type: 'text', id: 't', x: 10, y: 0, text: 'hi' } as TextElement;
    const fromLeft = RESIZE_FITTING.fitTextToWidth(element, { x: 10, y: 0, w: 100, h: 20 }, 'left', 60) as TextElement;
    assert.equal(fromLeft.wrap, 60);
    assert.equal(fromLeft.x, 50);
    const fromRight = RESIZE_FITTING.fitTextToWidth(element, { x: 10, y: 0, w: 100, h: 20 }, 'right', 60) as TextElement;
    assert.equal(fromRight.x, 10);
  });
});

describe('withArrowEnd', () => {
  const arrow: ArrowElement = { type: 'arrow', id: 'a', from: 'x', to: [100, 0], fromSide: 'right', head: 'end', dash: false, color: 'ink' } as ArrowElement;

  it('attaches an end to an item on a side', () => {
    const next = withArrowEnd(arrow, 'to', 'y', 'left');
    assert.equal(next.to, 'y');
    assert.equal(next.toSide, 'left');
    assert.equal(next.fromSide, 'right');
  });

  it('frees an end and drops its side', () => {
    const next = withArrowEnd(arrow, 'from', [5, 5], 'top');
    assert.deepEqual(next.from, [5, 5]);
    assert.equal('fromSide' in next, false);
  });
});

describe('areaMarqueeGeometry', () => {
  it('rounds corners 16px on screen, or a third of the short side', () => {
    assert.equal(areaMarqueeGeometry({ x: 0, y: 0, w: 300, h: 200 }, 1).fill.r, AREA_CORNER_PX);
    assert.equal(areaMarqueeGeometry({ x: 0, y: 0, w: 300, h: 200 }, 2).fill.r, AREA_CORNER_PX / 2);
    assert.equal(areaMarqueeGeometry({ x: 0, y: 0, w: 300, h: 30 }, 1).fill.r, 10);
  });

  it('draws the stroke inside the box, the same width at any zoom', () => {
    const { fill, edge } = areaMarqueeGeometry({ x: 10, y: 20, w: 100, h: 50 }, 2);
    const half = AREA_STROKE_PX / 2 / 2;
    assert.deepEqual(fill, { x: 10, y: 20, w: 100, h: 50, r: 8 });
    assert.deepEqual(edge, { x: 10 + half, y: 20 + half, w: 100 - 2 * half, h: 50 - 2 * half, r: 8 - half });
  });

  it('is never thinner than its stroke', () => {
    const { fill, edge } = areaMarqueeGeometry({ x: 0, y: 0, w: 0, h: 40 }, 4);
    assert.equal(fill.w, AREA_STROKE_PX / 4);
    assert.equal(edge.w, 0);
  });
});
