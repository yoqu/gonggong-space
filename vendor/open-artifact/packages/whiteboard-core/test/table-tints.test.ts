import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBoardDocuments } from '../src/check.ts';
import { createCommandHistory, createTableEditor, findTableElement } from '../src/history.ts';
import { normalizeElement, parseBoardContent } from '../src/normalize.ts';
import type { BoardContent, TableElement } from '../src/schema.ts';
import {
  MAX_TABLE_NUMBER_CHARS,
  TABLE_FILL_TINT,
  TABLE_HEAT_OPACITY,
  defaultTableHeatColor,
  tableCellNumber,
  tableCellPaints,
  tableFillPaint,
  tableHeatLevels,
  tableHeatPaint,
  withTableHeat,
} from '../src/table-tints.ts';
import { mergeTableEdit, tableColumnIsTinted, tableFromGrid, tableRowIsTinted } from '../src/table.ts';
import { BOARD_THEME_COLORS, DARK_CONTRAST_TEXT, LIGHT_CONTRAST_TEXT, SHAPE_FILL_COLORS, mixHexColors } from '../src/theme.ts';

/** A table with a header row: rows r1… and columns c1… from the grid. */
const table = (grid: string[][], extra: Partial<TableElement> = {}): TableElement => ({ type: 'table', id: 't1', x: 0, y: 0, head: true, color: 'white', ...tableFromGrid(grid), ...extra });

const normalizeTableElement = (fields: Record<string, unknown>): TableElement => {
  const element = normalizeElement({ type: 'table', id: 't1', x: 0, y: 0, ...fields });
  assert.ok(element?.type === 'table');
  return element;
};

const levelsOf = (element: TableElement): Record<string, Record<string, number>> =>
  Object.fromEntries(Object.entries(tableHeatLevels(element)).map(([rowId, cells]) => [rowId, Object.fromEntries(Object.entries(cells).map(([colId, { level }]) => [colId, level]))]));

describe('table fills', () => {
  const grid = { cols: { c1: { at: 1 }, c2: { at: 2 } }, rows: { r1: { at: 1, c1: 'a', c2: 'b' }, r2: { at: 2, c1: 'c', c2: 'd' } } };

  it('keeps block colors and #rrggbb, and drops the rest', () => {
    const element = normalizeTableElement({
      ...grid,
      fills: { r1: { c1: 'blue', c2: '#A1B2C3' }, r2: { c1: '', c2: 'teal' }, r9: { c1: 'pink' }, r1x: 'pink' },
    });
    assert.deepEqual(element.fills, { r1: { c1: 'blue', c2: '#a1b2c3' } });
  });

  it('drops fills of columns the table does not have, and leaves out an empty map', () => {
    assert.deepEqual(normalizeTableElement({ ...grid, fills: { r1: { c9: 'blue' } } }).fills, undefined);
    assert.equal('fills' in normalizeTableElement({ ...grid, fills: {} }), false);
  });

  it('reads a cell written as { text, color }', () => {
    const element = normalizeTableElement({ cols: grid.cols, rows: { r1: { at: 1, c1: { text: 'Done', color: 'green' }, c2: { text: 'Late', color: 'purple' } } }, fills: { r1: { c2: '' } } });
    assert.equal(element.rows.r1?.c1, 'Done');
    assert.equal(element.rows.r1?.c2, 'Late');
    assert.deepEqual(element.fills, { r1: { c1: 'green' } }, 'a "" fill clears the cell color');
  });

  it('paints a block color as a soft tint under the usual text', () => {
    assert.deepEqual(tableFillPaint('blue', 'light'), { fill: mixHexColors(BOARD_THEME_COLORS.light.paper, SHAPE_FILL_COLORS.blue, TABLE_FILL_TINT) });
    assert.deepEqual(tableFillPaint('blue', 'dark'), { fill: mixHexColors(BOARD_THEME_COLORS.dark.paper, SHAPE_FILL_COLORS.blue, TABLE_FILL_TINT) });
  });

  it('paints a hex color as written, with text that reads on it', () => {
    assert.deepEqual(tableFillPaint('#102030', 'light'), { fill: '#102030', ink: LIGHT_CONTRAST_TEXT });
    assert.deepEqual(tableFillPaint('#f0f0d0', 'dark'), { fill: '#f0f0d0', ink: DARK_CONTRAST_TEXT });
  });

  it('is checked for colors and cells', () => {
    const findings = checkBoardDocuments(
      new Map<string, Record<string, unknown>>([
        ['board/meta', { v: 1, title: 'Board', order: ['t1'] }],
        ['elements/t1', { type: 'table', x: 0, y: 0, ...grid, fills: { r1: { c1: 'teal', c2: '' }, r9: { c1: 'blue' } } }],
      ]),
    ).map((finding) => finding.message);
    assert.ok(findings.some((message) => message.includes('"teal"') && message.includes('#rrggbb')));
    assert.ok(findings.some((message) => message.includes('r9') && message.includes('does not have')));
    assert.ok(!findings.some((message) => message.includes('c2')), 'a "" fill is a clear, not a mistake');
  });
});

