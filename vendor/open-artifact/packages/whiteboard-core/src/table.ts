/**
 * Tables: keyed rows and columns, normalization, cell edits, sizing and
 * TSV import/export.
 *
 * Rows and columns are maps keyed by id, ordered by a numeric `at` (then by
 * a natural sort of the key). Keys instead of arrays let two people add or
 * edit rows at the same time: each change touches different keys, so the
 * JSON merge patches the sync engine writes never overwrite each other.
 *
 * Column widths are either fixed (`w`) or measured from the content with a
 * built-in glyph-width table, so sizing is the same in every browser and in
 * Node (the agent's checks).
 */

import { HEX_COLOR_PATTERN, NOTE_COLORS, type FillColor, type HexColor, type NoteColor, type TableColumn, type TableElement, type TableHeat, type TableRow, type TextSize } from './schema.ts';

/** Most cells one table holds, and most bytes of its JSON. */
export const TABLE_LIMITS = { cells: 3000, bytes: 194_560 } as const;
/** Most row or column keys read from one table. */
export const MAX_TABLE_KEYS = 4 * TABLE_LIMITS.cells;
/** Column width bounds; `fresh` is a new column, `fitMin`/`fitMax` bound auto widths. */
export const COLUMN_WIDTH_LIMITS = { min: 48, max: 800, fresh: 160, fitMin: 96, fitMax: 280 } as const;
/** Cell padding and line height. */
export const TABLE_CELL_PADDING = { padX: 12, padY: 8, line: 1.35 } as const;
/** Font size of each text size inside a table. */
export const TABLE_FONT_SIZES: Readonly<Record<TextSize, number>> = { small: 14, body: 16, large: 28, title: 48, huge: 96 };
/** Row and column keys: 1–64 characters, no control characters. */
export const TABLE_KEY_PATTERN = /^[^\u0000-\u001f\u007f]{1,64}$/;
/** Width of an unknown glyph, in em. */
export const FALLBACK_GLYPH_WIDTH_EM = 0.6;

/** The table fields these helpers read and write. */
export type TableData = Pick<TableElement, 'cols' | 'rows'> & { size?: TextSize };
/** Which axis of a table. */
export type TableAxis = 'rows' | 'cols';
/** One cell edit: `[rowId, columnId, text]`. */
export type TableCellEdit = readonly [rowId: string, columnId: string, text: string];

/** Font size of a table's cells. */
export function tableFontSize(table: { size?: TextSize }): number {
  return TABLE_FONT_SIZES[table.size ?? 'body'];
}

/** True for a usable row or column key. */
export function isTableKey(key: unknown): key is string {
  return typeof key === 'string' && TABLE_KEY_PATTERN.test(key) && key !== 'at' && !(key in Object.prototype);
}

/** A finite number from a number or numeric string. */
export function toFiniteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys of a row or column map, ordered by `at` then by a natural sort. */
export function sortTableKeys(entries: Readonly<Record<string, { at?: unknown } | undefined>>): string[] {
  const keys = Object.keys(entries);
  const orderOf = new Map(keys.map((key) => [key, toFiniteNumber(entries[key]?.at) ?? Number.POSITIVE_INFINITY]));
  const pieceCache = new Map<string, string[]>();
  const pieces = (key: string): string[] => {
    let cached = pieceCache.get(key);
    if (cached === undefined) pieceCache.set(key, (cached = key.match(/\d+|\D+/g) ?? []));
    return cached;
  };
  const isDigit = (piece: string): boolean => piece.charCodeAt(0) > 47 && piece.charCodeAt(0) < 58;
  const compareNatural = (left: string, right: string): number => {
    const [leftPieces, rightPieces] = [pieces(left), pieces(right)];
    for (let index = 0; index < Math.min(leftPieces.length, rightPieces.length); index++) {
      const [leftPiece, rightPiece] = [leftPieces[index]!, rightPieces[index]!];
      const diff = isDigit(leftPiece) && isDigit(rightPiece) ? Number(leftPiece) - Number(rightPiece) : 0;
      if (diff !== 0 || leftPiece !== rightPiece) return diff !== 0 ? diff : leftPiece < rightPiece ? -1 : 1;
    }
    return leftPieces.length - rightPieces.length;
  };
  return keys.sort((a, b) => {
    const [orderA, orderB] = [orderOf.get(a)!, orderOf.get(b)!];
    return orderA === orderB ? compareNatural(a, b) : orderA < orderB ? -1 : 1;
  });
}

const sortedKeysCache = new WeakMap<object, string[]>();

