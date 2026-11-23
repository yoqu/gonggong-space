/**
 * Text backdrops: a text element drawn over a note or a filled rectangle
 * reads against that fill, so the renderer picks its ink color from the
 * fill instead of the board paper. The backdrop is the topmost opaque
 * element under the text; it counts only when it is a note or a filled
 * rectangle that holds the whole text (rotation included).
 */

import { elementBounds, elementLayoutBox, rotatePointAround, type Box, type ElementMeasures } from './geometry.ts';
import { elementTurn, type BoardElement, type ElementId, type NoteElement, type ShapeElement } from './schema.ts';
import { blockColorHex, shapeFillColor, type ColorScheme } from './theme.ts';
import { drawingLookPaper, imageDrawingLook } from './drawn-svg/looks.ts';

/** Slack (board units) when deciding that text sits inside or overlaps a backdrop. */
export const TEXT_BACKDROP_TOLERANCE = 4;

/** True for elements that hide what is drawn under them. */
export function isOpaqueElement(element: BoardElement): boolean {
  return (
    element.type === 'note' ||
    (element.type === 'shape' && element.hollow !== true) ||
    ['image', 'html', 'table', 'link', 'timer', 'sticker'].includes(element.type)
  );
}

/** True for elements whose fill a text on top reads against: notes and filled rectangles. */
export function isTextBackdropElement(element: BoardElement): element is NoteElement | ShapeElement {
  return element.type === 'note' || (element.type === 'shape' && element.hollow !== true && (element.kind === 'rect' || element.kind === 'rounded'));
}

/**
 * True when every corner of `inner` (rotated by its turn) lies inside
 * `outer` (rotated by its turn), within {@link TEXT_BACKDROP_TOLERANCE}.
 */
export function isRotatedBoxInside(outer: BoardElement, outerBox: Box, inner: BoardElement, innerBox: Box): boolean {
  const innerCenter = { x: innerBox.x + innerBox.w / 2, y: innerBox.y + innerBox.h / 2 };
  const outerCenter = { x: outerBox.x + outerBox.w / 2, y: outerBox.y + outerBox.h / 2 };
  return [0, 1, 2, 3].every((corner) => {
    const point = rotatePointAround(
      rotatePointAround({ x: innerBox.x + (corner % 2) * innerBox.w, y: innerBox.y + (corner >> 1) * innerBox.h }, innerCenter, elementTurn(inner)),
      outerCenter,
      -elementTurn(outer),
    );
    return (
      Math.abs(point.x - outerCenter.x) <= outerBox.w / 2 + TEXT_BACKDROP_TOLERANCE && Math.abs(point.y - outerCenter.y) <= outerBox.h / 2 + TEXT_BACKDROP_TOLERANCE
    );
  });
}

/**
 * The fill color (hex) behind each text element that sits on a backdrop:
 * the topmost opaque element drawn before the text and overlapping it by
 * more than {@link TEXT_BACKDROP_TOLERANCE}, when that element is a
 * backdrop that holds the whole text. Given the board's `scheme`, a
 * drawing whose look lays paper behind it is a backdrop in that paper's tone.
 */
export function textBackdropColors(elements: readonly BoardElement[], measures?: ElementMeasures, scheme?: ColorScheme): Map<ElementId, string> {
  const backdrops: Array<{ el: BoardElement; seen: Box }> = [];
  const backdropColorByTextId = new Map<ElementId, string>();
  for (const element of elements) {
    const bounds = element.type === 'text' || isOpaqueElement(element) ? elementBounds(element, measures) : undefined;
    if (bounds === undefined) continue;
    if (element.type !== 'text') {
      backdrops.push({ el: element, seen: bounds });
      continue;
    }
    for (let index = backdrops.length - 1; index >= 0; index--) {
      const { el: backdrop, seen } = backdrops[index]!;
      if (
        Math.min(bounds.x + bounds.w, seen.x + seen.w) - Math.max(bounds.x, seen.x) <= TEXT_BACKDROP_TOLERANCE ||
        Math.min(bounds.y + bounds.h, seen.y + seen.h) - Math.max(bounds.y, seen.y) <= TEXT_BACKDROP_TOLERANCE
      )
        continue;
      const backdropBox = elementLayoutBox(backdrop, measures);
      const textBox = elementLayoutBox(element, measures);
      const look = scheme !== undefined && backdrop.type === 'image' ? imageDrawingLook(backdrop) : undefined;
      const paper = look !== undefined && scheme !== undefined ? drawingLookPaper(look, scheme) : undefined;
      const inside = backdropBox !== undefined && textBox !== undefined && isRotatedBoxInside(backdrop, backdropBox, element, textBox);
      if (inside && paper !== undefined) backdropColorByTextId.set(element.id, paper);
      else if (inside && isTextBackdropElement(backdrop))
        backdropColorByTextId.set(element.id, backdrop.type === 'shape' ? shapeFillColor(backdrop) : blockColorHex(backdrop.color));
      break;
    }
  }
  return backdropColorByTextId;
}
