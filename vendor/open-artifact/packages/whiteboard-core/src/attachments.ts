/**
 * What rides along with what: stickers sit on a host element and move with
 * it, free arrow ends inside a moved area move too, sections carry the
 * elements inside them, and a tidy-up grid keeps stickers on their hosts.
 */

import {
  boxCenter,
  elementBounds,
  elementLayoutBox,
  gridLayoutOfRects,
  pointInBox,
  rotateBoxAround,
  rotatePointAround,
  rotatedBoundingBox,
  type Box,
  type ElementMeasures,
  type Point,
} from './geometry.ts';
import { shapeOutlineDepth } from './hit-test.ts';
import { isSvgBase64DataUrl } from './image-source.ts';
import { elementTurn, type ArrowEnd, type BoardElement, type ElementId, type StickerElement } from './schema.ts';
import { isCurvedShapeKind } from './shape-paths.ts';

/** Elements a sticker can sit on. */
export type StickerHost = Extract<BoardElement, { type: 'note' | 'text' | 'shape' | 'image' | 'html' | 'link' | 'table' }>;

const HOST_TYPES: ReadonlySet<BoardElement['type']> = new Set(['note', 'text', 'shape', 'image', 'html', 'link', 'table']);

/** True for elements a sticker can sit on. */
export function canHostSticker(element: BoardElement): element is StickerHost {
  return HOST_TYPES.has(element.type);
}

/** The free (point) ends of arrows that move with a selection or a moved area. */
export type CarriedArrowEnds = Map<ElementId, { from?: ArrowEnd; to?: ArrowEnd }>;

/**
 * Free arrow ends that move along: every free end of a selected arrow, and
 * free ends inside one of `boxes` (unless `accept` refuses that end).
 */
export function carriedArrowEnds(
  elements: readonly BoardElement[],
  selectedIds: ReadonlySet<ElementId>,
  boxes: readonly Box[],
  accept?: (arrowId: ElementId, end: 'from' | 'to', box: Box) => boolean,
): CarriedArrowEnds {
  const carried: CarriedArrowEnds = new Map();
  for (const element of elements) {
    if (element.type !== 'arrow') continue;
    const carries = (end: 'from' | 'to'): boolean => {
      const point = element[end];
      return (
        typeof point !== 'string' &&
        (selectedIds.has(element.id) || boxes.some((box) => pointInBox(box, point[0], point[1]) && accept?.(element.id, end, box) !== false))
      );
    };
    const ends = { ...(carries('from') ? { from: element.from } : {}), ...(carries('to') ? { to: element.to } : {}) };
    if (ends.from !== undefined || ends.to !== undefined) carried.set(element.id, ends);
  }
  return carried;
}

/**
 * The element a sticker sits on, among the elements drawn before it:
 * - the preferred host (its recorded one) when they overlap by a quarter of
 *   the sticker each way;
 * - else the smallest host that contains the sticker's center (a see-through
 *   host such as text, a drawing, a hollow shape or a point outside a
 *   shape's outline only wins when it is smaller), or a host overlapping it
 *   that sits inside that one;
 * - else the host it overlaps most.
 * Pass `''` as `preferredId` to ignore the recorded host.
 */
