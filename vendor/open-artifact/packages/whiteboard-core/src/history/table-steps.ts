/**
 * Table edits as undo steps.
 *
 * Board steps never change a table's cells or rows: when a board step is
 * replayed, a table keeps the cells the document holds (see
 * `mergeTableEdit`), so undoing a move or a restyle never takes back
 * someone's typing. Table content therefore records steps of its own here,
 * and each undoes and redoes only what it changed:
 *
 * - a cell edit sets the cell back only where it still holds the text the
 *   edit left (so another person's later edit of that cell stays);
 * - an added row or column goes away on undo only while it is still empty;
 * - a deleted row or column comes back at its place, refilling only cells
 *   nobody has filled since;
 * - pasted cells go back cell by cell, and rows and columns the paste added
 *   go away while empty.
 *
 * Typing itself writes without a step ({@link TableEditor.typeCell}); the
 * cell's step is recorded once the edit leaves the cell
 * ({@link TableEditor.setCell}).
 */

import { tableContentBytes } from '../edits.ts';
import { canonicalValuesEqual } from '../json.ts';
import type { BoardContent, ElementId, FillColor, TableElement } from '../schema.ts';
import { setTableFillsWhereUnchanged, setTableHeatWhereUnchanged, tableCellFill, tableFillSwaps, withTableHeat } from '../table-tints.ts';
import {
  COLUMN_WIDTH_LIMITS,
  TABLE_LIMITS,
  addTableColumns,
  addTableRows,
  columnWidth,
  exceedsTableCellLimit,
  freshTableKey,
  hasTableCell,
  pinColumnWidths,
  removeTableColumn,
  removeTableRow,
  resizeColumn,
  setTableAxisOrder,
  setTableCell,
  setTableCells,
  tableCellValue,
  tableColumnIds,
  tableColumnIsTinted,
  tableInsertPosition,
  tableRowIds,
  tableRowIsTinted,
  widenColumnToFit,
  type TableAxis,
} from '../table.ts';
import type { StepDocument, StepHistory } from './board-steps.ts';
import { normalizeBoardContent } from './content.ts';

/** What the table editor says when it refuses a change. */
export const TABLE_STEP_MESSAGES = {
  tooBig: 'That is more than one table can hold. Split it into two tables.',
  tooBigPaste: 'That is more than one table can hold, so nothing was pasted. Paste it in parts, as several tables.',
  most: `A table holds at most ${TABLE_LIMITS.cells.toLocaleString('en-US')} cells, so nothing was pasted. Paste it in parts, as several tables.`,
} as const;

/** A change to one table. */
type TableChange = (table: TableElement) => TableElement;

/** One cell's text before and after: `[row, column, expected, value]`. */
export type TableCellSwap = readonly [rowId: string, columnId: string, expected: string, value: string];

/** One cell's text: `[row, column, value]`. */
type TableCellFill = readonly [rowId: string, columnId: string, value: string];

/** The table `id` in `content`, when there is one. */
export function findTableElement(content: BoardContent, id: ElementId): TableElement | undefined {
  const element = content.elements.find((item) => item.id === id);
  return element?.type === 'table' ? element : undefined;
}

/** Sets each cell to its value, but only where it still holds the expected text. */
export function setCellsWhereUnchanged(edits: readonly TableCellSwap[]): TableChange {
  return (table) => setTableCells(table, edits.flatMap(([row, col, expected, value]) => (tableCellValue(table, row, col) === expected ? [[row, col, value] as const] : [])));
}

/** Removes the rows `rowIds` that are empty (no text, fill or heat map). */
export function dropEmptyTableRows(rowIds: readonly string[]): TableChange {
  return (start) =>
    rowIds.reduce(
      (table, rowId) =>
        !tableRowIsTinted(table, rowId) && tableColumnIds(table).every((colId) => tableCellValue(table, rowId, colId) === '') ? removeTableRow(table, rowId) : table,
      start,
    );
}

/** Removes the columns `colIds` that are empty (no text, fill or heat map). */
export function dropEmptyTableColumns(colIds: readonly string[]): TableChange {
  return (start) =>
    colIds.reduce(
      (table, colId) =>
        !tableColumnIsTinted(table, colId) && tableRowIds(table).every((rowId) => tableCellValue(table, rowId, colId) === '') ? removeTableColumn(table, colId) : table,
      start,
    );
}

/** Fills cells that are empty now. */
function fillEmptyCells(cells: readonly TableCellFill[]): TableChange {
  return setCellsWhereUnchanged(cells.map(([row, col, value]) => [row, col, '', value] as const));
}

/**
 * Replaces the table `id` in the document with `change(table)`. Auto-width
 * columns are pinned first (so a change never makes the others jump),
 * unless that alone would pass the size limit. Refuses (saying `refusal`
 * when given) a change that makes the table too big or that normalizing
 * would cut. Returns whether the document changed.
 */
