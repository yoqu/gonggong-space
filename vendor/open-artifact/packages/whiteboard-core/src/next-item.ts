/**
 * Where a next item goes: beside an item (Mod+Return while typing, or a
 * click on one of its side dots, which also need room around them), or at
 * the free end of an arrow just drawn into empty board (the *next-item
 * offer*: the editor shows a faint item there that Return or a click adds,
 * joined to the arrow).
 *
 * Pure geometry: the editor decides when to offer and draws the offer.
 */

import { setArrowEnd } from './edits.ts';
import { elementBounds, elementLayoutBox, measuredArrowGeometry, type Box, type ElementMeasures, type ElementsById } from './geometry.ts';
import type { ArrowElement, ArrowSide, BoardElement, ElementType, NoteElement, ShapeElement } from './schema.ts';

/** Gap between an item and the next one placed beside it, by type. */
export const NEXT_ITEM_GAP = { note: 24, shape: 48 } as const;
/** Types a next item may overlap (strokes, sections and stickers sit around other things). */
export const NEXT_ITEM_IGNORED_TYPES: ReadonlySet<ElementType> = new Set(['stroke', 'container', 'sticker']);
/** Clearance kept around other items by a next item, board units. */
export const NEXT_ITEM_CLEARANCE = 12;

/** An item a next item can be: a note or a shape. */
export type NextItem = NoteElement | ShapeElement;

/** Whether `inner` sits centered inside the larger `outer` (the frame an item sits in, not an obstacle). */
export function isCenteredInside(inner: Box, outer: Box): boolean {
  return (
    outer.w > inner.w &&
    outer.h > inner.h &&
    Math.abs(inner.x + inner.w / 2 - outer.x - outer.w / 2) <= outer.w / 2 &&
    Math.abs(inner.y + inner.h / 2 - outer.y - outer.h / 2) <= outer.h / 2
  );
}

/** Whether two boxes overlap or come within {@link NEXT_ITEM_CLEARANCE} of each other. */
export function boxesNearlyTouch(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w + NEXT_ITEM_CLEARANCE &&
    b.x < a.x + a.w + NEXT_ITEM_CLEARANCE &&
    a.y < b.y + b.h + NEXT_ITEM_CLEARANCE &&
    b.y < a.y + a.h + NEXT_ITEM_CLEARANCE
  );
}

/** Where `template` goes beside `box` on `side`, `gap` away, lined up with `fromBox` across that direction. */
function spotBeside(fromBox: Box, box: Box, template: NextItem, side: ArrowSide): Box {
  const gap = NEXT_ITEM_GAP[template.type];
  const align = template.type === 'shape' ? 0.5 : 0;
  return {
    x: side === 'right' ? box.x + box.w + gap : side === 'left' ? box.x - template.w - gap : fromBox.x + (fromBox.w - template.w) * align,
    y: side === 'bottom' ? box.y + box.h + gap : side === 'top' ? box.y - template.h - gap : fromBox.y + (fromBox.h - template.h) * align,
    w: template.w,
    h: template.h,
  };
}

/** The boxes a next item placed from `fromBox` keeps clear of (not the frames `fromBox` sits in). */
function nextItemObstacles(fromBox: Box, elements: readonly BoardElement[], measures?: ElementMeasures): Box[] {
  return elements.flatMap((element) => {
    if (NEXT_ITEM_IGNORED_TYPES.has(element.type)) return [];
    const box = elementBounds(element, measures);
    return box && !isCenteredInside(fromBox, box) ? [box] : [];
  });
}

/**
 * Places `template` beside `from` on `side` (right by default), past
 * anything in the way: each time the spot would touch an item, it moves on
 * past that item, away from `from`. A shape is centered on `from` across
 * that direction, a note aligned with its top (or left) edge. Items `from`
 * sits centered inside (its frames) are not in the way.
 */
export function placeNextItemBeside<T extends NextItem>(from: BoardElement, template: T, elements: readonly BoardElement[], measures?: ElementMeasures, side: ArrowSide = 'right'): T {
  const fromBox = elementBounds(from, measures) ?? { x: 0, y: 0, w: 0, h: 0 };
  const obstacles = nextItemObstacles(fromBox, elements, measures);
  let spot = spotBeside(fromBox, fromBox, template, side);
  // Each step moves strictly away from `from`, so this ends after at most one step per obstacle.
  for (let blocked = obstacles.find((box) => boxesNearlyTouch(spot, box)); blocked; blocked = obstacles.find((box) => boxesNearlyTouch(spot, box))) {
    spot = spotBeside(fromBox, blocked, template, side);
  }
  return { ...template, x: spot.x, y: spot.y };
}

/**
 * Where the item a click on `from`'s `side` dot adds goes: right beside
 * `from` on that side when the spot is clear, else right below `from`, else
 * nowhere (`undefined`). It never steps past items in the way.
 */
export function placeNextItemAtSide<T extends NextItem>(from: BoardElement, template: T, side: ArrowSide, elements: readonly BoardElement[], measures?: ElementMeasures): T | undefined {
  const fromBox = elementBounds(from, measures);
  if (!fromBox) return undefined;
  const obstacles = nextItemObstacles(fromBox, elements, measures);
  for (const toward of side === 'bottom' ? (['bottom'] as const) : [side, 'bottom' as const]) {
    const spot = spotBeside(fromBox, fromBox, template, toward);
    if (!obstacles.some((box) => boxesNearlyTouch(spot, box))) return { ...template, x: spot.x, y: spot.y };
  }
  return undefined;
}

/** Items that take the room a side dot needs: notes, shapes, sections and stickers. */
export const SIDE_DOT_BLOCKING_TYPES: ReadonlySet<ElementType> = new Set(['note', 'shape', 'container', 'sticker']);

