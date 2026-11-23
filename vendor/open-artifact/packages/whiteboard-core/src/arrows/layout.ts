/**
 * Arrow layout for a whole board: where each arrow leaves and enters its
 * ends, how arrows sharing a side fan out along it, how parallel Z routes
 * stagger their middle legs, and the final geometry of every arrow
 * (straight line or elbow points, trimmed to the outline of the shapes it
 * joins).
 *
 * Element boxes come from an injected {@link ElementLayoutBoxResolver}
 * (the element's unrotated box, including measured heights), so this
 * module needs no DOM and no geometry module.
 *
 * The layout runs in WebAssembly (`crates/open-artifact-wb-geom/src/arrow_layout.rs`).
 * A board is encoded once per board map and resolver (element types,
 * shape sizes, rotations and the layout boxes arrow ends need) and kept on
 * the WebAssembly side; its plans and the geometry of all its arrows are
 * computed in one call each and cached, like the plans were before. Boards
 * are replaced, never mutated, so the caches stay valid.
 */

import { wbGeom, type WbGeom } from '@open-artifact/wasm-wb-geom';
import { elementTurn, type ArrowElement, type ArrowSide, type BoardElement, type ElementId } from '../schema.ts';
import type { LineSegment } from '../shape-paths.ts';
import { SIDE_ORDER, decodePoints, encodePoints, kindCode, sideCode } from '../geom-codec.ts';
import { MANUAL_ARROW_STRAIGHTEN_LIMIT, type RouteBox, type RoutePoint } from './routing.ts';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** A board point. */
export interface ArrowEndPoint {
  x: number;
  y: number;
}

/** A resolved arrow end: the (rotated) bounds of its element, or a free point. */
export type ArrowEndGeometry = ArrowEndPoint | RouteBox;

/** The board as a map from id to element, in drawing order. */
export type BoardIndex = ReadonlyMap<ElementId, BoardElement>;

/**
 * The unrotated layout box of an element (with any measured size, such as a
 * note grown to fit its text), or `undefined` for arrows.
 */
export type ElementLayoutBoxResolver = (element: BoardElement) => RouteBox | undefined;

/** The route-relevant fields of an arrow (a stored arrow or a draft being drawn). */
export type ArrowRouteFields = Pick<ArrowElement, 'from' | 'to' | 'fromSide' | 'toSide' | 'jog' | 'bends'> & { id?: ElementId };

/** How an arrow's ends spread along their sides and how its Z middle leg staggers. */
export interface ArrowSpread {
  /** Offsets of the start and end anchors along their sides. */
  exits: readonly [number, number];
  /** Shift of a Z route's middle leg (when the arrow has no `jog`). */
  stagger: number;
  /** The arrow must keep its turns (a straightened route would collide). */
  turns?: boolean;
}

/** An elbow route with the sides and exits it uses. */
export interface ElbowArrowRoute {
  pts: RoutePoint[];
  sides: [ArrowSide, ArrowSide];
  exits: readonly [number, number];
  /** Routed through manual bends. */
  bent?: true;
  /** A Z whose jog is small enough to straighten by sliding the ends. */
  flat?: true;
  /** A Z that keeps its jog. */
  z?: true;
}

/** One arrow end's use of an element side, for ordering arrows along it. */
export interface ArrowSideUse {
  id: ElementId | undefined;
  /** Tie-breaker: drawing order, signed by side orientation. */
  order: number;
  /** Which way the route turns after leaving (-1, 0 straight, 1). */
  way: number;
  /** Length of the first leg. */
  depth: number;
  /** Distance to the far end along the side. */
  far: number;
}

/** The sides an arrow uses and how each end uses its side. */
export interface ArrowEndSideUses {
  sides: [ArrowSide, ArrowSide];
  uses: [ArrowSideUse | undefined, ArrowSideUse | undefined];
  flat: boolean;
}

/** Where an arrow is drawn: a straight line, or the points of an elbow route. */
export interface ArrowGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  elbow?: RoutePoint[];
  /** Routed through manual bends. */
  bent?: true;
}

