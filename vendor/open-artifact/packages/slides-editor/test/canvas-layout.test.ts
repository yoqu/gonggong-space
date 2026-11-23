import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SectionGroup } from '@open-artifact/slides-core';
import { CAPTION_H, canvasLayout, dropGapAt, dropLineBoxes, emptySectionAt, GAP_X, GAP_Y, grow, LABEL_W, TILE_W, tileAt, tilesIn } from '../src/components/views/canvasLayout.ts';

// Three rows: the opening run (a, b), section s1 (c, d, e), and an empty section s2.
const groups: SectionGroup[] = [
  { section: null, ids: ['a', 'b'] },
  { section: { key: 's1', description: 'Middle' }, ids: ['c', 'd', 'e'] },
  { section: { key: 's2', description: '' }, ids: [] },
];
const layout = canvasLayout(groups, 1920, 1080);
const slideH = 270;
const pitch = slideH + CAPTION_H + GAP_Y;

describe('canvasLayout', () => {
  it('places one row per group, tiles after the label column', () => {
    assert.equal(layout.slideH, slideH);
    assert.equal(layout.tileH, slideH + CAPTION_H);
    assert.deepEqual(
      layout.tiles.map((t) => [t.id, t.index, t.row, t.x, t.y]),
      [
        ['a', 0, 0, LABEL_W, 0],
        ['b', 1, 0, LABEL_W + TILE_W + GAP_X, 0],
        ['c', 2, 1, LABEL_W, pitch],
        ['d', 3, 1, LABEL_W + TILE_W + GAP_X, pitch],
        ['e', 4, 1, LABEL_W + 2 * (TILE_W + GAP_X), pitch],
      ],
    );
    assert.equal(layout.width, LABEL_W + 3 * TILE_W + 2 * GAP_X);
    assert.equal(layout.height, 3 * pitch - GAP_Y);
    assert.deepEqual(
      layout.rows.map((r) => [r.key, r.section?.description ?? null, r.top, r.first]),
      [
        [null, null, 0, 0],
        ['s1', 'Middle', pitch, 2],
        ['s2', '', 2 * pitch, 5],
      ],
    );
    assert.deepEqual(layout.rows[2]!.empty, { x: LABEL_W, y: 2 * pitch, w: TILE_W, h: slideH });
  });

  it('follows the deck aspect', () => {
    assert.equal(canvasLayout(groups, 1440, 1080).slideH, 360);
  });
});

describe('hit testing', () => {
  it('finds the slide, or its caption, under a point', () => {
    assert.equal(tileAt(layout, LABEL_W + 10, 10)?.tile.id, 'a');
    assert.equal(tileAt(layout, LABEL_W + 10, 10)?.caption, false);
    assert.deepEqual(
      (({ tile, caption }) => [tile.id, caption])(tileAt(layout, LABEL_W + TILE_W + GAP_X + 5, pitch + slideH + 4)!),
      ['d', true],
    );
  });

  it('finds nothing in gaps, labels or empty rows', () => {
    assert.equal(tileAt(layout, LABEL_W + TILE_W + 4, 10), null);
    assert.equal(tileAt(layout, 10, 10), null);
    assert.equal(tileAt(layout, LABEL_W + 10, slideH + CAPTION_H + 4), null);
    assert.equal(tileAt(layout, LABEL_W + 10, 2 * pitch + 10), null);
    assert.equal(tileAt(layout, LABEL_W + 3 * (TILE_W + GAP_X), 10), null);
  });

  it('finds the empty section under a point', () => {
    assert.equal(emptySectionAt(layout, LABEL_W + 10, 2 * pitch + 10), 's2');
    assert.equal(emptySectionAt(layout, LABEL_W + 10, pitch + 10), null);
  });
});

describe('drop gaps', () => {
  it('lands before or after the nearest slide by its middle', () => {
    assert.equal(dropGapAt(layout, LABEL_W + 10, 10), 0);
    assert.equal(dropGapAt(layout, LABEL_W + TILE_W - 10, 10), 1);
    assert.equal(dropGapAt(layout, LABEL_W + TILE_W + GAP_X / 2, 10), 1);
    assert.equal(dropGapAt(layout, LABEL_W + 3 * (TILE_W + GAP_X), 10), 2);
    assert.equal(dropGapAt(layout, LABEL_W + 10, pitch + 10), 2);
    assert.equal(dropGapAt(layout, LABEL_W + 2 * (TILE_W + GAP_X) + TILE_W - 5, pitch + 10), 5);
  });

  it('weighs rows over columns', () => {
    // Just below row 0, far right: still row 0's last slide, not row 1.
    assert.equal(dropGapAt(layout, LABEL_W + 2 * (TILE_W + GAP_X) + 10, slideH + CAPTION_H + 10), 2);
  });

  it('draws a line before the slide at the gap, and after a row ending before it', () => {
    assert.deepEqual(dropLineBoxes(layout, 1), [{ x: LABEL_W + TILE_W + GAP_X - GAP_X / 2 - 2, y: 0, w: 4, h: slideH + CAPTION_H }]);
    assert.deepEqual(
      dropLineBoxes(layout, 2).map((b) => [b.x, b.y]),
      [
        [LABEL_W - GAP_X / 2 - 2, pitch],
        [LABEL_W + 2 * TILE_W + GAP_X + GAP_X / 2 - 2, 0],
      ],
    );
    assert.deepEqual(
      dropLineBoxes(layout, 5).map((b) => [b.x, b.y]),
      [[LABEL_W + 3 * TILE_W + 2 * GAP_X + GAP_X / 2 - 2, pitch]],
    );
  });
});

describe('culling', () => {
  it('lists the tiles meeting a rectangle, captions included', () => {
    assert.deepEqual(
      tilesIn(layout, { x: LABEL_W + TILE_W + 1, y: slideH + 1, w: TILE_W, h: pitch }).map((t) => t.id),
      ['b', 'd'],
    );
    assert.deepEqual(tilesIn(layout, { x: 0, y: 0, w: LABEL_W - 1, h: layout.height }), []);
  });

  it('grows a rectangle on every side', () => {
    assert.deepEqual(grow({ x: 0, y: 0, w: 100, h: 50 }, 0.5), { x: -50, y: -25, w: 200, h: 100 });
  });
});