function sortedTableKeys(entries: Readonly<Record<string, { at?: unknown } | undefined>>): string[] {
  let keys = sortedKeysCache.get(entries);
  if (keys === undefined) sortedKeysCache.set(entries, (keys = sortTableKeys(entries)));
  return keys;
}

/** Column ids in order. */
export function tableColumnIds(table: Pick<TableData, 'cols'>): string[] {
  return sortedTableKeys(table.cols);
}

/** Row ids in order. */
export function tableRowIds(table: Pick<TableData, 'rows'>): string[] {
  return sortedTableKeys(table.rows);
}

/** Ids of one axis in order. */
export function tableAxisIds(table: TableData, axis: TableAxis): string[] {
  return axis === 'rows' ? tableRowIds(table) : tableColumnIds(table);
}

/** A cell's text (`''` when empty). */
export function tableCellValue(table: Pick<TableData, 'rows'>, rowId: string, columnId: string): string {
  const value = table.rows[rowId]?.[columnId];
  return typeof value === 'string' && columnId !== 'at' ? value : '';
}

/** True when both the row and the column exist. */
export function hasTableCell(table: TableData, rowId: string, columnId: string): boolean {
  return table.rows[rowId] !== undefined && table.cols[columnId] !== undefined;
}

/** Every cell's text, row by row. */
export function tableCellGrid(table: TableData): string[][] {
  const columns = tableColumnIds(table);
  return tableRowIds(table).map((rowId) => columns.map((columnId) => tableCellValue(table, rowId, columnId)));
}

/** A cell fill or heat-map color: a block color name or `#rrggbb` (lower-cased); `undefined` for anything else, `""` included. */
export function tableTintColor(value: unknown): FillColor | undefined {
  if (typeof value !== 'string') return undefined;
  if ((NOTE_COLORS as readonly string[]).includes(value)) return value as NoteColor;
  return HEX_COLOR_PATTERN.test(value) ? (value.toLowerCase() as HexColor) : undefined;
}

/** True when a grid of this size would exceed {@link TABLE_LIMITS}. */
export function exceedsTableCellLimit(rows: number, columns: number): boolean {
  return rows * columns > TABLE_LIMITS.cells;
}

/* -------------------------------------------------------------------------- */
/* Widths                                                                     */
/* -------------------------------------------------------------------------- */

/** Widths of ASCII 32–126 in hundredths of an em (a neutral sans-serif). */
const ASCII_GLYPH_WIDTHS = [
  25, 30, 53, 65, 57, 104, 76, 30, 43, 43, 53, 66, 30, 41, 30, 40, 62, 52, 61, 60, 65, 60, 60, 59, 60, 60, 30, 30, 66, 66, 66, 60, 89, 79, 69, 81, 76, 66, 63,
  83, 79, 30, 58, 74, 60, 99, 81, 87, 64, 87, 73, 64, 65, 74, 79, 112, 74, 72, 68, 43, 37, 43, 66, 52, 51, 58, 66, 59, 65, 61, 49, 65, 63, 28, 28, 62, 28, 92,
  63, 62, 66, 65, 46, 54, 49, 61, 61, 87, 65, 62, 53, 43, 32, 43, 66,
];
const EXTRA_GLYPH_WIDTHS: Readonly<Record<string, number>> = {
  Æ: 117, æ: 95, Œ: 111, œ: 101, Ø: 87, ø: 62, Đ: 86, đ: 67, Ł: 70, Þ: 66, þ: 66, ð: 62, ß: 70,
  '—': 101, '…': 103, '→': 86, '←': 86, '€': 66, '£': 66, '¥': 66, '×': 66, '½': 91, '™': 66, '‰': 147, '§': 65, '©': 66, '®': 66,
};

/** Estimated width of a text in em, or 0 when no glyph is known (CJK, emoji). */
export function estimateTextWidthEm(text: string): number {
  let width = 0;
  let known = false;
  for (const char of text) {
    const base = char >= 'À' && char <= 'ɏ' ? char.normalize('NFD').charAt(0) : char;
    const glyph = ASCII_GLYPH_WIDTHS[base.charCodeAt(0) - 32] ?? EXTRA_GLYPH_WIDTHS[base];
    known ||= glyph !== undefined;
    width += (glyph ?? 100 * FALLBACK_GLYPH_WIDTH_EM * char.length) / 100;
  }
  return known ? width : 0;
}

/** A column width rounded and clamped to {@link COLUMN_WIDTH_LIMITS}. */
export function clampColumnWidth(width: number): number {
  return Math.round(Math.min(COLUMN_WIDTH_LIMITS.max, Math.max(COLUMN_WIDTH_LIMITS.min, width)));
}

