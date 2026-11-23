/**
 * Pure geometry of drawn elements: connector polylines and arrowheads, and
 * the outlines of polygon shapes. Shared by the renderer and the PPTX export.
 */

import type { ConnectorNode, Coord, Corner, HeadKind, Route, ShapeKind } from '@open-artifact/slides-core';

/** A point in px. */
export type Point = readonly [number, number];

/** Stroke width of a connector without `border-width`. */
export const DEFAULT_STROKE = 2;
/** Arrowhead length, in stroke widths. */
const HEAD_LENGTH = 4;
/** Half width of a filled head, in stroke widths. */
const FILLED_HEAD_WIDTH = 2;
/** Half width of an open head, in stroke widths. */
const OPEN_HEAD_WIDTH = 1.7;
/** How far the shaft stops short of a filled tip, in stroke widths. */
const SHAFT_INSET = 2;

/** Room kept around a flow connector's line so its heads are not cut off. */
export function connectorInset(stroke = DEFAULT_STROKE): number {
  return Math.max(4, Math.ceil(2.2 * stroke) + 1);
}

/** A connector's stroke width in px. */
export function connectorStroke(node: ConnectorNode): number {
  const width = parseFloat(node.style['border-width'] ?? '');
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_STROKE;
}

/** Resolves a connector coordinate against the host's size. */
export function resolveCoord(coord: Coord, size: number): number {
  return coord.unit === '%' ? (coord.value / 100) * size : coord.value;
}

/** The two ends of a flow connector of the given box, starting at `from`. */
export function flowEndpoints(width: number, height: number, from: Corner = 'tl', stroke = DEFAULT_STROKE): [Point, Point] {
  const inset = connectorInset(stroke);
  const left = width < 2 * inset ? width / 2 : inset;
  const top = height < 2 * inset ? height / 2 : inset;
  const right = width < 2 * inset ? width / 2 : width - inset;
  const bottom = height < 2 * inset ? height / 2 : height - inset;
  const x = from === 'tl' || from === 'bl' ? left : right;
  const y = from === 'tl' || from === 'tr' ? top : bottom;
  return [
    [x, y],
    [x === left ? right : left, y === top ? bottom : top],
  ];
}

/** One arrowhead: its tip, the unit direction it points in, and its kind. */
export interface ArrowHead {
  tip: Point;
  dir: Point;
  kind: Exclude<HeadKind, 'none'>;
}

/** A routed connector. */
export interface ConnectorPath {
  points: Point[];
  heads: ArrowHead[];
}

/** Routes a line between two points and places its heads. */
export function routeConnector(start: Point, end: Point, route: Route, headStart: HeadKind, headEnd: HeadKind): ConnectorPath {
  const midX = (start[0] + end[0]) / 2;
  const midY = (start[1] + end[1]) / 2;
  const vertical = Math.abs(end[0] - start[0]) < 1;
  const horizontal = Math.abs(end[1] - start[1]) < 1;
  const a: Point = [vertical ? midX : start[0], horizontal ? midY : start[1]];
  const b: Point = [vertical ? midX : end[0], horizontal ? midY : end[1]];
  let points: Point[] = [a, b];
  if (!vertical && !horizontal) {
    if (route === 'elbow') {
      points =
        Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
          ? [a, [midX, a[1]], [midX, b[1]], b]
          : [a, [a[0], midY], [b[0], midY], b];
    } else if (route === 'hv') {
      points = [a, [b[0], a[1]], b];
    } else if (route === 'vh') {
      points = [a, [a[0], b[1]], b];
    }
  }
  const direction = (from: Point, to: Point): Point => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    return [dx / length, dy / length];
  };
  const heads: ArrowHead[] = [];
  const n = points.length;
  if (headEnd !== 'none') heads.push({ tip: points[n - 1]!, dir: direction(points[n - 2]!, points[n - 1]!), kind: headEnd });
  if (headStart !== 'none') heads.push({ tip: points[0]!, dir: direction(points[1]!, points[0]!), kind: headStart });
  return { points, heads };
}

