import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pictureRect, resizeCropFrame, type CropBox } from '../src/components/stage/crop.ts';

const close = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** The picture's rect in the old frame's coordinates, after a frame change. */
function pictureAfter(next: CropBox, image: { w: number; h: number }, crop: { zoom: number; x: number; y: number }): CropBox {
  const r = pictureRect(next, image, crop);
  return { x: next.x + r.x, y: next.y + r.y, w: r.w, h: r.h };
}

describe('resizeCropFrame', () => {
  const frame = { w: 400, h: 300 };
  const image = { w: 1600, h: 900 };

  it('keeps the picture still when a side moves in', () => {
    const crop = { zoom: 1, x: 50, y: 50 };
    const before = pictureRect(frame, image, crop);
    for (const [edge, dx, dy] of [
      ['e', -100, 0],
      ['w', 80, 0],
      ['n', 0, 50],
      ['se', -50, -60],
      ['nw', 40, 30],
    ] as const) {
      const { frame: next, crop: c } = resizeCropFrame(frame, image, crop, edge, dx, dy);
      const after = pictureAfter(next, image, c);
      close(after.x, before.x, 1e-3);
      close(after.y, before.y, 1e-3);
      close(after.w, before.w, 1e-3);
      close(after.h, before.h, 1e-3);
    }
  });

  it('moves only the dragged sides', () => {
    const { frame: next } = resizeCropFrame(frame, image, { zoom: 1, x: 50, y: 50 }, 'e', -100, 25);
    assert.deepEqual(next, { x: 0, y: 0, w: 300, h: 300 });
  });

  it('stops the frame at the picture edges', () => {
    // The picture overflows the frame sideways only (16:9 in a 4:3 frame).
    const crop = { zoom: 1, x: 50, y: 50 };
    const picture = pictureRect(frame, image, crop);
    const { frame: wide } = resizeCropFrame(frame, image, crop, 'e', 10_000, 0);
    close(wide.x + wide.w, picture.x + picture.w);
    const { frame: tall } = resizeCropFrame(frame, image, crop, 's', 0, 10_000);
    assert.equal(tall.h, frame.h);
  });

  it('keeps a minimum frame size', () => {
    const { frame: next, crop } = resizeCropFrame(frame, image, { zoom: 1, x: 50, y: 50 }, 'se', -10_000, -10_000, 8);
    assert.ok(next.w >= 8 && next.h >= 8);
    assert.ok(crop.zoom <= 50);
  });
});
