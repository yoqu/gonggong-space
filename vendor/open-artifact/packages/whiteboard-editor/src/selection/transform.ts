/**
 * The gestures the selection overlay's handles start: resizing (per-type
 * aspect rules, turned boxes, snapping edges to neighbours), turning,
 * dragging an arrow's end onto another item or point, side dots that draw a
 * connected arrow or (on a click) add the next item beside, and panning an image
 * inside its crop.
 *
 * Each writes the board on every frame under one coalesced undo step.
 */

import {
  ARROW_LEG_GRAB_PX,
  ELEMENT_KIND_AFFORDANCES,
  MAX_ELEMENT_SIZE,
  applyResizeDrag,
  bendsForDraggedSegment,
  captureRotationStart,
  carriedArrowEnds,
  elementLayoutBox,
  elementTurn,
  guidesTouchingEdges,
  isElementLocked,
  layoutBoxResolver,
  nextNoteBeside,
  nextShapeBeside,
  normalizeArrow,
  normalizeTurnDegrees,
  panImageCrop,
  placeNextItemAtSide,
  resizeCropViewport,
  zoomImageCrop,
  resizeRectFromEdges,
  resizeRectKeepingAspect,
  resizeRotatedRect,
  rotatableSelection,
  rotatedBoundingBox,
  rotateElements,
  rotationAngle,
  setArrowBends,
  snapResizeEdgesToGuides,
  unionBounds,
  withoutLockedIds,
  type ArrowElement,
  type ArrowSide,
  type BoardElement,
  type Box,
  type CropHandle,
  type ElementId,
  type ElementMeasures,
  type ImageCrop,
  type ImageElement,
  type NextItem,
  type ResizeDrag,
  type ResizeEdges,
  type RoutePoint,
  type TextResizeFitting,
} from '@open-artifact/whiteboard-core';
import { create } from 'zustand';
import { ARROW_ROUTE_MOVED_MESSAGE, addedMessage, announce, turnedMessage } from '../services/announce.ts';
import { boardElements, editContent, selectedIds, viewerAuthor } from '../services/actions.ts';
import { useBoard } from '../state/board.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { glideToReveal } from '../services/navigation.ts';
import { arrowDrawGesture } from '../tools/arrow.ts';
import { gestureKey, type Gesture, type PointerSample } from '../tools/gesture.ts';
import { arrowEndAt, hitContext } from '../tools/hit.ts';
import { currentZoom, ensureRoom, randomNoteTilt } from '../tools/place.ts';
import { hasModifier } from '../tools/select.ts';
import { guideLines, snapCandidatesNear, snapDistanceFor, stillBoxes } from '../tools/snap.ts';
import { offerNextItem } from './next-offer.ts';
import { useInteraction } from './store.ts';

/* ------------------------------------------------------------------------ */
/* Resize                                                                   */
/* ------------------------------------------------------------------------ */

/** A resize handle: the edges it drags. */
export type HandleName = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The edges each handle drags. */
export const HANDLE_EDGES: Readonly<Record<HandleName, ResizeEdges>> = {
  n: { x: null, y: 'top' },
  ne: { x: 'right', y: 'top' },
  e: { x: 'right', y: null },
  se: { x: 'right', y: 'bottom' },
  s: { x: null, y: 'bottom' },
  sw: { x: 'left', y: 'bottom' },
  w: { x: 'left', y: null },
  nw: { x: 'left', y: 'top' },
};