export function replaceTableElement(
  doc: StepDocument,
  id: ElementId,
  change: TableChange,
  refusal: string | null = TABLE_STEP_MESSAGES.tooBig,
  onRefused?: (message: string) => void,
): boolean {
  const refuse = (): boolean => {
    if (refusal !== null) onRefused?.(refusal);
    return false;
  };
  const content = doc.content();
  const table = findTableElement(content, id);
  if (table === undefined) return false;
  const pinnedTable = pinColumnWidths(table);
  const pinned = tableContentBytes(pinnedTable) <= TABLE_LIMITS.bytes ? pinnedTable : table;
  const next = change(pinned);
  if (next === pinned) return false;
  const nextBytes = tableContentBytes(next);
  if (nextBytes > TABLE_LIMITS.bytes && nextBytes > tableContentBytes(pinned)) return refuse();
  const nextContent = normalizeBoardContent({ ...content, elements: content.elements.map((element) => (element === table ? next : element)) });
  const normalized = findTableElement(nextContent, id);
  if (normalized === undefined || tableRowIds(normalized).length < tableRowIds(next).length || tableColumnIds(normalized).length < tableColumnIds(next).length) return refuse();
  doc.setContent(nextContent);
  return true;
}

/** Brings back the fills and heat map a deleted row or column had, where nothing took their place. */
function bringBackTints(table: TableElement, axis: TableAxis, line: string): TableChange {
  const color = table.heat?.[axis]?.[line];
  const lineFills = Object.entries(table.fills ?? {}).flatMap(([rowId, cells]) =>
    axis === 'rows' ? (rowId === line ? [[rowId, cells] as const] : []) : cells[line] !== undefined ? [[rowId, { [line]: cells[line] }] as const] : [],
  );
  const swaps = tableFillSwaps({}, { fills: Object.fromEntries(lineFills) });
  return (current) => setTableFillsWhereUnchanged(color !== undefined && current.heat?.[axis]?.[line] === undefined ? withTableHeat(current, axis, line, color) : current, swaps);
}

/** Options of {@link createTableEditor}. */
export interface TableEditorOptions {
  /** Told why a change was refused (a toast, an announcement). */
  onRefused?: (message: string) => void;
  /** Called after each recorded step with its label and the table. */
  onEdit?: (label: string, id: ElementId) => void;
}

/** Table edits that record their own undo steps. */
export interface TableEditor {
  /** Whether the table `id` has the cell. */
  has(id: ElementId, row: string, col: string): boolean;
  /**
   * Writes typed text into a cell without a step (the step comes from
   * {@link setCell} when the edit leaves the cell). Returns `false` when
   * the text could not be kept (the table is full).
   */
  typeCell(id: ElementId, row: string, col: string, text: string): boolean;
  /**
   * Sets a cell and records the step from `before` (the text when the edit
   * started; the cell's current text by default). `alternate` also counts
   * as the edit's own result (a normalized form of `text`). `quiet` says
   * nothing on refusal. Returns whether the cell now holds `text`.
   */
  setCell(id: ElementId, row: string, col: string, text: string, before?: string, alternate?: string, quiet?: boolean): boolean;
  /** Adds an empty row at `index`; returns its key, or `undefined` when refused. */
  addRow(id: ElementId, index: number): string | undefined;
  /** Adds an empty column at `index`; returns its key, or `undefined` when refused. */
  addCol(id: ElementId, index: number): string | undefined;
  /** Deletes a row (undo brings it back with its cells). */
  removeRow(id: ElementId, rowId: string): boolean;
  /** Deletes a column (undo brings it back with its cells and width). */
  removeCol(id: ElementId, colId: string): boolean;
  /**
   * Sets a column's width. During a drag pass only `width` (and `settled`,
   * the width the drag started from, so the column never narrows below its
   * words); at the end pass `target` (the width it started from) as well,
   * which records the step.
   */
  colWidth(id: ElementId, col: string, width: number, target?: number, settled?: number): boolean;
  /**
   * Pastes a grid of cell text with its top-left at a cell, adding the rows
   * and columns it needs. Refuses (saying why) when the table would grow
   * past its limits.
   */
  fill(id: ElementId, row: string, col: string, grid: readonly (readonly string[])[]): boolean;
  /** Sets cells' fills (`""` clears one) as one step. */
  setFills(id: ElementId, cells: readonly (readonly [row: string, col: string, color: FillColor | ''])[]): boolean;
  /** Sets a heat map on a column or row (`""` takes it off) as one step; see {@link withTableHeat}. */
  setHeat(id: ElementId, axis: TableAxis, line: string, color: FillColor | ''): boolean;
}