/** Where a line may break: spaces, after dashes and slashes, around CJK runs. */
const WORD_BREAK_PATTERN =
  /\s+|(?<=[-/?­​‐‒–—․-‧‼⁇-⁉])|(?=—)|[ᄀ-ᇿ⌀-⏿☀-➿⬀-⯿⺀-\uffff]+/;
/** A list item marker at the start of a cell line. */
export const CELL_LIST_MARKER_PATTERN = /^(?:[-•*]|\d{1,3}\.)[  ]/;

/** Indent of list items in a cell, in em. */
function listIndentEm(text: string): number {
  return text.split('\n').reduce((indent, line) => Math.max(indent, 0.62 * ((CELL_LIST_MARKER_PATTERN.exec(line)?.[0].length ?? 2) - 2) + 0.5), 1.5);
}

/** Text with Markdown links replaced by their labels. */
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Text without inline markers (`*`, `` ` ``, `\`). */
export function stripInlineMarkers(text: string): string {
  return text.replace(/[*`\\]/g, '');
}

const columnPlainTextCache = new WeakMap<object, Map<string, string[]>>();
const wordFitWidthCache = new WeakMap<object, Map<string, number>>();
const autoColumnWidthCache = new WeakMap<object, Map<string, number>>();
const tableWidthCache = new WeakMap<object, number>();

function cacheFor<V>(cache: WeakMap<object, Map<string, V>>, key: object): Map<string, V> {
  let map = cache.get(key);
  if (map === undefined) cache.set(key, (map = new Map()));
  return map;
}

function columnPlainTexts(table: TableData, columnId: string): string[] {
  const byColumn = cacheFor(columnPlainTextCache, table.rows);
  let texts = byColumn.get(columnId);
  if (texts === undefined) {
    texts = tableRowIds(table).map((rowId) => stripMarkdownLinks(tableCellValue(table, rowId, columnId)));
    byColumn.set(columnId, texts);
  }
  return texts;
}

function longestColumnPiece(table: TableData, columnId: string, separator: string | RegExp): number {
  let longest = 0;
  for (const text of columnPlainTexts(table, columnId)) {
    for (const piece of stripInlineMarkers(text).split(separator)) longest = Math.max(longest, piece.length);
  }
  return longest;
}

/**
 * The column-width guidance agents write by: at body size, 10 for each
 * letter of a column's longest word, plus 26 (scaled with the table's
 * text size). The table is then as wide as its columns add up to.
 */
export const COLUMN_WIDTH_GUIDE = { perLetter: 10, pad: 26 } as const;

/** The least `w` the guidance gives a column (see {@link COLUMN_WIDTH_GUIDE}), within the limits. */
export function suggestedColumnWidth(table: TableData, columnId: string): number {
  const scale = tableFontSize(table) / TABLE_FONT_SIZES.body;
  return clampColumnWidth((COLUMN_WIDTH_GUIDE.perLetter * longestColumnPiece(table, columnId, /\s+/) + COLUMN_WIDTH_GUIDE.pad) * scale);
}

/** Width that fits the column's longest unbreakable word (bounded by `fitMax`). */
function columnWordFitWidth(table: TableData, columnId: string): number {
  const fontSize = tableFontSize(table);
  const padding = 2 * TABLE_CELL_PADDING.padX + 2;
  const cache = cacheFor(wordFitWidthCache, table.rows);
  const cacheKey = `${columnId} ${fontSize}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let width = 0;
  const consider = (wordEm: number, indentEm: number): void => {
    if (Math.ceil(wordEm * fontSize) + padding <= COLUMN_WIDTH_LIMITS.fitMax) {
      width = Math.max(width, Math.min(COLUMN_WIDTH_LIMITS.fitMax, Math.ceil((wordEm + indentEm) * fontSize) + padding));
    }
  };
  for (const text of columnPlainTexts(table, columnId)) {
    const indent = listIndentEm(text);
    for (const line of text.split('\n')) {
      const marker = CELL_LIST_MARKER_PATTERN.exec(line)?.[0];
      const body = line.slice(marker?.length ?? 0);
      for (const word of stripInlineMarkers(body.replace(/`[^`]*`/g, ' ')).split(WORD_BREAK_PATTERN)) {
        consider(estimateTextWidthEm(word ?? ''), marker === undefined ? 0 : indent);
      }
      if (marker !== undefined) {
        for (const word of (body.match(/`[^`]*`/g) ?? []).join(' ').replace(/`/g, '').split(/\s+/)) {
          if (word !== '') consider(Math.max(FALLBACK_GLYPH_WIDTH_EM * word.length, 0.55 * word.length + 8 / fontSize), indent);
        }
      }
    }
  }
  cache.set(cacheKey, width);
  return width;
}

