/**
 * Board geometry: the camera (pan and zoom), element layout boxes and
 * bounds, rotation math, size estimates for text that has not been measured
 * yet, and the titles drawn above sections (containers).
 *
 * The numeric parts (bounds, the drawn arrow polyline, the camera,
 * rotation, section title scales, the grid layout) run in WebAssembly
 * (`crates/open-artifact-wb-geom/src/geometry.rs`); text size estimates and the
 * element dispatch stay here.
 *
 * Everything here is pure. Sizes the page measured in the DOM come in as an
 * {@link ElementMeasures} map; without one, text sizes are estimated. Arrow
 * routing and label placement live in the arrows modules, which take a
 * layout box resolver ({@link layoutBoxResolver}); the `measured…` wrappers
 * here pass the measured sizes through.
 */

import { wbGeom } from '@open-artifact/wasm-wb-geom';
import { arrowLabelBox, offLineArrowLabelBox, type ArrowLabelBox, type LabelMeasure } from './arrows/labels.ts';
import { arrowGeometry, type ArrowGeometry, type ElementLayoutBoxResolver } from './arrows/layout.ts';
import { edgeCode, encodePoints } from './geom-codec.ts';
import {
  LINK_CARD_SIZE,
  MAX_ELEMENT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_SIZE_STYLES,
  arrowEndIds,
  elementTurn,
  type ArrowElement,
  type ArrowHeadKind,
  type BoardElement,
  type ContainerElement,
  type ElementId,
  type NoteElement,
  type TextSize,
} from './schema.ts';
import { tableTotalHeight, tableWidth } from './table.ts';
import { MAX_LIST_INDENT_LEVEL } from './text/markup.ts';
import { textOrPlaceholder } from './text/placeholder.ts';

/* -------------------------------------------------------------------------- */
/* Basic types                                                                */
/* -------------------------------------------------------------------------- */

/** A point in board (or screen) units. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The camera: the board point at the top-left of the view, and the zoom. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** The size of the view in screen pixels. */
export interface ViewSize {
  w: number;
  h: number;
}

/** Screen space covered by chrome at the top and bottom of the view. */
export interface ViewInsets {
  top: number;
  bottom: number;
}

/**
 * What the page measured for one element: the rendered height of a note,
 * table or text, the width of text or of a section title, a section's
 * height grown to fit its content, how far a nested section title may grow,
 * and the word widths of an arrow label.
 */
export interface ElementMeasure {
  w?: number;
  h?: number;
  sectionH?: number;
  titleMost?: number;
  label?: LabelMeasure;
}

/** Measured sizes by element id. */
export type ElementMeasures = ReadonlyMap<ElementId, ElementMeasure>;

/** Elements by id. */
export type ElementsById = ReadonlyMap<ElementId, BoardElement>;

/* -------------------------------------------------------------------------- */
/* Arrows with measured sizes                                                 */
/* -------------------------------------------------------------------------- */

/** Text functions the geometry borrows from the markup module. */
export interface GeometryHooks {
  /**
   * Markup turned into plain text that keeps list markers (for size
   * estimates and spoken labels); `element` picks the markup the element's
   * type allows.
   */
  plainTextWithListPrefixes(text: string, element?: BoardElement): string;
}

