/**
 * Changing what a block is: a shape becomes another shape kind or plain
 * text, and text becomes a shape. The block keeps its words, its spot (it
 * stays centered where it was) and its style where the new kind has one.
 * Also the fill toggle, which hollows a shape out or fills it again.
 */

import {
  MAX_AUTO_FIT_BOX,
  defaultShapeSize,
  fittedBoxPatch,
  measureRichTextBlock,
  normalizeElementOrKeep,
  shapeTextInsets,
  type BoardContent,
  type BoardElement,
  type Box,
  type ShapeElement,
  type ShapeKind,
  type TextElement,
} from '@open-artifact/whiteboard-core';

/** A block kind: a shape kind, or plain text. */
export type BlockKind = ShapeKind | 'text';

/** An element whose kind can change. */
export type KindChangeable = ShapeElement | TextElement;

/** True for elements whose kind can change. */
export function isKindChangeable(element: BoardElement | undefined): element is KindChangeable {
  return element?.type === 'shape' || element?.type === 'text';
}

/** The block kind of a shape or text. */
export function blockKindOf(element: KindChangeable): BlockKind {
  return element.type === 'shape' ? element.kind : 'text';
}

/** Widest a shape's text runs before turning it into text wraps it. */
const TEXT_WRAP_FROM = 480;
/** Narrowest wrap a turned-into text gets. */
const TEXT_MIN_WRAP = 320;
/** Room around the words when text becomes a shape. */
const SHAPE_TEXT_ROOM = 24;

/**
 * The element turned into `kind`, centered on `box` (its drawn box). The
 * same element comes back when it already is that kind.
 */
export function convertElementKind(element: KindChangeable, kind: BlockKind, box: Box): BoardElement {
  if (blockKindOf(element) === kind) return element;
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  if (element.type === 'shape') {
    if (kind !== 'text') return normalizeElementOrKeep({ ...element, kind, ...fittedBoxPatch({ ...element, kind }) });
    const { type: _type, kind: _kind, w: _w, h: _h, color: _color, stroke: _stroke, solid: _solid, hollow: _hollow, ink, size = 'small', ...rest } = element;
    const measured = measureRichTextBlock(element.text, size);
    const insets = shapeTextInsets(element.kind, element.w, element.h);
    const inner = element.w * (1 - insets.left - insets.right);
    const wrap = measured.w > Math.max(inner, TEXT_WRAP_FROM) ? Math.round(Math.max(inner, TEXT_MIN_WRAP)) : undefined;
    const text: TextElement = {
      ...rest,
      type: 'text',
      size,
      color: ink ?? 'ink',
      x: centerX - (wrap ?? measured.w) / 2,
      y: wrap === undefined ? centerY - measured.h / 2 : element.y,
      ...(wrap !== undefined ? { wrap } : {}),
    };
    return normalizeElementOrKeep(text);
  }
  if (kind === 'text') return element;
  const { type: _type, wrap: _wrap, color, ...kept } = element;
  const size = defaultShapeSize(kind);
  const insets = shapeTextInsets(kind, size.w, size.h);
  const width = Math.max(size.w, Math.min(MAX_AUTO_FIT_BOX.w, Math.ceil((box.w + SHAPE_TEXT_ROOM) / (1 - insets.left - insets.right))));
  const shape: ShapeElement = {
    ...kept,
    type: 'shape',
    kind,
    x: centerX - width / 2,
    y: centerY - size.h / 2,
    w: width,
    h: size.h,
    color: 'white',
    ...(color !== 'ink' ? { ink: color } : {}),
  };
  return normalizeElementOrKeep({ ...shape, ...fittedBoxPatch(shape) });
}

/** Replaces one element (by id) in the content. */
function putElement<T extends BoardContent>(content: T, element: BoardElement): T {
  let changed = false;
  const elements = content.elements.map((current) => {
    if (current.id !== element.id || current === element) return current;
    changed = true;
    return element;
  });
  return changed ? { ...content, elements } : content;
}

/** Turns every given element into `kind` (`boxOf` gives each one's drawn box). */
export function setKindForElements<T extends BoardContent>(content: T, elements: readonly KindChangeable[], kind: BlockKind, boxOf: (element: BoardElement) => Box | undefined): T {
  return elements.reduce((next, element) => {
    const box = boxOf(element);
    return box ? putElement(next, convertElementKind(element, kind, box)) : next;
  }, content);
}

/**
 * Hollows shapes out (`none`, which needs an outline: shapes without one
 * get the plain ink) or fills them again (`fill`).
 */
export function setShapeFillMode<T extends BoardContent>(content: T, shapes: readonly ShapeElement[], mode: 'fill' | 'none'): T {
  return shapes.reduce((next, shape) => {
    if (mode === 'fill') {
      if (shape.hollow !== true) return next;
      const { hollow: _hollow, ...filled } = shape;
      return putElement(next, filled);
    }
    if (shape.hollow === true) return next;
    return putElement(next, normalizeElementOrKeep({ ...shape, hollow: true, stroke: shape.stroke ?? 'ink' }));
  }, content);
}