/** A column's width: its fixed `w`, or one measured from its content. */
export function columnWidth(table: TableData, columnId: string): number {
  const column = table.cols[columnId];
  if (column === undefined) return 0;
  if (column.w !== undefined) return column.w;
  const cache = cacheFor(autoColumnWidthCache, table.rows);
  const cacheKey = `${columnId} ${tableFontSize(table)}`;
  let width = cache.get(cacheKey);
  if (width === undefined) {
    const longestLine = longestColumnPiece(table, columnId, '\n');
    width = Math.max(
      columnWordFitWidth(table, columnId),
      Math.round(
        Math.min(
          COLUMN_WIDTH_LIMITS.fitMax,
          Math.max(COLUMN_WIDTH_LIMITS.fitMin, longestLine * tableFontSize(table) * FALLBACK_GLYPH_WIDTH_EM + 2 * TABLE_CELL_PADDING.padX + 2),
        ),
      ),
    );
    cache.set(cacheKey, width);
  }
  return width;
}

/** The table's total width. */
export function tableWidth(table: TableData): number {
  let width = tableWidthCache.get(table);
  if (width === undefined) {
    width = tableColumnIds(table).reduce((sum, columnId) => sum + columnWidth(table, columnId), 0);
    tableWidthCache.set(table, width);
  }
  return width;
}

/** Width that fits the column's longest word. */
export function fitColumnWidth(table: TableData, columnId: string): number {
  const longestWord = longestColumnPiece(table, columnId, /\s+/);
  return Math.max(
    columnWordFitWidth(table, columnId),
    Math.min(COLUMN_WIDTH_LIMITS.fitMax, Math.ceil(longestWord * tableFontSize(table) * FALLBACK_GLYPH_WIDTH_EM) + 2 * TABLE_CELL_PADDING.padX + 2),
  );
}

/** Narrowest a column may be resized to without cutting words. */
export function columnMinWidth(table: TableData, columnId: string, current?: number): number {
  return Math.min(current ?? COLUMN_WIDTH_LIMITS.max, fitColumnWidth(table, columnId));
}

/** Row heights from the estimated number of wrapped lines in each cell. */
export function tableRowHeights(table: TableData): number[] {
  const fontSize = tableFontSize(table);
  const widths = tableColumnIds(table).map((columnId) => columnWidth(table, columnId));
  return tableCellGrid(table).map((row) => {
    const lineCounts = row.map((text, index) => {
      const charsPerLine = Math.max(1, ((widths[index] ?? 0) - 2 * TABLE_CELL_PADDING.padX) / (fontSize * 0.56));
      const plain = stripMarkdownLinks(text);
      const itemCharsPerLine = Math.max(1, charsPerLine - listIndentEm(plain) / 0.56);
      return plain.split('\n').reduce(
        (sum, line) =>
          sum +
          Math.max(
            1,
            Math.ceil(stripInlineMarkers(line).length / charsPerLine),
            CELL_LIST_MARKER_PATTERN.test(line) ? Math.ceil(stripInlineMarkers(line.replace(CELL_LIST_MARKER_PATTERN, '')).length / itemCharsPerLine) : 0,
          ),
        0,
      );
    });
    return Math.ceil(lineCounts.reduce((max, count) => Math.max(max, count), 1) * fontSize * TABLE_CELL_PADDING.line + 2 * TABLE_CELL_PADDING.padY) + 1;
  });
}

/** The table's total height. */
export function tableTotalHeight(table: TableData): number {
  return tableRowHeights(table).reduce((sum, height) => sum + height, 0);
}

/* -------------------------------------------------------------------------- */
/* Building records                                                           */
/* -------------------------------------------------------------------------- */

function sortedEntriesObject<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function atField(at: unknown): { at?: number } {
  const number = toFiniteNumber(at);
  return number !== undefined ? { at: number } : {};
}

function tableRowRecord(at: unknown, cells: Iterable<readonly [string, string]>): TableRow {
  return { ...atField(at), ...sortedEntriesObject(cells) } as TableRow;
}

function rowCellEntries(row: TableRow): [string, string][] {
  return Object.entries(row).filter((entry): entry is [string, string] => entry[0] !== 'at' && typeof entry[1] === 'string');
}

function mapObjectValues<V, R>(record: Readonly<Record<string, V>>, map: (value: V, key: string) => R): Record<string, R> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value, key)]));
}