/** Strips inline markup (`[text](url)`, `*`, `` ` ``, `\`) and keeps everything else. */
function stripInlineMarkup(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`\\]/g, '');
}

let hooks: GeometryHooks = { plainTextWithListPrefixes: stripInlineMarkup };

/**
 * Installs the markup function used to estimate text boxes (by default
 * inline markup is stripped and list markers kept as typed). Returns a
 * function that restores the previous hooks.
 */
export function installGeometryHooks(next: Partial<GeometryHooks>): () => void {
  const previous = hooks;
  hooks = { ...hooks, ...next };
  return () => {
    hooks = previous;
  };
}

/** The installed {@link GeometryHooks}. */
export function geometryHooks(): GeometryHooks {
  return hooks;
}

const resolverByMeasures = new WeakMap<ElementMeasures, ElementLayoutBoxResolver>();
const unmeasuredResolver: ElementLayoutBoxResolver = (element) => elementLayoutBox(element);

/** The layout box resolver the arrow modules take, for a measures map (cached per map). */
export function layoutBoxResolver(measures?: ElementMeasures): ElementLayoutBoxResolver {
  if (measures === undefined) return unmeasuredResolver;
  let resolver = resolverByMeasures.get(measures);
  if (resolver === undefined) resolverByMeasures.set(measures, (resolver = (element) => elementLayoutBox(element, measures)));
  return resolver;
}

/** Where an arrow is drawn, with elements at their measured sizes; `undefined` when an end is missing. */
export function measuredArrowGeometry(arrow: ArrowElement, byId: ElementsById, measures?: ElementMeasures): ArrowGeometry | undefined {
  return arrowGeometry(arrow, byId, layoutBoxResolver(measures));
}

/** The arrow label's box, using the label's measured words when the page has them. */
export function measuredArrowLabelBox(arrow: ArrowElement, line: ArrowGeometry, byId: ElementsById, measures?: ElementMeasures): ArrowLabelBox | undefined {
  return arrowLabelBox(arrow, line, byId, layoutBoxResolver(measures), measures?.get(arrow.id)?.label);
}

/** {@link measuredArrowLabelBox} when the label sits beside the line (it then adds to the arrow's bounds). */
export function measuredOffLineArrowLabelBox(arrow: ArrowElement, line: ArrowGeometry, byId: ElementsById, measures?: ElementMeasures): ArrowLabelBox | undefined {
  return offLineArrowLabelBox(arrow, line, byId, layoutBoxResolver(measures), measures?.get(arrow.id)?.label);
}

/** Which ends of an arrow carry a head. */
export function arrowHeadFlags(heads: readonly [ArrowHeadKind, ArrowHeadKind]): [boolean, boolean] {
  return [heads[0] !== 'none', heads[1] !== 'none'];
}

/** The extent of an arrow's line or route, as min and max corners. */
export function arrowLineBounds(line: ArrowGeometry): { x0: number; y0: number; x1: number; y1: number } {
  const coords = line.elbow ? encodePoints(line.elbow) : Float64Array.of(line.x1, line.y1, line.x2, line.y2);
  const [x0, y0, x1, y1] = wbGeom().arrow_line_bounds(coords) as unknown as [number, number, number, number];
  return { x0, y0, x1, y1 };
}

/**
 * The arrow's drawn path as a flat `[x0, y0, x1, y1, …]` polyline; rounded
 * route corners become three points each.
 */
export function arrowPolyline(line: ArrowGeometry, heads: readonly [ArrowHeadKind, ArrowHeadKind]): number[] {
  if (!line.elbow) return [line.x1, line.y1, line.x2, line.y2];
  // An empty route has no first or last point.
  if (line.elbow.length === 0) return [undefined, undefined] as unknown as number[];
  const [headFrom, headTo] = arrowHeadFlags(heads);
  return Array.from(wbGeom().arrow_polyline(encodePoints(line.elbow), headFrom, headTo));
}

/** The box around an arrow's drawn line, or `undefined` when an end is missing. */
export function arrowBoundsBox(arrow: ArrowElement, byId: ElementsById, measures?: ElementMeasures): Box | undefined {
  const line = measuredArrowGeometry(arrow, byId, measures);
  if (!line) return undefined;
  const { x0, y0, x1, y1 } = arrowLineBounds(line);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Font size of section titles (board units at zoom 1). */
export const containerTitleFontPx = TEXT_SIZE_STYLES.body.px;
/** Gap between a section title and the section's top edge. */
export const CONTAINER_TITLE_GAP = 6;
/** Height of the band above a section that holds its title, gap included. */
export const containerTitleBandHeight = Math.round(containerTitleFontPx * 1.375) + CONTAINER_TITLE_GAP;
/** Horizontal padding of a section title (both sides together). */
export const CONTAINER_TITLE_PADDING_X = 8;
/** Narrowest title text box. */
export const MIN_CONTAINER_TITLE_TEXT_WIDTH = 40;
/** Screen size of section titles at zoom 1 and below. */
export const CONTAINER_TITLE_SCREEN_PX = 13;
/** Screen size of section titles when zoomed far out. */
export const CONTAINER_TITLE_MIN_SCREEN_PX = 11;
/** Zoom at which titles reach their smallest screen size. */
export const CONTAINER_TITLE_SHRINK_END_ZOOM = 0.5;
/** Gap under a title when zoomed out (the title then keeps a fixed screen size). */
export const CONTAINER_TITLE_GAP_SCALED = 2;
/** Sections narrower than this on screen show no title. */
export const MIN_TITLED_CONTAINER_SCREEN_WIDTH = 48;
/** Width of the band along a section's edges that selects it. */
export const CONTAINER_EDGE_HIT_WIDTH = 14;
/** Timer card size. */
export const TIMER_WIDTH = 240;
export const TIMER_HEIGHT = 132;
/** Zoom limits. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
/** The author line at the bottom of a note: font size, line height, and its distance from the bottom. */
export const NOTE_AUTHOR_STYLE = { px: 9, line: 1.2, up: 14 } as const;
/** Bottom padding of a note that shows its author. */
export const noteAuthorBottomPadding = Math.ceil(NOTE_AUTHOR_STYLE.up + NOTE_AUTHOR_STYLE.px * NOTE_AUTHOR_STYLE.line + 5);

/** The center of a box. */
export function boxCenter(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** True when the point is inside the box (edges included). */
export function pointInBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/** A title on one line: trimmed lines joined with spaces, empty lines dropped. */
export function singleLineTitleText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                   */
/* -------------------------------------------------------------------------- */

function encodeBox(box: Box): Float64Array {
  return Float64Array.of(box.x, box.y, box.w, box.h);
}

function encodeBoxes(boxes: readonly Box[]): Float64Array {
  const out = new Float64Array(boxes.length * 4);
  boxes.forEach((box, index) => out.set([box.x, box.y, box.w, box.h], index * 4));
  return out;
}

function decodeBox(values: Float64Array): Box {
  return { x: values[0]!, y: values[1]!, w: values[2]!, h: values[3]! };
}

function encodeCamera(camera: Camera): Float64Array {
  return Float64Array.of(camera.x, camera.y, camera.zoom);
}

function decodeCamera(values: Float64Array): Camera {
  return { x: values[0]!, y: values[1]!, zoom: values[2]! };
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                     */
/* -------------------------------------------------------------------------- */

/** Clamps a zoom to {@link MIN_ZOOM}–{@link MAX_ZOOM}. */
export function clampZoom(zoom: number): number {
  return wbGeom().clamp_zoom(zoom);
}

/** Board point → screen point. */
export function boardToScreen(camera: Camera, x: number, y: number): Point {
  return { x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom };
}

/** Screen point → board point. */
export function screenToBoard(camera: Camera, screenX: number, screenY: number): Point {
  return { x: camera.x + screenX / camera.zoom, y: camera.y + screenY / camera.zoom };
}

/**
 * Pans the least distance that brings the box into view, `margin` pixels
 * inside the edges (and inside the insets). A box larger than the view is
 * aligned to its top-left. Returns the same camera when nothing moves.
 */
export function panCameraToReveal(camera: Camera, box: Box, viewport: ViewSize, insets: ViewInsets = { top: 0, bottom: 0 }, margin = 24): Camera {
  const moved = wbGeom().pan_camera_to_reveal(encodeCamera(camera), encodeBox(box), viewport.w, viewport.h, insets.top, insets.bottom, margin);
  return moved.length === 0 ? camera : { ...camera, x: moved[0]!, y: moved[1]! };
}

/** Pans so the box's center sits at the center of the view (between the insets). */
export function centerCameraOn(camera: Camera, box: Box, viewport: ViewSize, insets: ViewInsets): Camera {
  const [x, y] = wbGeom().center_camera_on(camera.zoom, encodeBox(box), viewport.w, viewport.h, insets.top, insets.bottom) as unknown as [number, number];
  return { ...camera, x, y };
}

/** True when the box fits in the view at the camera's zoom, with margins. */
export function fitsInViewport(camera: Camera, box: Box, viewport: ViewSize, insets: ViewInsets = { top: 0, bottom: 0 }, margin = 24): boolean {
  return wbGeom().fits_in_viewport(camera.zoom, encodeBox(box), viewport.w, viewport.h, insets.top, insets.bottom, margin);
}

/** True when no part of the box is in view. */
export function isOffscreen(camera: Camera, box: Box, viewport: ViewSize): boolean {
  return wbGeom().is_offscreen(encodeCamera(camera), encodeBox(box), viewport.w, viewport.h);
}

/** Pans by a screen distance (the board follows the pointer). */
export function panCameraBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom };
}

/** Zooms by a factor, keeping the board point under the screen point still. */
export function zoomCameraAt(camera: Camera, screenX: number, screenY: number, factor: number): Camera {
  const next = wbGeom().zoom_camera_at(encodeCamera(camera), screenX, screenY, factor);
  return next.length === 0 ? camera : decodeCamera(next);
}

/** The camera that shows the whole box centered, with padding, zoomed at most to `maxZoom`. */
export function cameraToFitBox(box: Box, viewWidth: number, viewHeight: number, padding = 48, maxZoom = 2): Camera {
  return decodeCamera(wbGeom().camera_to_fit_box(encodeBox(box), viewWidth, viewHeight, padding, maxZoom));
}

/* -------------------------------------------------------------------------- */
/* Size estimates                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Estimated size of a text element: 0.55 em per character, wrapped at
 * `wrapWidth` when given.
 */
export function estimateTextBlockSize(text: string, size: TextSize, wrapWidth?: number): { w: number; h: number } {
  const px = TEXT_SIZE_STYLES[size].px;
  const lines = text.length === 0 ? [''] : text.split('\n');
  const lineWidth = (line: string): number => line.length * px * 0.55;
  const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 1);
  const rowCount = wrapWidth === undefined ? lines.length : lines.reduce((count, line) => count + Math.max(1, Math.ceil(lineWidth(line) / wrapWidth)), 0);
  return { w: wrapWidth ?? Math.max(px, longestLine * px * 0.55), h: rowCount * px * TEXT_LINE_HEIGHT };
}

const WIDE_CHARS = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60]/g;
const ARROW_CHARS = /[\u2190\u2192]/g;
const LIST_LINE = /^([ \u00A0]*)(?:[-\u2022*]|\d{1,3}\.) (.*)$/;

/**
 * Estimated height of a note before the page measures it: words wrapped at
 * the note's inner width (CJK, capitals and arrows count wider), list items
 * indented past their markers, plus padding and the author line.
 */
export function estimateNoteHeight(note: Pick<NoteElement, 'w' | 'text' | 'size' | 'author'>): number {
  const { px, weight } = note.size !== undefined ? TEXT_SIZE_STYLES[note.size] : { px: 15, weight: 400 };
  const charsPerLine = Math.max(1, Math.floor((note.w - 32) / (((weight > 400 ? 8.25 : 7.3) * px) / 15)));
  const charWidth = (word: string): number =>
    word.length + 1.2 * (word.match(WIDE_CHARS)?.length ?? 0) + 0.4 * (word.match(/\p{Lu}/gu)?.length ?? 0) + 0.7 * (word.match(ARROW_CHARS)?.length ?? 0);
  let lineCount = 0;
  let continuesList = false;
  const stripMarkup = (text: string): string => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`\\]/g, '');
  const lines = stripMarkup(note.text) === '' ? [] : note.text.split(/\r\n?|\n/);
  const markerWidth = lines.reduce((widest, line) => Math.max(widest, (/^(\d{1,3})\. /.exec(line)?.[1]?.length ?? 1) + 2), 3);
  for (const line of lines) {
    const [, indent = '', itemText] = LIST_LINE.exec(line) ?? [];
    const listText: string | undefined = indent === '' || continuesList ? itemText : undefined;
    continuesList = listText !== undefined;
    const capacity =
      listText === undefined ? charsPerLine : Math.max(1, charsPerLine - markerWidth - 3 * Math.min(MAX_LIST_INDENT_LEVEL, Math.ceil(indent.length / 2)));
    let column = 0;
    lineCount += 1;
    for (const word of stripMarkup(listText ?? line).split(' ')) {
      if (column > 0 && column + 1 + charWidth(word) > capacity) [lineCount, column] = [lineCount + 1, 0];
      column += (column > 0 ? 1 : 0) + charWidth(word);
      for (; column > capacity; column -= capacity) lineCount += 1;
    }
  }
  return Math.min(MAX_ELEMENT_SIZE, 16 + lineCount * px * TEXT_LINE_HEIGHT + (note.author !== undefined ? noteAuthorBottomPadding : 12));
}

