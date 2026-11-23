/**
 * Pure selection helpers: what moves with a selection, aligning a
 * selection, rotating it, applying a move or resize drag, and which
 * selection chrome (outline, connection dots, toolbar) an element shows.
 *
 * Everything here is DOM-free. Text fitting during a resize is injected
 * ({@link TextResizeFitting}), because it depends on text measurement.
 */

import { carriedArrowEnds, containmentAnchor, findStickerHost, moveStickersWithHosts, stickersOnHosts, type CarriedArrowEnds } from './attachments.ts';
import { mapArrowEnds, offsetArrowEnds, patchElement, translateElements, type ArrowEndMoves } from './edits.ts';
import {
  boxCenter,
  containerTitleBandHeight,
  elementBounds,
  elementLayoutBox,
  resizeRotatedBox,
  rotateBoxAround,
  rotatedBoundingBox,
  rotatePointAround,
  unionBounds,
  type Box,
  type ElementMeasures,
  type Point,
} from './geometry.ts';
import { collectMovingSet, everyArrowEndId, selectionGroupCells } from './groups.ts';
import {
  MIN_ELEMENT_SIZE,
  arrowEndIds,
  elementTurn,
  isRotatableElement,
  normalizeTurnDegrees,
  withElementTurn,
  type BoardContent,
  type BoardElement,
  type ContainerElement,
  type ElementId,
  type ElementType,
  type NoteElement,
  type ShapeElement,
  type TextElement,
} from './schema.ts';
import { angleBetweenPoints, snapRotationDegrees } from './snapping.ts';
import { scaleTableWidth, tableWidth } from './table.ts';

/* -------------------------------------------------------------------------- */
/* What moves together                                                        */
/* -------------------------------------------------------------------------- */

const isContainerElement = (element: BoardElement): element is ContainerElement => element.type === 'container';

/**
 * Ids that move when `ids` move: the moving set without stickers (the
 * content of moving sections, and whole groups when `withGroups`), plus
 * arrows whose ends all move and at least one end is held by a moving
 * section or group (a free end counts when a moving section carries it).
 */
export function collectMoveIds(
  elements: readonly BoardElement[],
  ids: ReadonlySet<ElementId>,
  measures?: ElementMeasures,
  withGroups = false,
  hosts: Map<ElementId, ElementId | undefined> = new Map(),
): Set<ElementId> {
  const { ids: moveIds, frames, held } = collectMovingSet(elements, ids, measures, { stickers: false, groups: withGroups, hosts });
  for (const cell of withGroups ? selectionGroupCells(elements, moveIds) : []) if (cell.group !== undefined) for (const id of cell.ids) held.add(id);
  const attachedEnds = carriedArrowEnds(elements, new Set(), frames);
  for (const element of elements) {
    if (element.type !== 'arrow' || moveIds.has(element.id)) continue;
    const ends = [
      [element.from, attachedEnds.get(element.id)?.from !== undefined],
      [element.to, attachedEnds.get(element.id)?.to !== undefined],
    ] as const;
    if (
      ends.every(([end, carried]) => (typeof end === 'string' ? moveIds.has(end) : carried)) &&
      ends.some(([end, carried]) => (typeof end === 'string' ? held.has(end) : carried))
    )
      moveIds.add(element.id);
  }
  return moveIds;
}

/** {@link collectMoveIds} with whole groups, plus the stickers on moving hosts. */
export function collectMoveIdsWithAttached(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>, measures?: ElementMeasures): Set<ElementId> {
  const moveIds = collectMoveIds(elements, ids, measures, true);
  return new Set([...moveIds, ...stickersOnHosts(moveIds, elements, measures)]);
}

/** The elements that move with `ids` (arrows only when both attached ends move). */
export function elementsMovingTogether(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>, measures?: ElementMeasures): BoardElement[] {
  const moveIds = collectMoveIdsWithAttached(elements, ids, measures);
  return elements.filter((element) => moveIds.has(element.id) && (element.type !== 'arrow' || everyArrowEndId(element, (id) => moveIds.has(id))));
}

/**
 * The selected ids that are not riding on a selected host: a sticker whose
 * host is also selected drops out, unless it shares a group with another
 * selected element.
 */