describe('table heat maps', () => {
  it('reads numbers with signs, currency, commas and percents', () => {
    const read = (text: string) => tableCellNumber(text);
    assert.deepEqual(read('1,234.5'), { value: 1234.5, unit: '' });
    assert.deepEqual(read('$1,200'), { value: 1200, unit: '$' });
    assert.deepEqual(read('-€3'), { value: -3, unit: '€' });
    assert.deepEqual(read('£-3'), { value: -3, unit: '£' });
    assert.deepEqual(read('−4.5%'), { value: -4.5, unit: '%' });
    assert.deepEqual(read('+.5'), { value: 0.5, unit: '' });
    assert.deepEqual(read('**42**'), { value: 42, unit: '' });
    assert.deepEqual(read('_`7%`_'), { value: 7, unit: '%' });
    for (const text of ['', 'n/a', '12 apples', '1,23', '¥5', '$5%', '--5', '1.2.3', '**5*']) assert.equal(read(text), undefined, text);
    assert.equal(read('1'.repeat(MAX_TABLE_NUMBER_CHARS)) !== undefined, true);
    assert.equal(read(`${'1'.repeat(MAX_TABLE_NUMBER_CHARS)}1`), undefined);
  });

  it('ranks a column from its smallest to its largest number, header left out', () => {
    const element = table([['Name', 'Score'], ['a', '10'], ['b', 'n/a'], ['c', '30'], ['d', '20']], { heat: { cols: { c2: 'green' } } });
    assert.deepEqual(levelsOf(element), { r2: { c2: 0 }, r4: { c2: 1 }, r5: { c2: 0.5 } });
  });

  it('includes the first row when the table has no header', () => {
    const element = table([['1'], ['3']], { head: false, heat: { cols: { c1: 'blue' } } });
    assert.deepEqual(levelsOf(element), { r1: { c1: 0 }, r2: { c1: 1 } });
  });

  it('shades a row the same way', () => {
    const element = table([['Q1', 'Q2', 'Q3'], ['5', '15', '10']], { heat: { rows: { r2: 'peach' } } });
    assert.deepEqual(levelsOf(element), { r2: { c1: 0, c2: 1, c3: 0.5 } });
  });

  it('puts equal numbers at the middle', () => {
    assert.deepEqual(levelsOf(table([['h'], ['4'], ['4']], { heat: { cols: { c1: 'blue' } } })), { r2: { c1: 0.5 }, r3: { c1: 0.5 } });
  });

  it('ranks each unit on its own and skips a lone unit among several', () => {
    const element = table([['h'], ['$10'], ['$30'], ['5%'], ['7']], { heat: { cols: { c1: 'blue' } } });
    assert.deepEqual(levelsOf(element), { r2: { c1: 0 }, r3: { c1: 1 } });
    assert.deepEqual(levelsOf(table([['h'], ['5%']], { heat: { cols: { c1: 'blue' } } })), { r2: { c1: 0.5 } }, 'one unit alone is still shaded');
  });

  it('shades from faint to strong over the paper, with black or white text', () => {
    const low = tableHeatPaint('blue', 0, 'light');
    const high = tableHeatPaint('blue', 1, 'light');
    assert.equal(low.fill, mixHexColors(BOARD_THEME_COLORS.light.paper, SHAPE_FILL_COLORS.blue, TABLE_HEAT_OPACITY.low));
    assert.equal(high.fill, mixHexColors(BOARD_THEME_COLORS.light.paper, SHAPE_FILL_COLORS.blue, TABLE_HEAT_OPACITY.high));
    assert.deepEqual([TABLE_HEAT_OPACITY.low, TABLE_HEAT_OPACITY.high], [0.08, 0.92]);
    assert.equal(low.ink, DARK_CONTRAST_TEXT);
    assert.equal(tableHeatPaint('#102030', 1, 'light').ink, LIGHT_CONTRAST_TEXT);
    assert.equal(tableHeatPaint('blue', 0, 'dark').ink, LIGHT_CONTRAST_TEXT);
  });

  it('lets a fill win over a heat map', () => {
    const element = table([['h'], ['1'], ['2']], { heat: { cols: { c1: 'blue' } }, fills: { r3: { c1: 'pink' } } });
    const paints = tableCellPaints(element, 'light');
    assert.deepEqual(paints.r3?.c1, tableFillPaint('pink', 'light'));
    assert.deepEqual(paints.r2?.c1, tableHeatPaint('blue', 0, 'light'));
    assert.equal(paints.r1, undefined, 'the header is never shaded');
  });

  it('leaves a fill on the header row unpainted', () => {
    const element = table([['h'], ['1']], { fills: { r1: { c1: 'pink' }, r2: { c1: 'blue' } } });
    assert.deepEqual(Object.keys(tableCellPaints(element, 'light')), ['r2']);
    assert.deepEqual(Object.keys(tableCellPaints({ ...element, head: false }, 'light')).sort(), ['r1', 'r2']);
  });

  it('keeps heat maps of real rows and columns, but not on the header row', () => {
    const fields = { cols: { c1: { at: 1 } }, rows: { r1: { at: 1, c1: 'h' }, r2: { at: 2, c1: '1' } } };
    const element = normalizeTableElement({ ...fields, heat: { cols: { c1: 'blue', c9: 'pink' }, rows: { r1: 'green', r2: 'peach', r3: 'pink' } } });
    assert.deepEqual(element.heat, { cols: { c1: 'blue' }, rows: { r2: 'peach' } });
    assert.deepEqual(normalizeTableElement({ ...fields, head: false, heat: { rows: { r1: 'green' } } }).heat, { rows: { r1: 'green' } });
    assert.equal('heat' in normalizeTableElement({ ...fields, heat: { cols: { c1: '' } } }), false);
    assert.deepEqual(normalizeElement(element), element);
  });

  it('is checked for the header row and for both axes at once', () => {
    const findings = checkBoardDocuments(
      new Map<string, Record<string, unknown>>([
        ['board/meta', { v: 1, title: 'Board', order: ['t1'] }],
        ['elements/t1', { type: 'table', x: 0, y: 0, cols: { c1: { at: 1 } }, rows: { r1: { at: 1, c1: 'h' }, r2: { at: 2, c1: '1' } }, heat: { cols: { c1: 'blue' }, rows: { r1: 'pink', r2: 'green' } } }],
      ]),
    );
    assert.ok(findings.some((finding) => finding.level === 'warning' && finding.message.includes('header row')));
    assert.ok(findings.some((finding) => finding.level === 'info' && finding.message.includes('one axis')));
  });
});