/* -------------------------------------------------------------------------- */
/* Constants and small helpers                                                 */
/* -------------------------------------------------------------------------- */

/** Widest gap between neighboring arrow ends on one side. */
export const MAX_ARROW_END_SPACING = 24;
/** Arrow ends keep this far from a side's corners. */
export const ARROW_END_CORNER_MARGIN = 12;
/** Automatic Z routes with a smaller jog straighten by sliding their ends. */
export const ARROW_STRAIGHTEN_LIMIT = 32;
/** Passes of the ordering heuristic for staggered legs. */
export const ARROW_END_ORDER_PASSES = 4;
/** No spreading or staggering. */
export const NO_ARROW_SPREAD: ArrowSpread = { exits: [0, 0], stagger: 0 };

/** The placeholder arrow a draft without an id becomes while it is planned. */
export const DRAFT_ARROW: ArrowElement = { type: 'arrow', id: '\u0000new', from: [0, 0], to: [0, 0], head: 'end', dash: false, color: 'ink' };

function isBoxEnd(end: ArrowEndGeometry): end is RouteBox {
  return 'w' in end;
}

/** The center of an arrow end. */
export function arrowEndCenter(end: ArrowEndGeometry): ArrowEndPoint {
  return isBoxEnd(end) ? { x: end.x + end.w / 2, y: end.y + end.h / 2 } : end;
}

/** An arrow end as a box (a free point is a zero-size box). */
export function arrowEndAsBox(end: ArrowEndGeometry): RouteBox {
  return isBoxEnd(end) ? end : { ...end, w: 0, h: 0 };
}

/** True when the arrow has a manual route (a jog, or one bend). */
export function hasManualArrowRoute(arrow: Pick<ArrowRouteFields, 'jog' | 'bends'>): boolean {
  return arrow.jog !== undefined || arrow.bends?.length === 2;
}

/** The jog under which an arrow's Z route straightens. */
export function arrowStraightenLimit(arrow: Pick<ArrowRouteFields, 'jog' | 'bends'>): number {
  return hasManualArrowRoute(arrow) ? MANUAL_ARROW_STRAIGHTEN_LIMIT : ARROW_STRAIGHTEN_LIMIT;
}

/** A key of the directions a route's legs run (`"1,0 0,1 …"`). */
export function routeDirectionsKey(points: readonly RoutePoint[] = []): string {
  return points
    .slice(1)
    .map((point, index) => ([0, 1] as const).map((axis) => Math.sign((point[axis] ?? 0) - (points[index]?.[axis] ?? 0))).join())
    .join(' ');
}

/** The middle of a box side. */
export function boxSideMidpoint(box: RouteBox, side: ArrowSide): ArrowEndPoint {
  switch (side) {
    case 'top':
      return { x: box.x + box.w / 2, y: box.y };
    case 'bottom':
      return { x: box.x + box.w / 2, y: box.y + box.h };
    case 'left':
      return { x: box.x, y: box.y + box.h / 2 };
    case 'right':
      return { x: box.x + box.w, y: box.y + box.h / 2 };
  }
}

/** The side of a box facing a point (relative to the box's aspect). */
export function boxSideTowardPoint(box: RouteBox, x: number, y: number): ArrowSide {
  const relX = (x - (box.x + box.w / 2)) / Math.max(1, box.w);
  const relY = (y - (box.y + box.h / 2)) / Math.max(1, box.h);
  if (Math.abs(relX) > Math.abs(relY)) return relX > 0 ? 'right' : 'left';
  return relY > 0 ? 'bottom' : 'top';
}

/** The sides an arrow leaves and enters: its own, or the sides facing each other. */
export function arrowEndSides(arrow: Pick<ArrowRouteFields, 'fromSide' | 'toSide'>, from: ArrowEndGeometry, to: ArrowEndGeometry): [ArrowSide, ArrowSide] {
  return [
    (isBoxEnd(from) ? arrow.fromSide : undefined) ?? boxSideTowardPoint(arrowEndAsBox(from), arrowEndCenter(to).x, arrowEndCenter(to).y),
    (isBoxEnd(to) ? arrow.toSide : undefined) ?? boxSideTowardPoint(arrowEndAsBox(to), arrowEndCenter(from).x, arrowEndCenter(from).y),
  ];
}

