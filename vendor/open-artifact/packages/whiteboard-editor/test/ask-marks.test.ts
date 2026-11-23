import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaCornerPoint, areaFromCorners, boxesOverlap, oppositeCorner, visibleAskMarks, type AskMark } from '../src/collab/ask-marks.ts';

const mark = (key: string, x: number, claimKey = key): AskMark => ({ key, claimKey, box: { x, y: 0, w: 100, h: 100 }, color: '#f00' });

describe('request marks', () => {
  it('all show while no claim is framed', () => {
    const marks = [mark('a', 0), mark('b', 500)];
    assert.deepEqual(visibleAskMarks(marks, []), marks);
  });

  it('give way to a claim framed over them', () => {
    const shown = visibleAskMarks([mark('a', 0), mark('b', 500)], [{ key: 'other', frame: { x: 50, y: 50, w: 200, h: 200 } }]);
    assert.deepEqual(
      shown.map((each) => each.key),
      ['b'],
    );
  });

  it('give way to their own request’s claim wherever it is framed', () => {
    const shown = visibleAskMarks([mark('peer:a', 0, 'a'), mark('b', 500)], [{ key: 'a', frame: { x: 2000, y: 0, w: 10, h: 10 } }]);
    assert.deepEqual(
      shown.map((each) => each.key),
      ['b'],
    );
  });

  it('stay beside a claim that only touches them', () => {
    assert.equal(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
    assert.equal(visibleAskMarks([mark('a', 0)], [{ key: 'c', frame: { x: 100, y: 0, w: 50, h: 50 } }]).length, 1);
  });
});

describe('resizing a drawn area by its corner', () => {
  const box = { x: 10, y: 20, w: 100, h: 50 };

  it('names its corners and the one across from each', () => {
    assert.deepEqual(areaCornerPoint(box, 'top-left'), { x: 10, y: 20 });
    assert.deepEqual(areaCornerPoint(box, 'bottom-right'), { x: 110, y: 70 });
    assert.deepEqual(areaCornerPoint(box, 'top-right'), { x: 110, y: 20 });
    assert.equal(oppositeCorner('top-left'), 'bottom-right');
    assert.equal(oppositeCorner('bottom-left'), 'top-right');
  });

  it('keeps the origin and follows the grip', () => {
    assert.deepEqual(areaFromCorners({ x: 10, y: 20 }, { x: 210, y: 120 }), { x: 10, y: 20, w: 200, h: 100 });
  });

  it('flips to the other side when the grip passes the origin', () => {
    assert.deepEqual(areaFromCorners({ x: 10, y: 20 }, { x: 0, y: 0 }), { x: 0, y: 0, w: 10, h: 20 });
  });

  it('never gets smaller than the least size', () => {
    assert.deepEqual(areaFromCorners({ x: 10, y: 20 }, { x: 11, y: 20 }, 8), { x: 10, y: 20, w: 8, h: 8 });
    assert.deepEqual(areaFromCorners({ x: 10, y: 20 }, { x: 9, y: 19 }, 8), { x: 2, y: 12, w: 8, h: 8 });
  });
});