export function findStickerHost(
  sticker: BoardElement,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
  preferredId: ElementId | undefined = sticker.type === 'sticker' ? sticker.on?.[0] : undefined,
): StickerHost | undefined {
  if (sticker.type !== 'sticker') return undefined;
  type Candidate = { el: StickerHost; area: number; box: Box };
  let smallest: Candidate | undefined;
  let largestOverlap: Candidate | undefined;
  let nested: Candidate | undefined;
  for (const candidate of elements) {
    if (candidate.id === sticker.id) break;
    if (!canHostSticker(candidate)) continue;
    const box = elementLayoutBox(candidate, measures);
    if (box === undefined) continue;
    const stickerBox = rotateBoxAround(sticker, boxCenter(box), -elementTurn(candidate));
    const overlapW = Math.min(box.x + box.w, stickerBox.x + stickerBox.w) - Math.max(box.x, stickerBox.x);
    const overlapH = Math.min(box.y + box.h, stickerBox.y + stickerBox.h) - Math.max(box.y, stickerBox.y);
    if (candidate.id === preferredId && overlapW >= sticker.w / 4 && overlapH >= sticker.h / 4) return candidate;
    const centerX = stickerBox.x + stickerBox.w / 2;
    const centerY = stickerBox.y + stickerBox.h / 2;
    if (pointInBox(box, centerX, centerY)) {
      const isSeeThrough = (): boolean =>
        candidate.type === 'text' ||
        (candidate.type === 'image' && isSvgBase64DataUrl(candidate.src)) ||
        (candidate.type === 'shape' && (candidate.hollow === true || (!isCurvedShapeKind(candidate.kind) && shapeOutlineDepth(candidate, centerX, centerY) < 0)));
      if (smallest === undefined || box.w * box.h <= smallest.area || !isSeeThrough()) {
        smallest = { el: candidate, area: box.w * box.h, box };
        nested = undefined;
      }
    } else if (overlapW >= sticker.w / 4 && overlapH >= sticker.h / 4) {
      if (largestOverlap === undefined || overlapW * overlapH >= largestOverlap.area) largestOverlap = { el: candidate, area: overlapW * overlapH, box };
      if (
        smallest !== undefined &&
        pointInBox(smallest.box, box.x, box.y) &&
        pointInBox(smallest.box, box.x + box.w, box.y + box.h) &&
        (nested === undefined || overlapW * overlapH >= nested.area)
      )
        nested = { el: candidate, area: overlapW * overlapH, box };
    }
  }
  return (nested ?? smallest ?? largestOverlap)?.el;
}

/** {@link findStickerHost}'s id, cached per sticker in `cache`. */
export function cachedStickerHost(
  sticker: StickerElement,
  elements: readonly BoardElement[],
  measures: ElementMeasures | undefined,
  cache: Map<ElementId, ElementId | undefined>,
): ElementId | undefined {
  if (!cache.has(sticker.id)) cache.set(sticker.id, findStickerHost(sticker, elements, measures)?.id);
  return cache.get(sticker.id);
}

/** Ids of stickers (not already in `ids`) whose host is in `ids`. */
export function stickersOnHosts(
  ids: ReadonlySet<ElementId>,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
  cache: Map<ElementId, ElementId | undefined> = new Map(),
): ElementId[] {
  return elements.flatMap((element) =>
    element.type === 'sticker' && !ids.has(element.id) && ids.has(cachedStickerHost(element, elements, measures, cache) ?? '') ? [element.id] : [],
  );
}

/**
 * Stickers inside a frame (among `insideIds`) whose host straddles the
 * frame's edge: they stay with the host instead of moving with the frame.
 */
export function stickersOnStraddlingHosts(
  frame: Box,
  insideIds: Iterable<ElementId>,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
  cache: Map<ElementId, ElementId | undefined> = new Map(),
): ElementId[] {
  const inside = new Set(insideIds);
  const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const corners = [0, frame.w].flatMap((dx) => [0, frame.h].map((dy) => [frame.x + dx, frame.y + dy] as const));
  const straddling = new Map(
    elements.flatMap((element): Array<[ElementId, Box]> => {
      const box = canHostSticker(element) && !inside.has(element.id) ? elementLayoutBox(element, measures) : undefined;
      const bounds = box && rotatedBoundingBox(box, elementTurn(element));
      const containsFrame = (): boolean =>
        box !== undefined &&
        corners.every(([x, y]) => {
          const point: Point = elementTurn(element) === 0 ? { x, y } : rotatePointAround({ x, y }, boxCenter(box), -elementTurn(element));
          return pointInBox(box, point.x, point.y);
        });
      return bounds !== undefined && overlaps(bounds, frame) && !containsFrame() ? [[element.id, bounds]] : [];
    }),
  );
  const straddlingBoxes = [...straddling.values()];
  return elements.flatMap((element) =>
    element.type === 'sticker' &&
    inside.has(element.id) &&
    straddlingBoxes.some((box) => overlaps(box, element)) &&
    straddling.has(cachedStickerHost(element, elements, measures, cache) ?? '')
      ? [element.id]
      : [],
  );
}