/* -------------------------------------------------------------------------- */
/* Layout boxes and bounds                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The element's unrotated box as drawn: notes grow to their text, sections
 * to their content, text and tables take their measured (or estimated)
 * size, strokes their points plus half the pen width. Arrows have none.
 */
export function elementLayoutBox(element: BoardElement, measures?: ElementMeasures): Box | undefined {
  switch (element.type) {
    case 'arrow':
      return undefined;
    case 'note':
      return { x: element.x, y: element.y, w: element.w, h: Math.max(element.h, measures?.get(element.id)?.h ?? estimateNoteHeight(element)) };
    case 'container':
      return { x: element.x, y: element.y, w: element.w, h: Math.max(element.h, measures?.get(element.id)?.sectionH ?? 0) };
    case 'shape':
    case 'image':
    case 'sticker':
    case 'html':
      return { x: element.x, y: element.y, w: element.w, h: element.h };
    case 'timer':
      return { x: element.x, y: element.y, w: TIMER_WIDTH, h: TIMER_HEIGHT };
    case 'link':
      return { x: element.x, y: element.y, ...LINK_CARD_SIZE };
    case 'table':
      return { x: element.x, y: element.y, w: tableWidth(element), h: measures?.get(element.id)?.h ?? tableTotalHeight(element) };
    case 'text': {
      const measured = measures?.get(element.id);
      const size =
        measured?.w !== undefined && measured.h !== undefined ? { w: measured.w, h: measured.h } : estimateTextBlockSize(textOrPlaceholder(element), element.size, element.wrap);
      return { x: element.x, y: element.y, w: element.wrap ?? size.w, h: size.h };
    }
    case 'stroke': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let index = 0; index + 1 < element.points.length; index += 2) {
        const px = element.points[index]!;
        const py = element.points[index + 1]!;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const halfWidth = element.width / 2;
      return { x: element.x + minX - halfWidth, y: element.y + minY - halfWidth, w: maxX - minX + element.width, h: maxY - minY + element.width };
    }
  }
}

