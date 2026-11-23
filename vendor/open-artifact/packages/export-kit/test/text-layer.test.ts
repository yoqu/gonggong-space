import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupLines, isWebLink, type Word } from '../src/text-layer.ts';

const word = (text: string, left: number, top: number, space = true, size = 16): Word => ({ text, left, right: left + text.length * 8, top, bottom: top + 20, size, space });

describe('groupLines', () => {
  it('joins words on one line and splits on a new one', () => {
    const lines = groupLines([word('Hello', 10, 100), word('world', 60, 100, false), word('Next', 10, 1200)]);
    assert.deepEqual(
      lines.map((l) => l.text),
      ['Hello world', 'Next'],
    );
    assert.deepEqual(lines[0], { text: 'Hello world', x: 10, top: 100, bottom: 120, baseline: 116, size: 16, width: 90 });
  });

  it('adds a space only where the source has one or the gap is wide', () => {
    // "Hel" + "lo" with no space in the source and touching boxes: one word.
    assert.equal(groupLines([word('Hel', 0, 0, false), word('lo', 24, 0)])[0]!.text, 'Hello');
    // A gap wider than 0.15 em reads as a space.
    assert.equal(groupLines([word('a', 0, 0, false), word('b', 8 + 3, 0)])[0]!.text, 'a b');
  });

  it('breaks lines on a vertical jump, a step back or a wide gap', () => {
    assert.equal(groupLines([word('a', 0, 0), word('b', 10, 9)]).length, 2);
    assert.equal(groupLines([word('abc', 100, 0), word('d', 0, 0)]).length, 2);
    assert.equal(groupLines([word('a', 0, 0), word('b', 8 + 40, 0)]).length, 2);
    assert.equal(groupLines([word('a', 0, 0), word('b', 8 + 39, 0)]).length, 1);
  });

  it('keeps the largest size and the lowest bottom, and skips empty words', () => {
    const [line] = groupLines([word('a', 0, 0), { ...word('', 10, 0) }, { ...word('B', 10, 2, true, 20), bottom: 30 }]);
    assert.equal(line!.text, 'a B');
    assert.equal(line!.size, 20);
    assert.equal(line!.bottom, 30);
    assert.equal(line!.top, 0);
  });

  it('keeps web links only', () => {
    assert.ok(isWebLink('https://example.com'));
    assert.ok(isWebLink('MAILTO:a@b.c'));
    assert.ok(!isWebLink('javascript:alert(1)'));
    assert.ok(!isWebLink('#top'));
  });
});
