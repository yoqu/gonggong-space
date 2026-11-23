/**
 * The text editor's host: what happens around an edit, beyond the typing
 * the in-place editor does itself.
 *
 * - Table cells hand their grid keys here. Tab and Shift+Tab step through
 *   the cells row by row (past the last cell a new row is added), Return
 *   moves down a row (or ends the edit on the last one), Escape ends the
 *   edit, and the Menu key ends it and opens the row and column menu at
 *   the cell.
 * - Mod+Return in a note, shape or text ends the edit and starts a next one
 *   of the same kind: a note or shape to the right (past anything in the
 *   way), a text below.
 * - Tab in a single-line field (a title, an arrow label) ends the edit and
 *   moves to the next item in reading order (Shift+Tab: the previous one).
 * - A free text left blank is removed when its edit ends (one with a
 *   placeholder is kept, empty).
 */

import {
  elementBounds,
  isElementLocked,
  nextNoteBeside,
  nextShapeBeside,
  nextTextBelow,
  orderElementsForReading,
  placeNextItemBeside,
  removeElements,
  showsTextPlaceholder,
  tableColumnIds,
  tableRowIds,
  type BoardElement,
  type ElementId,
  type NoteElement,
  type ShapeElement,
  type TextElement,
} from '@open-artifact/whiteboard-core';
import { setTextEditHost } from '../elements/edit.ts';
import { editCoalesceKey } from '../elements/TextEditor.tsx';
import { useBoard } from '../state/board.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection, type TextEditTarget } from '../state/selection.ts';
import { placeElement, randomNoteTilt } from '../tools/place.ts';
import { openContextMenuAt } from '../ui/ContextMenu.tsx';
import { boardElements, canEditBoard, editContent, patchElements, runTableCellCommand, viewerAuthor } from './actions.ts';
import { announce, emptyBlockRemovedMessage } from './announce.ts';
import { focusItem } from './keyboard.ts';
import { finishTextPush } from './text-push.ts';

/** A table cell being edited. */
type CellTarget = Extract<TextEditTarget, { kind: 'cell' }>;

/* ------------------------------------------------------------------------ */
/* Table cells                                                              */
/* ------------------------------------------------------------------------ */

/** Moves the edit to another cell of the same table. */
function editCell(target: CellTarget, row: string, col: string): void {
  useSelection.getState().edit({ kind: 'cell', id: target.id, row, col });
}

/**
 * Tab (`step` 1) or Shift+Tab (`step` -1): the next or previous cell in
 * row order. Past the last cell a row is added below (unless the table is
 * full), and its first cell is edited. Before the first cell nothing
 * happens.
 */
function stepCell(target: CellTarget, step: 1 | -1): void {
  const table = useBoard.getState().byId.get(target.id);
  if (table?.type !== 'table') return;
  const rows = tableRowIds(table);
  const cols = tableColumnIds(table);
  const index = rows.indexOf(target.row) * cols.length + cols.indexOf(target.col) + step;
  if (index < 0) return;
  if (index < rows.length * cols.length) {
    editCell(target, rows[Math.floor(index / cols.length)]!, cols[index % cols.length]!);
    return;
  }
  const lastRow = rows.at(-1);
  const firstCol = cols[0];
  if (lastRow === undefined || firstCol === undefined) return;
  // Refuses (and says why) when the table is full or the board read-only.
  if (!runTableCellCommand(target.id, { row: lastRow, col: target.col }, 'row-below')) return;
  const grown = useBoard.getState().byId.get(target.id);
  if (grown?.type !== 'table') return;
  const added = tableRowIds(grown).find((row) => !rows.includes(row));
  if (added !== undefined) editCell(target, added, firstCol);
}

/** The on-screen box of a table cell, when it is drawn. */
function cellRect(target: CellTarget): DOMRect | undefined {
  const table = document.querySelector(`[data-wb-id="${CSS.escape(target.id)}"]`);
  const cell = table?.querySelector(`[data-wb-row="${CSS.escape(target.row)}"][data-wb-col="${CSS.escape(target.col)}"]`);
  return cell?.getBoundingClientRect();
}