/** Creates a table editor over a document and a history. */
export function createTableEditor(doc: StepDocument, history: StepHistory, options: TableEditorOptions = {}): TableEditor {
  const { onRefused, onEdit } = options;
  const replace = (id: ElementId, change: TableChange, refusal?: string | null): boolean => replaceTableElement(doc, id, change, refusal, onRefused);
  const tableOf = (id: ElementId): TableElement | undefined => findTableElement(doc.content(), id);
  const seedUndo = (id: ElementId, label: string, redo: TableChange, undo: TableChange): void => {
    history.seed({ label, do: () => void replace(id, redo), undo: () => void replace(id, undo) });
    onEdit?.(label, id);
  };
  const applyAndSeed = (id: ElementId, label: string, redo: TableChange, undo: TableChange, refusal?: string): boolean => {
    if (!replace(id, redo, refusal)) return false;
    seedUndo(id, label, redo, undo);
    return true;
  };
  /** Records the step from `table` to `next` in fills and heat maps, changing only what is still as it was. */
  const seedTints = (id: ElementId, label: string, table: TableElement, next: TableElement): boolean => {
    const swaps = tableFillSwaps(table, next);
    const back = swaps.map(([row, col, from, to]) => [row, col, to, from] as const);
    return applyAndSeed(
      id,
      label,
      (current) => setTableFillsWhereUnchanged(setTableHeatWhereUnchanged(current, table.heat, next.heat), swaps),
      (current) => setTableFillsWhereUnchanged(setTableHeatWhereUnchanged(current, next.heat, table.heat), back),
    );
  };
  /** Makes room for a new row or column at `index` (renumbering when needed); returns its order key. */
  const insertAt = (id: ElementId, axis: TableAxis, index: number): number | undefined => {
    const table = tableOf(id);
    if (table === undefined) return undefined;
    const placed = tableInsertPosition(table, axis, index);
    if (placed.table !== table) replace(id, (current) => tableInsertPosition(current, axis, index).table);
    return placed.at;
  };
  /** Gives a row or column without an order key one (so its place can be restored). */
  const ensurePlaced = (id: ElementId, axis: TableAxis, key: string): TableElement | undefined => {
    const table = tableOf(id);
    const entry = table?.[axis][key];
    if (table !== undefined && entry !== undefined && typeof entry.at !== 'number') {
      insertAt(id, axis, (axis === 'rows' ? tableRowIds(table) : tableColumnIds(table)).indexOf(key));
    }
    return tableOf(id);
  };

  return {
    has(id, row, col) {
      const table = tableOf(id);
      return table !== undefined && hasTableCell(table, row, col);
    },

    typeCell(id, row, col, text) {
      if (replace(id, (table) => setTableCell(table, row, col, text), null)) return true;
      const table = tableOf(id);
      return table === undefined || !hasTableCell(table, row, col) || tableCellValue(table, row, col) === text;
    },

    setCell(id, row, col, text, before, alternate, quiet = false) {
      const table = tableOf(id);
      if (table === undefined || !hasTableCell(table, row, col)) return false;
      const previous = before ?? tableCellValue(table, row, col);
      replace(id, (current) => setTableCell(current, row, col, text), quiet ? null : undefined);
      const after = tableOf(id);
      const now = after === undefined ? previous : tableCellValue(after, row, col);
      if (previous !== now && (now === text || now === alternate)) {
        seedUndo(id, 'Edit cell', setCellsWhereUnchanged([[row, col, previous, now]]), setCellsWhereUnchanged([[row, col, now, previous]]));
      }
      return previous !== now && now === text;
    },

    addRow(id, index) {
      const at = insertAt(id, 'rows', index);
      const key = freshTableKey('r', tableOf(id)?.rows ?? {});
      if (at === undefined) return undefined;
      return applyAndSeed(id, 'Add row', (table) => addTableRows(table, [[key, at]]), dropEmptyTableRows([key])) ? key : undefined;
    },

    addCol(id, index) {
      const at = insertAt(id, 'cols', index);
      const key = freshTableKey('c', tableOf(id)?.cols ?? {});
      if (at === undefined) return undefined;
      return applyAndSeed(id, 'Add column', (table) => addTableColumns(table, [[key, at, COLUMN_WIDTH_LIMITS.fresh]]), dropEmptyTableColumns([key])) ? key : undefined;
    },

    removeRow(id, rowId) {
      const table = ensurePlaced(id, 'rows', rowId);
      const at = table?.rows[rowId]?.at;
      if (table === undefined || typeof at !== 'number') return false;
      const cells = tableColumnIds(table).map((colId) => [rowId, colId, tableCellValue(table, rowId, colId)] as const);
      const tints = bringBackTints(table, 'rows', rowId);
      return applyAndSeed(
        id,
        'Delete row',
        (current) => removeTableRow(current, rowId),
        (current) => tints(fillEmptyCells(cells)(setTableAxisOrder(addTableRows(current, [[rowId, at]], true), 'rows', rowId, at))),
      );
    },

    removeCol(id, colId) {
      const table = ensurePlaced(id, 'cols', colId);
      const at = table?.cols[colId]?.at;
      const width = table && columnWidth(table, colId);
      if (table === undefined || typeof at !== 'number' || width === undefined) return false;
      const cells = tableRowIds(table).map((rowId) => [rowId, colId, tableCellValue(table, rowId, colId)] as const);
      const tints = bringBackTints(table, 'cols', colId);
      return applyAndSeed(
        id,
        'Delete column',
        (current) => removeTableColumn(current, colId),
        (current) => tints(fillEmptyCells(cells)(addTableColumns(current, [[colId, at, width]], true))),
      );
    },

    colWidth(id, col, width, target, settled = target) {
      const changed = replace(id, (table) => widenColumnToFit(table, col, width, settled));
      if (target === undefined) return changed;
      const table = tableOf(id);
      const reached = table && columnWidth(table, col);
      if (reached === undefined || reached === target) return false;
      const resizeFrom =
        (from: number, to: number): TableChange =>
        (current) =>
          columnWidth(current, col) === from ? resizeColumn(current, col, to) : current;
      seedUndo(id, 'Column width', resizeFrom(target, reached), resizeFrom(reached, target));
      return true;
    },

    fill(id, row, col, grid) {
      const table = tableOf(id);
      if (table === undefined || !hasTableCell(table, row, col)) return false;
      const rowIndex = tableRowIds(table).indexOf(row);
      const colIndex = tableColumnIds(table).indexOf(col);
      const rowCount = Math.max(tableRowIds(table).length, rowIndex + grid.length);
      const colCount = Math.max(tableColumnIds(table).length, colIndex + grid.reduce((most, line) => Math.max(most, line.length), 0));
      if (exceedsTableCellLimit(rowCount, colCount)) {
        onRefused?.(TABLE_STEP_MESSAGES.most);
        return false;
      }
      const rowsAt = insertAt(id, 'rows', Number.POSITIVE_INFINITY) ?? 0;
      const colsAt = insertAt(id, 'cols', Number.POSITIVE_INFINITY) ?? 0;
      const current = tableOf(id) ?? table;
      const freshKeys = (prefix: 'r' | 'c', count: number, start: number): Array<readonly [string, number]> => {
        const taken: Record<string, unknown> = { ...(prefix === 'r' ? current.rows : current.cols) };
        return Array.from({ length: Math.max(0, count) }, (_unused, offset) => {
          const key = freshTableKey(prefix, taken);
          taken[key] = true;
          return [key, start + offset] as const;
        });
      };
      const newRows = freshKeys('r', rowCount - tableRowIds(current).length, rowsAt);
      const newCols = freshKeys('c', colCount - tableColumnIds(current).length, colsAt);
      const rowIds = [...tableRowIds(current), ...newRows.map(([key]) => key)];
      const colIds = [...tableColumnIds(current), ...newCols.map(([key]) => key)];
      const cells: TableCellSwap[] = grid.flatMap((line, rowOffset) =>
        line.map((value, colOffset) => {
          const rowId = rowIds[rowIndex + rowOffset]!;
          const colId = colIds[colIndex + colOffset]!;
          return [rowId, colId, tableCellValue(current, rowId, colId), value] as const;
        }),
      );
      return applyAndSeed(
        id,
        'Paste cells',
        (target) =>
          setTableCells(
            addTableColumns(
              addTableRows(target, newRows, true),
              newCols.map(([key, at]) => [key, at, COLUMN_WIDTH_LIMITS.fresh] as const),
              true,
            ),
            cells.map(([rowId, colId, , value]) => [rowId, colId, value] as const),
          ),
        (target) =>
          dropEmptyTableColumns(newCols.map(([key]) => key))(
            dropEmptyTableRows(newRows.map(([key]) => key))(setCellsWhereUnchanged(cells.map(([rowId, colId, before, after]) => [rowId, colId, after, before] as const))(target)),
          ),
        TABLE_STEP_MESSAGES.tooBigPaste,
      );
    },

    setFills(id, cells) {
      const table = tableOf(id);
      if (table === undefined) return false;
      const next = setTableFillsWhereUnchanged(table, cells.map(([row, col, color]) => [row, col, tableCellFill(table, row, col), color] as const));
      return next !== table && seedTints(id, 'Fill cells', table, next);
    },

    setHeat(id, axis, line, color) {
      const table = tableOf(id);
      if (table === undefined) return false;
      const next = withTableHeat(table, axis, line, color);
      return next !== table && !canonicalValuesEqual(next, table) && seedTints(id, 'Heat map', table, next);
    },
  };
}