/** The colors of `raw` (key → color) whose key `keep` accepts, sorted by key; `undefined` when none is left. */
function tintColorMap(raw: unknown, keep: (key: string) => boolean): Record<string, FillColor> | undefined {
  const entries = (isRecord(raw) ? Object.entries(raw) : []).flatMap(([key, value]): [string, FillColor][] => {
    const color = tableTintColor(value);
    return color !== undefined && keep(key) ? [[key, color]] : [];
  });
  return entries.length > 0 ? sortedEntriesObject(entries) : undefined;
}

/**
 * Cleans up a table's `cols` and `rows`: valid keys only (sorted, capped),
 * columns derived from the cells when missing, cells as strings, and at
 * least one row and one column. Empty cells of unknown columns are kept as
 * `""` (they are tombstones a concurrent column delete left).
 *
 * `fills` and `heat` keep valid colors of rows and columns that exist. A
 * cell written as `{text, color}` reads as its text, with its color as the
 * cell's fill unless `fills` names that cell.
 */
export function normalizeTable(
  raw: { cols?: unknown; rows?: unknown; fills?: unknown; heat?: unknown; head?: unknown },
  cellText: (text: string) => string,
): Pick<TableElement, 'cols' | 'rows' | 'fills' | 'heat'> {
  const entriesOf = (record: unknown, limit: number): [string, Record<string, unknown>][] => {
    const entries = Object.fromEntries(
      (isRecord(record) ? Object.entries(record) : []).filter((entry): entry is [string, Record<string, unknown>] => isTableKey(entry[0]) && isRecord(entry[1])),
    );
    return sortTableKeys(entries)
      .slice(0, limit)
      .map((key) => [key, entries[key]!]);
  };
  const rows = entriesOf(raw.rows, MAX_TABLE_KEYS);
  const cols = entriesOf(raw.cols, MAX_TABLE_KEYS);
  const columns =
    cols.length > 0
      ? cols
      : entriesOf(Object.fromEntries(rows.flatMap(([, row]) => Object.keys(row).flatMap((key) => (row[key] !== '' ? [[key, {}]] : [])))), MAX_TABLE_KEYS);
  const keptRows = rows.slice(0, Math.max(1, Math.floor(MAX_TABLE_KEYS / Math.max(1, columns.length))));
  const normalizedCols: [string, TableColumn][] = columns.map(([key, column]) => {
    const width = toFiniteNumber(column.w);
    return [key, { ...atField(column.at), ...(width !== undefined ? { w: clampColumnWidth(width) } : {}) }];
  });
  if (normalizedCols.length === 0) normalizedCols.push(['c1', {}]);
  const plainCellValue = (value: unknown): string | undefined =>
    typeof value === 'string' ? cellText(value) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
  const cellValue = (value: unknown): string | undefined => plainCellValue(isRecord(value) ? value.text : value);
  const columnIds = new Set(normalizedCols.map(([key]) => key));
  const emptyCells = (row: Record<string, unknown>): [string, string][] =>
    Object.keys(row).flatMap((key): [string, string][] => (row[key] === '' && !columnIds.has(key) && isTableKey(key) ? [[key, '']] : []));
  const normalizedRows: [string, TableRow][] = keptRows.map(([key, row]) => [
    key,
    tableRowRecord(row.at, [
      ...normalizedCols.flatMap(([columnId]): [string, string][] => {
        const value = cellValue(row[columnId]);
        return value !== undefined ? [[columnId, value]] : [];
      }),
      ...emptyCells(row),
    ]),
  ]);
  if (normalizedRows.length === 0) normalizedRows.push(['r1', {}]);
  const rowIds = new Set(normalizedRows.map(([key]) => key));
  const rawRows = new Map(keptRows);
  const rawFills = isRecord(raw.fills) ? raw.fills : {};
  const fills = normalizedRows.flatMap(([rowId]): [string, Record<string, FillColor>][] => {
    const legacy = Object.fromEntries(Object.entries(rawRows.get(rowId) ?? {}).flatMap(([key, cell]) => (isRecord(cell) ? [[key, cell.color]] : [])));
    const ownFills = rawFills[rowId];
    const cells = tintColorMap({ ...legacy, ...(isRecord(ownFills) ? ownFills : {}) }, (key) => columnIds.has(key));
    return cells !== undefined ? [[rowId, cells]] : [];
  });
  const rawHeat = isRecord(raw.heat) ? raw.heat : {};
  const heatCols = tintColorMap(rawHeat.cols, (key) => columnIds.has(key));
  const headRowId = raw.head !== false ? sortedTableKeys(Object.fromEntries(normalizedRows))[0] : undefined;
  const heatRows = tintColorMap(rawHeat.rows, (key) => rowIds.has(key) && key !== headRowId);
  const heat: TableHeat = { ...(heatCols !== undefined ? { cols: heatCols } : {}), ...(heatRows !== undefined ? { rows: heatRows } : {}) };
  return {
    cols: sortedEntriesObject(normalizedCols),
    rows: sortedEntriesObject(normalizedRows),
    ...(fills.length > 0 ? { fills: sortedEntriesObject(fills) } : {}),
    ...(heatCols !== undefined || heatRows !== undefined ? { heat } : {}),
  };
}

