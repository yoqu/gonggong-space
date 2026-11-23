/**
 * The table a menu was opened on. A row or column command chosen from the
 * menu acts only while that table is still where it was, with the same number
 * of rows and columns: if an edit, an undo or a change to the file reshaped
 * or moved it meanwhile, the command's row and column numbers no longer mean
 * what the menu showed.
 */

import { nodeAt, tableColumns, type NodePath, type Slide, type TableNode } from '@open-artifact/slides-core';

export interface TableTarget {
  slide: string;
  path: NodePath;
  rows: number;
  columns: number;
  /** The cell being typed in, as [row, column]. */
  cell?: readonly [number, number];
}

export function tableTarget(slide: string, path: NodePath, table: TableNode, cell?: readonly [number, number]): TableTarget {
  return { slide, path, rows: table.rows.length, columns: tableColumns(table), cell };
}

/** The table the target names, or null when it is not that table any more. */
export function targetTable(slideId: string | null, slide: Slide | null, target: TableTarget): TableNode | null {
  if (!slide || slideId !== target.slide) return null;
  const node = nodeAt(slide, target.path);
  if (!node || node.kind !== 'table') return null;
  if (node.rows.length !== target.rows || tableColumns(node) !== target.columns) return null;
  if (target.cell && (target.cell[0] >= target.rows || target.cell[1] >= target.columns)) return null;
  return node;
}