/** A key a table cell hands to its grid; `false` lets the editor end the edit. */
function cellKey(target: CellTarget, chord: string): boolean {
  switch (chord) {
    case 'Tab':
    case 'Shift+Tab':
      stepCell(target, chord === 'Tab' ? 1 : -1);
      return true;
    case 'Return':
    case 'Mod+Return': {
      const table = useBoard.getState().byId.get(target.id);
      if (table?.type !== 'table') return false;
      const rows = tableRowIds(table);
      const below = rows[rows.indexOf(target.row) + 1];
      if (below === undefined) return false;
      editCell(target, below, target.col);
      return true;
    }
    case 'Menu': {
      const rect = cellRect(target);
      const cell = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      useSelection.getState().edit(null);
      if (rect) openContextMenuAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, cell);
      return true;
    }
    default:
      // Escape and anything else end the edit.
      return false;
  }
}

/* ------------------------------------------------------------------------ */
/* Next item (Mod+Return)                                                   */
/* ------------------------------------------------------------------------ */

/** The next item after `source`: a note or shape beside it, a text below it. */
function nextItemAfter(source: NoteElement | ShapeElement | TextElement): BoardElement {
  const elements = boardElements();
  switch (source.type) {
    case 'note':
      return placeNextItemBeside(source, nextNoteBeside(source, viewerAuthor(), randomNoteTilt()), elements, currentMeasures());
    case 'shape':
      return placeNextItemBeside(source, nextShapeBeside(source), elements, currentMeasures());
    case 'text': {
      const box = elementBounds(source, currentMeasures());
      return nextTextBelow(source, box ? box.y + box.h : source.y);
    }
  }
}

/** Mod+Return: ends the edit and starts typing into a next item of the same kind. */
function nextItem(target: TextEditTarget): boolean {
  if (target.kind !== 'element') return false;
  const source = useBoard.getState().byId.get(target.id);
  if (source?.type !== 'note' && source?.type !== 'shape' && source?.type !== 'text') return false;
  // A blank text only ends (and goes away); a read-only board only ends the edit.
  if ((source.type === 'text' && source.text.trim() === '') || !canEditBoard()) return false;
  useSelection.getState().edit(null);
  placeElement(nextItemAfter(source), { label: `Add ${source.type}`, keepTool: true });
  return true;
}

/* ------------------------------------------------------------------------ */
/* Single-line fields (Tab)                                                 */
/* ------------------------------------------------------------------------ */

/** Tab in a title or label: ends the edit and moves to the next item in reading order (wrapping). */
function stepField(target: TextEditTarget, backwards: boolean): boolean {
  const order = orderElementsForReading(boardElements(), currentMeasures()).map((element) => element.id);
  const at = order.indexOf(target.id);
  if (order.length === 0 || at < 0) return false;
  const next = order[(at + (backwards ? -1 : 1) + order.length) % order.length]!;
  useSelection.getState().edit(null);
  focusItem(next);
  return true;
}

/* ------------------------------------------------------------------------ */
/* End of an edit                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A free text left blank goes away when its edit ends, unless it has a
 * placeholder (it is then saved empty). The removal merges into the edit's
 * own undo step when it follows the typing at once, so a single undo brings
 * the text back as it was; items the typing pushed down go back first.
 */
function removeIfBlank(target: TextEditTarget): void {
  if (target.kind !== 'element') return;
  const element = useBoard.getState().byId.get(target.id);
  if (!canEditBoard() || element?.type !== 'text' || element.text.trim() !== '' || isElementLocked(element)) {
    finishTextPush(target.id, true);
    return;
  }
  if (showsTextPlaceholder(element)) {
    finishTextPush(element.id, true);
    if (element.text !== '') patchElements([element.id], (next) => (next.type === 'text' ? { ...next, text: '' } : next), { label: 'Edit text', coalesce: editCoalesceKey(element.id) });
    return;
  }
  finishTextPush(element.id, false);
  const ids = new Set<ElementId>([element.id]);
  const removed = editContent((content) => removeElements(content, ids), { label: 'Remove empty', coalesce: editCoalesceKey(element.id) });
  if (!removed) return;
  useSelection.getState().prune((id) => id !== element.id);
  announce(emptyBlockRemovedMessage(element.type));
}

/* ------------------------------------------------------------------------ */
/* Install                                                                  */
/* ------------------------------------------------------------------------ */

/** Installs the board's text editor host; returns a function that removes it. */
export function installTextEditHost(): () => void {
  return setTextEditHost({
    cell: cellKey,
    next: nextItem,
    step: stepField,
    ended: removeIfBlank,
  });
}
