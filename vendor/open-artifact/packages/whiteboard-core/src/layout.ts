/**
 * Board layout: finding free space for new elements, and growing sections
 * whose contents grew.
 *
 * Free space: the board's occupied rectangles (element boxes, section
 * titles, arrow and drawing segments) go into a multi-level grid index;
 * candidate spots around a target (beside nearby items, in rings around the
 * center, on a fine grid) are ranked by distance and tried in order of
 * preference: near the target, inside the requested area, clear of
 * sections.
 *
 * Section growth: a note measured taller than its box, or a shape or table
 * that grew, pushes the bottom of the smallest section holding it down
 * (never into the element below the section).
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { containmentAnchor } from './attachments.ts';
import {
  containerTitleBandHeight,
  containerTitleScaleForBand,
  containerTitleTextBounds,
  elementLayoutBox,
  measuredArrowGeometry,
  pointInBox,
  type Box,
  type ElementMeasure,
  type ElementMeasures,
  type ElementsById,
  type Point,
} from './geometry.ts';
import { MAX_ELEMENT_SIZE, arrowEndIds, type BoardContent, type BoardElement, type ContainerElement, type ElementId } from './schema.ts';
import { defaultShapeSize } from './shape-paths.ts';

/* -------------------------------------------------------------------------- */
/* Rectangles                                                                 */
/* -------------------------------------------------------------------------- */

/** Gap kept between placed items. */
export const ITEM_GAP = 24;

/** The gap between two rectangles (0 when they touch or overlap). */
export function placementRectGap(a: Box, b: Box): number {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
}