describe('setting a heat map', () => {
  const base = (): TableElement => table([['Name', 'Q1', 'Q2'], ['a', '1', '2'], ['b', '3', '4']], { fills: { r1: { c2: 'green' }, r2: { c2: 'pink', c3: 'blue' }, r3: { c1: 'peach' } } });

  it('on a column, clears the fills it shades (not the header)', () => {
    const next = withTableHeat(base(), 'cols', 'c2', 'purple');
    assert.deepEqual(next.heat, { cols: { c2: 'purple' } });
    assert.deepEqual(next.fills, { r1: { c2: 'green' }, r2: { c3: 'blue' }, r3: { c1: 'peach' } });
  });

  it('on a row, clears that row\'s fills and every column heat map', () => {
    const withColumn = withTableHeat(base(), 'cols', 'c2', 'purple');
    const next = withTableHeat(withColumn, 'rows', 'r2', 'green');
    assert.deepEqual(next.heat, { rows: { r2: 'green' } });
    assert.deepEqual(next.fills, { r1: { c2: 'green' }, r3: { c1: 'peach' } });
    assert.deepEqual(withTableHeat(next, 'cols', 'c3', 'blue').heat, { cols: { c3: 'blue' } }, 'and the other way round');
  });

  it('keeps the other heat maps of the same axis', () => {
    const next = withTableHeat(withTableHeat(base(), 'cols', 'c2', 'purple'), 'cols', 'c3', 'blue');
    assert.deepEqual(next.heat, { cols: { c2: 'purple', c3: 'blue' } });
  });

  it('takes one off with ""', () => {
    const next = withTableHeat(withTableHeat(base(), 'cols', 'c2', 'purple'), 'cols', 'c2', '');
    assert.equal('heat' in next, false);
    assert.deepEqual(next.fills, withTableHeat(base(), 'cols', 'c2', 'purple').fills, 'cleared fills stay cleared');
  });

  it('refuses the header row and unknown lines', () => {
    const start = base();
    assert.equal(withTableHeat(start, 'rows', 'r1', 'blue'), start);
    assert.equal(withTableHeat(start, 'rows', 'r9', 'blue'), start);
    assert.equal(withTableHeat(start, 'cols', 'c9', 'blue'), start);
  });

  it('starts from the table color, or blue on a white table', () => {
    assert.equal(defaultTableHeatColor({ color: 'white' }), 'blue');
    assert.equal(defaultTableHeatColor({ color: '#FFFFFF' }), 'blue');
    assert.equal(defaultTableHeatColor({ color: 'peach' }), 'peach');
    assert.equal(defaultTableHeatColor({ color: '#336699' }), '#336699');
  });
});

