/**
 * Tests of the board picture's framing and the pure look helpers the
 * exporter paints with (sticker rims, table header colors, arrow paths).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArrowElement, ArrowGeometry, NoteElement, StickerElement, TextElement } from '@open-artifact/whiteboard-core';
import { boardPngFilename, EXPORT_MAX_SCALE, PNG_FILENAME_MAX_CHARS, EXPORT_PADDING, EXPORT_TITLE_BAR_PX, exportFrameFor, framedElements } from '../src/export/frame.ts';
import { arrowEndNeighbor, arrowPathData, rectPathData, stickerOutlinePadding, stickerOutlineShadows, tableHeadColors, TABLE_HEAD_FILLS } from '../src/export/look.ts';

const note = (id: string, x = 0, y = 0): NoteElement => ({ type: 'note', id, x, y, w: 180, h: 180, color: 'yellow', text: 'Hi', tilt: 0 });
const sticker = (id: string, size: number): StickerElement => ({ type: 'sticker', id, x: 0, y: 0, w: size, h: size, glyph: '⭐' });

describe('exportFrameFor', () => {
  it('has no frame for an empty board', () => {
    assert.equal(exportFrameFor([]), undefined);
  });

  it('leaves out texts that show only their placeholder, unless an arrow joins one', () => {
    const hint = (id: string, x: number): TextElement => ({ type: 'text', id, x, y: 0, text: ' ', size: 'body', color: 'ink', placeholder: 'Type here' });
    const arrow: ArrowElement = { type: 'arrow', id: 'a', from: 'n1', to: 'joined', head: 'end', dash: false, color: 'ink' };
    const elements = [note('n1'), hint('alone', 2000), hint('joined', 600), arrow];
    assert.deepEqual(
      framedElements(elements).map((element) => element.id),
      ['n1', 'joined', 'a'],
    );
    assert.equal(exportFrameFor([hint('alone', 2000)]), undefined);
    const frame = exportFrameFor([note('n1'), hint('alone', 2000)]);
    assert.equal(frame?.board.w, 180 + EXPORT_PADDING * 2);
  });

  it('pads the content and caps the scale at 2', () => {
    const frame = exportFrameFor([note('n1')]);
    assert.ok(frame);
    assert.deepEqual(frame.board, { x: -EXPORT_PADDING, y: -EXPORT_PADDING, w: 180 + EXPORT_PADDING * 2, h: 180 + EXPORT_PADDING * 2 });
    assert.equal(frame.scale, EXPORT_MAX_SCALE);
    assert.equal(frame.width, 308 * 2);
    assert.equal(frame.height, 308 * 2 + EXPORT_TITLE_BAR_PX);
    assert.equal(frame.titleBar, EXPORT_TITLE_BAR_PX);
  });

  it('scales down so the longest edge, title bar included, fits', () => {
    const frame = exportFrameFor([note('n1'), note('n2', 5000, 0)], undefined, 1000);
    assert.ok(frame);
    assert.ok(frame.width <= 1000);
    assert.ok(frame.height <= 1000);
    assert.equal(frame.width, 1000);

    const tall = exportFrameFor([note('n1'), note('n2', 0, 400)], undefined, 400);
    assert.ok(tall);
    assert.equal(tall.height, 400);
    assert.ok(tall.width < 400);
  });

  it('widens the margin for big stickers so their rim is not cut', () => {
    const frame = exportFrameFor([sticker('s1', 480)]);
    assert.ok(frame);
    const pad = stickerOutlinePadding(480);
    assert.ok(pad > EXPORT_PADDING);
    assert.equal(frame.board.x, -pad);
  });
});

describe('boardPngFilename', () => {
  it('keeps the title, turning characters file systems refuse into spaces', () => {
    assert.equal(boardPngFilename('Q3 Retro: wins & misses!'), 'Q3 Retro wins & misses!.png');
    assert.equal(boardPngFilename('a/b\\c*d?e"f<g>h|i%j'), 'a b c d e f g h i j.png');
    assert.equal(boardPngFilename('Café 計画'), 'Café 計画.png');
  });

  it('drops control characters', () => {
    assert.equal(boardPngFilename('Plan\u0000\u0007 A\u007f'), 'Plan A.png');
    assert.equal(boardPngFilename('Line one\nLine two'), 'Line oneLine two.png');
  });

  it('keeps at most 120 characters', () => {
    assert.equal(boardPngFilename('x'.repeat(300)), 'x'.repeat(PNG_FILENAME_MAX_CHARS) + '.png');
    assert.equal(PNG_FILENAME_MAX_CHARS, 120);
  });

  it('falls back to "whiteboard"', () => {
    assert.equal(boardPngFilename(''), 'whiteboard.png');
    assert.equal(boardPngFilename(' :/?* '), 'whiteboard.png');
    assert.equal(boardPngFilename('\u0001\u0002'), 'whiteboard.png');
  });
});

describe('sticker rims', () => {
  it('reach further for bigger stickers', () => {
    assert.ok(Math.abs(stickerOutlinePadding(48) - 8.6) < 1e-9);
    assert.ok(Math.abs(stickerOutlinePadding(96) - 17.2) < 1e-9);
  });

  it('add the faint edge only when asked', () => {
    const plain = stickerOutlineShadows(false);
    const edged = stickerOutlineShadows(true);
    assert.equal(plain.length, 24);
    assert.equal(edged.length, 40);
    assert.ok(plain.every(([, , color]) => color === '#FFFFFF'));
    assert.ok(edged.slice(24).every(([, , color]) => color !== '#FFFFFF'));
  });
});

describe('tableHeadColors', () => {
  it('uses the neutral header fill for white tables', () => {
    assert.equal(tableHeadColors({ color: 'white' }, 'light').fill, TABLE_HEAD_FILLS.light);
    assert.equal(tableHeadColors({ color: 'white' }, 'dark').fill, TABLE_HEAD_FILLS.dark);
  });

  it('tints colored headers toward the paper', () => {
    const { fill, ink } = tableHeadColors({ color: 'blue' }, 'light');
    assert.match(fill, /^#[0-9a-f]{6}$/);
    assert.notEqual(fill, TABLE_HEAD_FILLS.light);
    assert.match(ink, /^#/);
  });
});

describe('arrow paths', () => {
  const straight: ArrowGeometry = { x1: 0, y1: 0, x2: 10, y2: 20 };
  const routed: ArrowGeometry = { x1: 0, y1: 0, x2: 50, y2: 50, elbow: [[0, 0], [50, 0], [50, 50]] };

  it('draws a straight arrow as one segment', () => {
    assert.equal(arrowPathData(straight, ['none', 'arrow']), 'M 0 0 L 10 20');
  });

  it('points heads away from the neighboring point', () => {
    assert.deepEqual(arrowEndNeighbor(straight, 'from'), { x: 10, y: 20 });
    assert.deepEqual(arrowEndNeighbor(straight, 'to'), { x: 0, y: 0 });
    assert.deepEqual(arrowEndNeighbor(routed, 'from'), { x: 50, y: 0 });
    assert.deepEqual(arrowEndNeighbor(routed, 'to'), { x: 50, y: 0 });
  });

  it('draws a routed arrow through its corners', () => {
    assert.match(arrowPathData(routed, ['none', 'arrow']), /^M\s*0[ ,]0/);
  });

  it('writes rectangles as a closed path', () => {
    assert.equal(rectPathData({ x: 1, y: 2, w: 3, h: 4 }), 'M1 2h3v4h-3Z');
  });
});
