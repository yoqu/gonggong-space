import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptySlide, type Slide } from '@open-artifact/slides-core';
import { captureOrder, hashText, lookKey, slideHash, snapshotKey, snapshotSize, wantedLive, type PlacedThumb } from '../src/services/live-plan.ts';

const look = { width: 1920, faces: {}, fontEpoch: 0 };

function slide(id: string, patch: Partial<Slide> = {}): Slide {
  return { ...emptySlide(id), ...patch };
}

describe('snapshot keys', () => {
  it('hashes text stably', () => {
    assert.equal(hashText('abc'), hashText('abc'));
    assert.notEqual(hashText('abc'), hashText('abd'));
    assert.match(hashText(''), /^[0-9a-f]{8}$/);
  });

  it('change when what the slide draws changes', () => {
    const a = slide('a', { style: { background: '#fff' } });
    const b = { ...a, style: { background: '#000' } };
    assert.notEqual(snapshotKey(a, look), snapshotKey(b, look));
  });

  it('ignore notes, id, transition and the skip flag', () => {
    const a = slide('a', { style: { background: '#fff' } });
    const b: Slide = { ...a, id: 'b', notes: 'Say hello', hidden: true, transition: 'fade' as Slide['transition'] };
    assert.equal(slideHash(a), slideHash(b));
    assert.equal(snapshotKey(a, look), snapshotKey(b, look));
  });

  it('change with the deck size, typefaces and font loading', () => {
    const a = slide('a');
    const base = snapshotKey(a, look);
    assert.notEqual(snapshotKey(a, { ...look, width: 1440 }), base);
    assert.notEqual(snapshotKey(a, { ...look, fontEpoch: 1 }), base);
    assert.notEqual(snapshotKey(a, { ...look, faces: { inter: { family: 'Inter', href: 'https://fonts.googleapis.com/css2?family=Inter' } } }), base);
    assert.equal(snapshotKey(a, lookKey(look)), base);
  });

  it('are cached per slide object', () => {
    const a = slide('a');
    assert.equal(slideHash(a), slideHash(a));
  });
});

/** A column of 100px-tall thumbnails, 10px apart, in a 300px-tall view scrolled to `scroll`. */
function column(n: number, scroll: number): PlacedThumb[] {
  const view = { x: 0, y: 0, w: 200, h: 300 };
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, rect: { x: 0, y: i * 110 - scroll, w: 180, h: 100 }, view }));
}

describe('wantedLive', () => {
  const options = { max: 32, margin: 0.5, minWidth: 48 };

  it('takes what is on screen and near it', () => {
    const { live, visible } = wantedLive(column(20, 0), [], options);
    assert.deepEqual([...visible].sort(), ['s0', 's1', 's2']);
    // 150px of margin below a 300px view: thumbnails starting above 450px.
    assert.deepEqual([...live].sort(), ['s0', 's1', 's2', 's3', 's4']);
  });

  it('follows the scroll', () => {
    const { live, visible } = wantedLive(column(20, 1100), [], options);
    assert.deepEqual([...visible].sort(), ['s10', 's11', 's12']);
    assert.ok(live.has('s9') && live.has('s13') && !live.has('s5') && !live.has('s0'));
  });

  it('caps the count, keeping what is on screen and nearest the middle', () => {
    const { live } = wantedLive(column(20, 1100), [], { ...options, max: 4 });
    assert.equal(live.size, 4);
    for (const id of ['s10', 's11', 's12']) assert.ok(live.has(id), id);
  });

  it('always adds pinned slides, beyond the cap', () => {
    const { live } = wantedLive(column(20, 0), ['s19', 's18'], { ...options, max: 2 });
    assert.ok(live.has('s19') && live.has('s18'));
    assert.equal(live.size, 4);
  });

  it('leaves tiny thumbnails as snapshots', () => {
    const view = { x: 0, y: 0, w: 1000, h: 800 };
    const thumbs: PlacedThumb[] = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, rect: { x: i * 20, y: 0, w: 16, h: 9 }, view }));
    const { live, visible } = wantedLive(thumbs, ['t3'], options);
    assert.deepEqual([...live], ['t3']);
    assert.equal(visible.size, 50);
  });

  it('skips views with no size (hidden)', () => {
    const view = { x: 0, y: 0, w: 0, h: 0 };
    const { live } = wantedLive([{ id: 'a', rect: { x: 0, y: 0, w: 100, h: 50 }, view }], [], options);
    assert.equal(live.size, 0);
  });
});

describe('captureOrder', () => {
  const order = Array.from({ length: 10 }, (_, i) => `s${i}`);

  it('starts on screen and spreads out from it', () => {
    assert.deepEqual(captureOrder(order, order, new Set(['s5'])), ['s5', 's4', 's6', 's3', 's7', 's2', 's8', 's1', 's9', 's0']);
  });

  it('measures from the nearest slide on screen', () => {
    assert.deepEqual(captureOrder(['s0', 's4', 's9', 's6'], order, new Set(['s2', 's8'])), ['s9', 's0', 's4', 's6']);
  });

  it('falls back to deck order', () => {
    assert.deepEqual(captureOrder(['s7', 's1', 's3'], order, new Set()), ['s1', 's3', 's7']);
  });

  it('drops slides not in the deck', () => {
    assert.deepEqual(captureOrder(['gone', 's2'], order, new Set(['s0'])), ['s2']);
  });
});

describe('snapshotSize', () => {
  it('scales the canvas', () => {
    assert.deepEqual(snapshotSize(1920, 1080, 0.25), { w: 480, h: 270 });
    assert.deepEqual(snapshotSize(1440, 1080, 0.25), { w: 360, h: 270 });
    assert.deepEqual(snapshotSize(10, 10, 0.01), { w: 1, h: 1 });
  });
});