/** True when a fill or a heat map tints the row. */
export function tableRowIsTinted(table: Pick<TableElement, 'fills' | 'heat'>, rowId: string): boolean {
  return table.heat?.rows?.[rowId] !== undefined || Object.keys(table.fills?.[rowId] ?? {}).length > 0;
}

/** True when a fill or a heat map tints the column. */
export function tableColumnIsTinted(table: Pick<TableElement, 'fills' | 'heat'>, columnId: string): boolean {
  return table.heat?.cols?.[columnId] !== undefined || Object.values(table.fills ?? {}).some((cells) => cells[columnId] !== undefined);
}

/** A table from a grid of texts (rows of cells). */
export function tableFromGrid(grid: readonly (readonly string[])[]): Pick<TableElement, 'cols' | 'rows'> {
  const columnCount = grid.reduce((max, row) => Math.max(max, row.length), 1);
  const cols = Object.fromEntries(Array.from({ length: columnCount }, (_, index) => [`c${index + 1}`, { at: index + 1 }]));
  const rows = Object.fromEntries(
    (grid.length > 0 ? grid : [[]]).map((row, index) => [
      `r${index + 1}`,
      { at: index + 1, ...Object.fromEntries(row.flatMap((cell, column) => (cell !== '' ? [[`c${column + 1}`, cell]] : []))) },
    ]),
  );
  return normalizeTable({ cols, rows }, (text) => text);
}

/** A random key (`prefix` + 8 letters) not already in `existing`. */
export function freshTableKey(prefix: string, existing: Readonly<Record<string, unknown>>, random: () => number = Math.random): string {
  for (;;) {
    const key = prefix + Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(random() * 26))).join('');
    if (existing[key] === undefined) return key;
  }
}

/* -------------------------------------------------------------------------- */
/* Edits                                                                      */
/* -------------------------------------------------------------------------- */

/** Moves one row or column to sort key `at`. */
export function setTableAxisOrder<T extends TableData>(table: T, axis: TableAxis, id: string, at: number): T {
  if (table[axis][id] === undefined || table[axis][id]?.at === at) return table;
  return axis === 'rows'
    ? { ...table, rows: mapObjectValues(table.rows, (row, key) => (key === id ? tableRowRecord(at, rowCellEntries(row)) : row)) }
    : { ...table, cols: mapObjectValues(table.cols, (column, key) => (key === id ? { at, ...(column.w !== undefined ? { w: column.w } : {}) } : column)) };
}

/** Renumbers an axis 1, 2, 3… in its current order. */
export function renumberTableAxis<T extends TableData>(table: T, axis: TableAxis): T {
  const order = new Map(tableAxisIds(table, axis).map((id, index) => [id, index + 1]));
  return axis === 'rows'
    ? { ...table, rows: mapObjectValues(table.rows, (row, key) => tableRowRecord(order.get(key), rowCellEntries(row))) }
    : { ...table, cols: mapObjectValues(table.cols, (column, key) => ({ at: order.get(key)!, ...(column.w !== undefined ? { w: column.w } : {}) })) };
}

/**
 * A sort key for inserting at `index` of an axis: a short random number in
 * the middle half between its neighbors, so two people inserting at the same
 * spot rarely collide. Renumbers the axis first when there is no room.
 */