const CORNERS: readonly HandleName[] = ['nw', 'ne', 'se', 'sw'];
const SIDES_X: readonly HandleName[] = ['w', 'e'];
const ALL_HANDLES: readonly HandleName[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Types that always keep their aspect ratio. */
const ASPECT_TYPES: ReadonlySet<BoardElement['type']> = new Set(['sticker', 'image', 'stroke']);

/**
 * The resize handles a selection gets: none when something in it does not
 * resize; texts and tables only change width; stickers, images and drawings
 * only scale from their corners.
 */
export function resizeHandlesFor(elements: readonly BoardElement[]): readonly HandleName[] {
  const boxes = elements.filter((element) => element.type !== 'arrow');
  if (boxes.length === 0 || boxes.some((element) => !ELEMENT_KIND_AFFORDANCES[element.type].resizes)) return [];
  if (boxes.length === 1 && (boxes[0]!.type === 'text' || boxes[0]!.type === 'table')) return SIDES_X;
  if (boxes.every((element) => ASPECT_TYPES.has(element.type))) return CORNERS;
  return ALL_HANDLES;
}

/** Text fitting while resizing: text re-wraps at the new width, keeping the edge across from the dragged one. */
export const RESIZE_FITTING: TextResizeFitting = {
  fitTextToWidth(element, frame, edge, width) {
    return { ...element, wrap: width, x: edge === 'left' ? frame.x + frame.w - width : frame.x };
  },
  minResizeSizeForText(_element, _frame, w, h) {
    return { w, h };
  },
};

/** The box the selection frame draws around elements: a lone element's own box, or the union of turned bounds. */
export function selectionFrame(elements: readonly BoardElement[], measures = currentMeasures()): { box: Box; turn: number } | undefined {
  const boxes = elements.filter((element) => element.type !== 'arrow');
  if (boxes.length === 1) {
    const box = elementLayoutBox(boxes[0]!, measures);
    return box ? { box, turn: elementTurn(boxes[0]) } : undefined;
  }
  const union = unionBounds(boxes.flatMap((element) => {
    const box = elementLayoutBox(element, measures);
    return box ? [rotatedBoundingBox(box, elementTurn(element))] : [];
  }));
  return union ? { box: union, turn: 0 } : undefined;
}

/** Starts resizing the selection from a handle. */
export function resizeGesture(sample: PointerSample, handle: HandleName): Gesture | null {
  const before = useBoard.getState().board.content;
  const measures = currentMeasures();
  const ids = withoutLockedIds(before.elements, selectedIds());
  const selected = before.elements.filter((element) => ids.has(element.id) && element.type !== 'arrow');
  const frame = selectionFrame(selected, measures);
  if (!frame || selected.length === 0) return null;
  const members = new Map<ElementId, Box>();
  for (const element of selected) {
    const box = elementLayoutBox(element, measures);
    if (box) members.set(element.id, box);
  }
  const edge = HANDLE_EDGES[handle];
  const start = frame.box;
  const drag: ResizeDrag = { before, members, start, edge, freeEnds: carriedArrowEnds(before.elements, new Set(members.keys()), []) };
  const corner = edge.x !== null && edge.y !== null;
  const aspectTypes = selected.every((element) => ASPECT_TYPES.has(element.type));
  const min = { w: Math.min(40, start.w), h: Math.min(40, start.h) };
  const max = { w: MAX_ELEMENT_SIZE, h: MAX_ELEMENT_SIZE };
  const still = stillBoxes(before.elements, new Set(members.keys()), measures);
  const key = gestureKey('resize', selected[0]!.id);
  useInteraction.getState().setTransform('resize');
  const origin = sample.board;
  return {
    move(next) {
      let dx = next.board.x - origin.x;
      let dy = next.board.y - origin.y;
      const keepAspect = (corner && aspectTypes) !== next.event.shiftKey || selected.some((element) => element.type === 'sticker');
      const context = hitContext();
      let box: Box;
      if (frame.turn !== 0) box = resizeRotatedRect(start, frame.turn, edge, dx, dy, min, max, keepAspect);
      else if (keepAspect) box = resizeRectKeepingAspect(start, edge, dx, dy, min, max);
      else {
        const candidates = hasModifier(next.event) ? [] : snapCandidatesNear(still, start, context.view, context.zoom);
        const snap = snapResizeEdgesToGuides(start, edge, dx, dy, candidates, snapDistanceFor(start, context.zoom));
        dx += snap.dx;
        dy += snap.dy;
        box = resizeRectFromEdges(start, edge, dx, dy, min, max);
        useInteraction.getState().setGuides(guideLines(guidesTouchingEdges(box, edge, candidates), still, box, context.view, context.zoom));
      }
      editContent((content) => ({ ...content, elements: applyResizeDrag(content.elements, drag, box, RESIZE_FITTING) }), { label: 'Resize', coalesce: key });
    },
    up() {
      useInteraction.getState().reset();
    },
    cancel() {
      useInteraction.getState().reset();
      editContent((content) => ({ ...content, elements: applyResizeDrag(content.elements, drag, start, RESIZE_FITTING) }), { label: 'Resize', coalesce: key });
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Turn                                                                     */
/* ------------------------------------------------------------------------ */

/** True when the selection has something that turns. */
export function canTurnSelection(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): boolean {
  return rotatableSelection(elements, ids).items.length > 0;
}

/** Starts turning the selection around its center (Shift snaps to 15° steps). */
export function turnGesture(sample: PointerSample): Gesture | null {
  const elements = boardElements();
  const ids = withoutLockedIds(elements, selectedIds());
  const items = rotatableSelection(elements, ids).items;
  if (items.length === 0) return null;
  const start = captureRotationStart(items, elements, currentMeasures());
  const base = items.length === 1 ? elementTurn(items[0]) : 0;
  const from = sample.board;
  const key = gestureKey('turn', items[0]!.id);
  let degrees = 0;
  useInteraction.getState().setTransform('turn');
  useInteraction.getState().setTurnDegrees(base);
  return {
    cursor: 'grabbing',
    move(next) {
      degrees = rotationAngle(start, from, next.board, next.event.shiftKey, base);
      editContent((content) => ({ ...content, elements: rotateElements(content.elements, start, degrees) }), { label: 'Turn', coalesce: key });
      useInteraction.getState().setTurnDegrees(normalizeTurnDegrees(base + degrees));
    },
    up() {
      useInteraction.getState().reset();
      if (degrees !== 0) announce(turnedMessage(degrees, items.length === 1 ? normalizeTurnDegrees(base + degrees) : undefined));
    },
    cancel() {
      useInteraction.getState().reset();
      editContent((content) => ({ ...content, elements: rotateElements(content.elements, start, 0) }), { label: 'Turn', coalesce: key });
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Arrow ends                                                               */
/* ------------------------------------------------------------------------ */

/** The arrow with one end moved to a new place (attached ends get a side when given). */
export function withArrowEnd(arrow: ArrowElement, end: 'from' | 'to', target: ArrowElement['from'], side: ArrowSide | undefined): ArrowElement {
  const sideKey = end === 'from' ? 'fromSide' : 'toSide';
  const { [sideKey]: _side, ...rest } = arrow;
  return { ...rest, [end]: target, ...(side !== undefined && typeof target === 'string' ? { [sideKey]: side } : {}) } as ArrowElement;
}

/** Starts dragging one end of an arrow (⌘ leaves it free). */
export function arrowEndGesture(sample: PointerSample, arrowId: ElementId, end: 'from' | 'to'): Gesture | null {
  const arrow = useBoard.getState().byId.get(arrowId);
  if (arrow?.type !== 'arrow' || isElementLocked(arrow)) return null;
  const other = end === 'from' ? arrow.to : arrow.from;
  const own = typeof other === 'string' ? other : undefined;
  const key = gestureKey('arrow-end', arrowId);
  useInteraction.getState().setTransform('arrow');
  const write = (next: ArrowElement): void => {
    editContent((content) => ({ ...content, elements: content.elements.map((element) => (element.id === arrowId ? next : element)) }), { label: 'Move arrow end', coalesce: key });
  };
  void sample;
  return {
    cursor: 'grabbing',
    move(next) {
      const point = next.board;
      const choice = hasModifier(next.event) ? { end: [point.x, point.y] as const } : arrowEndAt(hitContext(), point, next.event.pointerType, own);
      const target = typeof choice.end === 'string' && choice.end === own ? ([point.x, point.y] as const) : choice.end;
      useInteraction.getState().setConnect(typeof target === 'string' ? { id: target, ...('side' in choice && choice.side !== undefined ? { side: choice.side } : {}) } : null);
      write(withArrowEnd(arrow, end, target, 'side' in choice ? choice.side : undefined));
    },
    up() {
      useInteraction.getState().reset();
      // An end dragged off into empty board offers a next item there.
      const moved = useBoard.getState().byId.get(arrowId);
      if (moved?.type === 'arrow' && moved !== arrow) offerNextItem(moved);
    },
    cancel() {
      useInteraction.getState().reset();
      write(arrow);
    },
  };
}

/** Screen pixels a leg drag must travel before it bends the route, per pointer type. */
export const ARROW_LEG_START_SLOP_PX = { mouse: 6, touch: 16 } as const;

/** True when two arrows have the same manual route. */
function sameRoute(a: ArrowElement, b: ArrowElement): boolean {
  return a.jog === b.jog && (a.bends ?? []).join() === (b.bends ?? []).join();
}

/**
 * Starts dragging leg `leg` of an arrow sideways to bend its route
 * ({@link bendsForDraggedSegment}); `route` is the route drawn when the
 * press started. Dragging back onto the automatic route clears the bends.
 */
export function arrowLegGesture(sample: PointerSample, arrowId: ElementId, leg: number, route: readonly RoutePoint[]): Gesture | null {
  const arrow = useBoard.getState().byId.get(arrowId);
  if (arrow?.type !== 'arrow' || isElementLocked(arrow)) return null;
  const key = gestureKey('arrow-leg', arrowId);
  const start = sample.screen;
  const slop = sample.event.pointerType === 'mouse' ? ARROW_LEG_START_SLOP_PX.mouse : ARROW_LEG_START_SLOP_PX.touch;
  let moved = false;
  let held = arrow;
  useInteraction.getState().setTransform('arrow');
  const write = (next: ArrowElement): void => {
    if (sameRoute(next, held)) return;
    held = next;
    editContent((content) => ({ ...content, elements: content.elements.map((element) => (element.id === arrowId && element.type === 'arrow' ? withRouteOf(element, next) : element)) }), {
      label: 'Move arrow route',
      coalesce: key,
    });
  };
  return {
    cursor: 'grabbing',
    move(next) {
      moved ||= Math.hypot(next.screen.x - start.x, next.screen.y - start.y) >= slop;
      if (!moved) return;
      const bends = bendsForDraggedSegment(arrow, route, leg, next.board.x, next.board.y, ARROW_LEG_GRAB_PX / currentZoom(), useBoard.getState().byId, layoutBoxResolver(currentMeasures()));
      // No valid route here: keep the last one.
      if (bends === undefined) return;
      write(bends === 'same' ? arrow : setArrowBends(arrow, bends ?? undefined));
    },
    up() {
      useInteraction.getState().reset();
      if (!sameRoute(held, arrow)) announce(ARROW_ROUTE_MOVED_MESSAGE);
    },
    cancel() {
      useInteraction.getState().reset();
      write(arrow);
    },
  };
}

/** `current` with the manual route (`bends` and `jog`) of `route`; other fields stay as they are now. */
function withRouteOf(current: ArrowElement, route: ArrowElement): ArrowElement {
  const { bends: _bends, jog: _jog, ...rest } = current;
  return normalizeArrow({ ...rest, ...(route.bends !== undefined ? { bends: route.bends } : {}), ...(route.jog !== undefined ? { jog: route.jog } : {}) });
}

/* ------------------------------------------------------------------------ */
/* Side dots                                                                */
/* ------------------------------------------------------------------------ */

/** The side dot under the pointer (no button down), with the tilt a note it adds would take. */
export interface HoveredSideDot {
  id: ElementId;
  side: ArrowSide;
  tilt: number;
}

/** The hovered side dot: the overlay previews what a click on it would add. */
export const useSideDotHover = create<{ dot: HoveredSideDot | null }>()(() => ({ dot: null }));

/** Notes the side dot under the pointer, or none. */
export function hoverSideDot(dot: { id: ElementId; side: ArrowSide } | null): void {
  const current = useSideDotHover.getState().dot;
  if (dot === null ? current === null : current?.id === dot.id && current.side === dot.side) return;
  useSideDotHover.setState({ dot: dot && { ...dot, tilt: randomNoteTilt() } });
}

/**
 * The item a click on `element`'s `side` dot adds: a sticky note after a
 * note, an empty shape like it (at the kind's default size) after a shape,
 * beside it on that side or else below it (core's `placeNextItemAtSide`);
 * `undefined` for other items or when neither spot is clear.
 */
export function sideDotItem(
  element: BoardElement,
  side: ArrowSide,
  tilt: number,
  elements: readonly BoardElement[] = boardElements(),
  measures: ElementMeasures = currentMeasures(),
): NextItem | undefined {
  if (element.type === 'note') return placeNextItemAtSide(element, nextNoteBeside(element, viewerAuthor(), tilt), side, elements, measures);
  if (element.type === 'shape') return placeNextItemAtSide(element, nextShapeBeside(element), side, elements, measures);
  return undefined;
}

/**
 * Adds what a click on `element`'s `side` dot adds (see {@link sideDotItem}),
 * selects it, starts typing into it and glides the view just enough to show it.
 */
export function addNextItemAtDot(element: BoardElement, side: ArrowSide, tilt = randomNoteTilt()): boolean {
  const next = sideDotItem(element, side, tilt);
  if (!next || !ensureRoom()) return false;
  const added = editContent((content) => ({ ...content, elements: [...content.elements, next] }), { label: next.type === 'note' ? 'Add note' : 'Add shape' });
  if (!added) return false;
  useSideDotHover.setState({ dot: null });
  useSelection.getState().select([next.id]);
  useSelection.getState().edit({ kind: 'element', id: next.id, selectAll: true });
  glideToReveal({ x: next.x, y: next.y, w: next.w, h: next.h });
  announce(addedMessage(next.type));
  return true;
}

/** A press on a side dot: drag to draw a connected arrow (ending any typing); click to add the next item. */
export function sideDotGesture(sample: PointerSample, elementId: ElementId, side: ArrowSide): Gesture | null {
  const element = useBoard.getState().byId.get(elementId);
  if (!element || !ensureRoom()) return null;
  const hovered = useSideDotHover.getState().dot;
  const tilt = hovered?.id === elementId && hovered.side === side ? hovered.tilt : randomNoteTilt();
  useSideDotHover.setState({ dot: null });
  if (useSelection.getState().editing !== null) useSelection.getState().edit(null);
  return arrowDrawGesture(sample, { end: elementId, side }, {
    byTool: false,
    color: useTool.getState().ink,
    onClick: () => {
      const current = useBoard.getState().byId.get(elementId);
      if (current) addNextItemAtDot(current, side, tilt);
    },
  });
}

/* ------------------------------------------------------------------------ */
/* Image crop                                                               */
/* ------------------------------------------------------------------------ */

/** The natural size of an image element's picture (from its view), or its frame when not loaded. */
export function naturalImageSize(id: ElementId, frame: { w: number; h: number }): { w: number; h: number } {
  if (typeof document === 'undefined') return frame;
  const image = document.querySelector<HTMLImageElement>(`.wb-surface [data-wb-id="${CSS.escape(id)}"] img`);
  return image && image.naturalWidth > 0 ? { w: image.naturalWidth, h: image.naturalHeight } : frame;
}

/** Writes an image's crop under a coalesced undo step. */
export function writeImageCrop(id: ElementId, crop: ImageCrop | undefined, key: string): boolean {
  return editContent(
    (content) => ({
      ...content,
      elements: content.elements.map((element) => {
        if (element.id !== id || element.type !== 'image') return element;
        const { crop: _crop, ...rest } = element;
        return crop ? { ...rest, crop } : rest;
      }),
    }),
    { label: 'Crop', coalesce: key },
  );
}

/** Starts panning an image inside its crop frame. */
export function cropPanGesture(sample: PointerSample, id: ElementId): Gesture | null {
  const image = useBoard.getState().byId.get(id);
  if (image?.type !== 'image' || isElementLocked(image)) return null;
  const frame = { w: image.w, h: image.h };
  const natural = naturalImageSize(id, frame);
  const crop = image.crop ?? { zoom: 1, x: 0.5, y: 0.5 };
  const key = gestureKey('crop', id);
  const origin = sample.board;
  const turn = (elementTurn(image) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  return {
    cursor: 'grabbing',
    move(next) {
      // The drag in the image's own (unturned) frame.
      const dx = next.board.x - origin.x;
      const dy = next.board.y - origin.y;
      writeImageCrop(id, panImageCrop(frame, natural, crop, dx * cos + dy * sin, -dx * sin + dy * cos), key);
    },
    cancel() {
      writeImageCrop(id, image.crop, key);
    },
  };
}

/** Starts moving one side or corner of an image's crop frame (the picture stays put). */
export function cropFrameGesture(sample: PointerSample, id: ElementId, handle: CropHandle): Gesture | null {
  const image = useBoard.getState().byId.get(id);
  if (image?.type !== 'image' || isElementLocked(image)) return null;
  const frame = { w: image.w, h: image.h };
  const natural = naturalImageSize(id, frame);
  const crop = image.crop ?? { zoom: 1, x: 0.5, y: 0.5 };
  const turn = (elementTurn(image) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const center = { x: image.x + image.w / 2, y: image.y + image.h / 2 };
  const key = gestureKey('crop-frame', id);
  const origin = sample.board;
  // Only the frame and crop are written, onto the image as it is now (a change from elsewhere to the rest stays).
  const write = (box: Pick<ImageElement, 'x' | 'y' | 'w' | 'h'>, nextCrop: ImageCrop | undefined): void => {
    editContent(
      (content) => ({
        ...content,
        elements: content.elements.map((element) => {
          if (element.id !== id || element.type !== 'image') return element;
          const { crop: _crop, ...rest } = element;
          return nextCrop ? { ...rest, ...box, crop: nextCrop } : { ...rest, ...box };
        }),
      }),
      { label: 'Crop', coalesce: key },
    );
  };
  return {
    move(next) {
      // The drag in the image's own (unturned) frame.
      const dx = next.board.x - origin.x;
      const dy = next.board.y - origin.y;
      const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
      const result = resizeCropViewport(frame, natural, crop, handle, local.x, local.y, MIN_CROP_FRAME_SIZE);
      // The new frame's center, turned back onto the board.
      const offset = { x: result.frame.x + result.frame.w / 2 - frame.w / 2, y: result.frame.y + result.frame.h / 2 - frame.h / 2 };
      const cx = center.x + offset.x * cos - offset.y * sin;
      const cy = center.y + offset.x * sin + offset.y * cos;
      write({ x: cx - result.frame.w / 2, y: cy - result.frame.h / 2, w: result.frame.w, h: result.frame.h }, result.crop);
    },
    cancel() {
      write({ x: image.x, y: image.y, w: image.w, h: image.h }, image.crop);
    },
  };
}

/** The smallest a crop frame gets, board units. */
export const MIN_CROP_FRAME_SIZE = 16;

/** Zooms an image inside its crop frame by `factor` around a board point. */
export function zoomImageCropAt(id: ElementId, factor: number, at: { x: number; y: number }, key: string): boolean {
  const image = useBoard.getState().byId.get(id);
  if (image?.type !== 'image' || isElementLocked(image)) return false;
  const frame = { w: image.w, h: image.h };
  const turn = (-elementTurn(image) * Math.PI) / 180;
  const dx = at.x - (image.x + image.w / 2);
  const dy = at.y - (image.y + image.h / 2);
  const local = { x: frame.w / 2 + dx * Math.cos(turn) - dy * Math.sin(turn), y: frame.h / 2 + dx * Math.sin(turn) + dy * Math.cos(turn) };
  const crop = image.crop ?? { zoom: 1, x: 0.5, y: 0.5 };
  return writeImageCrop(id, zoomImageCrop(frame, naturalImageSize(id, frame), crop, factor, local), key);
}