/** The axis-aligned bounds of the element as drawn (rotation included). */
export function elementBounds(element: BoardElement, measures?: ElementMeasures): Box | undefined {
  const box = elementLayoutBox(element, measures);
  return box && rotatedBoundingBox(box, elementTurn(element));
}

/** The smallest box around all boxes; `undefined` for none. */
export function unionBounds(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  return decodeBox(wbGeom().union_bounds(encodeBoxes(boxes)));
}

/**
 * The bounds of several elements: boxes, free or routed arrows (an arrow
 * between two elements adds nothing unless it is routed around them), and
 * arrow labels placed off the line.
 */
export function elementsBounds(elements: readonly BoardElement[], measures?: ElementMeasures): Box | undefined {
  const byId: ElementsById = new Map(elements.map((element) => [element.id, element]));
  const boxes: Array<Box | undefined> = [];
  for (const element of elements) {
    if (element.type !== 'arrow') {
      boxes.push(elementBounds(element, measures));
      continue;
    }
    const line = measuredArrowGeometry(element, byId, measures);
    if (arrowEndIds(element).length < 2 || line?.elbow) boxes.push(arrowBoundsBox(element, byId, measures));
    if (line !== undefined) boxes.push(measuredOffLineArrowLabelBox(element, line, byId, measures));
  }
  return unionBounds(boxes.filter((box): box is Box => box !== undefined));
}