/** True when end `a` comes before end `b` left to right, then top to bottom. */
export function arrowEndPrecedes(a: ArrowEndGeometry, b: ArrowEndGeometry): boolean {
  const [centerA, centerB] = [arrowEndCenter(a), arrowEndCenter(b)];
  return centerA.x < centerB.x || (centerA.x === centerB.x && centerA.y <= centerB.y);
}

/** Orders arrow ends along a side so their routes do not cross. */
export function compareArrowSideUses(a: ArrowSideUse, b: ArrowSideUse): number {
  return a.way - b.way || (a.way < 0 ? a.depth - b.depth || b.far - a.far : a.way > 0 ? b.depth - a.depth || a.far - b.far : 0) || a.order - b.order;
}

/** Length of a box side (0 for a free point). */
export function boxSideLength(end: ArrowEndGeometry, side: ArrowSide): number {
  return isBoxEnd(end) ? (side === 'left' || side === 'right' ? end.h : end.w) : 0;
}

/** Furthest an arrow end may slide from the middle of a side. */
export function maxArrowEndOffset(end: ArrowEndGeometry, side: ArrowSide): number {
  return Math.max(0, boxSideLength(end, side) / 2 - ARROW_END_CORNER_MARGIN);
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

type GeomBoard = InstanceType<WbGeom['GeomBoard']>;

/** An arrow as the 15-number record of `crates/open-artifact-wb-geom/src/wasm/arrow_layout.rs`, plus its bend values. */
interface EncodedArrow {
  record: Float64Array;
  bends: Float64Array;
}

function encodeEnd(out: Float64Array, at: number, end: ArrowElement['from'], indexOf: (id: string) => number | undefined): void {
  if (typeof end !== 'string') {
    out[at] = 0;
    out[at + 1] = end[0];
    out[at + 2] = end[1];
    out[at + 3] = indexOf(String(end)) ?? -1;
    return;
  }
  const index = indexOf(end);
  out[at] = index === undefined ? 2 : 1;
  out[at + 1] = index ?? 0;
  out[at + 3] = -1;
}

const noIndex = (): undefined => undefined;

function encodeArrow(arrow: ArrowRouteFields, elementIndex: number, indexOf: (id: string) => number | undefined = noIndex): EncodedArrow {
  const record = new Float64Array(15);
  record[0] = elementIndex;
  encodeEnd(record, 1, arrow.from, indexOf);
  encodeEnd(record, 5, arrow.to, indexOf);
  record[9] = sideCode(arrow.fromSide);
  record[10] = sideCode(arrow.toSide);
  record[11] = arrow.jog !== undefined ? 1 : 0;
  record[12] = arrow.jog ?? 0;
  const bends = arrow.bends ? Float64Array.from(arrow.bends.slice(1) as number[]) : new Float64Array(0);
  record[13] = arrow.bends ? (arrow.bends[0] === 'h' ? 0 : 1) : -1;
  record[14] = bends.length;
  return { record, bends };
}

function encodeEnds(from: ArrowEndGeometry, to: ArrowEndGeometry): Float64Array {
  const out = new Float64Array(10);
  for (const [at, end] of [
    [0, from],
    [5, to],
  ] as const) {
    if (isBoxEnd(end)) out.set([1, end.x, end.y, end.w, end.h], at);
    else out.set([0, end.x, end.y, 0, 0], at);
  }
  return out;
}

function encodeElement(element: BoardElement, box: RouteBox | undefined, out = new Float64Array(10), at = 0): Float64Array {
  out[at] = element.type === 'arrow' ? 1 : element.type === 'shape' ? 2 : 0;
  if (element.type === 'shape') {
    out[at + 1] = kindCode(element.kind);
    out[at + 2] = element.w;
    out[at + 3] = element.h;
  }
  out[at + 4] = elementTurn(element);
  if (box !== undefined) out.set([1, box.x, box.y, box.w, box.h], at + 5);
  return out;
}

/** A board encoded for the WebAssembly layout, with its cached results. */
interface BoardGeom {
  layoutBox: ElementLayoutBoxResolver;
  handle: GeomBoard;
  /** Elements in board order, as encoded. */
  elements: BoardElement[];
  indexOf: Map<ElementId, number>;
  /** Elements whose layout box has been sent. */
  boxed: Uint8Array;
  /** Board arrows in order, and each arrow id's slot among them. */
  arrows: ArrowElement[];
  arrowSlots: Map<ElementId, number>;
  plans?: ArrowPlans;
  geometry?: { values: Float64Array; starts: Uint32Array };
}

const boardGeomCache = new WeakMap<BoardIndex, BoardGeom>();

function encodeBoard(board: BoardIndex, layoutBox: ElementLayoutBoxResolver): BoardGeom {
  const elements: BoardElement[] = [];
  const indexOf = new Map<ElementId, number>();
  for (const [id, element] of board) {
    indexOf.set(id, elements.length);
    elements.push(element);
  }
  const lookup = (id: string): number | undefined => indexOf.get(id);
  const encodedElements = new Float64Array(elements.length * 10);
  const boxed = new Uint8Array(elements.length);
  const arrows: ArrowElement[] = [];
  const arrowSlots = new Map<ElementId, number>();
  const records: EncodedArrow[] = [];
  let bendCount = 0;
  elements.forEach((element, index) => {
    if (element.type !== 'arrow') return;
    arrowSlots.set(element.id, arrows.length);
    arrows.push(element);
    const encoded = encodeArrow(element, index, lookup);
    records.push(encoded);
    bendCount += encoded.bends.length;
    for (const end of [element.from, element.to]) {
      const target = typeof end === 'string' ? indexOf.get(end) : undefined;
      if (target !== undefined) boxed[target] = 1;
    }
  });
  elements.forEach((element, index) => encodeElement(element, boxed[index] && element.type !== 'arrow' ? layoutBox(element) : undefined, encodedElements, index * 10));
  const arrowValues = new Float64Array(records.length * 15);
  const bendValues = new Float64Array(bendCount);
  let at = 0;
  records.forEach(({ record, bends }, index) => {
    arrowValues.set(record, index * 15);
    bendValues.set(bends, at);
    at += bends.length;
  });
  const handle = new (wbGeom().GeomBoard)(encodedElements, arrowValues, bendValues);
  return { layoutBox, handle, elements, indexOf, boxed, arrows, arrowSlots };
}

/** The encoded board (cached per board map and resolver). */
function boardGeom(board: BoardIndex, layoutBox: ElementLayoutBoxResolver): BoardGeom {
  const cached = boardGeomCache.get(board);
  if (cached && cached.layoutBox === layoutBox && cached.elements.length === board.size) return cached;
  const encoded = encodeBoard(board, layoutBox);
  boardGeomCache.set(board, encoded);
  return encoded;
}

/** Sends the layout boxes of an arrow's id ends when the board encoding left them out. */
function ensureEndBoxes(geom: BoardGeom, arrow: Pick<ArrowRouteFields, 'from' | 'to'>): void {
  for (const end of [arrow.from, arrow.to]) {
    const index = typeof end === 'string' ? geom.indexOf.get(end) : undefined;
    if (index === undefined || geom.boxed[index]) continue;
    geom.boxed[index] = 1;
    const element = geom.elements[index]!;
    const box = element.type === 'arrow' ? undefined : geom.layoutBox(element);
    geom.handle.set_layout(index, box !== undefined, box?.x ?? 0, box?.y ?? 0, box?.w ?? 0, box?.h ?? 0);
  }
}

function encodeArrowOn(geom: BoardGeom, arrow: ArrowRouteFields): EncodedArrow {
  ensureEndBoxes(geom, arrow);
  return encodeArrow(arrow, -1, (id) => geom.indexOf.get(id));
}

function decodeGeometry(values: Float64Array, at: number): ArrowGeometry | undefined {
  const status = values[at];
  if (status === 0) return undefined;
  const line = { x1: values[at + 1]!, y1: values[at + 2]!, x2: values[at + 3]!, y2: values[at + 4]! };
  if (status === 1) return line;
  const elbow = decodePoints(values, at + 6, values[at + 5]!);
  return status === 3 ? { ...line, elbow, bent: true } : { ...line, elbow };
}

/** True when the board still holds what was encoded for this stored arrow. */
function storedArrowIsCurrent(geom: BoardGeom, board: BoardIndex, arrow: ArrowElement): boolean {
  if (geom.elements[geom.indexOf.get(arrow.id) ?? -1] !== arrow) return false;
  for (const end of [arrow.from, arrow.to]) {
    if (typeof end !== 'string') continue;
    const index = geom.indexOf.get(end);
    if ((index === undefined ? undefined : geom.elements[index]) !== board.get(end)) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Rotation                                                                    */
/* -------------------------------------------------------------------------- */

function rotatedBoundingBox(box: RouteBox, degrees: number): RouteBox {
  if (!degrees) return box;
  const [x, y, w, h] = wbGeom().rotated_bounding_box(box.x, box.y, box.w, box.h, degrees) as unknown as [number, number, number, number];
  return { x, y, w, h };
}

/** The bounds of an element (its layout box, rotated). */
function elementBounds(element: BoardElement, layoutBox: ElementLayoutBoxResolver): RouteBox | undefined {
  const box = layoutBox(element);
  return box && rotatedBoundingBox(box, elementTurn(element));
}

/** The origins manual bend values are relative to: the first half from the start center, the rest from the end center. */
export function bendOrigins(first: 'h' | 'v', count: number, fromCenter: ArrowEndPoint, toCenter: ArrowEndPoint): number[] {
  return Array.from({ length: count }, (_, index) => {
    const center = index < Math.ceil(count / 2) ? fromCenter : toCenter;
    return (first === 'h') === (index % 2 === 0) ? center.x : center.y;
  });
}

/** Where an arrow end is: its element's bounds, a free point, or `undefined` (missing element, or an arrow). */
export function resolveArrowEndGeometry(end: ArrowElement['from'], board: BoardIndex, layoutBox: ElementLayoutBoxResolver): ArrowEndGeometry | undefined {
  if (typeof end !== 'string') return { x: end[0], y: end[1] };
  const target = board.get(end);
  return target === undefined || target.type === 'arrow' ? undefined : elementBounds(target, layoutBox);
}

/* -------------------------------------------------------------------------- */
/* Routing one arrow                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The elbow route of one arrow: through its manual bends when they still
 * make a valid route, else the automatic route for its sides (with the
 * spread's exits when they keep the route's shape). A Z is marked `flat`
 * when its jog is small enough to straighten, else `z`.
 */
export function routeElbowArrow(arrow: ArrowRouteFields, from: ArrowEndGeometry, to: ArrowEndGeometry, spread: ArrowSpread): ElbowArrowRoute | undefined {
  const { record, bends } = encodeArrow(arrow, -1);
  const values = wbGeom().arrow_route_elbow(record, bends, encodeEnds(from, to), spread.exits[0], spread.exits[1], spread.stagger, Boolean(spread.turns));
  if (values.length === 0) return undefined;
  const flags = values[4]!;
  return {
    pts: decodePoints(values, 5),
    sides: [SIDE_ORDER[values[0]!]!, SIDE_ORDER[values[1]!]!],
    exits: flags & 8 ? spread.exits : NO_ARROW_SPREAD.exits,
    ...(flags & 1 ? { bent: true as const } : {}),
    ...(flags & 2 ? { flat: true as const } : {}),
    ...(flags & 4 ? { z: true as const } : {}),
  };
}

/**
 * The sides an arrow uses and, for each end attached to an element, how it
 * uses that side (which way it turns, how deep its first leg is), so arrows
 * sharing a side can be ordered.
 */
export function arrowEndSideUses(arrow: ArrowRouteFields, spacing: number, from: ArrowEndGeometry, to: ArrowEndGeometry, route: ElbowArrowRoute | undefined): ArrowEndSideUses {
  const { record, bends } = encodeArrow(arrow, -1);
  const encodedRoute = route ? Float64Array.of(sideCode(route.sides[0]), sideCode(route.sides[1]), route.flat ? 1 : 0, ...encodePoints(route.pts)) : new Float64Array(0);
  const values = wbGeom().arrow_end_side_uses(record, bends, spacing, encodeEnds(from, to), encodedRoute);
  const useAt = (at: number): ArrowSideUse | undefined =>
    values[at] === 1 ? { id: arrow.id, order: values[at + 1]!, way: values[at + 2]!, depth: values[at + 3]!, far: values[at + 4]! } : undefined;
  return { sides: route?.sides ?? [SIDE_ORDER[values[0]!]!, SIDE_ORDER[values[1]!]!], uses: [useAt(3), useAt(8)], flat: values[2] === 1 };
}

/**
 * Offsets along a side for the arrow ends sharing it (already ordered),
 * centered on the straight ones and at most {@link MAX_ARROW_END_SPACING}
 * apart.
 */
export function spreadArrowEndOffsets(uses: readonly ArrowSideUse[], sideLength: number): number[] {
  return Array.from(wbGeom().arrow_spread_end_offsets(Float64Array.from(uses, (use) => use.way), sideLength));
}

/**
 * Exits that line up two facing ends so a nearly straight arrow becomes
 * straight, sliding the preferred end first. `undefined` when no allowed
 * slide works; the given exits when no straightening is needed.
 */
export function straightenFacingArrowExits(
  arrow: ArrowRouteFields,
  exits: readonly [number, number],
  preferEnd: 0 | 1,
  canUseExit: (end: 0 | 1, offset: number) => boolean,
  sides: readonly [ArrowSide, ArrowSide],
  from: ArrowEndGeometry,
  to: ArrowEndGeometry,
): readonly [number, number] | undefined {
  const { record, bends } = encodeArrow(arrow, -1);
  const values = wbGeom().arrow_straighten_candidates(record, bends, exits[0], exits[1], preferEnd, sideCode(sides[0]), sideCode(sides[1]), encodeEnds(from, to));
  if (values[0] === 0) return exits;
  for (const at of [1, 3]) {
    const candidate: [number, number] = [values[at]!, values[at + 1]!];
    if (([0, 1] as const).every((end) => candidate[end] === exits[end] || canUseExit(end, candidate[end]))) return candidate;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Planning a board                                                            */
/* -------------------------------------------------------------------------- */

const elementIndexCache = new WeakMap<readonly BoardElement[], Map<ElementId, BoardElement>>();

/** A map from id to element (cached per array). */
export function indexElementsById(elements: readonly BoardElement[]): Map<ElementId, BoardElement> {
  const byId = elementIndexCache.get(elements) ?? new Map(elements.map((element) => [element.id, element] as const));
  elementIndexCache.set(elements, byId);
  return byId;
}

/** One arrow being planned, with its resolved ends and drawing order. */
export interface PlannedArrow {
  el: ArrowElement;
  f: ArrowEndGeometry;
  t: ArrowEndGeometry;
  place: number;
}

/** The spread plan of every arrow on a board, by id. */
export type ArrowPlans = Map<ElementId, ArrowSpread>;

/**
 * Plans every arrow on a board: the exits that fan arrows out along shared
 * sides and the staggers of parallel Z legs. Repeats while straightening
 * one arrow forces others sharing its side to keep their turns. Cached per
 * board map and resolver.
 */
export function planBoardArrows(board: BoardIndex, layoutBox: ElementLayoutBoxResolver): ArrowPlans {
  const geom = boardGeom(board, layoutBox);
  if (geom.plans) return geom.plans;
  const values = geom.handle.plans();
  const plans: ArrowPlans = new Map();
  geom.arrows.forEach((arrow, slot) => {
    if (values[slot * 4] === 1) plans.set(arrow.id, { exits: [values[slot * 4 + 1]!, values[slot * 4 + 2]!], stagger: values[slot * 4 + 3]! });
  });
  geom.plans = plans;
  return plans;
}

/**
 * Staggers of parallel Z routes whose middle legs would sit on top of each
 * other: groups overlapping legs, orders each group to minimize crossings,
 * and spreads it into lanes up to {@link MAX_ARROW_END_SPACING} apart.
 */
export function staggerParallelArrows(arrows: readonly PlannedArrow[], routeFor: (arrow: PlannedArrow, stagger: number) => ElbowArrowRoute | undefined): Map<ElementId, number> {
  const legs = new Float64Array(arrows.length * 8);
  arrows.forEach((arrow, index) => {
    const route = arrow.el.jog === undefined ? routeFor(arrow, 0) : undefined;
    const [start, corner, , end] = route?.z ? route.pts : [];
    legs[index * 8] = arrow.place;
    if (start && corner && end) legs.set([1, start[0], start[1], corner[0], corner[1], end[0], end[1]], index * 8 + 1);
  });
  const values = wbGeom().arrow_stagger_parallel(legs);
  const staggers = new Map<ElementId, number>();
  for (let at = 0; at < values.length; at += 2) staggers.set(arrows[values[at]!]!.el.id, values[at + 1]!);
  return staggers;
}

const draftBoardCache = new WeakMap<BoardIndex, Array<{ key: string; board: BoardIndex }>>();

/**
 * The board with a draft arrow in it (replacing the stored arrow with the
 * same id, or added as {@link DRAFT_ARROW}). The last four drafts per board
 * are cached, so dragging an end replans cheaply.
 */
export function boardWithDraftArrow(board: BoardIndex, draft: ArrowRouteFields & Partial<Omit<ArrowElement, 'type' | 'id'>>): BoardIndex {
  const recent = draftBoardCache.get(board) ?? [];
  draftBoardCache.set(board, recent);
  const key = JSON.stringify([draft.id, draft.from, draft.to, draft.fromSide, draft.toSide, draft.jog, draft.bends]);
  const hit = recent.find((entry) => entry.key === key);
  if (hit) {
    recent.unshift(...recent.splice(recent.indexOf(hit), 1));
    return hit.board;
  }
  const existing = draft.id !== undefined ? board.get(draft.id) : undefined;
  const { fromSide: _fromSide, toSide: _toSide, jog: _jog, bends: _bends, ...base }: ArrowElement = existing?.type === 'arrow' ? existing : { ...DRAFT_ARROW, id: draft.id ?? DRAFT_ARROW.id };
  const { id: _draftId, ...draftProps } = draft;
  const nextBoard = new Map(board).set(base.id, { ...base, ...draftProps } as ArrowElement);
  recent.unshift({ key, board: nextBoard });
  recent.length = Math.min(recent.length, 4);
  return nextBoard;
}

/** The spread plan of one arrow (a stored arrow or a draft), planned with the rest of the board. */
export function routePlanForArrow(arrow: ArrowRouteFields, board: BoardIndex, layoutBox: ElementLayoutBoxResolver): ArrowSpread {
  const stored = arrow.id !== undefined ? board.get(arrow.id) : undefined;
  const routeKey = (candidate: ArrowRouteFields): string => JSON.stringify([candidate.from, candidate.to, candidate.fromSide, candidate.toSide, candidate.jog, candidate.bends]);
  const unchanged = stored === arrow || (stored?.type === 'arrow' && routeKey(stored) === routeKey(arrow));
  return planBoardArrows(unchanged ? board : boardWithDraftArrow(board, arrow), layoutBox).get(arrow.id ?? DRAFT_ARROW.id) ?? NO_ARROW_SPREAD;
}

/* -------------------------------------------------------------------------- */
/* Trimming to outlines                                                        */
/* -------------------------------------------------------------------------- */

const shapeOutlineCache = new Map<string, LineSegment[]>();

/** The outline of a shape as line segments `[x1, y1, x2, y2]` in its own coordinates (cached). */
export function shapeOutlineSegments({ kind, w, h }: { kind: Extract<BoardElement, { type: 'shape' }>['kind']; w: number; h: number }): LineSegment[] {
  const key = [kind, w, h].join();
  const cached = shapeOutlineCache.get(key);
  if (cached) return cached;
  const values = wbGeom().arrow_shape_outline_segments(kindCode(kind), w, h);
  const segments: LineSegment[] = [];
  for (let at = 0; at < values.length; at += 4) segments.push([values[at]!, values[at + 1]!, values[at + 2]!, values[at + 3]!]);
  if (shapeOutlineCache.size >= 1024) shapeOutlineCache.delete(shapeOutlineCache.keys().next().value!);
  shapeOutlineCache.set(key, segments);
  return segments;
}

/**
 * Where the segment `start → end` first meets an element's outline, as a
 * fraction of its length (honoring rotation and the exact outline of
 * shapes); `undefined` when it misses or starts inside.
 */
export function outlineHitFraction(element: BoardElement, start: ArrowEndPoint, end: ArrowEndPoint, layoutBox: ElementLayoutBoxResolver): number | undefined {
  const values = wbGeom().arrow_outline_hit_fraction(encodeElement(element, layoutBox(element)), start.x, start.y, end.x, end.y);
  return values.length === 0 ? undefined : values[0];
}

/** How far inside the bounds of a rotated element its outline is, along the line `at` crossing `side`. */
export function rotatedOutlineInset(element: BoardElement, side: ArrowSide, at: number, layoutBox: ElementLayoutBoxResolver): number {
  return wbGeom().arrow_rotated_outline_inset(encodeElement(element, layoutBox(element)), sideCode(side), at);
}

/** Moves a route's end points in from the bounds to the outline of the shape (or rotated element) they touch. */
export function insetArrowEndsToOutline(
  points: readonly RoutePoint[],
  arrow: Pick<ArrowRouteFields, 'from' | 'to'>,
  board: BoardIndex,
  sides: readonly [ArrowSide, ArrowSide],
  exits: readonly [number, number],
  layoutBox: ElementLayoutBoxResolver,
): RoutePoint[] {
  const geom = boardGeom(board, layoutBox);
  const { record, bends } = encodeArrowOn(geom, arrow);
  return decodePoints(geom.handle.inset_ends(encodePoints(points), record, bends, sideCode(sides[0]), sideCode(sides[1]), exits[0], exits[1]));
}

/* -------------------------------------------------------------------------- */
/* Final geometry                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where an arrow is drawn: its elbow route (planned with the rest of the
 * board and trimmed to the outlines it joins), or, when no elbow route is
 * valid, a straight line between the facing sides, clipped to rotated
 * outlines and kept 6 clear of attached boxes. `undefined` when an end is
 * missing.
 *
 * A stored arrow (the board's own object) is served from the geometry of
 * all the board's arrows, computed in one call and cached with the board.
 */
export function arrowGeometry(arrow: ArrowRouteFields, board: BoardIndex, layoutBox: ElementLayoutBoxResolver): ArrowGeometry | undefined {
  let geom = boardGeom(board, layoutBox);
  if (arrow.id !== undefined && board.get(arrow.id) === arrow) {
    if (!storedArrowIsCurrent(geom, board, arrow as ArrowElement)) {
      geom = encodeBoard(board, layoutBox);
      boardGeomCache.set(board, geom);
    }
    if (!geom.geometry) {
      const values = geom.handle.geometries();
      const starts = new Uint32Array(geom.arrows.length);
      for (let slot = 0, at = 0; slot < starts.length; slot++) {
        starts[slot] = at;
        at += values[at] === 0 ? 1 : 6 + values[at + 5]! * 2;
      }
      geom.geometry = { values, starts };
    }
    return decodeGeometry(geom.geometry.values, geom.geometry.starts[geom.arrowSlots.get(arrow.id)!]!);
  }
  const plan = routePlanForArrow(arrow, board, layoutBox);
  const { record, bends } = encodeArrowOn(geom, arrow);
  return decodeGeometry(geom.handle.geometry(record, bends, plan.exits[0], plan.exits[1], plan.stagger), 0);
}