describe('tinted rows and columns', () => {
  it('count as tinted with a fill or a heat map', () => {
    const element = table([['a', 'b'], ['1', '2']], { fills: { r2: { c1: 'blue' } }, heat: { cols: { c2: 'green' } } });
    assert.deepEqual([tableRowIsTinted(element, 'r1'), tableRowIsTinted(element, 'r2')], [false, true]);
    assert.deepEqual([tableColumnIsTinted(element, 'c1'), tableColumnIsTinted(element, 'c2')], [true, true]);
  });

  it('are not empty when a step that added them is undone', () => {
    let content: BoardContent = parseBoardContent({ elements: [table([['a'], ['1']])] });
    const doc = { content: () => content, setContent: (next: BoardContent) => void (content = next) };
    const history = createCommandHistory();
    const editor = createTableEditor(doc, history);
    const rowId = editor.addRow('t1', 2)!;
    const columnId = editor.addCol('t1', 1)!;
    const current = findTableElement(content, 't1')!;
    doc.setContent(parseBoardContent({ elements: [{ ...current, fills: { [rowId]: { c1: 'pink' } }, heat: { cols: { [columnId]: 'blue' } } }] }));
    history.undo();
    history.undo();
    const after = findTableElement(content, 't1')!;
    assert.ok(after.rows[rowId] !== undefined, 'the filled row stays');
    assert.ok(after.cols[columnId] !== undefined, 'the heat-mapped column stays');
  });
});

