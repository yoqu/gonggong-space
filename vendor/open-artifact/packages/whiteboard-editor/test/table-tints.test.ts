/**
 * Tests of table cell colors and heat maps on the page: what is said after
 * a change, the color a heat map takes, which rows take one, and where
 * tinted cells get a divider.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tableCellPaints, tableFromGrid, tableHeatPaint, type TableElement } from '@open-artifact/whiteboard-core';
import { tableTintDividers } from '../src/export/look.ts';
import { TABLE_TINT_MESSAGES, heatChangeMessage, heatColorFor, heatRampGradient, takesRowHeat } from '../src/lib/table-heat.ts';

/** A table with a header row: rows r1… and columns c1… from the grid. */
const table = (grid: string[][], extra: Partial<TableElement> = {}): TableElement => ({ type: 'table', id: 't1', x: 0, y: 0, head: true, color: 'white', ...tableFromGrid(grid), ...extra });

describe('heatChangeMessage', () => {
  it('says a heat map was added, recolored or removed', () => {
    assert.equal(heatChangeMessage(undefined, 'cols', 'c1', 'blue'), TABLE_TINT_MESSAGES.heatAdded);
    assert.equal(heatChangeMessage({ cols: { c2: 'pink' } }, 'cols', 'c1', 'blue'), TABLE_TINT_MESSAGES.heatAdded);
    assert.equal(heatChangeMessage({ cols: { c1: 'pink' } }, 'cols', 'c1', 'blue'), TABLE_TINT_MESSAGES.heatColor);
    assert.equal(heatChangeMessage({ cols: { c1: 'pink' } }, 'cols', 'c1', ''), TABLE_TINT_MESSAGES.heatRemoved);
  });

  it('says the other axis lost its heat maps', () => {
    assert.equal(heatChangeMessage({ cols: { c1: 'pink' } }, 'rows', 'r2', 'blue'), 'Row heat map added. Column heat maps removed.');
    assert.equal(heatChangeMessage({ rows: { r2: 'pink' } }, 'cols', 'c1', 'blue'), 'Column heat map added. Row heat maps removed.');
    assert.equal(heatChangeMessage({ rows: {} }, 'cols', 'c1', 'blue'), TABLE_TINT_MESSAGES.heatAdded);
  });
});

describe('heatColorFor', () => {
  it('keeps the color a line has, else takes the last one picked, else the table default', () => {
    const plain = table([['h'], ['1']]);
    assert.equal(heatColorFor({ ...plain, heat: { cols: { c1: 'green' } } }, 'cols', 'c1', 'pink'), 'green');
    assert.equal(heatColorFor(plain, 'cols', 'c1', 'pink'), 'pink');
    assert.equal(heatColorFor(plain, 'cols', 'c1', undefined), 'blue');
    assert.equal(heatColorFor({ ...plain, color: 'peach' }, 'cols', 'c1', undefined), 'peach');
  });

  it('draws a ramp from the lowest shade to the highest', () => {
    assert.equal(heatRampGradient('blue', 'light'), `linear-gradient(90deg, ${tableHeatPaint('blue', 0, 'light').fill}, ${tableHeatPaint('blue', 1, 'light').fill})`);
  });
});

describe('takesRowHeat', () => {
  it('turns down the header row and unknown rows', () => {
    const element = table([['h'], ['1']]);
    assert.equal(takesRowHeat(element, 'r1'), false);
    assert.equal(takesRowHeat(element, 'r2'), true);
    assert.equal(takesRowHeat(element, 'r9'), false);
    assert.equal(takesRowHeat({ ...element, head: false }, 'r1'), true);
  });
});

describe('tableTintDividers', () => {
  it('divides tinted cells from tinted neighbors on the right and below only', () => {
    const element = table(
      [
        ['h', 'h'],
        ['1', '2'],
        ['3', '4'],
        ['5', '6'],
      ],
      { fills: { r2: { c1: 'pink', c2: 'pink' }, r3: { c1: 'blue' } } },
    );
    assert.deepEqual(tableTintDividers(element, tableCellPaints(element, 'light')), {
      r2: { c1: { right: true, bottom: true } },
    });
  });

  it('divides a whole heat-mapped column row by row', () => {
    const element = table([['h'], ['1'], ['2'], ['3']], { heat: { cols: { c1: 'blue' } } });
    assert.deepEqual(tableTintDividers(element, tableCellPaints(element, 'light')), {
      r2: { c1: { right: false, bottom: true } },
      r3: { c1: { right: false, bottom: true } },
    });
  });
});