/** Options of {@link moveStickersWithHosts}. */
export interface MoveStickersOptions {
  /** Stickers keep their relative spot when a host is resized (not only when it changes size). */
  stretch?: boolean;
  /** Move only the stickers listed in `hosts`, with the hosts given there. */
  only?: boolean;
  /** Sticker id → host id, overriding the host found on the board. */
  hosts?: ReadonlyMap<ElementId, ElementId | undefined>;
  /** Stickers that moved on their own (left alone). */
  own?: (id: ElementId) => boolean;
}

/**
 * Moves stickers with the hosts that moved or were resized between `before`
 * and `after`: a sticker keeps its spot relative to its host (scaled with
 * the host's size, rotated with the host).
 */
export function moveStickersWithHosts(
  before: readonly BoardElement[],
  after: BoardElement[],
  measures?: ElementMeasures,
  options: MoveStickersOptions = {},
): BoardElement[] {
  const previousById = new Map(before.map((element) => [element.id, element]));
  const moved = new Map<ElementId, [Box, Box]>();
  for (const element of after) {
    const previous = previousById.get(element.id);
    const oldBox = previous !== undefined && previous !== element && canHostSticker(previous) ? elementLayoutBox(previous, measures) : undefined;
    const newLayout = oldBox && elementLayoutBox(element, measures);
    if (previous === undefined || oldBox === undefined || newLayout === undefined) continue;
    const grown =
      element.type === 'note' && previous.type === 'note' && element.h !== previous.h
        ? { ...newLayout, h: Math.max(element.h, oldBox.h > previous.h ? oldBox.h : 0) }
        : newLayout;
    const resized =
      options.stretch === true || ('w' in element && 'w' in previous && element.w !== previous.w) || ('h' in element && 'h' in previous && element.h !== previous.h);
    const newBox = resized ? grown : { ...oldBox, x: grown.x, y: grown.y };
    if (oldBox.x !== newBox.x || oldBox.y !== newBox.y || oldBox.w !== newBox.w || oldBox.h !== newBox.h) moved.set(element.id, [oldBox, newBox]);
  }
  if (moved.size === 0 && options.only !== true) return after;
  const nearMoved = (sticker: Box): boolean =>
    [...moved].some(([id, [oldBox]]) => {
      const box = rotatedBoundingBox(oldBox, elementTurn(previousById.get(id)));
      return sticker.x <= box.x + box.w && box.x <= sticker.x + sticker.w && sticker.y <= box.y + box.h && box.y <= sticker.y + sticker.h;
    });
  return after.map((element) => {
    const previous = previousById.get(element.id);
    if (element.type !== 'sticker' || previous?.type !== 'sticker' || options.own?.(element.id) === true) return element;
    const hostId =
      options.only === true
        ? options.hosts?.get(previous.id)
        : nearMoved(previous)
          ? findStickerHost(previous, before, measures, options.hosts?.get(previous.id))?.id
          : undefined;
    if (hostId === undefined) return element;
    const [hostBefore, hostAfter] = moved.get(hostId) ?? [previous, previous];
    const remap = (value: number, start: number, size: number, newStart: number, newSize: number): number => {
      const within = Math.min(size, Math.max(0, value - start));
      return newStart + (size > 0 ? (within * newSize) / size : within) + (value - start - within);
    };
    const rotation = elementTurn(previousById.get(hostId));
    const local = rotateBoxAround(previous, boxCenter(hostBefore), -rotation);
    const { x, y } = rotateBoxAround(
      {
        ...local,
        x: remap(local.x + previous.w / 2, hostBefore.x, hostBefore.w, hostAfter.x, hostAfter.w) - previous.w / 2,
        y: remap(local.y + previous.h / 2, hostBefore.y, hostBefore.h, hostAfter.y, hostAfter.h) - previous.h / 2,
      },
      boxCenter(hostAfter),
      rotation,
    );
    return x === element.x && y === element.y ? element : { ...element, x, y };
  });
}

