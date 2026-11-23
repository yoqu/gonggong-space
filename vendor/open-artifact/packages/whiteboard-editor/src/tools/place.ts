/**
 * Shared pieces of the placing tools: the sizes new items get, factories
 * for each new element, the board-full check, and {@link placeElement},
 * which adds an element, selects it, starts typing into it when it holds
 * words, announces it and hands the tool back to Select.
 */

import {
  COLUMN_WIDTH_LIMITS,
  TABLE_CELL_PADDING,
  createElementId,
  createPastedTable,
  defaultShapeSize,
  noteColorForAuthor,
  scaleTableWidth,
  tableColumnIds,
  tableRowIds,
  tableRowHeights,
  truncateAuthorName,
  wouldExceedElementLimit,
  type BoardElement,
  type Box,
  type ContainerElement,
  type ElementType,
  type FillColor,
  type NoteElement,
  type ShapeElement,
  type ShapeKind,
  type TableElement,
  type TextElement,
} from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { BOARD_FULL_MESSAGE, addedMessage, announce, refuse } from '../services/announce.ts';
import { addElements, ensureEditable, viewerAuthor } from '../services/actions.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';

/** Side of a new sticky note. */
export const NOTE_TEMPLATE_SIZE = 180;
/** Size of a section placed with a click. */
export const DEFAULT_PLACE_SIZE = { w: 480, h: 320 } as const;
/** A new text's top sits this far above the click, so the caret lands on it. */
export const TEXT_TEMPLATE_Y = -11;
/** Two taps this close in time (ms) and space (screen px) are a double tap. */
export const DOUBLE_TAP = { ms: 500, px: 5 } as const;
/** Screen pixels a press must travel before a handle drag starts. */
export const TRANSFORM_START_SLOP_PX = 4;
/** Screen pixels a press on empty board must travel before the marquee starts. */
export const MARQUEE_START_SLOP_PX = 4;
export { SIDE_DOT_OFFSET_PX } from '../lib/side-dots.ts';
/** Side dots show only from this zoom, on an item at least this big on screen (pixels). */
export const SIDE_DOTS_MIN_SIZE = { zoom: 0.25, px: 40 } as const;
/**
 * The hovered item stays hovered while the pointer is this close (screen
 * pixels) to its edge over another item; over empty board it stays out to
 * its side dots.
 */
export const HOVER_KEEP_SLOP_PX = 4;

/** The zoom right now. */
export function currentZoom(): number {
  return useCamera.getState().camera.zoom;
}

/**
 * Whether `adding` more elements fit: refuses (read-only or the board is
 * full) and returns `false` when they do not.
 */
export function ensureRoom(adding = 1): boolean {
  if (!ensureEditable()) return false;
  if (wouldExceedElementLimit(useBoard.getState().board.content, adding)) return refuse(BOARD_FULL_MESSAGE);
  return true;
}

export { randomNoteTilt } from '../state/tool.ts';

/** A new empty note centered on `center`, in the author's color and stamped with the author. */
export function createNoteAt(center: Point, tilt = useTool.getState().takeNoteTilt()): NoteElement {
  const author = viewerAuthor();
  return {
    type: 'note',
    id: createElementId(),
    x: center.x - NOTE_TEMPLATE_SIZE / 2,
    y: center.y - NOTE_TEMPLATE_SIZE / 2,
    w: NOTE_TEMPLATE_SIZE,
    h: NOTE_TEMPLATE_SIZE,
    color: author.id !== null ? noteColorForAuthor(author.id) : useTool.getState().noteColor,
    size: 'body',
    text: '',
    tilt,
    ...(author.name !== null ? { author: truncateAuthorName(author.name) } : {}),
    ...(author.id !== null ? { authorId: [...author.id].slice(0, 128).join('') } : {}),
  };
}

/** A new empty text whose first line sits on `point`. */
export function createTextAt(point: Point): TextElement {
  return { type: 'text', id: createElementId(), x: point.x, y: point.y + TEXT_TEMPLATE_Y, text: '', size: 'body', color: 'ink' };
}

/** A new empty shape in a box (the tool's fill). */
export function createShape(kind: ShapeKind, box: Box, color: FillColor = useTool.getState().shapeColor): ShapeElement {
  return { type: 'shape', id: createElementId(), kind, x: box.x, y: box.y, w: box.w, h: box.h, color, size: 'body', text: '' };
}

/** A new shape of the default size centered on `center`. */
export function createShapeAt(kind: ShapeKind, center: Point): ShapeElement {
  const size = defaultShapeSize(kind);
  return createShape(kind, { x: center.x - size.w / 2, y: center.y - size.h / 2, w: size.w, h: size.h });
}

/** A new untitled section in a box. */
export function createContainer(box: Box): ContainerElement {
  return { type: 'container', id: createElementId(), x: box.x, y: box.y, w: box.w, h: box.h, color: 'white', text: '' };
}

/** A new empty 3 × 3 table whose first cell starts at `point`. */
export function createTableAt(point: Point): TableElement {
  const table = scaleTableWidth(
    createPastedTable([
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ]),
    3 * COLUMN_WIDTH_LIMITS.fresh,
  );
  return { ...table, x: Math.round(point.x - TABLE_CELL_PADDING.padX), y: Math.round(point.y - (tableRowHeights(table)[0] ?? 0) / 2) };
}

/** Element types that start typing when placed. */
const TYPES_TYPED_ON_PLACE: ReadonlySet<ElementType> = new Set(['note', 'text', 'shape', 'container']);

/** Options of {@link placeElement}. */
export interface PlaceOptions {
  /** Undo label. */
  label: string;
  /** Start typing into it (default: for notes, texts, shapes and sections). */
  edit?: boolean;
  /** Keep the tool armed (default: hand back to Select unless the tool is sticky). */
  keepTool?: boolean;
}

/**
 * Adds a new element, selects it, starts typing into it when it holds words,
 * announces it and hands the tool back to Select. Returns `false` (with a
 * spoken reason) when the board is read-only or full.
 */
export function placeElement(element: BoardElement, options: PlaceOptions): boolean {
  if (!ensureRoom()) return false;
  if (!addElements([element], options.label)) return false;
  if (element.type === 'table') {
    const [row] = tableRowIds(element);
    const [col] = tableColumnIds(element);
    if (options.edit !== false && row !== undefined && col !== undefined) useSelection.getState().edit({ kind: 'cell', id: element.id, row, col });
  } else if (options.edit ?? TYPES_TYPED_ON_PLACE.has(element.type)) {
    useSelection.getState().edit({ kind: 'element', id: element.id, selectAll: true });
  }
  announce(addedMessage(element.type));
  if (!options.keepTool) useTool.getState().placed();
  return true;
}
