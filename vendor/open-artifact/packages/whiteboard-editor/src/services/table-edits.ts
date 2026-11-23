/**
 * Table edits with undo steps of their own.
 *
 * Board steps never change a table's cells, rows or columns (so undoing a
 * move never takes back someone's typing); table content goes through the
 * table editor sync installs ({@link setTableEditor}), whose steps undo
 * only what they changed.
 *
 * Typing in a cell writes at once without a step; the cell is *pending*
 * until its edit leaves the cell, and then records one step from the text
 * it had when the typing started ({@link flushTableCell}). Anything else
 * done to the table first flushes the pending cell, so steps stay in the
 * order they happened.
 */

import {
  TEXT_CUT_NOTICE,
  exceedsTableCellLimit,
  isElementLocked,
  parseTsvGrid,
  tableCellValue,
  tableColumnIds,
  tableRowIds,
  trimPastedTableCells,
  type ElementId,
  type FillColor,
  type TableAxis,
  type TableEditor,
  type TableElement,
} from '@open-artifact/whiteboard-core';
import { TABLE_TINT_MESSAGES, heatChangeMessage, heatColorFor } from '../lib/table-heat.ts';
import { useBoard } from '../state/board.ts';
import { useSelection } from '../state/selection.ts';
import { useTableHeat } from '../state/table-heat.ts';
import { TABLE_MESSAGES, ensureEditable } from './actions.ts';
import { LOCKED_MESSAGE, announce, notify, refuse } from './announce.ts';

/** Names of the buttons that add a row or a column. */
export const TABLE_ADD_LABELS = { row: 'Add a row', column: 'Add a column' } as const;

/** Read to screen readers while a cell is being edited. */
export const TABLE_EDITOR_HINT = 'Tab and Return move between cells. Shift+F10 opens row and column actions. Escape goes back to the table.';

/** What the table edits say beyond the editor's own refusals. */
export const TABLE_EDIT_MESSAGES = {
  fullTyping: 'This table is full: what you type from here won’t be kept. Put it in another table.',
} as const;

/** The running table editor (set while the live board is up). */
let editor: TableEditor | null = null;

/** Installs (or, with `null`, removes) the table editor. */
export function setTableEditor(next: TableEditor | null): void {
  editor = next;
}

/** The table editor, or `null` before sync started. */
export function tableEditor(): TableEditor | null {
  return editor;
}

/** A cell being typed into whose step is not recorded yet. */
interface PendingCell {
  id: ElementId;
  row: string;
  col: string;
  /** The text before the typing started. */
  from: string;
  /** The latest typed text. */
  text: string;
  /** The latest text the table kept (when typing past its limit was dropped). */
  last?: string;
  /** Whether the person was told the table is full. */
  told?: boolean;
}

let pending: PendingCell | undefined;

/** A cell position. */
export interface CellAt {
  id: ElementId;
  row: string;
  col: string;
}

const sameCell = (a: CellAt, b: CellAt): boolean => a.id === b.id && a.row === b.row && a.col === b.col;

/**
 * Records the pending cell's step. With `only`, records it only when it is
 * that cell (an edit that ended late does not record a newer cell's typing).
 */
export function flushTableCell(only?: CellAt): void {
  const cell = pending;
  if (cell === undefined || (only !== undefined && !sameCell(cell, only))) return;
  pending = undefined;
  editor?.setCell(cell.id, cell.row, cell.col, cell.text, cell.from, cell.last, cell.told);
}

/** Writes typed text into a cell (no step until the edit leaves the cell). */
export function typeTableCell(id: ElementId, row: string, col: string, text: string): void {
  if (editor === null) return;
  if (pending !== undefined && !sameCell(pending, { id, row, col })) flushTableCell();
  if (pending === undefined) {
    const table = useBoard.getState().byId.get(id);
    pending = { id, row, col, from: table?.type === 'table' ? tableCellValue(table, row, col) : '', text };
  }
  pending.text = text;
  if (editor.typeCell(id, row, col, text)) pending.last = text;
  else if (pending.told !== true) {
    pending.told = true;
    refuse(TABLE_EDIT_MESSAGES.fullTyping);
  }
}

