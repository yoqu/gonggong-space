/**
 * Hit testing for presses: the element under a point (with the section
 * fallback a press on empty space inside a section gets), where an arrow end
 * dropped at a point attaches, the side dots around an item, and the 45°
 * constraint Shift puts on lines.
 *
 * Everything takes a {@link HitContext} so it can be tested without stores;
 * {@link hitContext} builds one from the live board, measures and camera.
 */

import {
  ARROW_END_SNAP_PX,
  boxSideMidpoint,
  boxSideTowardPoint,
  containerTitleBandHeightAt,
  containerTitleBounds,
  containerTitleScaleForZoom,
  elementBounds,
  elementLayoutBox,
  findArrowEndTarget,
  hasRoomForContainerTitle,
  hitSlop,
  isElementLocked,
  isFramedBoxElement,
  pointToBoxDistance,
  topElementAt,
  type ArrowEndChoice,
  type ArrowSide,
  type BoardElement,
  type Box,
  type ContainerElement,
  type ElementId,
  type ElementMeasures,
  type ElementsById,
} from '@open-artifact/whiteboard-core';
import { visibleRect, type Point, type Rect } from '../lib/camera.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { SIDE_DOT_OFFSET_PX } from './place.ts';

/** What hit tests look at. */
export interface HitContext {
  /** The board's elements, back to front. */
  elements: readonly BoardElement[];
  /** The same elements by id. */
  byId: ElementsById;
  /** Measured sizes. */
  measures: ElementMeasures;
  /** The zoom. */
  zoom: number;
  /** The visible board area. */
  view: Rect;
}

/** A hit context over the live board, measures and camera. */
export function hitContext(): HitContext {
  const { board, byId } = useBoard.getState();
  const { camera, width, height } = useCamera.getState();
  return {
    elements: board.content.elements,
    byId,
    measures: currentMeasures(),
    zoom: camera.zoom,
    view: visibleRect(camera, width || Infinity, height || Infinity),
  };
}

/** The topmost element at a point (see core `topElementAt`). */
export function hitElementAt(context: HitContext, point: Point, pointerType: string): BoardElement | undefined {
  return topElementAt(context.elements, point.x, point.y, hitSlop(pointerType, context.zoom), context.measures, context.byId, context.zoom);
}

/**
 * The smallest section at a point: on its title band, or (unless
 * `titleOnly`) anywhere inside its area, `slop` included.
 */
export function containerAtPoint(
  elements: readonly BoardElement[],
  point: Point,
  slop: number,
  measures: ElementMeasures,
  zoom: number,
  titleOnly = false,
): ContainerElement | undefined {
  let best: ContainerElement | undefined;
  for (const element of elements) {
    if (element.type !== 'container' || (best !== undefined && element.w * element.h > best.w * best.h)) continue;
    // As the view draws the title (and the “Add a title” hint).
    const titleScale = containerTitleScaleForZoom(zoom, measures.get(element.id)?.titleMost);
    const titleHeight = containerTitleBandHeightAt(titleScale, zoom);
    const titleBox = containerTitleBounds(element, measures, zoom) ?? {
      x: element.x,
      y: element.y - titleHeight,
      w: Math.min(element.w, ((measures.get(element.id)?.w ?? 90) + 4) * titleScale),
      h: titleHeight,
    };
    const onTitle =
      hasRoomForContainerTitle(element, zoom) &&
      point.x >= titleBox.x - slop &&
      point.x <= Math.min(element.x + element.w, titleBox.x + titleBox.w + 6 * slop) &&
      point.y >= titleBox.y &&
      point.y <= element.y;
    const bottom = element.y + (elementLayoutBox(element, measures)?.h ?? element.h);
    const inside = point.x >= element.x - slop && point.x <= element.x + element.w + slop && point.y >= element.y - slop && point.y <= bottom + slop;
    if (onTitle || (!titleOnly && inside)) best = element;
  }
  return best;
}

/** True when an element covers at least 70% of the visible board. */
export function fillsViewport(context: HitContext, element: BoardElement): boolean {
  const box = elementLayoutBox(element, context.measures);
  if (!box) return false;
  const { view } = context;
  const overlapW = Math.max(0, Math.min(box.x + box.w, view.x + view.w) - Math.max(box.x, view.x));
  const overlapH = Math.max(0, Math.min(box.y + box.h, view.y + view.h) - Math.max(box.y, view.y));
  return overlapW * overlapH >= 0.7 * view.w * view.h;
}

/**
 * The section a press on empty space inside it picks: the smallest one
 * there (a locked one only on its title). A section that fills the view is
 * only picked on its title, so a press inside it can still start a marquee.
 */
export function hitPressTarget(context: HitContext, point: Point, pointerType: string): ContainerElement | undefined {
  const slop = hitSlop(pointerType, context.zoom);
  const onTitle = (element: BoardElement): boolean => containerAtPoint([element], point, slop, context.measures, context.zoom, true) !== undefined;
  const hit = containerAtPoint(
    context.elements.filter((element) => !isElementLocked(element) || onTitle(element)),
    point,
    slop,
    context.measures,
    context.zoom,
  );
  if (!hit) return undefined;
  return fillsViewport(context, hit) && !onTitle(hit) ? undefined : hit;
}

/**
 * {@link hitPressTarget}, except that a drawing or arrow close to the point
 * (within 2.5× the usual slop) wins over the section around it.
 */
export function hitPressTargetOrLine(context: HitContext, point: Point, pointerType: string): BoardElement | undefined {
  const hit = hitPressTarget(context, point, pointerType);
  if (!hit) return undefined;
  const lines = context.elements.filter((element) => element.type === 'stroke' || element.type === 'arrow');
  return topElementAt(lines, point.x, point.y, 2.5 * hitSlop(pointerType, context.zoom), context.measures, context.byId, context.zoom) ?? hit;
}

