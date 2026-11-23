/**
 * Table colors as drawn: cell fills and heat maps turned into a background
 * and, where the usual text would not read on it, a text color.
 *
 * A fill named after a block color is a soft tint of that color on the
 * paper, under the table's usual text; a `#rrggbb` fill is drawn as
 * written, with dark or light text, whichever reads. A heat map shades each
 * number of its column (or row) by where it falls between the smallest and
 * largest number of the same unit there, faint at the low end and strong at
 * the top, with dark or light text, whichever reads. The header row is
 * never shaded.
 */

import { canonicalValuesEqual } from './json.ts';
import { HEX_COLOR_PATTERN, type FillColor, type TableElement, type TableHeat } from './schema.ts';
import { tableCellValue, tableColumnIds, tableRowIds, type TableAxis } from './table.ts';
import { BOARD_THEME_COLORS, contrastTextColorOn, mixHexColors, shapeFillForColor, type ColorScheme } from './theme.ts';

/** How strongly a named fill tints the paper. */
export const TABLE_FILL_TINT = 0.25;
/** How strongly a heat map's color covers the paper at its lowest and highest number. */
export const TABLE_HEAT_OPACITY = { low: 0.08, high: 0.92 } as const;
/** Longest cell text a heat map reads as a number. */
export const MAX_TABLE_NUMBER_CHARS = 60;

/** One cell's paint: its background, and a text color when the table's usual text would not read on it. */
export interface TableCellPaint {
  fill: string;
  ink?: string;
}

/** One cell of a heat map: its color and where its number falls, 0 (lowest) to 1 (highest). */
export interface TableHeatLevel {
  color: FillColor;
  level: number;
}

/** A number read from a cell, and its unit: a currency sign, `%`, or `""`. */
export interface TableCellNumber {
  value: number;
  unit: string;
}

/** Values by row id, then column id. */
export type TableCellMap<V> = Record<string, Record<string, V>>;

/** The table fields heat maps read. */
export type TableHeatSource = Pick<TableElement, 'cols' | 'rows' | 'head' | 'heat'>;

/** The table fields fills and heat maps read. */
export type TableTintSource = TableHeatSource & Pick<TableElement, 'fills'>;