/**
 * Pastes tab-separated text into a table from a cell, growing the table as
 * needed, and ends the edit. Returns `false` when the text is not a grid
 * (a plain paste into the cell).
 */
export function pasteTableCells(id: ElementId, row: string, col: string, text: string): boolean {
  const grid = parseTsvGrid(text);
  if (grid === undefined || editor === null) return false;
  flushTableCell();
  const { lists, cut } = trimPastedTableCells(grid);
  if (!editor.fill(id, row, col, lists)) return true;
  if (cut) notify(TEXT_CUT_NOTICE);
  useSelection.getState().edit(null);
  return true;
}

/** Adds a row at the bottom or a column at the right end; returns its key. */
export function addTableLine(id: ElementId, line: 'row' | 'column'): string | undefined {
  const table = useBoard.getState().byId.get(id);
  if (editor === null || table?.type !== 'table') return undefined;
  flushTableCell();
  const rows = tableRowIds(table).length;
  const cols = tableColumnIds(table).length;
  if (line === 'row' ? exceedsTableCellLimit(rows + 1, cols) : exceedsTableCellLimit(rows, cols + 1)) {
    refuse(TABLE_MESSAGES.full);
    return undefined;
  }
  const key = line === 'row' ? editor.addRow(id, rows) : editor.addCol(id, cols);
  if (key !== undefined) announce(TABLE_MESSAGES.added(line));
  return key;
}

/** The table `id` and the editor when the viewer may change its colors (refusing, with the reason, otherwise). */
function tintableTable(id: ElementId): { table: TableElement; tables: TableEditor } | undefined {
  if (!ensureEditable()) return undefined;
  const table = useBoard.getState().byId.get(id);
  if (table?.type !== 'table' || editor === null) return undefined;
  if (isElementLocked(table)) return void refuse(LOCKED_MESSAGE);
  flushTableCell();
  return { table, tables: editor };
}

/** Sets the fill of table cells (`""` clears it) as one step. */
export function setTableCellFill(id: ElementId, cells: readonly { row: string; col: string }[], color: FillColor | ''): boolean {
  const target = tintableTable(id);
  if (target === undefined) return false;
  const changed = target.tables.setFills(
    id,
    cells.map(({ row, col }) => [row, col, color] as const),
  );
  if (changed) announce(color === '' ? TABLE_TINT_MESSAGES.fillRemoved : TABLE_TINT_MESSAGES.fill);
  return changed;
}

/**
 * Sets the heat map of one column or row (`""` takes it off) as one step;
 * turning one on takes the other axis's heat maps off and clears the
 * fills of the cells it shades.
 */
export function setTableLineHeat(id: ElementId, axis: TableAxis, line: string, color: FillColor | ''): boolean {
  const target = tintableTable(id);
  if (target === undefined) return false;
  const changed = target.tables.setHeat(id, axis, line, color);
  if (changed) announce(heatChangeMessage(target.table.heat, axis, line, color));
  return changed;
}

/** Turns the heat map of one column or row on (in the color it would take) or off. */
export function toggleTableLineHeat(id: ElementId, axis: TableAxis, line: string): boolean {
  const table = useBoard.getState().byId.get(id);
  if (table?.type !== 'table') return false;
  const on = table.heat?.[axis]?.[line] !== undefined;
  return setTableLineHeat(id, axis, line, on ? '' : heatColorFor(table, axis, line, useTableHeat.getState().lastPicked));
}

/** Sets a heat map's color, remembering it for the next heat map turned on. */
export function pickTableHeatColor(id: ElementId, axis: TableAxis, line: string, color: FillColor): boolean {
  useTableHeat.getState().remember(color);
  return setTableLineHeat(id, axis, line, color);
}