/* -------------------------------------------------------------------------- */
/* Rotation                                                                   */
/* -------------------------------------------------------------------------- */

/** Rotates a point around a center by `degrees` (clockwise on screen). */
export function rotatePointAround(point: Point, center: Point, degrees: number): Point {
  const [x, y] = wbGeom().rotate_point_around_xy(point.x, point.y, center.x, center.y, degrees) as unknown as [number, number];
  return { x, y };
}

/** The axis-aligned bounds of a box rotated around its center. */
export function rotatedBoundingBox(box: Box, degrees: number): Box {
  if (!degrees) return box;
  return decodeBox(wbGeom().rotated_bounding_box_of(encodeBox(box), degrees));
}

/** True when a box rotated around its center overlaps an axis-aligned box (separating axes). */
export function rotatedBoxesOverlap(box: Box, degrees: number, other: Box): boolean {
  return wbGeom().rotated_boxes_overlap_of(encodeBox(box), degrees, encodeBox(other));
}

/** Rotates a box (keeping its size) so its center turns around `center`. */
export function rotateBoxAround<T extends Box>(box: T, center: Point, degrees: number): T {
  if (degrees === 0) return box;
  const [x, y] = wbGeom().rotate_box_around_of(encodeBox(box), center.x, center.y, degrees) as unknown as [number, number];
  return { ...box, x, y };
}