export function topLevelSelectedIds(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>, measures?: ElementMeasures): Set<ElementId> {
  const sharesSelectedGroup = (element: BoardElement): boolean =>
    elements.some((other) => other.id !== element.id && ids.has(other.id) && other.groups?.some((group) => element.groups?.includes(group)) === true);
  return new Set(
    elements.flatMap((element) =>
      ids.has(element.id) && (!ids.has(findStickerHost(element, elements, measures)?.id ?? '') || sharesSelectedGroup(element)) ? [element.id] : [],
    ),
  );
}

/**
 * An offset for pasting `moving` among `others` where no pasted section
 * (with its title band) partly overlaps another section or swallows an
 * existing element: the given offset when it fits, else the nearest one
 * stepping right, down or diagonally by `step` (up to 400 steps).
 */
export function findFreePasteOffset(
  moving: readonly BoardElement[],
  others: readonly BoardElement[],
  offset: { dx: number; dy: number },
  step: number,
  measures?: ElementMeasures,
): { dx: number; dy: number } {
  const withTitleBand = (box: Box): Box => ({ x: box.x, y: box.y - containerTitleBandHeight, w: box.w, h: box.h + containerTitleBandHeight });
  const boxOf = (element: BoardElement): Box | undefined => elementLayoutBox(element, measures);
  const movingBoxes = moving.filter(isContainerElement).flatMap((element) => boxOf(element) ?? []);
  const otherBoxes = others
    .filter(isContainerElement)
    .flatMap((element) => boxOf(element) ?? [])
    .map(withTitleBand);
  const anchorPoints = others.flatMap((element): Array<readonly [number, number]> => {
    if (element.type === 'arrow') return [element.from, element.to].filter((end): end is readonly [number, number] => typeof end !== 'string');
    const box = isContainerElement(element) ? undefined : elementLayoutBox(element, measures);
    const anchor = box && containmentAnchor(element, box);
    return anchor ? [[anchor.x, anchor.y]] : [];
  });
  const contains = (inner: Box, outer: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  const apart = (a: Box, b: Box, gap: number): boolean => a.x >= b.x + b.w + gap || b.x >= a.x + a.w + gap || a.y >= b.y + b.h + gap || b.y >= a.y + a.h + gap;
  const fitsAt = (dx: number, dy: number, gap: number): boolean =>
    movingBoxes.every((box) => {
      const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
      const banded = withTitleBand(moved);
      return (
        otherBoxes.every((other) => apart(banded, other, gap) || (contains(banded, other) && !contains(other, banded))) &&
        !anchorPoints.some(([x, y]) => contains({ x, y, w: 0, h: 0 }, moved))
      );
    });
  if (fitsAt(offset.dx, offset.dy, 0)) return offset;
  for (let distance = step; distance <= 400 * step; distance += step)
    for (const [dx, dy] of [
      [offset.dx + distance, offset.dy],
      [offset.dx, offset.dy + distance],
      [offset.dx + distance, offset.dy + distance],
    ] as const)
      if (fitsAt(dx, dy, step)) return { dx, dy };
  return offset;
}

/* -------------------------------------------------------------------------- */
/* Aligning                                                                   */
/* -------------------------------------------------------------------------- */

/** An edge or center line a selection aligns to. */
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** How far a unit's box moves to align with the selection bounds, per edge. */
export const ALIGN_OFFSETS: Record<AlignEdge, (box: Box, bounds: Box) => readonly [number, number]> = {
  left: (box, bounds) => [bounds.x - box.x, 0],
  hcenter: (box, bounds) => [bounds.x + (bounds.w - box.w) / 2 - box.x, 0],
  right: (box, bounds) => [bounds.x + bounds.w - box.w - box.x, 0],
  top: (box, bounds) => [0, bounds.y - box.y],
  vcenter: (box, bounds) => [0, bounds.y + (bounds.h - box.h) / 2 - box.y],
  bottom: (box, bounds) => [0, bounds.y + bounds.h - box.h - box.y],
};

/** Moves smaller than this are skipped. */
export const ALIGN_EPSILON = 0.001;

/** One thing that aligns as a whole: a group or a loose element, with what moves along. */
export interface AlignmentUnit {
  /** The bounds of the unit's own elements. */
  box: Box;
  /** The unit's own (selected) elements. */
  own: ElementId[];
  /** Everything that moves with it (section content, stickers, group members). */
  ids: Set<ElementId>;
  /** Areas of moving sections (free arrow ends inside move along). */
  frames: Box[];
}

/**
 * The selection split into units that align as a whole: groups and loose
 * elements, each with what moves along. Larger units claim shared
 * elements first; a unit whose own element was already claimed drops out.
 */
export function alignmentUnits(elements: readonly BoardElement[], selectedIds: ReadonlySet<ElementId>, measures?: ElementMeasures): AlignmentUnit[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const stickerHosts = new Map(
    elements.flatMap((element): Array<[ElementId, ElementId | undefined]> =>
      element.type === 'sticker' ? [[element.id, findStickerHost(element, elements, measures)?.id]] : [],
    ),
  );
  const hostIds = new Set(stickerHosts.values());
  const isLoose = (element: BoardElement | undefined): boolean =>
    element !== undefined && element.type !== 'container' && element.groups === undefined && !hostIds.has(element.id);
  const units = selectionGroupCells(elements, selectedIds).flatMap(({ ids }): AlignmentUnit[] => {
    const box = unionBounds(ids.flatMap((id) => byId.get(id) ?? []).flatMap((element) => elementBounds(element, measures) ?? []));
    if (box === undefined) return [];
    const single = ids.length === 1 && isLoose(byId.get(ids[0] ?? ''));
    return [
      {
        box,
        own: ids,
        ...(single ? { ids: new Set(ids), frames: [] } : collectMovingSet(elements, new Set(ids), measures, { hosts: stickerHosts, within: selectedIds })),
      },
    ];
  });
  const claimed = new Set<ElementId>();
  return units
    .sort((a, b) => b.ids.size - a.ids.size)
    .flatMap(({ box, own, ids, frames }) => {
      if (own.some((id) => claimed.has(id))) return [];
      const unclaimed = new Set([...ids].filter((id) => !claimed.has(id)));
      for (const id of unclaimed) claimed.add(id);
      return [{ box, own, ids: unclaimed, frames }];
    });
}

/**
 * Aligns the selection's units to an edge or center line of their bounds
 * (a lone tilted note is straightened). `undefined` when fewer than two
 * units or nothing changes; otherwise the content and the ids touched.
 */
export function alignSelection<T extends BoardContent>(
  content: T,
  selectedIds: ReadonlySet<ElementId>,
  edge: AlignEdge,
  measures?: ElementMeasures,
): { after: T; scope: Set<ElementId> } | undefined {
  const units = alignmentUnits(content.elements, selectedIds, measures);
  const bounds = unionBounds(units.map((unit) => unit.box));
  if (units.length < 2 || bounds === undefined) return undefined;
  const movedEnds = new Set<string>();
  const scope = new Set<ElementId>();
  const freeEnds = (arrowId: ElementId, ends: ArrowEndMoves): ArrowEndMoves => {
    const free: ArrowEndMoves = {};
    for (const side of ['from', 'to'] as const) {
      const end = ends[side];
      if (end === undefined || movedEnds.has(arrowId + ' ' + side)) continue;
      free[side] = end;
      movedEnds.add(arrowId + ' ' + side);
    }
    return free;
  };
  let next = content;
  for (const { box, own, ids, frames } of units) {
    const onlyId = own.length === 1 ? own[0] : undefined;
    const single = content.elements.find((element) => element.id === onlyId);
    if (single?.type === 'note' && single.tilt !== 0) {
      next = patchElement(next, single.id, { tilt: 0 });
      scope.add(single.id);
    }
    const carriedEnds: CarriedArrowEnds = new Map(
      [...carriedArrowEnds(content.elements, ids, frames)].flatMap(([arrowId, ends]) => {
        const free = freeEnds(arrowId, ends);
        return (free.from ?? free.to) ? [[arrowId, free] as const] : [];
      }),
    );
    const [dx, dy] = ALIGN_OFFSETS[edge](box, bounds);
    if (Math.abs(dx) < ALIGN_EPSILON && Math.abs(dy) < ALIGN_EPSILON) continue;
    next = translateElements(next, ids, carriedEnds, dx, dy);
    for (const id of [...ids, ...carriedEnds.keys()]) scope.add(id);
  }
  return scope.size === 0 ? undefined : { after: next, scope };
}

/* -------------------------------------------------------------------------- */
/* Rotating                                                                   */
/* -------------------------------------------------------------------------- */

/** CSS custom property carrying an element's turn (for shadows that stay put). */
export const TURN_VAR = '--wb-turn';

/** Rounds a coordinate of a rotated or resized group to hundredths (no `-0`). */
export function roundGroupCoordinate(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/** Degrees as shown to people (`45°`). */
export function formatDegrees(degrees: number): string {
  return String(degrees) + '°';
}

/** Inline style rotating an element by its turn (empty when upright). */
export function rotationStyle(element: BoardElement): Record<string, string> {
  const turn = elementTurn(element);
  return turn === 0 ? {} : { rotate: String(turn) + 'deg', [TURN_VAR]: String(turn) + 'deg' };
}

/**
 * A CSS rule giving `selector` a drop shadow that keeps pointing the same
 * way on screen while the element is turned (by {@link TURN_VAR}), with an
 * unrotated fallback for browsers without trigonometric CSS.
 */
export function rotatedDropShadowRule(selector: string, x: number, y: number, blur: number, color: string): string {
  const cos = 'cos(var(' + TURN_VAR + ',0deg))';
  const sin = 'sin(var(' + TURN_VAR + ',0deg))';
  const px = (value: number): string => String(value) + 'px';
  const rule = (dx: string, dy: string): string => selector + '{filter:drop-shadow(' + dx + ' ' + dy + ' ' + px(blur) + ' ' + color + ');}';
  return (
    rule(px(x), px(y)) +
    '@supports (filter:drop-shadow(calc(1px*cos(0deg)) 0 0 red)){' +
    rule('calc(' + px(x) + '*' + cos + ' + ' + px(y) + '*' + sin + ')', 'calc(' + px(y) + '*' + cos + ' - ' + px(x) + '*' + sin + ')') +
    '}'
  );
}

/** What a rotation acts on. */
export interface RotatableSelection {
  /** Elements that turn (arrows only with a free end; a lone half-attached arrow does not turn). */
  items: BoardElement[];
  /** Types in the selection that stay upright. */
  upright: ElementType[];
}

/** Splits a selection into the elements that turn and the types that stay upright. */
export function rotatableSelection(elements: readonly BoardElement[], selectedIds: ReadonlySet<ElementId>): RotatableSelection {
  const selected = elements.filter((element) => selectedIds.has(element.id));
  const turnable = selected.filter((element) => (element.type === 'arrow' ? arrowEndIds(element).length < 2 : isRotatableElement(element)));
  const [first] = turnable;
  return {
    items: turnable.length === 1 && first?.type === 'arrow' && arrowEndIds(first).length === 1 ? [] : turnable,
    upright: [...new Set(selected.flatMap((element) => (element.type === 'arrow' || isRotatableElement(element) ? [] : [element.type])))],
  };
}

/** The state a rotation starts from. */
export interface RotationStart {
  /** The point everything turns around (the center of the items' box centers). */
  pivot: Point;
  /** Each turning element's box (at its stored x/y) and turn at the start. */
  was: Map<ElementId, Box & { turn: number }>;
  /** Free arrow ends that turn along. */
  freeEnds: CarriedArrowEnds;
}

/**
 * Records where a rotation starts: the pivot (the mean of the items' box
 * centers, or of their free arrow ends when only arrows turn), and the
 * starting box and turn of each item and of the stickers on them.
 */
export function captureRotationStart(items: readonly BoardElement[], elements: readonly BoardElement[] = items, measures?: ElementMeasures): RotationStart {
  const ids = new Set(items.map((element) => element.id));
  const stickerIds = new Set(stickersOnHosts(ids, elements, measures));
  const frames = items.flatMap((element) => elementLayoutBox(element, measures) ?? []);
  const freeEnds = carriedArrowEnds(elements, ids, []);
  const points =
    frames.length > 0
      ? frames.map(boxCenter)
      : [...freeEnds.values()].flatMap((ends) => [ends.from, ends.to].flatMap((end) => (end === undefined || typeof end === 'string' ? [] : [{ x: end[0], y: end[1] }])));
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  const was = new Map<ElementId, Box & { turn: number }>();
  for (const element of elements) {
    if (element.type === 'arrow' || !(ids.has(element.id) || stickerIds.has(element.id))) continue;
    const box = elementLayoutBox(element, measures);
    if (box !== undefined) was.set(element.id, { ...box, x: element.x, y: element.y, turn: elementTurn(element) });
  }
  return { pivot: { x: sum.x / points.length, y: sum.y / points.length }, was, freeEnds };
}

/**
 * The turn (degrees) of a rotation drag from `from` to `to` around the
 * pivot, snapped (coarsely with `snap`) as an absolute turn from `baseTurn`.
 */
export function rotationAngle(start: RotationStart, from: Point, to: Point, snap: boolean, baseTurn = 0): number {
  const delta = angleBetweenPoints(start.pivot.x, start.pivot.y, to.x, to.y) - angleBetweenPoints(start.pivot.x, start.pivot.y, from.x, from.y);
  return normalizeTurnDegrees(snapRotationDegrees(baseTurn + delta, snap) - baseTurn);
}

/**
 * The elements turned by `degrees` around the start's pivot: each item's
 * center orbits the pivot and its turn grows; free arrow ends orbit too.
 */
export function rotateElements(elements: readonly BoardElement[], start: RotationStart, degrees: number): BoardElement[] {
  return elements.map((element): BoardElement => {
    if (element.type === 'arrow') {
      const ends = start.freeEnds.get(element.id);
      if (ends === undefined) return element;
      return mapArrowEnds(element, ends, ([x, y]) => {
        if (degrees % 360 === 0) return [x, y];
        const point = rotatePointAround({ x, y }, start.pivot, degrees);
        return [roundGroupCoordinate(point.x), roundGroupCoordinate(point.y)];
      });
    }
    const was = start.was.get(element.id);
    if (!isRotatableElement(element) || was === undefined) return element;
    const strokeFrame = element.type === 'stroke' ? elementLayoutBox(element) : undefined;
    const [dx, dy] = strokeFrame ? [strokeFrame.x - element.x, strokeFrame.y - element.y] : [0, 0];
    const turn = was.turn + degrees;
    const frame = { ...was, x: was.x + dx, y: was.y + dy };
    if (Math.hypot(boxCenter(frame).x - start.pivot.x, boxCenter(frame).y - start.pivot.y) < 0.02) return withElementTurn(element, turn);
    if (degrees % 360 === 0) return withElementTurn({ ...element, x: was.x, y: was.y }, turn);
    const rotated = rotateBoxAround(frame, start.pivot, degrees);
    return withElementTurn({ ...element, x: roundGroupCoordinate(rotated.x - dx), y: roundGroupCoordinate(rotated.y - dy) }, turn);
  });
}

/** Keeps a rotated element's opposite corner in place while its size changes. */
export type RotatedResizeKeeper = (element: BoardElement, frame: Box, w: number, h: number, measures?: ElementMeasures) => Point | undefined;

/**
 * A keeper for a rotated element whose size changes as it re-renders (for
 * example a turned note growing with its text): returns the new top-left
 * that keeps the top-left corner on screen, or `undefined` when the size
 * did not change. It remembers the last result, so repeated growth builds
 * on it rather than on a stale frame.
 */
export function createRotatedResizeKeeper(): RotatedResizeKeeper {
  let last: (Box & { id: ElementId; measures: ElementMeasures | undefined }) | undefined;
  return (element, frame, w, h, measures) => {
    if (element.type === 'arrow') return undefined;
    const base = last?.id === element.id && last.x === element.x && last.y === element.y && last.measures === measures ? last : frame;
    if (w === base.w && h === base.h) return undefined;
    const kept = resizeRotatedBox(base, elementTurn(element), w, h);
    last = { id: element.id, x: roundGroupCoordinate(kept.x), y: roundGroupCoordinate(kept.y), w, h, measures };
    return { x: last.x, y: last.y };
  };
}

/** The keys of a keyboard event a rotation shortcut looks at. */
export interface RotationKeyEvent {
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** Degrees an Alt+Arrow key press turns the selection (1° with Shift, else 15°); `undefined` for other keys. */
export function rotationKeyStep(event: RotationKeyEvent): number | undefined {
  if (!event.altKey || event.metaKey || event.ctrlKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return undefined;
  return (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 15);
}

/* -------------------------------------------------------------------------- */
/* Applying drags                                                             */
/* -------------------------------------------------------------------------- */

/** Narrowest text a resize drag leaves. */
export const MIN_DRAG_TEXT_WIDTH = 40;

/** A move drag in progress. */
export interface MoveDrag {
  dx: number;
  dy: number;
  /** Where each moving element started. */
  origins: ReadonlyMap<ElementId, Point>;
  /** Free arrow ends that move along. */
  freeEnds: CarriedArrowEnds;
}

/** Moves the dragged elements (from their origins) and free arrow ends by the drag offset. */
export function applyMoveDrag<T extends BoardContent>(board: T, drag: MoveDrag): T {
  return {
    ...board,
    elements: board.elements.map((element): BoardElement => {
      if (element.type === 'arrow') {
        const ends = drag.freeEnds.get(element.id);
        return ends ? offsetArrowEnds(element, ends, drag.dx, drag.dy) : element;
      }
      const origin = drag.origins.get(element.id);
      return origin ? { ...element, x: origin.x + drag.dx, y: origin.y + drag.dy } : element;
    }),
  };
}

/** The edges a resize drag moves (`null` on an axis it leaves alone). */
export interface ResizeEdge {
  x: 'left' | 'right' | null;
  y: 'top' | 'bottom' | null;
}

/** A resize drag in progress. */
export interface ResizeDrag {
  /** The board when the drag started. */
  before: BoardContent;
  /** Each resized element's box at the start. */
  members: ReadonlyMap<ElementId, Box>;
  /** The selection box at the start. */
  start: Box;
  edge: ResizeEdge;
  /** Free arrow ends that scale along. */
  freeEnds: CarriedArrowEnds;
}

/** Text fitting a resize needs (it depends on text measurement, so the editor provides it). */
export interface TextResizeFitting {
  /** The text re-wrapped to `width`, keeping the edge opposite the dragged `edge` in place. */
  fitTextToWidth(element: TextElement, frame: Box, edge: 'left' | 'right', width: number): TextElement;
  /** The size (at least `w` × `h`) a shape or note needs to keep its text inside. */
  minResizeSizeForText(element: ShapeElement | NoteElement, frame: Box, w: number, h: number): { w: number; h: number };
}

/** The lone section being shrunk by a vertical edge drag (its stored height is smaller than the drag start). */
export function shrinkingSoloContainer(drag: ResizeDrag): ContainerElement | undefined {
  const [onlyId] = drag.members.keys();
  const member = drag.members.size === 1 && drag.edge.y !== null ? drag.before.elements.find((element) => element.id === onlyId) : undefined;
  return member?.type === 'container' && drag.start.h > member.h ? member : undefined;
}

const resizeStickerHostsCache = new WeakMap<object, Map<ElementId, ElementId>>();

/**
 * Sticker id → resized host id for stickers (not resized themselves) that
 * sit on a resized element, found against the starting boxes (cached per
 * drag; `extraMembers` add boxes for host lookup).
 */
export function resizeStickerHosts(drag: ResizeDrag, extraMembers?: ReadonlyMap<ElementId, Box>): Map<ElementId, ElementId> {
  const cached = resizeStickerHostsCache.get(drag.members);
  if (cached) return cached;
  const memberBoxes = drag.before.elements.flatMap((element) => {
    const member = drag.members.get(element.id);
    return member === undefined ? [] : [rotatedBoundingBox(member, elementTurn(element))];
  });
  const overlapsMember = (box: Box): boolean =>
    memberBoxes.some((member) => box.x <= member.x + member.w && member.x <= box.x + box.w && box.y <= member.y + member.h && member.y <= box.y + box.h);
  const members = extraMembers === undefined ? drag.members : new Map([...extraMembers, ...drag.members]);
  const hosts = new Map(
    drag.before.elements.flatMap((element): Array<[ElementId, ElementId]> => {
      const hostId =
        element.type === 'sticker' && !drag.members.has(element.id) && overlapsMember(element) ? findStickerHost(element, drag.before.elements, members)?.id : undefined;
      return hostId !== undefined && drag.members.has(hostId) ? [[element.id, hostId]] : [];
    }),
  );
  resizeStickerHostsCache.set(drag.members, hosts);
  return hosts;
}

const isShapeOrNote = (element: BoardElement): element is ShapeElement | NoteElement => element.type === 'shape' || element.type === 'note';

/**
 * Applies a resize drag to box `to`: members scale from the start box
 * (text re-wraps, tables scale their columns, drawings scale their points,
 * shapes and notes keep room for their text, a lone turned element keeps
 * its opposite corner), free arrow ends scale along, and stickers on
 * resized hosts follow them.
 */
export function applyResizeDrag(elements: readonly BoardElement[], drag: ResizeDrag, to: Box, fitting: TextResizeFitting): BoardElement[] {
  const { x: toX, y: toY, w: toW, h: toH } = to;
  const start = drag.start;
  const solo = drag.members.size === 1;
  const container = shrinkingSoloContainer(drag);
  const scaleX = toW / start.w;
  const scaleY = toH / start.h;
  const anchorX = drag.edge.x ?? undefined;
  const anchorY = drag.edge.y ?? undefined;
  const resized = elements.map((element): BoardElement => {
    if (element.type === 'arrow') {
      const ends = drag.freeEnds.get(element.id);
      return ends ? mapArrowEnds(element, ends, ([x, y]) => [toX + (x - start.x) * scaleX, toY + (y - start.y) * scaleY]) : element;
    }
    const member = drag.members.get(element.id);
    if (!member) return element;
    const x = toX + (member.x - start.x) * scaleX;
    const y = toY + (member.y - start.y) * scaleY;
    if (element.type === 'text') {
      if (solo && drag.edge.x !== null && elementTurn(element) !== 0) {
        const prior = fitting.fitTextToWidth(element, member, 'left', Math.max(MIN_DRAG_TEXT_WIDTH, Math.round(toW)));
        const source = resizeRotatedBox(member, elementTurn(element), member.x + member.w - prior.x, toH, { x: anchorX });
        return { ...prior, x: source.x, y: source.y };
      }
      if (solo) return drag.edge.x === null ? element : fitting.fitTextToWidth(element, member, drag.edge.x, Math.max(MIN_DRAG_TEXT_WIDTH, Math.round(member.w * scaleX)));
      return { ...element, x, y, ...(element.wrap !== undefined ? { wrap: Math.max(MIN_ELEMENT_SIZE, member.w * scaleX) } : {}) };
    }
    if (element.type === 'timer' || element.type === 'link') return { ...element, x, y };
    if (element.type === 'table') {
      const prior = drag.before.elements.find((other) => other.id === element.id);
      const source = prior?.type === 'table' ? prior : element;
      const next = drag.edge.x === null && solo ? element : scaleTableWidth(element, Math.max(MIN_DRAG_TEXT_WIDTH, tableWidth(source) * scaleX), source);
      return solo ? { ...next, x: drag.edge.x === 'left' ? member.x + tableWidth(source) - tableWidth(next) : element.x } : { ...next, x, y };
    }
    if (element.type === 'stroke') {
      const prior = drag.before.elements.find((other) => other.id === element.id);
      const points = (prior?.type === 'stroke' ? prior.points : element.points).map((coord, index) => coord * (index % 2 === 0 ? scaleX : scaleY));
      const strokeWidth = prior?.type === 'stroke' ? prior.width : element.width;
      return { ...element, x, y, points, width: Math.min(40, Math.max(1, (strokeWidth * (scaleX + scaleY)) / 2)) };
    }
    const keepH =
      (element.type === 'note' || element.type === 'container') && drag.edge.y === null ? element.h : container && toH === start.h ? container.h : undefined;
    const newW = Math.max(MIN_ELEMENT_SIZE, member.w * scaleX);
    const newH = keepH ?? Math.max(MIN_ELEMENT_SIZE, member.h * scaleY);
    if (!isShapeOrNote(element)) return { ...element, x, y, w: newW, h: newH };
    const fitted = fitting.minResizeSizeForText(element, member, newW, newH);
    if (solo && elementTurn(element) !== 0 && keepH !== undefined)
      return { ...element, ...resizeRotatedBox(member, elementTurn(element), fitted.w, toH, { x: anchorX }), h: keepH };
    if (solo && elementTurn(element) !== 0)
      return { ...element, ...resizeRotatedBox({ x, y, w: newW, h: newH }, elementTurn(element), fitted.w, fitted.h, { x: anchorX, y: anchorY }) };
    return {
      ...element,
      x: drag.edge.x === 'left' ? x + newW - fitted.w : x,
      y: drag.edge.y === 'top' ? y + newH - fitted.h : y,
      ...fitted,
    };
  });
  return moveStickersWithHosts(drag.before.elements, resized, drag.members, { stretch: true, hosts: resizeStickerHosts(drag), only: true });
}

/* -------------------------------------------------------------------------- */
/* Selection chrome                                                           */
/* -------------------------------------------------------------------------- */

/** What an element's words are: its body text, a short label, embed source, or none. */
export type ElementWords = 'body' | 'label' | 'source' | 'none';

/** What clicking an element's dots does: add a linked element, start an arrow, both, or no dots. */
export type ElementDots = 'adds' | 'connects' | 'adds, connects' | 'none';

/** How each kind of element behaves when selected. */
export interface ElementKindAffordance {
  words: ElementWords;
  /** Whether it has resize handles. */
  resizes: boolean;
  dots: ElementDots;
  /** Shows a hairline outline on hover. */
  hairline?: true;
  /** Is a line (no selection outline). */
  line?: true;
}

/** Selection behavior per element type. */
export const ELEMENT_KIND_AFFORDANCES: Record<ElementType, ElementKindAffordance> = {
  note: { words: 'body', resizes: true, dots: 'adds, connects' },
  shape: { words: 'body', resizes: true, dots: 'adds, connects' },
  text: { words: 'body', resizes: true, dots: 'none', hairline: true },
  table: { words: 'body', resizes: true, dots: 'none' },
  container: { words: 'label', resizes: true, dots: 'none' },
  arrow: { words: 'label', resizes: false, dots: 'none', line: true },
  image: { words: 'none', resizes: true, dots: 'none' },
  link: { words: 'none', resizes: false, dots: 'none' },
  timer: { words: 'none', resizes: false, dots: 'none' },
  sticker: { words: 'none', resizes: true, dots: 'none' },
  stroke: { words: 'none', resizes: true, dots: 'none' },
  html: { words: 'source', resizes: true, dots: 'none' },
};

/** The chrome drawn around an element. */
export interface SelectionChrome {
  outline: 'none' | 'hair' | 'thin' | 'full';
  dots: ElementDots;
  /** Whether the selection toolbar shows. */
  bar: boolean;
}

/** No chrome at all. */
export const NO_SELECTION_CHROME: SelectionChrome = { outline: 'none', dots: 'none', bar: false };

/** The state an element's chrome is drawn for. */
export type SelectionChromeState = 'hovered' | 'selected' | 'typing';

/** What the chrome depends on besides the element. */
export interface SelectionChromeContext {
  /** The active tool (`select`, `hand`, `arrow`, …). */
  tool: string;
  /** The last pointer was a finger. */
  finger?: boolean;
  /** The text being typed is empty. */
  empty?: boolean;
}

/** The chrome for an element of `kind` in `state`. */
export function selectionChromeFor(kind: ElementType, state: SelectionChromeState, context: SelectionChromeContext): SelectionChrome {
  const affordance = ELEMENT_KIND_AFFORDANCES[kind];
  const selecting = context.tool === 'select';
  switch (state) {
    case 'hovered':
      return !selecting ? NO_SELECTION_CHROME : { ...NO_SELECTION_CHROME, outline: affordance.hairline ? 'hair' : 'none', dots: affordance.dots };
    case 'selected':
      return {
        outline: affordance.line ? 'none' : 'full',
        dots: selecting ? affordance.dots : 'none',
        bar: selecting || (affordance.line === true && context.tool === 'arrow'),
      };
    case 'typing':
      if (affordance.words !== 'body') return NO_SELECTION_CHROME;
      return {
        outline: 'thin',
        dots:
          context.finger === true || context.tool === 'hand' || affordance.dots === 'none'
            ? 'none'
            : context.tool === 'arrow'
              ? 'connects'
              : affordance.dots,
        bar: true,
      };
  }
}
