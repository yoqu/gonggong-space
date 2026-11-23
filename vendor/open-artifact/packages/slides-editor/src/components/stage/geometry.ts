/**
 * Stage geometry: measuring rendered elements in slide coordinates,
 * snapping a moving box to guides, and connector endpoint math.
 *
 * Slide coordinates are canvas pixels (1920×1080) relative to the slide's
 * top-left, whatever the stage zoom is.
 */

import {
  isPinned,
  nodeAt,
  pathKey,
  round2,
  SLIDE_HEIGHT,
  SLIDE_MARGIN,
  SLIDE_WIDTH,
  type ConnectorNode,
  type Coord,
  type NodePath,
  type Rect,
  type Slide,
} from '@open-artifact/slides-core';

/** The element drawn for a path, inside a slide root. */
export function elementOf(root: HTMLElement, path: NodePath | string): HTMLElement | null {
  const key = typeof path === 'string' ? path : pathKey(path);
  return root.querySelector<HTMLElement>(`[data-open-artifact-path="${CSS.escape(key)}"]`);
}

/** An element's box in slide coordinates (its axis-aligned bounds when rotated). */
export function measure(root: HTMLElement, el: Element, scale: number): Rect {
  const base = root.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: round2((r.left - base.left) / scale), y: round2((r.top - base.top) / scale), w: round2(r.width / scale), h: round2(r.height / scale) };
}

/** The box of the element at `path`, or null when it is not drawn. */
export function measurePath(root: HTMLElement, path: NodePath, scale: number): Rect | null {
  const el = elementOf(root, path);
  return el ? measure(root, el, scale) : null;
}

/** A point in slide coordinates from client coordinates. */
export function toSlidePoint(root: HTMLElement, clientX: number, clientY: number, scale: number): { x: number; y: number } {
  const base = root.getBoundingClientRect();
  return { x: (clientX - base.left) / scale, y: (clientY - base.top) / scale };
}

/** The bounds of several rects. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** True when two rects overlap. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A rect from two corner points. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/* -------------------------------------------------------------------------- */
/* Snapping                                                                    */
/* -------------------------------------------------------------------------- */

/** Guide lines a moving box snaps to. */
export interface Guides {
  x: number[];
  y: number[];
}

/** The slide's own guides: edges, the 128px margins and the center lines. */
export function slideGuides(): Guides {
  return {
    x: [0, SLIDE_MARGIN, SLIDE_WIDTH / 2, SLIDE_WIDTH - SLIDE_MARGIN, SLIDE_WIDTH],
    y: [0, SLIDE_MARGIN, SLIDE_HEIGHT / 2, SLIDE_HEIGHT - SLIDE_MARGIN, SLIDE_HEIGHT],
  };
}

/** Guides from other elements: their edges and centers. */
export function elementGuides(rects: readonly Rect[]): Guides {
  const x: number[] = [];
  const y: number[] = [];
  for (const r of rects) {
    x.push(r.x, r.x + r.w / 2, r.x + r.w);
    y.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { x, y };
}

/** The result of snapping: the correction and the lines to draw. */
export interface Snap {
  dx: number;
  dy: number;
  /** Guide positions that matched (drawn as lines across the slide). */
  lines: { x: number[]; y: number[] };
}

/** Finds the closest guide to any of `values` within `threshold`. */
function closest(values: readonly number[], guides: readonly number[], threshold: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const g of guides) {
      const d = g - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: g };
    }
  }
  return best;
}

/**
 * Snaps a moving box: its left / center / right edges to the x guides and
 * top / middle / bottom to the y guides. `edges` limits which edges move
 * (a resize only snaps the edges being dragged).
 */
export function snapRect(rect: Rect, guides: Guides, threshold: number, edges: { x: ('start' | 'center' | 'end')[]; y: ('start' | 'center' | 'end')[] } = { x: ['start', 'center', 'end'], y: ['start', 'center', 'end'] }): Snap {
  const xs = edges.x.map((e) => (e === 'start' ? rect.x : e === 'center' ? rect.x + rect.w / 2 : rect.x + rect.w));
  const ys = edges.y.map((e) => (e === 'start' ? rect.y : e === 'center' ? rect.y + rect.h / 2 : rect.y + rect.h));
  const bx = closest(xs, guides.x, threshold);
  const by = closest(ys, guides.y, threshold);
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, lines: { x: bx ? [bx.at] : [], y: by ? [by.at] : [] } };
}

/* -------------------------------------------------------------------------- */
/* Connectors                                                                  */
/* -------------------------------------------------------------------------- */

/** A connector coordinate in px for a host size. */
export function coordPx(coord: Coord, size: number): number {
  return coord.unit === '%' ? (coord.value / 100) * size : coord.value;
}

/** A connector's two ends in px of its host. */
export function connectorEnds(node: ConnectorNode, hostW: number, hostH: number): [{ x: number; y: number }, { x: number; y: number }] | null {
  const p = node.points;
  if (!p) return null;
  return [
    { x: coordPx(p.x1, hostW), y: coordPx(p.y1, hostH) },
    { x: coordPx(p.x2, hostW), y: coordPx(p.y2, hostH) },
  ];
}