/**
 * Resizes a rotated box to a new width and height, keeping the corner
 * opposite `anchor` (by default the top-left) still on screen.
 */
export function resizeRotatedBox(
  box: Box,
  degrees: number,
  width: number,
  height: number,
  anchor: { x?: 'left' | 'right'; y?: 'top' | 'bottom' } = { x: 'right', y: 'bottom' },
): Box {
  return decodeBox(
    wbGeom().resize_rotated_box(encodeBox(box), degrees, width, height, anchor.x === 'left', anchor.y === 'top', edgeCode(anchor.x ?? 'right'), edgeCode(anchor.y ?? 'bottom')),
  );
}

/* -------------------------------------------------------------------------- */
/* Section titles                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How much a section title is scaled at a zoom: titles keep a readable
 * screen size (13 px, shrinking to 11 px by zoom 0.5) when zoomed out, and
 * scale with the board when zoomed in. `maxScale` caps the growth of a
 * nested title (it must not cover its parent's content).
 */
export function containerTitleScaleForZoom(zoom: number, maxScale = Infinity): number {
  return wbGeom().container_title_scale_for_zoom(zoom, maxScale);
}

/** The title gap at zoom 1 above the fixed scaled gap. */
export const containerTitleScaledGap = (CONTAINER_TITLE_GAP - CONTAINER_TITLE_GAP_SCALED) * containerTitleScaleForZoom(1);
/** The part of the title band that scales when zoomed out. */
export const containerTitleScaledBand = containerTitleBandHeight - CONTAINER_TITLE_GAP + CONTAINER_TITLE_GAP_SCALED;

/** Height of the title band at a title scale and zoom. */
export function containerTitleBandHeightAt(scale: number, zoom?: number): number {
  return wbGeom().container_title_band_height_at(scale, zoom ?? NaN);
}

/** The title scale that fills a band of the given height. */
export function containerTitleScaleForBand(bandHeight: number): number {
  return wbGeom().container_title_scale_for_band(bandHeight);
}