/** True when two rectangles overlap or come within `margin` of each other. */
export function placementRectsOverlap(a: Box, b: Box, margin: number): boolean {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

/** True when `inner` lies wholly inside `outer`. */
export function placementRectInside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** A rectangle's center. */
export function placementRectCenter(rect: Box): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* -------------------------------------------------------------------------- */
/* Occupancy                                                                  */
/* -------------------------------------------------------------------------- */

/** How far from the target (`near`) a spot may be by default. */
export const FREE_SPACE_DEFAULT_REACH = 600;
/** Most ring steps out from the center in each direction. */
export const FREE_SPACE_MAX_RING_STEPS = 40;
/** Steps of the fine grid across the search area. */
export const FREE_SPACE_FINE_STEPS = 96;
/** The band around `near` searched first. */
export const FREE_SPACE_NEAR_MARGIN = 384;
/** Fewest drawing points per occupied box. */
export const STROKE_BOX_MIN_POINTS = 8;
/** Most occupied boxes per drawing. */
export const STROKE_BOX_MAX_BOXES = 24;
/** Length of the pieces a straight arrow is boxed in. */
export const ARROW_BOX_SEGMENT_LENGTH = 64;
/** Most pieces per straight arrow. */
export const ARROW_BOX_MAX_SEGMENTS = 32;
/** Padding around an arrow piece. */
export const ARROW_BOX_PAD = 4;
/** Cell size of the finest index level. */
export const OCCUPANCY_CELL_SIZE = 128;
/** Most cells a rectangle may cover on one level (larger ones go a level up). */
export const OCCUPANCY_MAX_CELLS = 256;
/** Cell size ratio between index levels. */
export const OCCUPANCY_LEVEL_FACTOR = 16;

/** The occupied rectangles of a board. */
export interface OccupiedRects {
  /** Everything taken: boxes, section titles, arrow and drawing pieces. */
  taken: Box[];
  /** Element boxes only (spots are tried beside these). */
  items: Box[];
  /** For each taken rectangle, the index of the element it belongs to. */
  of: number[];
}

/**
 * The rectangles the elements take: element boxes, section titles (a
 * section's area itself stays free), arrows cut into padded pieces (with
 * room around free ends), drawings cut into point runs. Arrows with an end
 * attached to a missing element are skipped. The arrow and drawing pieces
 * are cut in one WebAssembly call (`occupied_pieces`).
 */
export function collectOccupiedRects(elements: readonly BoardElement[], measures?: ElementMeasures, byId?: ElementsById): OccupiedRects {
  const lookup = byId ?? new Map(elements.map((element) => [element.id, element]));
  const ids = new Set(elements.map((element) => element.id));
  // What each element takes: its own boxes, or (`cut`) its pieces from the batch followed by `boxes`.
  const plans: Array<{ cut: boolean; boxes: Box[]; item?: Box }> = [];
  const records: number[] = [];
  for (const element of elements) {
    if (element.type === 'arrow') {
      const line = arrowEndIds(element).every((id) => ids.has(id)) ? measuredArrowGeometry(element, lookup, measures) : undefined;
      if (line === undefined) {
        plans.push({ cut: false, boxes: [] });
        continue;
      }
      records.push(0, line.x1, line.y1, line.x2, line.y2, line.elbow ? line.elbow.length : -1);
      if (line.elbow) for (const [x, y] of line.elbow) records.push(x, y);
      const ends: Box[] = [];
      for (const end of [element.from, element.to])
        if (typeof end !== 'string') ends.push({ x: end[0] - ITEM_GAP, y: end[1] - ITEM_GAP, w: 2 * ITEM_GAP, h: 2 * ITEM_GAP });
      plans.push({ cut: true, boxes: ends });
      continue;
    }
    if (element.type === 'container') {
      const title = containerTitleTextBounds(element, measures);
      plans.push({ cut: false, boxes: title === undefined ? [] : [title] });
      continue;
    }
    if (element.type === 'stroke') {
      const points = element.points;
      records.push(1, element.x, element.y, element.width, points.length);
      for (let index = 0; index < points.length; index++) records.push(points[index]!);
      plans.push({ cut: true, boxes: [] });
      continue;
    }
    const box = elementLayoutBox(element, measures);
    plans.push(box === undefined ? { cut: false, boxes: [] } : { cut: false, boxes: [box], item: box });
  }
  const pieces = records.length > 0 ? wbGeom().occupied_pieces(Float64Array.from(records)) : new Float64Array();
  const taken: Box[] = [];
  const items: Box[] = [];
  const of: number[] = [];
  let at = 0;
  plans.forEach((plan, owner) => {
    if (plan.cut) {
      const count = pieces[at]!;
      for (let piece = 0; piece < count; piece++) {
        const base = at + 1 + piece * 4;
        taken.push({ x: pieces[base]!, y: pieces[base + 1]!, w: pieces[base + 2]!, h: pieces[base + 3]! });
        of.push(owner);
      }
      at += 1 + count * 4;
    }
    for (const box of plan.boxes) {
      taken.push(box);
      of.push(owner);
    }
    if (plan.item !== undefined) items.push(plan.item);
  });
  return { taken, items, of };
}

/** A spatial index of occupied rectangles. */
export interface OccupancyIndex {
  add(rect: Box): void;
  /** True when `rect` overlaps (or comes within `margin` of) an indexed rectangle. */
  hits(rect: Box, margin: number): boolean;
  /** Rectangle comparisons so far (for diagnostics). */
  checks(): number;
  /** Cell entries stored. */
  entries(): number;
  /** Cells looked at. */
  looked(): number;
}

type OccupancyGrid = InstanceType<ReturnType<typeof wbGeom>['OccupancyGrid']>;

/** The WebAssembly grid behind each index from {@link createOccupancyIndex}. */
const occupancyGrids = new WeakMap<OccupancyIndex, OccupancyGrid>();

function encodeRects(rects: Iterable<Box>): Float64Array {
  const values: number[] = [];
  for (const rect of rects) values.push(rect.x, rect.y, rect.w, rect.h);
  return Float64Array.from(values);
}

/**
 * A multi-level grid index: a rectangle goes in the finest level where it
 * covers at most {@link OCCUPANCY_MAX_CELLS} cells; non-finite ones are
 * checked against everything. The grid lives in WebAssembly and copies
 * the rectangles' numbers when they are added.
 */
export function createOccupancyIndex(rects: Iterable<Box>): OccupancyIndex {
  const grid = new (wbGeom().OccupancyGrid)(encodeRects(rects));
  const index: OccupancyIndex = {
    add: (rect) => grid.add(rect.x, rect.y, rect.w, rect.h),
    hits: (rect, margin) => grid.hits(rect.x, rect.y, rect.w, rect.h, margin),
    checks: () => grid.checks(),
    entries: () => grid.entries(),
    looked: () => grid.looked(),
  };
  occupancyGrids.set(index, grid);
  return index;
}

/** A board's occupied rectangles with their index. */
export interface BoardOccupancy extends OccupiedRects {
  index: OccupancyIndex;
}

/** {@link collectOccupiedRects} with an {@link OccupancyIndex} over them. */
export function buildBoardOccupancy(elements: readonly BoardElement[], measures?: ElementMeasures, byId?: ElementsById): BoardOccupancy {
  const occupancy = collectOccupiedRects(elements, measures, byId);
  return { ...occupancy, index: createOccupancyIndex(occupancy.taken) };
}

/* -------------------------------------------------------------------------- */
/* Free spots                                                                 */
/* -------------------------------------------------------------------------- */

/** A width and height. */
export interface PlacementSize {
  w: number;
  h: number;
}

/** What {@link findFreeSpots} looks for. */
export interface FreeSpaceRequest {
  content: BoardContent;
  measures?: ElementMeasures;
  /** One spot is found per size, in order; each found spot is taken for the next. */
  sizes: readonly PlacementSize[];
  /** The area to search (usually the visible board area). */
  area: Box;
  /** Place close to this rectangle (within `reach`). */
  near?: Box;
  /** How far from `near` a spot may be. */
  reach?: number;
  /** A preferred region (spots inside it win, and it may cross sections). */
  prefer?: Box;
  /** A prebuilt occupancy to use (and add to); its index must come from {@link createOccupancyIndex}. */
  ground?: BoardOccupancy;
  /** Do not take the found spots (each size is placed independently). */
  dry?: boolean;
}

/** A request as the 15 numbers of `crates/open-artifact-wb-geom/src/wasm/free_space.rs`. */
function encodeRequest(request: Pick<FreeSpaceRequest, 'area' | 'near' | 'reach' | 'prefer'>): Float64Array {
  const { area, near, prefer } = request;
  return Float64Array.of(
    area.x,
    area.y,
    area.w,
    area.h,
    near === undefined ? 0 : 1,
    near?.x ?? 0,
    near?.y ?? 0,
    near?.w ?? 0,
    near?.h ?? 0,
    request.reach ?? FREE_SPACE_DEFAULT_REACH,
    prefer === undefined ? 0 : 1,
    prefer?.x ?? 0,
    prefer?.y ?? 0,
    prefer?.w ?? 0,
    prefer?.h ?? 0,
  );
}

/** Candidate top-left corners for an item of `size`. */
export function freeSpaceCandidates(request: Pick<FreeSpaceRequest, 'area' | 'near' | 'reach' | 'prefer'>, size: PlacementSize, items: readonly Box[]): Array<Point & { fine?: true }> {
  const values = wbGeom().free_space_candidates(encodeRequest(request), size.w, size.h, encodeRects(items));
  const candidates: Array<Point & { fine?: true }> = [];
  for (let at = 0; at < values.length; at += 3) candidates.push(values[at + 2] === 1 ? { x: values[at]!, y: values[at + 1]!, fine: true } : { x: values[at]!, y: values[at + 1]! });
  return candidates;
}

/**
 * Top-left corners of free spots, one per requested size (`undefined` when
 * none is free). Spots are ranked by distance from the target (coarse spots
 * before fine-grid ones, then right, below, left, above), then tried: in
 * the preferred region, near the target clear of sections, inside the area
 * clear of sections, anywhere clear of sections, inside the area, anywhere.
 */
export function findFreeSpots(request: FreeSpaceRequest): Array<Point | undefined> {
  const occupancy = request.ground ?? buildBoardOccupancy(request.content.elements, request.measures);
  const grid = occupancyGrids.get(occupancy.index);
  if (grid === undefined) throw new TypeError('findFreeSpots: the occupancy index must come from createOccupancyIndex');
  const sections = encodeRects(request.content.elements.filter((element) => element.type === 'container'));
  const sizes = Float64Array.from(request.sizes.flatMap((size) => [size.w, size.h]));
  const values = wbGeom().find_free_spots(grid, encodeRects(occupancy.items), sections, sizes, encodeRequest(request), request.dry === true);
  const placed: Array<Point | undefined> = [];
  for (let at = 0; at < values.length; at += 6) {
    if (values[at] !== 1) {
      placed.push(undefined);
      continue;
    }
    const spot = { x: values[at + 1]!, y: values[at + 2]!, w: values[at + 3]!, h: values[at + 4]!, fine: values[at + 5] === 1 };
    if (request.dry !== true) {
      occupancy.taken.push(spot);
      occupancy.items.push(spot);
    }
    placed.push({ x: spot.x, y: spot.y });
  }
  return placed;
}

/* -------------------------------------------------------------------------- */
/* Section growth                                                             */
/* -------------------------------------------------------------------------- */

/** Space kept between a section's bottom and the content that pushed it. */
export const SECTION_GROW_GAP = 24;

/** True when `inner`'s corners both lie in `outer`. */
export function boxContainsBox(outer: Box, inner: Box): boolean {
  return pointInBox(outer, inner.x, inner.y) && pointInBox(outer, inner.x + inner.w, inner.y + inner.h);
}

/** True when an element sits in a box: a section wholly, anything else by its containment anchor. */
export function elementSitsInBox(box: Box, element: BoardElement, elementBox: Box): boolean {
  if (element.type === 'container') return boxContainsBox(box, element);
  const anchor = containmentAnchor(element, elementBox);
  return pointInBox(box, anchor.x, anchor.y);
}

/** The sections, smallest area first. */
export function sectionsSmallestFirst(elements: readonly BoardElement[]): ContainerElement[] {
  return elements.filter((element): element is ContainerElement => element.type === 'container').sort((a, b) => a.w * a.h - b.w * b.h);
}

/** True when `element` is a sticker on a note that sits in `section`. */
export function isStickerOnNote(
  elements: readonly BoardElement[],
  section: Box,
  element: BoardElement,
  elementBox: Box,
  measures?: ElementMeasures,
): boolean {
  return (
    element.type === 'sticker' &&
    elements.some((candidate) => {
      if (candidate.type !== 'note') return false;
      const noteBox = elementLayoutBox(candidate, measures)!;
      return elementSitsInBox(section, candidate, noteBox) && pointInBox(noteBox, elementBox.x + elementBox.w / 2, elementBox.y + elementBox.h / 2);
    })
  );
}

/**
 * True when something in the section (not one of `skipIds`) would fall out
 * of it at height `height`.
 */
export function sectionStillNeedsGrowth(
  elements: readonly BoardElement[],
  section: ContainerElement,
  height: number,
  measures: ElementMeasures | undefined,
  skipIds: ReadonlySet<ElementId>,
): boolean {
  return elements.some((element) => {
    if (element === section || skipIds.has(element.id)) return false;
    const box = elementLayoutBox(element, measures);
    return (
      box !== undefined &&
      elementSitsInBox(section, element, box) &&
      !elementSitsInBox({ ...section, h: height }, element, box) &&
      !isStickerOnNote(elements, section, element, box, measures)
    );
  });
}

/**
 * New heights for sections whose contents grew: a note measured taller than
 * its box, a growing child section, or a shape (taller than its kind's
 * default) or table reaching past the bottom pushes the section's bottom
 * down to its bottom plus {@link SECTION_GROW_GAP}, but never into an
 * element (or a section's title) just below the section. Elements in
 * `frozenIds` neither push nor block. Smallest sections first, so nested
 * growth carries outward.
 */
export function sectionGrowthForContents(
  elements: readonly BoardElement[],
  measures: ElementMeasures,
  frozenIds?: ReadonlySet<ElementId>,
): Map<ElementId, number> {
  const growth = new Map<ElementId, number>();
  const tallNotes = new Set(elements.filter((element) => element.type === 'note' && (measures.get(element.id)?.h ?? 0) >= element.h + 1));
  const grownShapes = new Set(
    elements.filter(
      (element) =>
        ((element.type === 'shape' && element.size !== undefined && element.h > defaultShapeSize(element.kind).h) || element.type === 'table') &&
        frozenIds?.has(element.id) !== true,
    ),
  );
  if (tallNotes.size === 0 && grownShapes.size === 0) return growth;
  const boxes = new Map(
    elements.flatMap((element): Array<[BoardElement, Box]> => {
      const box = elementLayoutBox(element, measures);
      return box ? [[element, box]] : [];
    }),
  );
  for (const section of sectionsSmallestFirst(elements)) {
    const bottom = section.y + section.h;
    const inside = [...boxes].filter(([element, box]) => element !== section && elementSitsInBox(section, element, box));
    const pushers = inside.flatMap(([element, box]) =>
      tallNotes.has(element) || growth.has(element.id) || (grownShapes.has(element) && box.y + box.h > bottom) ? [box] : [],
    );
    let newBottom = Math.max(bottom, ...pushers.map((box) => box.y + box.h + SECTION_GROW_GAP));
    for (const [element, box] of newBottom > bottom ? boxes : []) {
      if (
        element === section ||
        frozenIds?.has(element.id) === true ||
        elementSitsInBox(section, element, box) ||
        (element.type === 'container' && boxContainsBox(element, section))
      )
        continue;
      if (
        element.type === 'sticker' &&
        inside.some(([candidate, candidateBox]) => candidate.type === 'note' && pointInBox(candidateBox, box.x + box.w / 2, box.y + box.h / 2))
      )
        continue;
      if (box.x < section.x + section.w && box.x + box.w > section.x && box.y + box.h > bottom)
        newBottom = Math.min(newBottom, box.y - (element.type === 'container' ? containerTitleBandHeight : 0) - SECTION_GROW_GAP);
    }
    if (newBottom <= bottom) continue;
    growth.set(section.id, newBottom - section.y);
    boxes.set(section, { ...boxes.get(section)!, h: newBottom - section.y });
  }
  return growth;
}

/**
 * The largest title scale each nested section's title fits at: the band
 * between its top and the top of a section it sits in (sections in
 * `frozenIds` are ignored as outer sections).
 */
export function nestedSectionTitleRoom(elements: readonly BoardElement[], measures?: ElementMeasures, frozenIds?: ReadonlySet<ElementId>): Map<ElementId, number> {
  const room = new Map<ElementId, number>();
  const sections = elements.flatMap((element) => (element.type === 'container' ? [{ id: element.id, ...elementLayoutBox(element, measures)! }] : []));
  for (const inner of sections)
    for (const outer of sections)
      if (
        outer !== inner &&
        frozenIds?.has(outer.id) !== true &&
        outer.y < inner.y &&
        inner.y < outer.y + outer.h &&
        outer.x <= inner.x &&
        inner.x < outer.x + outer.w
      )
        room.set(inner.id, Math.min(room.get(inner.id) ?? Infinity, containerTitleScaleForBand(inner.y - outer.y)));
  return room;
}

const measuresWithoutSectionHeights = new WeakMap<ElementMeasures, ElementMeasures>();

/** The measures without sections' measured heights (cached per map). */
export function withoutSectionHeights(measures: ElementMeasures): ElementMeasures {
  const stripped =
    measuresWithoutSectionHeights.get(measures) ??
    new Map([...measures].map(([id, { sectionH: _sectionH, ...rest }]): [ElementId, ElementMeasure] => [id, rest]));
  measuresWithoutSectionHeights.set(measures, stripped);
  return stripped;
}

/**
 * Sections to grow after `moved` elements were dropped or resized: a
 * section grows (to the smaller of its measured and needed height) only
 * when a moved element, or a section grown here, now pokes out of its
 * bottom, and it is not itself moving or held by a section that would not
 * fit it. Returns old and new heights by section id.
 */
export function planSectionGrowth(
  elements: readonly BoardElement[],
  moved: readonly BoardElement[],
  measures?: ElementMeasures,
): Map<ElementId, { from: number; to: number }> {
  const growth = new Map<ElementId, { from: number; to: number }>();
  const grown: BoardElement[] = [];
  const needed =
    moved.length === 0 || measures === undefined
      ? new Map<ElementId, number>()
      : sectionGrowthForContents(elements, withoutSectionHeights(measures), new Set(moved.map((element) => element.id)));
  const targetHeight = (id: ElementId): number => Math.min(MAX_ELEMENT_SIZE, measures?.get(id)?.sectionH ?? 0, needed.get(id) ?? 0);
  for (const section of needed.size === 0 ? [] : sectionsSmallestFirst(elements)) {
    const height = targetHeight(section.id);
    if (height <= section.h || moved.some((element) => element.id === section.id)) continue;
    const pushesIn = (element: BoardElement): boolean => {
      const box = elementLayoutBox(element, measures);
      return (
        box !== undefined &&
        elementSitsInBox({ ...section, h: height }, element, box) &&
        !elementSitsInBox(section, element, box) &&
        !isStickerOnNote(elements, section, element, box, measures)
      );
    };
    if (
      elements.some(
        (other) =>
          other.type === 'container' &&
          other !== section &&
          boxContainsBox(other, section) &&
          !boxContainsBox({ ...other, h: Math.max(other.h, targetHeight(other.id)) }, { ...section, h: height }),
      ) ||
      ![...moved, ...grown].some(pushesIn)
    )
      continue;
    growth.set(section.id, { from: section.h, to: height });
    grown.push({ ...section, h: height });
  }
  return growth;
}
