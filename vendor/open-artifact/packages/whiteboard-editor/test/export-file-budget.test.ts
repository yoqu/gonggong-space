/**
 * Tests of the board file download's size rules: embedded picture sizes
 * and how an oversized file drops pictures, then its preview.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_FILE_IMAGE_MAX_PX,
  BOARD_FILE_IMAGE_MIN_PX,
  embedLongEdges,
  embedPixelSize,
  fitBoardFileToBudget,
  utf8Length,
} from '../src/export/file-budget.ts';

/** A stand-in board file: the kept pictures and a 100-character preview. */
const assemble = (embeds: ReadonlyMap<string, string>, preview: boolean): string =>
  JSON.stringify({ pictures: Object.fromEntries(embeds), preview: preview ? 'P'.repeat(100) : null });

const embeds: ReadonlyMap<string, string> = new Map([
  ['small', 's'.repeat(50)],
  ['large', 'l'.repeat(300)],
  ['medium', 'm'.repeat(100)],
]);

describe('utf8Length', () => {
  it('counts bytes, not characters', () => {
    assert.equal(utf8Length('abc'), 3);
    assert.equal(utf8Length('é'), 2);
    assert.equal(utf8Length('你好'), 6);
  });
});

describe('embedPixelSize', () => {
  it('scales the long edge and keeps the aspect', () => {
    assert.deepEqual(embedPixelSize({ w: 4000, h: 2000 }, 2048), { w: 2048, h: 1024 });
    assert.deepEqual(embedPixelSize({ w: 300, h: 600 }, 100), { w: 50, h: 100 });
  });

  it('is never smaller than one pixel', () => {
    assert.deepEqual(embedPixelSize({ w: 5000, h: 1 }, 100), { w: 100, h: 1 });
  });
});

describe('embedLongEdges', () => {
  it('starts at the picture size, capped, and shrinks by 0.7', () => {
    const edges = embedLongEdges({ w: 3000, h: 1000 });
    assert.equal(edges[0], BOARD_FILE_IMAGE_MAX_PX);
    assert.equal(edges[1], 1433);
    assert.ok(edges.every((edge, index) => index === 0 || edge < (edges[index - 1] ?? Infinity)));
    assert.ok(edges.every((edge) => edge >= BOARD_FILE_IMAGE_MIN_PX));
    assert.ok(Math.floor((edges.at(-1) ?? 0) * 0.7) < BOARD_FILE_IMAGE_MIN_PX);
  });

  it('keeps a small picture at its own size', () => {
    assert.deepEqual(embedLongEdges({ w: 100, h: 80 }), [100]);
  });

  it('embeds a tiny original without upscaling it', () => {
    assert.deepEqual(embedLongEdges({ w: 50, h: 40 }), [50]);
  });
});

describe('fitBoardFileToBudget', () => {
  const full = utf8Length(assemble(embeds, true));

  it('keeps everything that fits', () => {
    const fitted = fitBoardFileToBudget(assemble, embeds, full);
    assert.deepEqual([...fitted.embedded].sort(), ['large', 'medium', 'small']);
    assert.equal(fitted.preview, true);
    assert.equal(fitted.text, assemble(embeds, true));
  });

  it('drops the largest picture first', () => {
    const fitted = fitBoardFileToBudget(assemble, embeds, full - 10);
    assert.deepEqual([...fitted.embedded].sort(), ['medium', 'small']);
    assert.equal(fitted.preview, true);
    assert.ok(utf8Length(fitted.text) <= full - 10);
  });

  it('drops more pictures when one is not enough', () => {
    const fitted = fitBoardFileToBudget(assemble, embeds, full - 350);
    assert.deepEqual([...fitted.embedded], ['small']);
    assert.equal(fitted.preview, true);
  });

  it('drops the preview last', () => {
    const fitted = fitBoardFileToBudget(assemble, embeds, 60);
    assert.equal(fitted.embedded.size, 0);
    assert.equal(fitted.preview, false);
    assert.equal(fitted.text, assemble(new Map(), false));
  });

  it('keeps the preview of a file without pictures when it fits', () => {
    const fitted = fitBoardFileToBudget(assemble, new Map(), 1000);
    assert.equal(fitted.preview, true);
  });
});
