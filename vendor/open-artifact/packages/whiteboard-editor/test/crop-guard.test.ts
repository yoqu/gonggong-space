/**
 * Cropping a picture someone else changes: which changes from elsewhere
 * stop crop mode.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Board, BoardElement, ImageElement } from '@open-artifact/whiteboard-core';
import { CROP_IMAGE_CHANGED_ELSEWHERE, cropPictureChanged, cropTargetChanged } from '../src/selection/crop-guard.ts';

const image: ImageElement = { type: 'image', id: 'i1', x: 0, y: 0, w: 400, h: 300, src: '/_blob/a' };

/** A board of `elements`. */
function boardOf(...elements: BoardElement[]): Board {
  return { title: 'Board', content: { elements } } as unknown as Board;
}

describe('cropPictureChanged', () => {
  it('stops cropping when the picture goes, is swapped or is resized', () => {
    assert.ok(cropPictureChanged(image, undefined));
    assert.ok(cropPictureChanged(image, { ...image, src: '/_blob/b' }));
    assert.ok(cropPictureChanged(image, { ...image, w: 200 }));
    assert.ok(cropPictureChanged(image, { ...image, h: 200 }));
    assert.ok(cropPictureChanged(image, { type: 'note', id: 'i1', x: 0, y: 0, w: 100, h: 100, color: 'yellow', text: '', tilt: 0 }));
  });

  it('goes on through moves, turns and crop changes', () => {
    assert.ok(!cropPictureChanged(image, image));
    assert.ok(!cropPictureChanged(image, { ...image, x: 50, y: 20 }));
    assert.ok(!cropPictureChanged(image, { ...image, crop: { zoom: 2, x: 0.5, y: 0.5 } }));
  });

  it('reads the picture out of both boards', () => {
    const other: BoardElement = { type: 'note', id: 'n1', x: 0, y: 0, w: 100, h: 100, color: 'yellow', text: '', tilt: 0 };
    assert.ok(!cropTargetChanged('i1', boardOf(image, { ...other, text: 'x' }), boardOf(image, other)));
    assert.ok(cropTargetChanged('i1', boardOf(other), boardOf(image, other)));
    assert.match(CROP_IMAGE_CHANGED_ELSEWHERE, /cropping stopped/);
  });
});