describe('merging table edits', () => {
  it('carries fills and heat maps with the incoming table', () => {
    const current = table([['a', 'b']], { cols: { c1: { at: 1, w: 300 }, c2: { at: 2 } } });
    const incoming = table([['a', 'b']], { fills: { r1: { c1: 'blue' } }, heat: { cols: { c2: 'green' } } });
    const merged = mergeTableEdit(current, incoming, current);
    assert.deepEqual(merged.fills, { r1: { c1: 'blue' } });
    assert.deepEqual(merged.heat, { cols: { c2: 'green' } });
    const cleared = mergeTableEdit(incoming, current, incoming);
    assert.equal('fills' in cleared || 'heat' in cleared, false);
  });
});

describe('table editor tints', () => {
  function setup(extra: Partial<TableElement> = {}) {
    let content: BoardContent = parseBoardContent({ elements: [table([['Name', 'Q1'], ['a', '1'], ['b', '2']], extra)] });
    const doc = { content: () => content, setContent: (next: BoardContent) => void (content = next) };
    const history = createCommandHistory();
    const editor = createTableEditor(doc, history);
    return { doc, history, editor, current: (): TableElement => findTableElement(content, 't1')! };
  }

  it('fills cells as one step and undoes only what is still its own', () => {
    const t = setup();
    assert.equal(t.editor.setFills('t1', [['r2', 'c1', 'blue'], ['r3', 'c1', '#336699']]), true);
    assert.deepEqual(t.current().fills, { r2: { c1: 'blue' }, r3: { c1: '#336699' } });
    // Someone else recolors one of the cells.
    t.doc.setContent(parseBoardContent({ elements: [{ ...t.current(), fills: { r2: { c1: 'pink' }, r3: { c1: '#336699' } } }] }));
    t.history.undo();
    assert.deepEqual(t.current().fills, { r2: { c1: 'pink' } });
    assert.equal(t.editor.setFills('t1', [['r2', 'c1', 'pink']]), false, 'nothing to change');
  });

  it('sets a heat map as one step, clearing and bringing back the fills it covers', () => {
    const t = setup({ fills: { r2: { c2: 'pink' } } });
    assert.equal(t.editor.setHeat('t1', 'cols', 'c2', 'green'), true);
    assert.deepEqual(t.current().heat, { cols: { c2: 'green' } });
    assert.equal(t.current().fills, undefined);
    t.history.undo();
    assert.equal(t.current().heat, undefined);
    assert.deepEqual(t.current().fills, { r2: { c2: 'pink' } });
    t.history.redo();
    assert.deepEqual(t.current().heat, { cols: { c2: 'green' } });
    assert.equal(t.editor.setHeat('t1', 'rows', 'r1', 'blue'), false, 'the header row takes none');
  });

  it('brings back a deleted row with its fills and heat map', () => {
    const t = setup({ fills: { r2: { c1: 'blue' } }, heat: { rows: { r2: 'green' } } });
    assert.equal(t.editor.removeRow('t1', 'r2'), true);
    assert.equal(t.current().rows.r2, undefined);
    t.history.undo();
    assert.deepEqual(t.current().fills, { r2: { c1: 'blue' } });
    assert.deepEqual(t.current().heat, { rows: { r2: 'green' } });
  });

  it('brings back a deleted column with its fills and heat map', () => {
    const t = setup({ fills: { r1: { c2: 'peach' } }, heat: { cols: { c2: 'purple' } } });
    assert.equal(t.editor.removeCol('t1', 'c2'), true);
    t.history.undo();
    assert.deepEqual(t.current().fills, { r1: { c2: 'peach' } });
    assert.deepEqual(t.current().heat, { cols: { c2: 'purple' } });
  });
});
