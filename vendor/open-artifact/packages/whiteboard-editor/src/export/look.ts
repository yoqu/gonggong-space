/**
 * Styling rules the exporter needs that the core model does not carry:
 * text alignment and colors per element, table colors, sticker rims, face
 * sticker rings, card colors for embeds and links, and arrow paths.
 *
 * They match how the board draws each element, so a downloaded picture
 * looks like the board. Everything here is pure.
 */

import {
  BOARD_THEME_COLORS,
  DEFAULT_STICKER_SIZE,
  TEXT_SIZE_STYLES,
  arrowHeadFlags,
  boardInkColor,
  chipColorOn,
  columnWidth,
  contrastTextColorOn,
  inkColorHex,
  isSameBlockColor,
  parseRgbaColor,
  roundedRoutePath,
  shapeFillForColor,
  shapeTextColor,
  tableCellValue,
  tableColumnIds,
  tableRowIds,
  themedInkColor,
  type ArrowGeometry,
  type ArrowHeadKind,
  type Box,
  type ColorScheme,
  type NoteElement,
  type Rgba,
  type ShapeElement,
  type TableCellMap,
  type TableCellPaint,
  type TableElement,
  type TextAlign,
} from '@open-artifact/whiteboard-core';

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** An element's text alignment: shapes center by default, everything else starts left. */
export function textAlignOf(element: { type: string; textAlign?: TextAlign }): TextAlign {
  return element.textAlign ?? (element.type === 'shape' ? 'center' : 'left');
}

/** The text color of a note or shape: its ink, else the color that reads on its fill. */
export function paperTextColor(element: NoteElement | ShapeElement, scheme: ColorScheme): string {
  if (element.type === 'shape') return shapeTextColor(element, scheme);
  return element.ink !== undefined ? inkColorHex(element.ink) : contrastTextColorOn(element.color);
}

/** The color an element draws its ink in (arrows and their labels). */
export function elementInkColor(element: { color: string }, scheme: ColorScheme): string {
  return themedInkColor(element.color, scheme);
}

/* -------------------------------------------------------------------------- */
/* Shapes, cards and faces                                                    */
/* -------------------------------------------------------------------------- */

/** Width of the subtle inner edge of a filled shape. */
export const SHAPE_EDGE_WIDTH = 1;

/** Fill and outline of the cards that stand in for embeds and links: `[fill, stroke]`. */
export const EXPORT_CARD_COLORS: Readonly<Record<ColorScheme, readonly [string, string]>> = {
  light: ['#ffffff', 'rgba(0,0,0,.12)'],
  dark: ['#1f1f1f', 'rgba(255,255,255,.24)'],
};

/** Ring color of a face sticker when authors are hidden. */
export const FACE_STICKER_RING_COLOR = '#D1D1D1';

/** The white rim of a face sticker `size` across. */
export function faceStickerRingWidth(size: number): number {
  return Math.max(2, size * 0.06);
}

/* -------------------------------------------------------------------------- */
/* Sticker rims                                                               */
/* -------------------------------------------------------------------------- */

/** Width of a sticker's white die-cut rim at the default sticker size. */
export const STICKER_OUTLINE_WIDTH = 4;
/** Color of the die-cut rim. */
export const STICKER_OUTLINE_COLOR = '#FFFFFF';
/** Width of the faint edge around the rim (light boards only). */
export const STICKER_EDGE_WIDTH = 0.6;
/** Color of the faint edge around the rim. */
export const STICKER_EDGE_COLOR = '#D6D6D6';

/** How far a sticker's rim reaches past its box. */
export function stickerOutlinePadding(size: number): number {
  return ((STICKER_OUTLINE_WIDTH + STICKER_EDGE_WIDTH + 4) * size) / DEFAULT_STICKER_SIZE;
}

/** One rim stamp: an offset as a share of the sticker size, and its color. */
export type StickerRimStamp = readonly [dx: number, dy: number, color: string];

/** `count` stamps on a circle of `radius` (default-size units). */
function ringStamps(radius: number, color: string, count: number): StickerRimStamp[] {
  return Array.from({ length: count }, (_, index) => [
    (Math.cos((index * 2 * Math.PI) / count) * radius) / DEFAULT_STICKER_SIZE,
    (Math.sin((index * 2 * Math.PI) / count) * radius) / DEFAULT_STICKER_SIZE,
    color,
  ]);
}

/**
 * The stamps that draw a sticker's rim: the art repeated in the rim color
 * around itself, then (on light boards) a faint edge outside it.
 */
