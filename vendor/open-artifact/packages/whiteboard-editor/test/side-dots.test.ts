import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, ShapeElement } from '@open-artifact/whiteboard-core';
import { glideCameraAt } from '../src/lib/camera.ts';
import { SIDE_DOT_OFFSET_PX, sideDotCenter, sideDotReachPx, sideDotTitle, sideDotsWithRoom } from '../src/lib/side-dots.ts';

function shape(id: string, x: number, y: number, w = 100, h = 60): ShapeElement {
  return { type: 'shape', id, kind: 'rect', color: 'white', text: '', x, y, w, h };
}

describe('side dots', () => {
  it('sit the dot offset outside the middle of each side, turning with the item', () => {
    const box = { x: 0, y: 0, w: 100, h: 60 };
    assert.deepEqual(sideDotCenter(box, 'right', 0, 12), { x: 112, y: 30 });
    const turned = sideDotCenter(box, 'right', 90, 12);
    assert.ok(Math.abs(turned.x - 50) < 1e-9 && Math.abs(turned.y - 92) < 1e-9);
  });

  it('show only on sides with room', () => {
    const from = shape('s', 0, 0);
    const box = { x: 0, y: 0, w: 100, h: 60 };
    const all: BoardElement[] = [from];
    assert.deepEqual(sideDotsWithRoom(from, box, 0, 1, false, all), ['top', 'right', 'bottom', 'left']);
    const crowded: BoardElement[] = [from, shape('r', 118, 0)];
    assert.deepEqual(sideDotsWithRoom(from, box, 0, 1, false, crowded), ['top', 'bottom', 'left']);
    // A finger needs more room around a dot than a mouse.
    const near: BoardElement[] = [from, shape('r', 130, 0)];
    assert.deepEqual(sideDotsWithRoom(from, box, 0, 1, false, near), ['top', 'right', 'bottom', 'left']);
    assert.deepEqual(sideDotsWithRoom(from, box, 0, 1, true, near), ['top', 'bottom', 'left']);
  });

  it('need less room under a mouse than the dot offset, more under a finger', () => {
    assert.ok(sideDotReachPx(false) < SIDE_DOT_OFFSET_PX);
    assert.ok(sideDotReachPx(true) > SIDE_DOT_OFFSET_PX);
  });

  it('name the click and the drag in their tooltip', () => {
    assert.equal(sideDotTitle('note', true), 'Click to add a sticky note\nDrag to connect');
    assert.equal(sideDotTitle('shape', true), 'Click to add a shape\nDrag to connect');
    assert.equal(sideDotTitle('shape', false), 'Drag to connect');
  });
});

describe('camera glide', () => {
  it('eases from one camera to the other', () => {
    const from = { x: 0, y: 0, zoom: 1 };
    const to = { x: 100, y: -50, zoom: 1 };
    assert.deepEqual(glideCameraAt(from, to, 0), from);
    assert.deepEqual(glideCameraAt(from, to, 1), to);
    const half = glideCameraAt(from, to, 0.5);
    assert.ok(half.x > 50 && half.x < 100);
  });
});
