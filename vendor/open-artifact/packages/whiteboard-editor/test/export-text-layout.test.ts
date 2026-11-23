/**
 * Tests of the exporter's text layout: wrapping markup spans, breaking long
 * words, inline code chips, line limits, ellipses and right-to-left text.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutRasterTextLines, type MeasureContext } from '../src/export/raster-text.ts';
import {
  CODE_CHIP_PAD,
  graphemesOf,
  isRightToLeftText,
  rasterSpanFont,
  truncateToWidth,
  wrapRichText,
  type SpanMeasure,
  type WrappedLine,
} from '../src/export/text-layout.ts';

/** Every grapheme is 10 wide. */
const width = (text: string): number => graphemesOf(text).length * 10;
/** {@link width} for any span kind. */
const measure: SpanMeasure = (text) => width(text);
const lineText = (line: WrappedLine): string => line.pieces.map((piece) => piece.text).join('');

/** A measuring context where every grapheme is 10 wide, whatever the font. */
const fakeContext = (): MeasureContext => {
  const ctx = { font: '', measureText: (text: string) => ({ width: graphemesOf(text).length * 10 }) };
  return ctx as unknown as MeasureContext;
};

describe('wrapRichText', () => {
  it('wraps between words and drops trailing spaces', () => {
    const lines = wrapRichText([[{ kind: 'text', text: 'one two three four' }]], 90, measure);
    assert.deepEqual(lines.map(lineText), ['one two', 'three', 'four']);
    assert.equal(lines[0]?.w, 70);
  });

  it('starts a new line for each paragraph, and an empty one is an empty line', () => {
    const lines = wrapRichText([[{ kind: 'text', text: 'a' }], [], [{ kind: 'text', text: 'b' }]], 100, measure);
    assert.deepEqual(lines.map(lineText), ['a', '', 'b']);
  });

  it('breaks a word wider than the line between graphemes', () => {
    const lines = wrapRichText([[{ kind: 'text', text: 'abcdefghij' }]], 40, measure);
    assert.deepEqual(lines.map(lineText), ['abcd', 'efgh', 'ij']);
  });

  it('keeps a word across a style change together', () => {
    const lines = wrapRichText(
      [
        [
          { kind: 'text', text: 'go ' },
          { kind: 'bold', text: 'bold' },
          { kind: 'text', text: 'text' },
        ],
      ],
      80,
      measure,
    );
    assert.deepEqual(lines.map(lineText), ['go', 'boldtext']);
    assert.deepEqual(
      lines[1]?.pieces.map((piece) => piece.kind),
      ['bold', 'text'],
    );
  });

  it('pads inline code chips on both sides', () => {
    const [line] = wrapRichText([[{ kind: 'code', text: 'npm' }]], 200, measure);
    assert.ok(line);
    assert.equal(line.pieces[0]?.lead, CODE_CHIP_PAD);
    assert.equal(line.w, 30 + CODE_CHIP_PAD * 2);
  });

  it('stops at the line limit', () => {
    const lines = wrapRichText([[{ kind: 'text', text: 'a b c d e f' }]], 10, measure, 2);
    assert.deepEqual(lines.map(lineText), ['a', 'b']);
  });
});

describe('truncateToWidth', () => {
  it('leaves text that fits alone', () => {
    assert.equal(truncateToWidth('hello', 50, width), 'hello');
  });

  it('cuts with an ellipsis', () => {
    assert.equal(truncateToWidth('hello world', 50, width), 'hell…');
  });

  it('gives nothing when not one character fits', () => {
    assert.equal(truncateToWidth('hello', 15, width), '');
  });
});

describe('isRightToLeftText', () => {
  it('detects Hebrew and Arabic', () => {
    assert.equal(isRightToLeftText('שלום'), true);
    assert.equal(isRightToLeftText('مرحبا'), true);
    assert.equal(isRightToLeftText('hello'), false);
  });
});

describe('rasterSpanFont', () => {
  it('sets code in the monospace face at 90 %', () => {
    assert.match(rasterSpanFont('code', { px: 20, weight: 400 }), /^400 18px .*monospace/);
  });

  it('uses the bold weight for bold spans', () => {
    assert.match(rasterSpanFont('bold', { px: 20, weight: 400, bold: 600 }), /600/);
    assert.match(rasterSpanFont('bolditalic', { px: 20, weight: 400 }), /italic/);
  });
});

describe('layoutRasterTextLines', () => {
  it('lays out markup paragraphs', () => {
    const lines = layoutRasterTextLines(fakeContext(), 'Went **well**\nnext', { px: 16, weight: 400 }, 200, 'left');
    assert.deepEqual(lines.map(lineText), ['Went well', 'next']);
    assert.deepEqual(
      lines[0]?.pieces.map((piece) => piece.kind),
      ['text', 'bold'],
    );
  });

  it('marks right-to-left paragraphs', () => {
    const [line] = layoutRasterTextLines(fakeContext(), 'שלום עולם', { px: 16, weight: 400 }, 500, 'left');
    assert.equal(line?.rtl, true);
  });

  it('respects the line limit', () => {
    const lines = layoutRasterTextLines(fakeContext(), 'a\nb\nc\nd', { px: 16, weight: 400 }, 200, 'left', 2);
    assert.equal(lines.length, 2);
  });
});