export function tableInsertPosition<T extends TableData>(table: T, axis: TableAxis, index: number, random: () => number = Math.random): { table: T; at: number } {
  const ids = tableAxisIds(table, axis);
  const beforeId = ids[Math.min(index, ids.length) - 1];
  const afterId = ids[Math.min(index, ids.length)];
  const [beforeAt, afterAt] = [beforeId, afterId].map((id) => (id === undefined ? undefined : toFiniteNumber(table[axis][id]?.at)));
  const at = ((): number | undefined => {
    if ((beforeId !== undefined && beforeAt === undefined) || (afterId !== undefined && afterAt === undefined)) return undefined;
    if (beforeAt === undefined || afterAt === undefined) {
      return afterAt !== undefined ? Math.ceil(afterAt) - 1 : beforeAt !== undefined ? Math.floor(beforeAt) + 1 : 1;
    }
    const low = beforeAt + (afterAt - beforeAt) / 4;
    const high = afterAt - (afterAt - beforeAt) / 4;
    const pick = low + random() * (high - low);
    for (let digits = 0; digits < 12; digits++) {
      const rounded = Math.round(pick * 10 ** digits) / 10 ** digits;
      if (rounded >= low && rounded <= high) return rounded;
    }
    return pick;
  })();
  return at !== undefined &&
    (beforeAt === undefined || at > beforeAt) &&
    (afterAt === undefined || at < afterAt) &&
    (beforeAt === undefined || afterAt === undefined || afterAt - beforeAt >= 0.000001)
    ? { table, at }
    : tableInsertPosition(renumberTableAxis(table, axis), axis, index, random);
}

/** Sets cell texts; edits of missing cells or unchanged texts are skipped. */
export function setTableCells<T extends TableData>(table: T, edits: Iterable<TableCellEdit>): T {
  const byRow = new Map<string, Map<string, string>>();
  for (const [rowId, columnId, text] of edits) {
    if (hasTableCell(table, rowId, columnId) && tableCellValue(table, rowId, columnId) !== text) {
      byRow.set(rowId, (byRow.get(rowId) ?? new Map<string, string>()).set(columnId, text));
    }
  }
  if (byRow.size === 0) return table;
  return {
    ...table,
    rows: mapObjectValues(table.rows, (row, rowId) => {
      const cells = byRow.get(rowId);
      return cells === undefined ? row : tableRowRecord(row.at, [...new Map([...rowCellEntries(row), ...cells])]);
    }),
  };
}

/** Sets one cell's text. */
export function setTableCell<T extends TableData>(table: T, rowId: string, columnId: string, text: string): T {
  return setTableCells(table, [[rowId, columnId, text]]);
}

/** Adds rows `[id, at]`, as many as the cell limit allows (all with `unlimited`). */
export function addTableRows<T extends TableData>(table: T, rows: readonly (readonly [string, number])[], unlimited = false): T {
  const room = unlimited ? Number.POSITIVE_INFINITY : Math.floor(TABLE_LIMITS.cells / tableColumnIds(table).length) - tableRowIds(table).length;
  const added = rows.filter(([id]) => table.rows[id] === undefined && isTableKey(id)).slice(0, Math.max(0, room));
  if (added.length === 0) return table;
  return { ...table, rows: sortedEntriesObject([...Object.entries(table.rows), ...added.map(([id, at]): [string, TableRow] => [id, tableRowRecord(at, [])])]) };
}

/** Removes a row (never the last one). */
export function removeTableRow<T extends TableData>(table: T, rowId: string): T {
  if (table.rows[rowId] === undefined || tableRowIds(table).length <= 1) return table;
  const { [rowId]: _removed, ...rows } = table.rows;
  return { ...table, rows };
}

/** Adds columns `[id, at, width?]`, as many as the cell limit allows. */
export function addTableColumns<T extends TableData>(table: T, cols: readonly (readonly [string, number, number?])[], unlimited = false): T {
  const room = unlimited ? Number.POSITIVE_INFINITY : Math.floor(TABLE_LIMITS.cells / tableRowIds(table).length) - tableColumnIds(table).length;
  const added = cols.filter(([id]) => table.cols[id] === undefined && isTableKey(id)).slice(0, Math.max(0, room));
  if (added.length === 0) return table;
  return {
    ...table,
    cols: sortedEntriesObject([
      ...Object.entries(table.cols),
      ...added.map(([id, at, width]): [string, TableColumn] => [id, { ...atField(at), ...(width !== undefined ? { w: clampColumnWidth(width) } : {}) }]),
    ]),
  };
}

/**
 * Removes a column (never the last one). Its non-empty cells become `""`
 * so the delete merges with a concurrent edit of the same cells.
 */
export function removeTableColumn<T extends TableData>(table: T, columnId: string): T {
  if (table.cols[columnId] === undefined || tableColumnIds(table).length <= 1) return table;
  const { [columnId]: _removed, ...cols } = table.cols;
  return {
    ...table,
    cols,
    rows: mapObjectValues(table.rows, (row) => (typeof row[columnId] === 'string' && row[columnId] !== '' ? ({ ...row, [columnId]: '' } as TableRow) : row)),
  };
}