/** True when the section is wide enough on screen to show its title. */
export function hasRoomForContainerTitle(element: Pick<ContainerElement, 'w'>, zoom: number): boolean {
  return element.w * zoom >= MIN_TITLED_CONTAINER_SCREEN_WIDTH;
}

/**
 * The title scale of a section: 1 without a zoom, `undefined` when the
 * section is too narrow on screen to show a title.
 */
export function containerTitleScale(element: ContainerElement, measures?: ElementMeasures, zoom?: number): number | undefined {
  if (zoom === undefined) return 1;
  return hasRoomForContainerTitle(element, zoom) ? containerTitleScaleForZoom(zoom, measures?.get(element.id)?.titleMost) : undefined;
}

/** The title chip above a section (padding included), or `undefined` without a title. */
export function containerTitleBounds(element: ContainerElement, measures?: ElementMeasures, zoom?: number): Box | undefined {
  const scale = containerTitleScale(element, measures, zoom);
  if (element.text.trim() === '' || scale === undefined) return undefined;
  const measuredWidth = measures?.get(element.id)?.w;
  return decodeBox(wbGeom().container_title_bounds(encodeBox(element), element.text.length, measuredWidth ?? NaN, scale, zoom ?? NaN, measuredWidth !== undefined));
}

/** The measured title text itself (for clicking into the title); needs a measured width. */
export function containerTitleTextBounds(element: ContainerElement, measures?: ElementMeasures, zoom?: number): Box | undefined {
  const scale = containerTitleScale(element, measures, zoom);
  const measuredWidth = element.text.trim() === '' ? undefined : measures?.get(element.id)?.w;
  if (measuredWidth === undefined || scale === undefined) return undefined;
  return decodeBox(wbGeom().container_title_text_bounds(encodeBox(element), measuredWidth, scale, zoom ?? NaN));
}

/** True when the point is on the section's title chip, with `slop` around it (not below). */
export function isPointOnContainerTitle(element: ContainerElement, x: number, y: number, slop: number, measures?: ElementMeasures, zoom?: number): boolean {
  const title = containerTitleBounds(element, measures, zoom);
  return title !== undefined && pointInBox({ x: title.x - slop, y: title.y - slop, w: title.w + 2 * slop, h: title.h + slop }, x, y);
}

/**
 * The element's bounds with a section's title above it. With `mode` true
 * (or `'editor'`) the whole title band counts, as wide as the section;
 * otherwise only the title chip. `'editor'` ignores the nested-title cap.
 */
export function elementBoundsWithTitle(element: BoardElement, measures?: ElementMeasures, mode: boolean | 'editor' = false, zoom?: number): Box | undefined {
  const bounds = elementBounds(element, measures);
  if (bounds === undefined || element.type !== 'container') return bounds;
  const bandHeight = containerTitleBandHeightAt(
    zoom === undefined ? 1 : containerTitleScaleForZoom(zoom, mode === 'editor' ? undefined : measures?.get(element.id)?.titleMost),
    zoom,
  );
  const title = mode ? { x: bounds.x, y: bounds.y - bandHeight, w: bounds.w, h: bandHeight } : containerTitleBounds(element, measures, zoom);
  return title !== undefined ? unionBounds([bounds, title]) : bounds;
}

/* -------------------------------------------------------------------------- */
/* Grid layout                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Arranges rectangles in a near-square grid (reading order: rows, then
 * columns), each centered in a cell as large as the largest item, starting
 * at the top-left of their current bounds. Returns new top-left positions.
 */
export function gridLayoutOfRects(items: ReadonlyArray<{ id: ElementId; rect: Box }>, gap = 24): Map<ElementId, Point> {
  const positions = new Map<ElementId, Point>();
  const values = wbGeom().grid_layout_of_rects(encodeBoxes(items.map((item) => item.rect)), gap);
  for (let at = 0; at < values.length; at += 3) positions.set(items[values[at]!]!.id, { x: values[at + 1]!, y: values[at + 2]! });
  return positions;
}