/** Sticker → host pairs for stickers whose host is in the selection. */
export function stickerHostPairs(selection: readonly BoardElement[], elements: readonly BoardElement[], measures?: ElementMeasures): Map<BoardElement, StickerHost> {
  const ids = new Set(selection.map((element) => element.id));
  return new Map(
    elements.flatMap((sticker): Array<[BoardElement, StickerHost]> => {
      const host = findStickerHost(sticker, elements, measures);
      return host !== undefined && ids.has(host.id) ? [[sticker, host]] : [];
    }),
  );
}

/** The selection's items a tidy-up grid arranges (no strokes, sections or stickers riding on a selected host). */
export function gridArrangeRects(selection: readonly BoardElement[], elements: readonly BoardElement[], measures?: ElementMeasures): Array<{ id: ElementId; rect: Box }> {
  const hosted = stickerHostPairs(selection, elements, measures);
  return selection.flatMap((element) => {
    const rect = elementBounds(element, measures);
    return rect !== undefined && element.type !== 'stroke' && element.type !== 'container' && !hosted.has(element) ? [{ id: element.id, rect }] : [];
  });
}

/**
 * New top-left positions for a tidy-up grid of the selection (two items at
 * least); rotated items are placed by their bounds, and stickers move with
 * their hosts.
 */
export function gridArrangePositions(selection: readonly BoardElement[], elements: readonly BoardElement[], measures?: ElementMeasures): Map<ElementId, Point> {
  const items = gridArrangeRects(selection, elements, measures);
  const positions = items.length < 2 ? new Map<ElementId, Point>() : gridLayoutOfRects(items);
  for (const element of selection) {
    const placed = elementTurn(element) === 0 ? undefined : positions.get(element.id);
    const layout = elementLayoutBox(element, measures);
    const rect = elementBounds(element, measures);
    if (placed && layout && rect) positions.set(element.id, { x: placed.x + layout.x - rect.x, y: placed.y + layout.y - rect.y });
  }
  for (const [sticker, host] of stickerHostPairs(selection, elements, measures)) {
    const placed = positions.get(host.id);
    if (sticker.type === 'sticker' && placed !== undefined) positions.set(sticker.id, { x: sticker.x + placed.x - host.x, y: sticker.y + placed.y - host.y });
  }
  return positions;
}

/** The point that decides whether an element is inside a section: its center (a note's declared height). */
export function containmentAnchor(element: BoardElement, box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + (element.type === 'note' ? element.h : box.h) / 2 };
}

/**
 * Ids of the elements inside a box (a section's area): a section counts
 * when wholly inside, anything else when its center is. Arrows never count.
 */
export function elementsWithinBox(box: Box, elements: readonly BoardElement[], measures?: ElementMeasures, excludeId?: ElementId): ElementId[] {
  const ids: ElementId[] = [];
  for (const element of elements) {
    if (element.type === 'arrow' || element.id === excludeId) continue;
    const elementBox = elementLayoutBox(element, measures);
    if (!elementBox) continue;
    const anchor = containmentAnchor(element, elementBox);
    if (
      element.type === 'container'
        ? pointInBox(box, element.x, element.y) && pointInBox(box, element.x + element.w, element.y + element.h)
        : pointInBox(box, anchor.x, anchor.y)
    )
      ids.push(element.id);
  }
  return ids;
}

/** Notes with their height raised to the height they are drawn at. */
export function withMeasuredNoteHeights(elements: readonly BoardElement[], measures?: ElementMeasures): BoardElement[] {
  return elements.map((element) => (element.type === 'note' ? { ...element, h: elementLayoutBox(element, measures)!.h } : element));
}