/** A connector with its ends moved (written in px). */
export function withConnectorEnds(node: ConnectorNode, a: { x: number; y: number }, b: { x: number; y: number }): ConnectorNode {
  const px = (value: number): Coord => ({ value: round2(value), unit: 'px' });
  return { ...node, points: { x1: px(a.x), y1: px(a.y), x2: px(b.x), y2: px(b.y) } };
}

/** The host box (slide or relative box) a pinned node at `path` is placed against. */
export function hostRect(root: HTMLElement, slide: Slide, path: NodePath, scale: number): Rect {
  if (path.length <= 1) return { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT };
  const host = measurePath(root, path.slice(0, -1), scale);
  return host ?? { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT };
}

/** True when the node at `path` is pinned (moves by rect) rather than in the flow. */
export function pinnedAt(slide: Slide, path: NodePath): boolean {
  const node = nodeAt(slide, path);
  return Boolean(node && isPinned(node));
}

/** An element's unrotated box in slide coordinates plus its rotation. */
export interface Box extends Rect {
  /** Degrees, clockwise. */
  rotation: number;
}

/**
 * Measures an element's own box: its layout size (unaffected by rotation and
 * by the stage zoom) centered on its drawn center, with its rotation.
 */
export function measureBox(root: HTMLElement, el: Element, scale: number, rotation: number): Box {
  const bounds = measure(root, el, scale);
  if (!rotation || !(el instanceof HTMLElement)) return { ...bounds, rotation: 0 };
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { x: round2(cx - w / 2), y: round2(cy - h / 2), w, h, rotation };
}

/** Rotates a vector by `degrees`. */
export function rotate(v: { x: number; y: number }, degrees: number): { x: number; y: number } {
  if (!degrees) return v;
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** A resize handle: which edges it moves (-1 start, 0 none, 1 end) on each axis. */
export interface Handle {
  id: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
  cursor: string;
}

/** The eight resize handles, clockwise from the top-left corner. */
export const HANDLES: readonly Handle[] = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' },
  { id: 'n', hx: 0, hy: -1, cursor: 'ns-resize' },
  { id: 'ne', hx: 1, hy: -1, cursor: 'nesw-resize' },
  { id: 'e', hx: 1, hy: 0, cursor: 'ew-resize' },
  { id: 'se', hx: 1, hy: 1, cursor: 'nwse-resize' },
  { id: 's', hx: 0, hy: 1, cursor: 'ns-resize' },
  { id: 'sw', hx: -1, hy: 1, cursor: 'nesw-resize' },
  { id: 'w', hx: -1, hy: 0, cursor: 'ew-resize' },
];

/** The smallest size a resize leaves. */
export const MIN_SIZE = 8;

/**
 * Resizes a (possibly rotated) box by dragging `handle` by a pointer delta
 * in slide coordinates. The opposite edge or corner stays put on the slide.
 * `keepRatio` scales both axes together (corners) or around the center line
 * (edges).
 */
export function resizeBox(start: Box, handle: Handle, delta: { x: number; y: number }, keepRatio: boolean): Box {
  const local = rotate(delta, -start.rotation);
  let w = handle.hx ? Math.max(MIN_SIZE, start.w + handle.hx * local.x) : start.w;
  let h = handle.hy ? Math.max(MIN_SIZE, start.h + handle.hy * local.y) : start.h;
  if (keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (handle.hx && handle.hy) {
      // Follow the axis the pointer moved most along.
      if (Math.abs(w / start.w - 1) > Math.abs(h / start.h - 1)) h = Math.max(MIN_SIZE, w / ratio);
      else w = Math.max(MIN_SIZE, h * ratio);
    } else if (handle.hx) h = Math.max(MIN_SIZE, w / ratio);
    else w = Math.max(MIN_SIZE, h * ratio);
  }
  // The fixed point (opposite handle) in local coordinates from the center.
  const before = { x: (-handle.hx * start.w) / 2, y: (-handle.hy * start.h) / 2 };
  const after = { x: (-handle.hx * w) / 2, y: (-handle.hy * h) / 2 };
  const shift = rotate({ x: before.x - after.x, y: before.y - after.y }, start.rotation);
  const cx = start.x + start.w / 2 + shift.x;
  const cy = start.y + start.h / 2 + shift.y;
  return { x: round2(cx - w / 2), y: round2(cy - h / 2), w: round2(w), h: round2(h), rotation: start.rotation };
}

/** The paths of `paths` after `removed` paths are taken out of the tree. */
export function shiftPaths(paths: readonly NodePath[], removed: readonly NodePath[]): NodePath[] {
  return paths.map((path) => {
    const next = [...path];
    for (let depth = 0; depth < path.length; depth++) {
      let shift = 0;
      for (const r of removed) {
        if (r.length !== depth + 1) continue;
        if (r.slice(0, depth).every((n, i) => n === path[i]) && r[depth]! < path[depth]!) shift++;
      }
      next[depth] = path[depth]! - shift;
    }
    return next;
  });
}