export function stickerOutlineShadows(withEdge: boolean): StickerRimStamp[] {
  return [
    ...ringStamps(STICKER_OUTLINE_WIDTH / 2, STICKER_OUTLINE_COLOR, 8),
    ...ringStamps(STICKER_OUTLINE_WIDTH, STICKER_OUTLINE_COLOR, 16),
    ...(withEdge ? ringStamps(STICKER_OUTLINE_WIDTH + STICKER_EDGE_WIDTH, STICKER_EDGE_COLOR, 16) : []),
  ];
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

/** Corner radius of a table. */
export const TABLE_RADIUS = 12;
/** Grid line color of tables. */
export const TABLE_LINE_COLORS: Readonly<Record<ColorScheme, string>> = { light: 'rgba(0,0,0,.08)', dark: 'rgba(255,255,255,.08)' };
/** Header fill of tables with a white header. */
export const TABLE_HEAD_FILLS: Readonly<Record<ColorScheme, string>> = { light: '#f6f6f6', dark: '#202020' };
/** How strongly a header color tints the paper. */
export const TABLE_HEAD_TINT_ALPHA = 0.25;

/** A 0–1 RGB color as `#rrggbb`. */
function rgbToHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Colors of a table's header row: its fill, text and code chips. */
export function tableHeadColors(table: Pick<TableElement, 'color' | 'ink'>, scheme: ColorScheme): { fill: string; ink: string; chip: string } {
  const color = parseRgbaColor(shapeFillForColor(table.color));
  const paper = parseRgbaColor(BOARD_THEME_COLORS[scheme].paper);
  const fill =
    isSameBlockColor(table.color, 'white') || color === undefined || paper === undefined
      ? TABLE_HEAD_FILLS[scheme]
      : rgbToHex({
          r: TABLE_HEAD_TINT_ALPHA * color.r + (1 - TABLE_HEAD_TINT_ALPHA) * paper.r,
          g: TABLE_HEAD_TINT_ALPHA * color.g + (1 - TABLE_HEAD_TINT_ALPHA) * paper.g,
          b: TABLE_HEAD_TINT_ALPHA * color.b + (1 - TABLE_HEAD_TINT_ALPHA) * paper.b,
          a: 1,
        });
  return { fill, ink: table.ink !== undefined ? themedInkColor(table.ink, scheme) : boardInkColor(scheme), chip: chipColorOn(fill) };
}

/** The weight of a table's header text (at least medium). */
export function tableHeadWeight(table: Pick<TableElement, 'size'>): number {
  return Math.max(500, TEXT_SIZE_STYLES[table.size ?? 'body'].weight);
}

/** Which sides of a tinted cell meet another tinted cell: there the board draws a divider in the paper color. */
export interface TableCellDividers {
  right: boolean;
  bottom: boolean;
}

/** The dividers of each tinted cell that has a tinted neighbor on its right or below it. */
export function tableTintDividers(
  table: Pick<TableElement, 'rows' | 'cols'>,
  paints: TableCellMap<TableCellPaint>,
): TableCellMap<TableCellDividers> {
  const rowIds = tableRowIds(table);
  const columnIds = tableColumnIds(table);
  const dividers: TableCellMap<TableCellDividers> = {};
  rowIds.forEach((rowId, rowIndex) => {
    columnIds.forEach((columnId, columnIndex) => {
      if (paints[rowId]?.[columnId] === undefined) return;
      const nextColumn = columnIds[columnIndex + 1];
      const nextRow = rowIds[rowIndex + 1];
      const right = nextColumn !== undefined && paints[rowId]?.[nextColumn] !== undefined;
      const bottom = nextRow !== undefined && paints[nextRow]?.[columnId] !== undefined;
      if (right || bottom) (dividers[rowId] ??= {})[columnId] = { right, bottom };
    });
  });
  return dividers;
}

/**
 * A table cell as the shape it is styled like: the header row filled with
 * the table's color, body cells hollow on the paper.
 */
export function tableCellShape(table: TableElement, rowId: string, columnId: string): ShapeElement {
  const head = table.head && tableRowIds(table)[0] === rowId;
  return {
    type: 'shape',
    id: table.id,
    kind: 'rect',
    x: 0,
    y: 0,
    w: columnWidth(table, columnId),
    h: 0,
    color: head ? table.color : 'white',
    ...(head ? {} : { stroke: 'ink', hollow: true as const }),
    size: table.size ?? 'body',
    ...(table.ink !== undefined ? { ink: table.ink } : {}),
    textAlign: table.textAlign ?? 'left',
    text: tableCellValue(table, rowId, columnId),
  };
}

/* -------------------------------------------------------------------------- */
/* Arrows                                                                     */
/* -------------------------------------------------------------------------- */

/** SVG `d` of an arrow's line: straight, or its route with rounded corners. */
export function arrowPathData(line: ArrowGeometry, heads: readonly [ArrowHeadKind, ArrowHeadKind]): string {
  if (line.elbow) return roundedRoutePath(line.elbow, arrowHeadFlags(heads));
  return `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`;
}

/** The point an arrow end's head points away from: the neighboring route point, or the other end. */
export function arrowEndNeighbor(line: ArrowGeometry, end: 'from' | 'to'): { x: number; y: number } {
  const neighbor = line.elbow?.[end === 'from' ? 1 : line.elbow.length - 2];
  if (neighbor) return { x: neighbor[0], y: neighbor[1] };
  return end === 'from' ? { x: line.x2, y: line.y2 } : { x: line.x1, y: line.y1 };
}

/** SVG `d` of a rectangle. */
export function rectPathData(box: Box): string {
  return `M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`;
}