const NUMBER_PATTERN = /^([-+−]?)([$€£]?)([-+−]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(%?)$/;
const INLINE_WRAPPER_PATTERN = /^([*_`]+)(.+)\1$/s;

/**
 * The number a cell's text shows, or `undefined`. Markdown `*`, `_` and
 * backtick wrappers are read through; then it is digits with optional
 * thousands commas and decimals, an optional sign (`-`, `+` or `−`), and
 * either a leading `$`, `€` or `£` or a trailing `%` (`$1,200`, `−3.5%`).
 */
export function tableCellNumber(text: string): TableCellNumber | undefined {
  let value = text.trim();
  if (value.length > MAX_TABLE_NUMBER_CHARS) return undefined;
  for (let match = INLINE_WRAPPER_PATTERN.exec(value); match !== null; match = INLINE_WRAPPER_PATTERN.exec(value)) value = match[2]!.trim();
  const match = NUMBER_PATTERN.exec(value);
  if (match === null) return undefined;
  const [, signBefore, currency, signAfter, digits, percent] = match;
  if ((signBefore !== '' && signAfter !== '') || (currency !== '' && percent !== '')) return undefined;
  const magnitude = Number(digits!.replaceAll(',', ''));
  return { value: /[-−]/.test(signBefore! + signAfter!) ? -magnitude : magnitude, unit: currency! + percent! };
}

function setCell<V>(map: TableCellMap<V>, rowId: string, columnId: string, value: V): void {
  (map[rowId] ??= {})[columnId] = value;
}

/** The rows a heat map may cover: every row but the header. */
function tableBodyRowIds(table: Pick<TableElement, 'rows' | 'head'>): string[] {
  const rowIds = tableRowIds(table);
  return table.head ? rowIds.slice(1) : rowIds;
}

/**
 * The heat-map level of every numeric cell a heat map covers. Numbers are
 * ranked against those of the same unit; when a line mixes units, a unit
 * with a single number is left unshaded. Equal numbers sit at 0.5. Where a
 * row and a column heat map cross, the column's wins.
 */
export function tableHeatLevels(table: TableHeatSource): TableCellMap<TableHeatLevel> {
  const levels: TableCellMap<TableHeatLevel> = {};
  if (table.heat === undefined) return levels;
  const bodyRowIds = tableBodyRowIds(table);
  const columnIds = tableColumnIds(table);
  const shade = (cells: readonly (readonly [string, string])[], color: FillColor): void => {
    const byUnit = new Map<string, (readonly [string, string, number])[]>();
    for (const [rowId, columnId] of cells) {
      const number = tableCellNumber(tableCellValue(table, rowId, columnId));
      if (number === undefined) continue;
      const group = byUnit.get(number.unit) ?? [];
      group.push([rowId, columnId, number.value]);
      byUnit.set(number.unit, group);
    }
    for (const group of byUnit.values()) {
      if (byUnit.size > 1 && group.length === 1) continue;
      const values = group.map(([, , value]) => value);
      const [low, high] = [Math.min(...values), Math.max(...values)];
      for (const [rowId, columnId, value] of group) setCell(levels, rowId, columnId, { color, level: high === low ? 0.5 : (value - low) / (high - low) });
    }
  };
  for (const rowId of bodyRowIds) {
    const color = table.heat.rows?.[rowId];
    if (color !== undefined) shade(columnIds.map((columnId) => [rowId, columnId] as const), color);
  }
  for (const columnId of columnIds) {
    const color = table.heat.cols?.[columnId];
    if (color !== undefined) shade(bodyRowIds.map((rowId) => [rowId, columnId] as const), color);
  }
  return levels;
}

/** The paint of a cell fill. */
export function tableFillPaint(color: FillColor, scheme: ColorScheme): TableCellPaint {
  if (HEX_COLOR_PATTERN.test(color)) return { fill: color, ink: contrastTextColorOn(color) };
  return { fill: mixHexColors(BOARD_THEME_COLORS[scheme].paper, shapeFillForColor(color), TABLE_FILL_TINT) };
}

/** The paint of a heat-map cell at `level` (0–1): the color laid over the paper, with dark or light text. */
export function tableHeatPaint(color: FillColor, level: number, scheme: ColorScheme): Required<TableCellPaint> {
  const full = HEX_COLOR_PATTERN.test(color) ? color : shapeFillForColor(color);
  const opacity = TABLE_HEAT_OPACITY.low + (TABLE_HEAT_OPACITY.high - TABLE_HEAT_OPACITY.low) * Math.min(1, Math.max(0, level));
  const fill = mixHexColors(BOARD_THEME_COLORS[scheme].paper, full, opacity);
  return { fill, ink: contrastTextColorOn(fill) };
}

/** The paint of every tinted cell: its fill, or else its heat-map shade. The header row keeps the header's color. */
export function tableCellPaints(table: TableTintSource, scheme: ColorScheme): TableCellMap<TableCellPaint> {
  const paints: TableCellMap<TableCellPaint> = {};
  for (const [rowId, cells] of Object.entries(tableHeatLevels(table))) {
    for (const [columnId, { color, level }] of Object.entries(cells)) setCell(paints, rowId, columnId, tableHeatPaint(color, level, scheme));
  }
  const bodyRowIds = new Set(tableBodyRowIds(table));
  for (const [rowId, cells] of Object.entries(table.fills ?? {})) {
    if (!bodyRowIds.has(rowId)) continue;
    for (const [columnId, color] of Object.entries(cells)) setCell(paints, rowId, columnId, tableFillPaint(color, scheme));
  }
  return paints;
}

/** The color a new heat map takes: the table's own color, or blue on a white table. */
export function defaultTableHeatColor(table: Pick<TableElement, 'color'>): FillColor {
  return table.color === 'white' || table.color.toLowerCase() === '#ffffff' ? 'blue' : table.color;
}

/**
 * The table with a heat map set on one column or row (`""` takes it off).
 * Heat maps run along one axis at a time, so setting one removes those of
 * the other axis, and the cells it shades lose their own fills. The header
 * row takes no row heat map.
 */
export function withTableHeat<T extends TableTintSource>(table: T, axis: TableAxis, id: string, color: FillColor | ''): T {
  const bodyRowIds = tableBodyRowIds(table);
  if (axis === 'rows' ? !bodyRowIds.includes(id) : table.cols[id] === undefined) return table;
  const { [id]: _previous, ...others } = table.heat?.[axis] ?? {};
  const line = color === '' ? others : { ...others, [id]: color };
  const kept: TableHeat = color === '' ? { ...table.heat } : {};
  if (Object.keys(line).length > 0) kept[axis] = line;
  else delete kept[axis];
  const fills: Record<string, Record<string, FillColor>> = { ...table.fills };
  if (color !== '' && axis === 'rows') delete fills[id];
  else if (color !== '') {
    for (const rowId of bodyRowIds) {
      const cells = fills[rowId];
      if (cells?.[id] === undefined) continue;
      const { [id]: _cleared, ...rest } = cells;
      if (Object.keys(rest).length > 0) fills[rowId] = rest;
      else delete fills[rowId];
    }
  }
  const result = { ...table, heat: kept, fills };
  if (kept.cols === undefined && kept.rows === undefined) Reflect.deleteProperty(result, 'heat');
  if (Object.keys(fills).length === 0) Reflect.deleteProperty(result, 'fills');
  return result;
}

/** A cell's own fill, `""` for none. */
export function tableCellFill(table: Pick<TableElement, 'fills'>, rowId: string, columnId: string): FillColor | '' {
  return table.fills?.[rowId]?.[columnId] ?? '';
}

/** One fill change: `[row, column, expected, value]`, where `""` is no fill. */
export type TableFillSwap = readonly [rowId: string, columnId: string, expected: FillColor | '', value: FillColor | ''];

/** Sets each cell's fill to its value, but only where the cell still has the expected fill. */
export function setTableFillsWhereUnchanged<T extends TableTintSource>(table: T, swaps: readonly TableFillSwap[]): T {
  const fills: Record<string, Record<string, FillColor>> = { ...table.fills };
  let changed = false;
  for (const [rowId, columnId, expected, value] of swaps) {
    if (table.rows[rowId] === undefined || table.cols[columnId] === undefined || expected === value || tableCellFill({ fills }, rowId, columnId) !== expected) continue;
    const { [columnId]: _previous, ...rest } = fills[rowId] ?? {};
    const cells = value === '' ? rest : { ...rest, [columnId]: value };
    if (Object.keys(cells).length > 0) fills[rowId] = cells;
    else delete fills[rowId];
    changed = true;
  }
  if (!changed) return table;
  const result = { ...table, fills };
  if (Object.keys(fills).length === 0) Reflect.deleteProperty(result, 'fills');
  return result;
}

/** The table's heat maps set to `value`, but only where they are still `expected`. */
export function setTableHeatWhereUnchanged<T extends TableTintSource>(table: T, expected: TableHeat | undefined, value: TableHeat | undefined): T {
  if (!canonicalValuesEqual(table.heat, expected) || canonicalValuesEqual(expected, value)) return table;
  const result = { ...table, heat: value };
  if (value === undefined) Reflect.deleteProperty(result, 'heat');
  return result;
}

/** The fill changes between two versions of a table, as swaps from `before` to `after`. */
export function tableFillSwaps(before: Pick<TableElement, 'fills'>, after: Pick<TableElement, 'fills'>): TableFillSwap[] {
  const swaps: TableFillSwap[] = [];
  const rowIds = new Set([...Object.keys(before.fills ?? {}), ...Object.keys(after.fills ?? {})]);
  for (const rowId of rowIds) {
    const columnIds = new Set([...Object.keys(before.fills?.[rowId] ?? {}), ...Object.keys(after.fills?.[rowId] ?? {})]);
    for (const columnId of columnIds) {
      const [from, to] = [tableCellFill(before, rowId, columnId), tableCellFill(after, rowId, columnId)];
      if (from !== to) swaps.push([rowId, columnId, from, to]);
    }
  }
  return swaps;
}