/** Distance from a point to a box: 0 inside it. */
function distanceToBox(box: Box, x: number, y: number): number {
  const dx = x < box.x ? box.x - x : x > box.x + box.w ? x - box.x - box.w : 0;
  const dy = y < box.y ? box.y - y : y > box.y + box.h ? y - box.y - box.h : 0;
  return Math.hypot(dx, dy);
}

/**
 * Whether a side dot at (`x`, `y`) has room: no note, shape, section or
 * sticker other than `owner` within `reach` of it. A section counts by its
 * outline, so a dot well inside one still has room.
 */
export function sideDotHasRoom(owner: BoardElement, x: number, y: number, reach: number, elements: readonly BoardElement[], measures?: ElementMeasures): boolean {
  return !elements.some((element) => {
    if (element.id === owner.id || !SIDE_DOT_BLOCKING_TYPES.has(element.type)) return false;
    const box = elementBounds(element, measures);
    if (!box) return false;
    const inside = distanceToBox(box, x, y) === 0;
    const distance = inside && element.type === 'container' ? Math.min(x - box.x, box.x + box.w - x, y - box.y, box.y + box.h - y) : distanceToBox(box, x, y);
    return distance <= reach;
  });
}

/* ------------------------------------------------------------------------ */
/* The next-item offer                                                      */
/* ------------------------------------------------------------------------ */

/** An item offered at an arrow's free end. */
export interface ArrowEndOffer {
  /** The arrow as it was when the offer was made. */
  arrow: ArrowElement;
  /** The arrow's free end, which the offered item would take. */
  end: 'from' | 'to';
  /** The offered item, placed where it would go. */
  next: NextItem;
  /** The side of the offered item the arrow would join. */
  side: ArrowSide;
}

/** The end of an arrow left on empty board while the other is on an item; `undefined` otherwise. */
export function arrowFreeEnd(arrow: ArrowElement): 'from' | 'to' | undefined {
  if (typeof arrow.from === 'string') return typeof arrow.to === 'string' ? undefined : 'to';
  return typeof arrow.to === 'string' ? 'from' : undefined;
}

/**
 * Where a box of `size` goes so that the middle of its `side` is at
 * (`x`, `y`): a box joined on its left starts at `x`, on its top at `y`,
 * and so on.
 */
export function placeBoxAtAnchor(size: { w: number; h: number }, side: ArrowSide, x: number, y: number): { x: number; y: number } {
  return {
    x: side === 'left' ? x : side === 'right' ? x - size.w : x - size.w / 2,
    y: side === 'top' ? y : side === 'bottom' ? y - size.h : y - size.h / 2,
  };
}

/**
 * The item to offer at an arrow's free end: `next` placed so the arrow
 * meets the middle of the side facing back along its last leg, exactly at
 * the arrow's tip. `undefined` when the arrow has no free end (both ends on
 * items, or neither), its ends are missing, or the offered item would come
 * near another item (arrows, strokes and sections aside).
 */
export function arrowEndNextOffer(
  arrow: ArrowElement,
  next: NextItem,
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
  byId: ElementsById = new Map(elements.map((element) => [element.id, element])),
): ArrowEndOffer | undefined {
  const end = arrowFreeEnd(arrow);
  const geometry = end && measuredArrowGeometry(arrow, byId, measures);
  if (!end || !geometry) return undefined;
  const points = geometry.elbow ?? [
    [geometry.x1, geometry.y1],
    [geometry.x2, geometry.y2],
  ];
  const [tip, before] = end === 'to' ? [points[points.length - 1]!, points[points.length - 2]!] : [points[0]!, points[1]!];
  const dx = tip[0] - before[0];
  const dy = tip[1] - before[1];
  // The side facing back along the last leg: an arrow heading right joins the item's left side.
  const side: ArrowSide = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom';
  const placed: NextItem = { ...next, ...placeBoxAtAnchor(next, side, tip[0], tip[1]) };
  // Joining the item may move where the arrow meets it (a note grown to its
  // text, a shape's outline); shift the item so the join lands on the tip.
  const linked = setArrowEnd(arrow, end, { end: placed.id, side });
  const linkedGeometry = linked && measuredArrowGeometry(linked, new Map(byId).set(placed.id, placed).set(linked.id, linked), measures);
  if (!linkedGeometry) return undefined;
  const [joinX, joinY] = end === 'to' ? [linkedGeometry.x2, linkedGeometry.y2] : [linkedGeometry.x1, linkedGeometry.y1];
  const adjusted: NextItem = side === 'left' || side === 'right' ? { ...placed, x: placed.x + tip[0] - joinX } : { ...placed, y: placed.y + tip[1] - joinY };
  const box = elementLayoutBox(adjusted, measures);
  if (!box) return undefined;
  const crowded = elements.some((element) => {
    if (element.type === 'arrow' || element.type === 'stroke' || element.type === 'container') return false;
    const other = elementBounds(element, measures);
    return other !== undefined && boxesNearlyTouch(box, other);
  });
  return crowded ? undefined : { arrow, end, next: adjusted, side };
}

/**
 * Whether an offer still stands on the board as it is now: its arrow is
 * still there with the same free end, and the item would still go to the
 * same place without coming near anything.
 */
export function isArrowEndOfferCurrent(offer: ArrowEndOffer, elements: readonly BoardElement[], measures?: ElementMeasures, byId?: ElementsById): boolean {
  const index = byId ?? new Map(elements.map((element) => [element.id, element]));
  const arrow = index.get(offer.arrow.id);
  const current = arrow?.type === 'arrow' ? arrowEndNextOffer(arrow, offer.next, elements, measures, index) : undefined;
  return current !== undefined && current.end === offer.end && current.next.x === offer.next.x && current.next.y === offer.next.y;
}
