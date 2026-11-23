/**
 * The placing tools: Note, Text, Shape, Section and Table.
 *
 * - Note: a click drops a note centered on it, over an item too (the tool
 *   stays the Note tool).
 * - Text: a click starts a new text whose first line sits on it.
 * - Shape and Section: drag out a box (Shift keeps it square); a click
 *   drops one of the default size.
 * - Table: a click drops an empty 3 × 3 table and types into its first cell.
 *
 * Each hands the tool back to Select after placing (unless it is sticky).
 */

import {
  MAX_ELEMENT_SIZE,
  MIN_DRAG_TEXT_WIDTH,
  MIN_ELEMENT_SIZE,
  type BoardElement,
  type Box,
  type ElementId,
} from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';
import { addedMessage, announce } from '../services/announce.ts';
import { editContent } from '../services/actions.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { gestureKey, pastThreshold, type Gesture, type PointerSample } from './gesture.ts';
import {
  DEFAULT_PLACE_SIZE,
  createContainer,
  createNoteAt,
  createShape,
  createShapeAt,
  createTableAt,
  createTextAt,
  ensureRoom,
  placeElement,
} from './place.ts';
import { forgetTap } from './select.ts';

/** A gesture that places something when the press is released without dragging far. */
function placeOnRelease(place: (at: Point) => void): Gesture {
  return {
    cursor: 'crosshair',
    up(end) {
      place(end.board);
    },
  };
}

/** The Note tool's press. */
export function notePress(sample: PointerSample): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const at = sample.board;
  return placeOnRelease(() => placeElement(createNoteAt(at), { label: 'Add note' }));
}

/** The Text tool's press. */
export function textPress(sample: PointerSample): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const at = sample.board;
  return placeOnRelease(() => placeElement(createTextAt(at), { label: 'Add text' }));
}

/** The Table tool's press. */
export function tablePress(sample: PointerSample): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const at = sample.board;
  return placeOnRelease(() => placeElement(createTableAt(at), { label: 'Add table' }));
}

/**
 * The box a drag from `start` to `end` draws: at least `min` and at most
 * {@link MAX_ELEMENT_SIZE} on each side, square with `square`, growing away
 * from the start in the drag's direction.
 */
export function drawnShapeBox(start: Point, end: Point, square: boolean, min: number): Box {
  let w = Math.abs(end.x - start.x);
  let h = Math.abs(end.y - start.y);
  if (square) w = h = Math.max(w, h);
  w = Math.min(MAX_ELEMENT_SIZE, Math.max(min, w));
  h = Math.min(MAX_ELEMENT_SIZE, Math.max(min, h));
  return { x: end.x < start.x ? start.x - w : start.x, y: end.y < start.y ? start.y - h : start.y, w, h };
}

/** Drag-to-size for shapes and sections. */
function drawBoxGesture(sample: PointerSample, kind: 'shape' | 'container'): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const start = sample.board;
  const min = kind === 'container' ? MIN_DRAG_TEXT_WIDTH : MIN_ELEMENT_SIZE;
  const label = kind === 'container' ? 'Add section' : 'Add shape';
  const make = (box: Box): BoardElement => (kind === 'container' ? createContainer(box) : createShape(useTool.getState().shapeKind, box));
  let id: ElementId | null = null;
  let key = '';
  let template: BoardElement | null = null;
  const write = (box: Box): void => {
    if (!template) return;
    const next = { ...template, x: box.x, y: box.y, w: box.w, h: box.h } as BoardElement;
    editContent(
      (content) =>
        content.elements.some((element) => element.id === next.id)
          ? { ...content, elements: content.elements.map((element) => (element.id === next.id ? next : element)) }
          : { ...content, elements: [...content.elements, next] },
      { label, coalesce: key },
    );
  };
  return {
    cursor: 'crosshair',
    move(next) {
      if (!template && !pastThreshold(sample.screen, next.screen, next.event)) return;
      const box = drawnShapeBox(start, next.board, next.event.shiftKey, min);
      if (!template) {
        template = make(box);
        id = template.id;
        key = gestureKey('draw', id);
        useSelection.getState().select([id]);
      }
      write(box);
    },
    up() {
      if (!template || id === null) {
        const element =
          kind === 'container'
            ? createContainer({ x: start.x, y: start.y, w: DEFAULT_PLACE_SIZE.w, h: DEFAULT_PLACE_SIZE.h })
            : createShapeAt(useTool.getState().shapeKind, start);
        placeElement(element, { label });
        return;
      }
      useSelection.getState().select([id]);
      useSelection.getState().edit({ kind: 'element', id, selectAll: true });
      announce(addedMessage(kind));
      useTool.getState().placed();
    },
    cancel() {
      if (id === null) return;
      const gone = id;
      editContent((content) => ({ ...content, elements: content.elements.filter((element) => element.id !== gone) }), { label, coalesce: key });
      useSelection.getState().clear();
    },
  };
}

/** The Shape tool's press. */
export function shapePress(sample: PointerSample): Gesture | null {
  return drawBoxGesture(sample, 'shape');
}

/** The Section tool's press. */
export function containerPress(sample: PointerSample): Gesture | null {
  return drawBoxGesture(sample, 'container');
}