/**
 * The element a press picks: what is under the point, or (when allowed) the
 * section around an empty spot, or a line near it.
 */
export function pressTargetAt(context: HitContext, point: Point, pointerType: string, sectionFallback: boolean): BoardElement | undefined {
  return hitElementAt(context, point, pointerType) ?? (sectionFallback ? hitPressTargetOrLine(context, point, pointerType) : undefined);
}

/* ------------------------------------------------------------------------ */
/* Side dots and arrow ends                                                 */
/* ------------------------------------------------------------------------ */

/** The four sides arrows connect to, in dot order. */
export const CONNECT_SIDES: readonly ArrowSide[] = ['top', 'right', 'bottom', 'left'];

/** The side across from each side. */
export const OPPOSITE_SIDE: Readonly<Record<ArrowSide, ArrowSide>> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

/**
 * Where an item's side dot sits: a little outside the middle of the side,
 * or on the edge itself (`onEdge`) when the item is big enough on screen.
 */
export function sideDotPoint(box: Box, side: ArrowSide, zoom: number, onEdge = false): Point {
  const point = boxSideMidpoint(box, side);
  const offset = onEdge && Math.min(box.w, box.h) * zoom >= 32 ? 0 : SIDE_DOT_OFFSET_PX / zoom;
  return {
    x: point.x + (side === 'left' ? -offset : side === 'right' ? offset : 0),
    y: point.y + (side === 'top' ? -offset : side === 'bottom' ? offset : 0),
  };
}

/** True when a point is within `band` (default: a fifth of the box, at least 18) of a box's edge. */
export function isNearBoxEdge(box: Box, x: number, y: number, band?: number): boolean {
  const edgeDistance = Math.min(x - box.x, box.x + box.w - x, y - box.y, box.y + box.h - y);
  const reach = band ?? Math.max(18, Math.min(box.w, box.h) * 0.2);
  return edgeDistance <= reach && edgeDistance >= -reach;
}

/**
 * Where an arrow end dropped at a point attaches: a side dot of an item
 * near it, the item under it (on the side facing the point when near an
 * edge), an item within snapping reach, or the free point itself.
 * `ownId` is the item the other end is on (it never attaches twice);
 * `allowFree: false` gives `{ end: [x, y] }` without looking for reach.
 */
export function arrowEndAt(context: HitContext, point: Point, pointerType: string, ownId?: ElementId | readonly [number, number], allowFree = true): ArrowEndChoice {
  const { x, y } = point;
  const own = typeof ownId === 'string' ? ownId : undefined;
  const connectable = context.elements.filter(isFramedBoxElement);
  const slop = hitSlop(pointerType, context.zoom);
  const hit = topElementAt(connectable, x, y, slop, context.measures, undefined, context.zoom);
  const reach = (pointerType === 'touch' ? 22 : SIDE_DOT_OFFSET_PX) / context.zoom;
  let best: { end: ElementId; side: ArrowSide; d: number } | undefined;
  for (const element of connectable) {
    const box = element.id !== own ? elementBounds(element, context.measures) : undefined;
    if (!box || x < box.x - 2 * reach || x > box.x + box.w + 2 * reach || y < box.y - 2 * reach || y > box.y + box.h + 2 * reach) continue;
    if (pointToBoxDistance(box, x, y) === 0 && (!isNearBoxEdge(box, x, y) || (own !== undefined && hit !== undefined && hit.id !== element.id))) continue;
    for (const side of CONNECT_SIDES) {
      const anchor = sideDotPoint(box, side, context.zoom, own !== undefined && element.type !== 'container');
      const distance = Math.hypot(anchor.x - x, anchor.y - y);
      if (distance <= reach && distance <= (best?.d ?? reach)) best = { end: element.id, side, d: distance };
    }
  }
  if (best) return { end: best.end, side: best.side };
  const hitBox = hit ? elementBounds(hit, context.measures) : undefined;
  if (!hit || !hitBox) {
    if (!allowFree) return { end: [x, y] };
    const overSomething = topElementAt(
      context.elements.filter((element) => element.type !== 'arrow'),
      x,
      y,
      slop,
      context.measures,
      undefined,
      context.zoom,
    );
    const near = overSomething
      ? undefined
      : findArrowEndTarget(
          connectable.filter((element) => element.id !== own),
          x,
          y,
          ARROW_END_SNAP_PX[pointerType === 'touch' ? 'touch' : 'mouse'] / context.zoom,
          (element) => elementLayoutBox(element, context.measures),
        );
    return near ?? { end: [x, y] };
  }
  return { end: hit.id, ...(isNearBoxEdge(hitBox, x, y) ? { side: boxSideTowardPoint(hitBox, x, y) } : {}) };
}

/** The board point an arrow end stands for: a free point, or the side (or middle) of the item it is on. */
export function arrowEndPoint(context: HitContext, choice: ArrowEndChoice): Point | undefined {
  if (typeof choice.end !== 'string') return { x: choice.end[0], y: choice.end[1] };
  const element = context.byId.get(choice.end);
  const box = element ? elementBounds(element, context.measures) : undefined;
  if (!box) return undefined;
  return choice.side !== undefined ? boxSideMidpoint(box, choice.side) : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** `to` moved onto the nearest 45° line through `from` (keeping its distance along that line). */
export function snapEndToFortyFiveDegrees(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...to };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: from.x + Math.cos(angle) * along, y: from.y + Math.sin(angle) * along };
}
