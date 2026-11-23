/**
 * A table's chrome on the board: a resize edge on the right of each column
 * and buttons that add a row (below) or a column (on the right). They show
 * while the table can be changed and is the one thing selected or being
 * edited, and keep their screen size at any zoom (`--wb-ts` is 1 / zoom).
 */

import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { IconButton } from '@open-artifact/ui';
import { columnWidth, exceedsTableCellLimit, isElementLocked, tableColumnIds, tableRowIds, type ElementId, type TableElement } from '@open-artifact/whiteboard-core';
import { TABLE_MESSAGES, canEditBoard } from '../services/actions.ts';
import { TABLE_ADD_LABELS, addTableLine, flushTableCell, tableEditor } from '../services/table-edits.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';

/** Gap between the table and its add buttons, screen pixels. */
export const TABLE_ADD_BUTTON_GAP = 20;

/**
 * The scale of the table's controls (1 / zoom), or `undefined` when they
 * are hidden: the board is read-only or the table locked, another tool or
 * comment mode is on, or the table is neither being edited nor the one
 * thing selected.
 */
export function useTableControls(element: TableElement): number | undefined {
  const zoom = useCamera((state) => state.camera.zoom);
  const shown = useSelection((state) => (state.editing === null ? state.ids.length === 1 && state.ids[0] === element.id : state.editing.kind === 'cell' && state.editing.id === element.id));
  const tool = useTool((state) => (state.commentMode || state.handOverride ? 'other' : state.tool));
  if (!shown || tool !== 'select' || !canEditBoard() || isElementLocked(element)) return undefined;
  return 1 / zoom;
}

/** A column-width drag in progress. */
interface ColumnDrag {
  col: string;
  /** The width when the drag started. */
  from: number;
  /** Pointer x when the drag started, screen pixels. */
  x: number;
  /** The width asked for now. */
  w: number;
}

/** The controls of one table; `scale` is from {@link useTableControls}. */
export function TableControls({ element, scale }: { element: TableElement; scale: number }) {
  const id: ElementId = element.id;
  const rows = tableRowIds(element);
  const cols = tableColumnIds(element);
  const drag = useRef<ColumnDrag | undefined>(undefined);

  const edges: number[] = [];
  let right = 0;
  for (const col of cols) {
    right += columnWidth(element, col);
    edges.push(right);
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    drag.current = undefined;
    delete event.currentTarget.dataset.held;
    if (current !== undefined) tableEditor()?.colWidth(id, current.col, current.w, current.from);
  };

  const edgeHandlers = (col: string) => ({
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      flushTableCell();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.held = '';
      const width = columnWidth(element, col);
      drag.current = { col, from: width, x: event.clientX, w: width };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (current === undefined) return;
      if (event.buttons === 0) return endDrag(event);
      current.w = current.from + (event.clientX - current.x) * scale;
      tableEditor()?.colWidth(id, current.col, current.w, undefined, current.from);
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
  });

  const rowsFull = exceedsTableCellLimit(rows.length + 1, cols.length);
  const colsFull = exceedsTableCellLimit(rows.length, cols.length + 1);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

  return (
    <div
      className="wb-table-controls"
      data-wb-chrome=""
      style={{ '--wb-ts': String(scale), '--wb-table-gap': `${TABLE_ADD_BUTTON_GAP}px` } as CSSProperties}
      onPointerDown={stop}
      onMouseDown={(event) => event.preventDefault()}
      onDoubleClick={stop}
    >
      {cols.map((col, index) => (
        <div
          key={col}
          className={index === cols.length - 1 ? 'wb-table-edge wb-table-edge-last' : 'wb-table-edge'}
          aria-hidden="true"
          style={{ left: edges[index] }}
          {...edgeHandlers(col)}
        />
      ))}
      <IconButton
        size="sm"
        className="wb-table-add wb-table-add-col"
        label={colsFull ? TABLE_MESSAGES.full : TABLE_ADD_LABELS.column}
        icon={<Plus size={14} />}
        tabIndex={-1}
        disabled={colsFull}
        onClick={() => addTableLine(id, 'column')}
      />
      <IconButton
        size="sm"
        className="wb-table-add wb-table-add-row"
        label={rowsFull ? TABLE_MESSAGES.full : TABLE_ADD_LABELS.row}
        icon={<Plus size={14} />}
        tabIndex={-1}
        disabled={rowsFull}
        onClick={() => addTableLine(id, 'row')}
      />
    </div>
  );
}
