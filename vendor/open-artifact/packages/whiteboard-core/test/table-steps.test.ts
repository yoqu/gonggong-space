import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TABLE_STEP_MESSAGES, createCommandHistory, createTableEditor, findTableElement } from '../src/history.ts';
import { parseBoardContent } from '../src/normalize.ts';
import type { BoardContent, TableElement } from '../src/schema.ts';
import { TABLE_LIMITS, tableCellGrid, tableColumnIds, tableFromGrid, tableRowIds } from '../src/table.ts';

const table = (grid: string[][]): TableElement => ({ type: 'table', id: 't1', x: 0, y: 0, head: true, color: 'white', ...tableFromGrid(grid) });

/** A table editor over an in-memory board with one table. */
function setup(grid: string[][]) {
  let content: BoardContent = parseBoardContent({ elements: [table(grid)] });
  const doc = {
    content: () => content,
    setContent(next: BoardContent) {
      content = next;
    },
  };
  const history = createCommandHistory();
  const refused: string[] = [];
  const edits: string[] = [];
  const editor = createTableEditor(doc, history, { onRefused: (message) => refused.push(message), onEdit: (label) => edits.push(label) });
  const current = (): TableElement => findTableElement(content, 't1')!;
  return { doc, history, editor, refused, edits, current, grid: () => tableCellGrid(current()), rows: () => tableRowIds(current()), cols: () => tableColumnIds(current()) };
}

describe('table editor', () => {
  it('records a cell edit from the text it had when the edit started', () => {
    const t = setup([['A', 'B'], ['1', '2']]);
    const [r1] = t.rows();
    const [c1] = t.cols();
    t.editor.typeCell('t1', r1!, c1!, 'Al');
    t.editor.typeCell('t1', r1!, c1!, 'Alpha');
    assert.equal(t.history.canUndo(), false, 'typing records no step');
    assert.equal(t.editor.setCell('t1', r1!, c1!, 'Alpha', 'A'), true, 'the edit changed the cell from where it started');
    assert.deepEqual(t.edits, ['Edit cell']);
    t.history.undo();
    assert.equal(t.grid()[0]![0], 'A');
    t.history.redo();
    assert.equal(t.grid()[0]![0], 'Alpha');
  });

  it('keeps a later edit of the same cell on undo', () => {
    const t = setup([['A', 'B']]);
    const [r1] = t.rows();
    const [c1] = t.cols();
    t.editor.setCell('t1', r1!, c1!, 'mine');
    t.editor.typeCell('t1', r1!, c1!, 'theirs');
    t.history.undo();
    assert.equal(t.grid()[0]![0], 'theirs');
  });

  it('adds a row and takes it back while it is empty', () => {
    const t = setup([['A', 'B'], ['1', '2']]);
    const key = t.editor.addRow('t1', 2);
    assert.ok(key);
    assert.equal(t.rows().at(-1), key);
    t.history.undo();
    assert.equal(t.rows().length, 2);
    t.history.redo();
    assert.equal(t.rows().length, 3);
    t.editor.typeCell('t1', key!, t.cols()[0]!, 'kept');
    t.history.undo();
    assert.equal(t.rows().length, 3, 'a filled row stays');
  });

  it('inserts a column at an index', () => {
    const t = setup([['A', 'B']]);
    const key = t.editor.addCol('t1', 1);
    assert.equal(t.cols()[1], key);
    assert.deepEqual(t.grid(), [['A', '', 'B']]);
  });

  it('brings a deleted row back at its place with its cells', () => {
    const t = setup([['A', 'B'], ['1', '2'], ['3', '4']]);
    const middle = t.rows()[1]!;
    assert.equal(t.editor.removeRow('t1', middle), true);
    assert.deepEqual(t.grid(), [['A', 'B'], ['3', '4']]);
    t.history.undo();
    assert.deepEqual(t.grid(), [['A', 'B'], ['1', '2'], ['3', '4']]);
  });

  it('brings a deleted column back with its cells', () => {
    const t = setup([['A', 'B', 'C'], ['1', '2', '3']]);
    t.editor.removeCol('t1', t.cols()[0]!);
    assert.deepEqual(t.grid(), [['B', 'C'], ['2', '3']]);
    t.history.undo();
    assert.deepEqual(t.grid(), [['A', 'B', 'C'], ['1', '2', '3']]);
  });

  it('records a column width once the drag ends', () => {
    const t = setup([['A', 'B']]);
    const col = t.cols()[0]!;
    const start = 200;
    t.editor.colWidth('t1', col, start, start);
    t.history.clear();
    t.editor.colWidth('t1', col, 260);
    t.editor.colWidth('t1', col, 300);
    assert.equal(t.history.canUndo(), false, 'a live drag records nothing');
    t.editor.colWidth('t1', col, 320, start);
    assert.equal(t.current().cols[col]!.w, 320);
    t.history.undo();
    assert.equal(t.current().cols[col]!.w, start);
  });

  it('pastes a grid that grows the table and undoes it', () => {
    const t = setup([['A', 'B'], ['1', '2']]);
    const [, r2] = t.rows();
    const [, c2] = t.cols();
    assert.equal(
      t.editor.fill('t1', r2!, c2!, [
        ['x', 'y'],
        ['z', 'w'],
      ]),
      true,
    );
    assert.deepEqual(t.grid(), [
      ['A', 'B', ''],
      ['1', 'x', 'y'],
      ['', 'z', 'w'],
    ]);
    t.history.undo();
    assert.deepEqual(t.grid(), [
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('refuses a paste past the cell limit and says why', () => {
    const t = setup([['A']]);
    const [r1] = t.rows();
    const [c1] = t.cols();
    const wide = [Array.from({ length: TABLE_LIMITS.cells + 1 }, () => 'x')];
    assert.equal(t.editor.fill('t1', r1!, c1!, wide), false);
    assert.deepEqual(t.refused, [TABLE_STEP_MESSAGES.most]);
    assert.deepEqual(t.grid(), [['A']]);
  });
});
