import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeFloatingLeft, placeFloatingToolbar, type FloatingLayout } from '../src/lib/floating.ts';

const base: Omit<FloatingLayout, 'selTop' | 'selBottom'> = { menuH: 40, bandTop: 60, bandBottom: 700, caret: () => null };

describe('placeFloatingToolbar', () => {
  it('sits 10px above the selection when there is room', () => {
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 300, selBottom: 400 }), { top: 250, placed: 'above', overlaps: false });
  });

  it('goes below when the selection is near the top', () => {
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 90, selBottom: 400 }), { top: 410, placed: 'below', overlaps: false });
  });

  it('pins to the top when the selection fills the view and no caret is known', () => {
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 70, selBottom: 690 }), { top: 68, placed: 'above', overlaps: true });
  });

  it('stays clear of the caret line inside a tall selection', () => {
    const caret = (): { top: number; bottom: number } => ({ top: 80, bottom: 110 });
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 70, selBottom: 690, caret }), { top: 120, placed: 'below', overlaps: true });
  });

  it('keeps above the caret when the caret is low enough', () => {
    const caret = (): { top: number; bottom: number } => ({ top: 400, bottom: 430 });
    assert.deepEqual(placeFloatingToolbar({ ...base, selTop: 70, selBottom: 690, caret }), { top: 68, placed: 'above', overlaps: true });
  });
});

describe('placeFloatingLeft', () => {
  it('aligns with the selection', () => {
    assert.equal(placeFloatingLeft(200, 300, 100, 900), 200);
  });

  it('stays inside the band on both sides', () => {
    assert.equal(placeFloatingLeft(50, 300, 100, 900), 108);
    assert.equal(placeFloatingLeft(800, 300, 100, 900), 592);
  });
});