/** The shaft's points, pulled back from filled tips so the line does not poke through. */
export function shaftPoints(path: ConnectorPath, stroke: number): Point[] {
  const points = path.points.map(([x, y]): Point => [x, y]);
  const n = points.length;
  const inset = SHAFT_INSET * stroke;
  for (const head of path.heads) {
    if (head.kind !== 'filled') continue;
    const last = path.points[n - 1]!;
    const index = head.tip[0] === last[0] && head.tip[1] === last[1] ? n - 1 : 0;
    const neighbour = points[index === 0 ? 1 : n - 2]!;
    const length = Math.hypot(head.tip[0] - neighbour[0], head.tip[1] - neighbour[1]);
    if (n === 2 && length <= inset) return length === 0 ? points : [];
    const cut = Math.min(inset, length);
    points[index] = [head.tip[0] - head.dir[0] * cut, head.tip[1] - head.dir[1] * cut];
  }
  return points;
}

/** The two back corners of an arrowhead. */
export function headWings(head: ArrowHead, stroke: number): [Point, Point] {
  const [tx, ty] = head.tip;
  const [dx, dy] = head.dir;
  const length = HEAD_LENGTH * stroke;
  const half = (head.kind === 'open' ? OPEN_HEAD_WIDTH : FILLED_HEAD_WIDTH) * stroke;
  const bx = tx - dx * length;
  const by = ty - dy * length;
  return [
    [bx - dy * half, by + dx * half],
    [bx + dy * half, by - dx * half],
  ];
}

/** SVG path data of a polyline. */
export function polylineData(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

/** The full geometry of a connector drawn in a box of the given size. */
export function connectorGeometry(node: ConnectorNode, width: number, height: number): ConnectorPath {
  const stroke = connectorStroke(node);
  let start: Point;
  let end: Point;
  if (node.points) {
    start = [resolveCoord(node.points.x1, width), resolveCoord(node.points.y1, height)];
    end = [resolveCoord(node.points.x2, width), resolveCoord(node.points.y2, height)];
  } else {
    [start, end] = flowEndpoints(width, height, node.from, stroke);
  }
  return routeConnector(start, end, node.route, node.headStart, node.headEnd);
}

/** Outlines of the polygon shapes in a 100×100 box. */
export const SHAPE_POLYGONS: Partial<Record<ShapeKind, string>> = {
  diamond: '50,0 100,50 50,100 0,50',
  'arrow-right': '0,30 60,30 60,10 100,50 60,90 60,70 0,70',
  'arrow-left': '100,30 40,30 40,10 0,50 40,90 40,70 100,70',
  'arrow-up': '30,100 30,40 10,40 50,0 90,40 70,40 70,100',
  'arrow-down': '30,0 30,60 10,60 50,100 90,60 70,60 70,0',
};

/** A polygon outline scaled to a box. */
export function scaledPolygon(shape: ShapeKind, width: number, height: number): string {
  const outline = SHAPE_POLYGONS[shape];
  if (!outline) return '';
  return outline
    .split(' ')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number) as [number, number];
      return `${((x / 100) * width).toFixed(2)},${((y / 100) * height).toFixed(2)}`;
    })
    .join(' ');
}

/** The stroke of a shape from its `border` value: width, line style and color. */
export interface ShapeStroke {
  width: number;
  line: 'solid' | 'dashed' | 'dotted' | 'double';
  color: string;
}

/** Reads a `border` value (`2px dashed #333`) as a stroke. */
export function parseStroke(border: string | undefined): ShapeStroke | undefined {
  if (!border || border === 'none') return undefined;
  const parts = border.split(/\s+(?![^(]*\))/);
  let width = 1;
  let line: ShapeStroke['line'] = 'solid';
  let color = '#000000';
  for (const part of parts) {
    if (/^[\d.]+px$/.test(part)) width = parseFloat(part);
    else if (part === 'solid' || part === 'dashed' || part === 'dotted' || part === 'double') line = part;
    else if (part === 'none') return undefined;
    else color = part;
  }
  return width > 0 ? { width, line, color } : undefined;
}

/** The SVG dash array of a line style. */
export function dashArray(line: ShapeStroke['line'] | string | undefined, width: number): string | undefined {
  if (line === 'dashed') return `${width * 3} ${width * 2}`;
  if (line === 'dotted') return `0 ${width * 2}`;
  return undefined;
}