/** Sets a column's width. */
export function setColumnWidth<T extends TableData>(table: T, columnId: string, width: number): T {
  if (table.cols[columnId] === undefined || table.cols[columnId].w === width) return table;
  return { ...table, cols: mapObjectValues(table.cols, (column, key) => (key === columnId ? { ...atField(column.at), w: width } : column)) };
}

/** Sets a column's width, clamped. */
export function resizeColumn<T extends TableData>(table: T, columnId: string, width: number): T {
  return setColumnWidth(table, columnId, clampColumnWidth(width));
}

/** Widens a column to at least its word-fit width. */
export function widenColumnToFit<T extends TableData>(table: T, columnId: string, width: number, current?: number): T {
  return setColumnWidth(table, columnId, clampColumnWidth(Math.max(width, columnMinWidth(table, columnId, current))));
}

/** Gives every auto-width column its current measured width. */
export function pinColumnWidths<T extends TableData>(table: T): T {
  if (Object.values(table.cols).every((column) => column.w !== undefined)) return table;
  return { ...table, cols: mapObjectValues(table.cols, (column, key) => (column.w !== undefined ? column : { ...atField(column.at), w: columnWidth(table, key) })) };
}

/** Scales every column so the table is `width` wide (no column narrower than its words). */
export function scaleTableWidth<T extends TableData>(table: T, width: number, reference: TableData = table): T {
  const widthOf = (columnId: string): number => (reference.cols[columnId] !== undefined ? columnWidth(reference, columnId) : columnWidth(table, columnId));
  const scale = width / tableColumnIds(table).reduce((sum, columnId) => sum + widthOf(columnId), 0);
  return {
    ...table,
    cols: mapObjectValues(table.cols, (column, key) => ({
      ...atField(column.at),
      w: clampColumnWidth(Math.max(widthOf(key) * scale, columnMinWidth(table, key, widthOf(key)))),
    })),
  };
}

/**
 * Undo/redo of a table edit applied over current content: takes the
 * incoming rows, columns, fills and heat maps but keeps column widths that
 * changed locally since `base`.
 */
export function mergeTableEdit<T extends { type: string }>(current: T, incoming: { type: string }, base?: { type: string }): T {
  if (current.type !== 'table' || incoming.type !== 'table') return current;
  const local = current as unknown as TableElement;
  const remote = incoming as TableElement;
  const baseTable = base?.type === 'table' ? (base as TableElement) : undefined;
  if (local.cols === remote.cols && local.rows === remote.rows && local.fills === remote.fills && local.heat === remote.heat) return current;
  const cols = mapObjectValues(remote.cols, (column, key): TableColumn => {
    const width = baseTable !== undefined && local.cols[key] !== undefined && baseTable.cols[key]?.w !== local.cols[key]?.w ? local.cols[key]?.w : column.w;
    return { ...atField(column.at), ...(width !== undefined ? { w: width } : {}) };
  });
  const merged = { ...current, cols, rows: remote.rows, fills: remote.fills, heat: remote.heat };
  for (const field of ['fills', 'heat'] as const) if (merged[field] === undefined) Reflect.deleteProperty(merged, field);
  return merged;
}

/* -------------------------------------------------------------------------- */
/* TSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Parses tab-separated text (as spreadsheets copy it, with `"…"` quoting)
 * into a grid; `undefined` unless it has at least two columns, every row has
 * the same number of cells and some first cell is not empty.
 */
export function parseTsvGrid(text: string): string[][] | undefined {
  if (!text.includes('\t')) return undefined;
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const rows: string[][] = [[]];
  let cell = '';
  let inQuotes = false;
  const endCell = (): void => {
    rows[rows.length - 1]!.push(cell);
    cell = '';
  };
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized.charAt(index);
    if (inQuotes) {
      if (char === '"' && normalized.charAt(index + 1) === '"') {
        cell += '"';
        index++;
      } else if (char === '"') inQuotes = false;
      else cell += char;
    } else if (char === '"' && cell === '') inQuotes = true;
    else if (char === '\t') endCell();
    else if (char === '\n') {
      endCell();
      rows.push([]);
    } else cell += char;
  }
  endCell();
  const columnCount = rows[0]?.length ?? 0;
  return columnCount >= 2 && rows.every((row) => row.length === columnCount) && rows.some((row) => row[0] !== '') ? rows : undefined;
}

/** The table as tab-separated text. */
export function tableToTsv(table: TableData, formatCell: (text: string) => string = (text) => text): string {
  return tableCellGrid(table)
    .map((row) => row.map(formatCell).join('\t'))
    .join('\n');
}
