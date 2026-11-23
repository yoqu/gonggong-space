/**
 * Table cell colors and heat maps as the page offers them: the color a new
 * heat map takes, what is said after each change, and the small ramp a heat
 * map toggle shows.
 */

import { defaultTableHeatColor, tableHeatPaint, tableRowIds, type ColorScheme, type FillColor, type TableAxis, type TableElement, type TableHeat } from '@open-artifact/whiteboard-core';

/** What is said after a cell color or heat map change. */
export const TABLE_TINT_MESSAGES = {
  heatAdded: 'Heat map added',
  heatRemoved: 'Heat map removed',
  heatColor: 'Heat map color updated',
  fill: 'Cell color updated',
  fillRemoved: 'Cell color removed',
  switched: (axis: TableAxis): string => (axis === 'rows' ? 'Row heat map added. Column heat maps removed.' : 'Column heat map added. Row heat maps removed.'),
} as const;

/** Names of the heat map toggles and removals. */
export const TABLE_HEAT_LABELS = {
  toggle: (axis: TableAxis): string => (axis === 'rows' ? 'Heat map this row' : 'Heat map this column'),
  remove: (axis: TableAxis): string => (axis === 'rows' ? 'Remove row heat map' : 'Remove column heat map'),
} as const;

const OTHER_AXIS: Readonly<Record<TableAxis, TableAxis>> = { rows: 'cols', cols: 'rows' };

/** What is said after setting the heat map of one column or row to `color` (`""` takes it off), given the heat maps before. */
export function heatChangeMessage(before: TableHeat | undefined, axis: TableAxis, line: string, color: FillColor | ''): string {
  if (color === '') return TABLE_TINT_MESSAGES.heatRemoved;
  if (Object.keys(before?.[OTHER_AXIS[axis]] ?? {}).length > 0) return TABLE_TINT_MESSAGES.switched(axis);
  return before?.[axis]?.[line] !== undefined ? TABLE_TINT_MESSAGES.heatColor : TABLE_TINT_MESSAGES.heatAdded;
}

/** The color a heat map turned on for a line takes: the one it has, else the last one picked, else the table's default. */
export function heatColorFor(table: Pick<TableElement, 'color' | 'heat'>, axis: TableAxis, line: string, lastPicked: FillColor | undefined): FillColor {
  return table.heat?.[axis]?.[line] ?? lastPicked ?? defaultTableHeatColor(table);
}

/** A CSS gradient from a heat map's lowest shade to its highest. */
export function heatRampGradient(color: FillColor, scheme: ColorScheme): string {
  return `linear-gradient(90deg, ${tableHeatPaint(color, 0, scheme).fill}, ${tableHeatPaint(color, 1, scheme).fill})`;
}

/** Whether a row may take a heat map: any row of the table but its header row. */
export function takesRowHeat(table: Pick<TableElement, 'head' | 'rows'>, row: string): boolean {
  return table.rows[row] !== undefined && !(table.head && tableRowIds(table)[0] === row);
}
