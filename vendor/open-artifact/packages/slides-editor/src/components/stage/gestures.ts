/**
 * Pointer gestures on the stage: moving, resizing and rotating elements,
 * dragging connector ends, marquee selection, drawing new elements, and
 * panning a picture inside its crop or dragging the crop frame's sides.
 *
 * Moves preview by shifting the drawn elements with the CSS `translate`
 * property (nothing reflows until the drop); the other gestures preview a
 * draft slide (see `useStageGesture`). Every gesture commits one undo step
 * on pointer-up and leaves nothing behind on Escape.
 */

import {
  comparePaths,
  duplicateNodes,
  isAncestorPath,
  isPinned,
  LIMITS,
  nodeAt,
  parsePathKey,
  patchNodeStyle,
  pathKey,
  pinnedRectOf,
  pxValue,
  rotationOf,
  samePath,
  setImageCrop,
  setNodeRect,
  setRotation,
  updateNodeAt,
  type ConnectorNode,
  type Crop,
  type ImageNode,
  type NodePath,
  type Rect,
  type Slide,
  type SlideNode,
  type StylePatch,
} from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { flushSync } from 'react-dom';
import { FLOW_ROOT_KEY } from '../../render/SlideView.tsx';
import { useDeck } from '../../state/deck.ts';
import { useView, type Tool } from '../../state/view.ts';
import { changeSlide, editableEntry, insertPinned, insertShape, insertTextBox, isLayoutOnly, newShape, pinAt, selectableElements, selectableFor } from '../../services/commands.ts';
import {
  connectorEnds,
  elementGuides,
  elementOf,
  hostRect,
  intersects,
  measure,
  measureBox,
  rectFromPoints,
  resizeBox,
  shiftPaths,
  slideGuides,
  snapRect,
  toSlidePoint,
  unionRect,
  withConnectorEnds,
  type Box,
  type Guides,
  type Handle,
  MIN_SIZE,
} from './geometry.ts';
import { resizeCropFrame, type CropEdge } from './crop.ts';
import { useStageGesture } from './store.ts';

/** What a gesture needs to know about the stage. */
export interface StageContext {
  /** The rendered slide (`[data-open-artifact-slide]`). */
  root: HTMLElement;
  /** Screen pixels per slide pixel. */
  scale: number;
  slideId: string;
}

/** Screen pixels the pointer travels before a press becomes a drag. */
const DRAG_THRESHOLD = 3;
/** Screen pixels within which an edge snaps to a guide. */
const SNAP_DISTANCE = 6;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The slide as stored (not the draft). */
function storedSlide(ctx: StageContext): Slide | null {
  return useDeck.getState().slides[ctx.slideId]?.slide ?? null;
}

/** True when the slide on stage may be changed by this viewer. */
export function stageEditable(ctx: StageContext): boolean {
  return editableEntry(ctx.slideId) !== null;
}

/** The node path under an event target, or null for the background / flow layer. */
export function hitPath(target: EventTarget | null, root: HTMLElement): NodePath | null {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  const el = target.closest('[data-open-artifact-path]');
  if (!el || !root.contains(el)) return null;
  const key = el.getAttribute('data-open-artifact-path') ?? '';
  if (key === FLOW_ROOT_KEY || key === '') return null;
  return parsePathKey(key);
}

/**
 * The element a press at a client point selects. Boxes that only lay out
 * their children (an unfilled layer, say) let the press through to what
 * lies under them.
 */
export function pickAt(ctx: StageContext, slide: Slide, clientX: number, clientY: number, selection: readonly NodePath[]): NodePath | null {
  const seen = new Set<string>();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const hit = hitPath(el, ctx.root);
    if (!hit) continue;
    const key = pathKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = selectableFor(slide, hit, selection);
    if (path) return path;
  }
  return null;
}

/** The deepest element at a client point (double-click enters groups to it). */
export function deepestAt(ctx: StageContext, slide: Slide, clientX: number, clientY: number): NodePath | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const hit = hitPath(el, ctx.root);
    if (!hit) continue;
    for (let depth = hit.length; depth >= 1; depth--) {
      const prefix = hit.slice(0, depth);
      const node = nodeAt(slide, prefix);
      if (node && !isLayoutOnly(node)) return prefix;
    }
  }
  return null;
}

interface Tracker {
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  /** Escape or a cancelled pointer. */
  cancel(): void;
}

/** Follows the pointer until it is released or the gesture is cancelled. */
function track(handlers: Tracker): void {
  const move = (e: PointerEvent): void => handlers.move(e);
  const up = (e: PointerEvent): void => {
    stop();
    handlers.up(e);
  };
  const cancel = (): void => {
    stop();
    handlers.cancel();
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  function stop(): void {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

/** Guides for a gesture: the slide's plus every other element's edges and centers. */
function guidesExcept(ctx: StageContext, slide: Slide, moving: readonly NodePath[]): Guides {
  const rects: Rect[] = [];
  for (const path of selectableElements(slide)) {
    if (moving.some((m) => samePath(m, path) || isAncestorPath(m, path) || isAncestorPath(path, m))) continue;
    const el = elementOf(ctx.root, path);
    if (el) rects.push(measure(ctx.root, el, ctx.scale));
  }
  const base = slideGuides();
  const others = elementGuides(rects);
  return { x: [...base.x, ...others.x], y: [...base.y, ...others.y] };
}

/** Selected paths without descendants of other selected paths, in document order. */
function topmost(paths: readonly NodePath[]): NodePath[] {
  return paths.filter((p) => !paths.some((q) => isAncestorPath(q, p))).sort(comparePaths);
}

/** A node's own box on the slide (unrotated, with its rotation). */
function boxOf(ctx: StageContext, slide: Slide, path: NodePath): Box | null {
  const el = elementOf(ctx.root, path);
  const node = nodeAt(slide, path);
  return el && node ? measureBox(ctx.root, el, ctx.scale, rotationOf(node)) : null;
}

/** Commits a draft slide made by a gesture. */
function commitDraft(ctx: StageContext, label: string): void {
  const draft = useStageGesture.getState().draft;
  useStageGesture.getState().reset();
  if (draft && draft.slideId === ctx.slideId) changeSlide(ctx.slideId, label, () => draft.slide);
}

/* -------------------------------------------------------------------------- */
/* Move                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Drags the selected elements. Pinned elements get new offsets; flow
 * elements are pinned where they were dropped. Shift keeps the move on one
 * axis, ⌘/Ctrl turns snapping off, Alt drops copies instead.
 */
export function startMove(ctx: StageContext, event: PointerEvent | React.PointerEvent, selection: readonly NodePath[]): void {
  const slide = storedSlide(ctx);
  if (!slide || !stageEditable(ctx)) return;
  const paths = topmost(selection.filter((p) => nodeAt(slide, p)));
  if (paths.length === 0) return;
  const elements = paths.map((p) => elementOf(ctx.root, p));
  if (elements.some((el) => !el)) return;
  const boxes = paths.map((p) => boxOf(ctx, slide, p)!);
  const bounds = unionRect(elements.map((el) => measure(ctx.root, el!, ctx.scale)))!;
  const saved = elements.map((el) => el!.style.translate);
  const startX = event.clientX;
  const startY = event.clientY;
  let guides: Guides | null = null;
  let moving = false;
  let dx = 0;
  let dy = 0;

  const restore = (): void => {
    elements.forEach((el, i) => {
      el!.style.translate = saved[i]!;
    });
    useStageGesture.getState().reset();
  };

  track({
    move(e) {
      if (!moving) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        moving = true;
        guides = guidesExcept(ctx, slide, paths);
        if (useView.getState().textEdit) useView.getState().endTextEdit();
      }
      dx = (e.clientX - startX) / ctx.scale;
      dy = (e.clientY - startY) / ctx.scale;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let lines: Guides | null = null;
      if (!(e.metaKey || e.ctrlKey) && guides) {
        const snap = snapRect({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, guides, SNAP_DISTANCE / ctx.scale);
        if (!e.shiftKey || dy === 0) dx += snap.dx;
        if (!e.shiftKey || dx === 0) dy += snap.dy;
        lines = snap.lines;
      }
      for (const el of elements) el!.style.translate = `${dx}px ${dy}px`;
      useStageGesture.getState().set({ move: { keys: paths.map(pathKey), dx, dy }, guides: lines });
    },
    up(e) {
      restore();
      if (!moving || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return;
      commitMove(ctx, paths, boxes, dx, dy, e.altKey);
    },
    cancel: restore,
  });
}

/** Writes a finished move (or Alt-drag copy). */
function commitMove(ctx: StageContext, paths: NodePath[], boxes: Box[], dx: number, dy: number, copy: boolean): void {
  let selected: NodePath[] = [];
  const ok = changeSlide(ctx.slideId, copy ? 'Duplicate' : 'Move', (slide) => {
    let next = slide;
    let targets = paths;
    if (copy) {
      const result = duplicateNodes(next, paths, 0);
      if (result.paths.length !== paths.length) return null;
      next = result.slide;
      targets = result.paths;
    }
    const flow: { path: NodePath; rect: Rect }[] = [];
    const pinned: NodePath[] = [];
    targets.forEach((path, i) => {
      const node = nodeAt(next, path);
      const box = boxes[i]!;
      if (!node) return;
      if (node.kind === 'connector' && node.points) {
        const host = hostRect(ctx.root, next, path, ctx.scale);
        const ends = connectorEnds(node, host.w, host.h);
        if (!ends) return;
        next = updateNodeAt(next, path, (n) => withConnectorEnds(n as ConnectorNode, { x: ends[0].x + dx, y: ends[0].y + dy }, { x: ends[1].x + dx, y: ends[1].y + dy }));
        pinned.push(path);
      } else if (isPinned(node)) {
        const host = hostRect(ctx.root, next, path, ctx.scale);
        const r = pinnedRectOf(node) ?? { x: box.x - host.x, y: box.y - host.y, w: box.w, h: box.h };
        next = setNodeRect(next, path, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
        pinned.push(path);
      } else {
        flow.push({ path, rect: { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h } });
      }
    });
    if (flow.length) {
      const count = next.children.filter(isPinned).length;
      if (count + flow.length > LIMITS.pinnedPerHost) {
        toast.add({ title: `A slide holds at most ${LIMITS.pinnedPerHost} pinned elements`, description: 'Group some of them first.' });
        return null;
      }
      const result = pinAt(
        next,
        flow.map((f) => f.path),
        flow.map((f) => f.rect),
      );
      selected = [...shiftPaths(pinned, flow.map((f) => f.path)), ...result.paths];
      return result.slide;
    }
    selected = pinned;
    return next;
  });
  if (ok) useView.getState().select(selected);
}

/* -------------------------------------------------------------------------- */
/* Resize                                                                      */
/* -------------------------------------------------------------------------- */

/** True when a flow child takes up spare room (`flex-grow` above 0). */
function grows(node: SlideNode): boolean {
  const flex = node.style.flex?.trim();
  if (flex === 'auto' || (flex && Number(flex.split(/\s+/)[0]) > 0)) return true;
  return Number(node.style['flex-grow'] ?? 0) > 0;
}

/**
 * How a flow element breaks out of its container when a resize would move
 * it: the element and the siblings its leaving would move are pinned where
 * they are, and the container keeps its size, so nothing else on the slide
 * moves.
 */
interface FlowBreakout {
  /** The container's path (empty for the slide itself). */
  container: NodePath;
  /** The container's size, kept once its children leave (null for the slide). */
  size: { w: number; h: number } | null;
  /** The siblings the element's leaving would move, where they are now. */
  pushed: { path: NodePath; rect: Rect }[];
}

/** Plans the breakout of a flow element, or null when it cannot break out. */
function planFlowBreakout(ctx: StageContext, slide: Slide, path: NodePath, node: SlideNode): FlowBreakout | null {
  if (rotationOf(node) || node.kind === 'connector') return null;
  const container = path.slice(0, -1);
  const parent = container.length ? nodeAt(slide, container) : null;
  if (container.length && parent?.kind !== 'box') return null;
  const style = parent ? parent.style : slide.style;
  const children = parent?.kind === 'box' ? parent.children : slide.children;
  const index = path[path.length - 1]!;
  // Which siblings move when the element leaves: every one in a grid or a
  // spread-out row; otherwise the ones after it, the ones after a growing
  // sibling before it, and growing ones (they take up the freed room).
  const spread = style.display === 'grid' || (style['justify-content'] !== undefined && style['justify-content'] !== 'start');
  const firstGrowing = children.findIndex((child, i) => i < index && !isPinned(child) && grows(child));
  const pushed: FlowBreakout['pushed'] = [];
  for (const [i, child] of children.entries()) {
    if (i === index || isPinned(child)) continue;
    if (!(spread || i > index || (firstGrowing >= 0 && i > firstGrowing) || grows(child))) continue;
    // Rotated or line-like siblings cannot be pinned faithfully.
    if (child.kind === 'connector' || rotationOf(child)) return null;
    const childPath = [...container, i];
    const el = elementOf(ctx.root, childPath);
    if (!el) return null;
    pushed.push({ path: childPath, rect: measure(ctx.root, el, ctx.scale) });
  }
  let size: FlowBreakout['size'] = null;
  if (container.length) {
    const el = elementOf(ctx.root, container);
    if (!el) return null;
    const r = measure(ctx.root, el, ctx.scale);
    size = { w: r.w, h: r.h };
  }
  return { container, size, pushed };
}

/** Pins a flow element at `rect` with the siblings it would push; null when the slide has no room. */
function applyFlowBreakout(slide: Slide, path: NodePath, rect: Rect, plan: FlowBreakout): { slide: Slide; path: NodePath } | null {
  if (slide.children.filter(isPinned).length + plan.pushed.length + 1 > LIMITS.pinnedPerHost) return null;
  let base = slide;
  if (plan.size) base = patchNodeStyle(base, plan.container, { width: pxValue(plan.size.w), height: pxValue(plan.size.h) });
  // The resized element goes on top of the siblings pinned with it.
  const result = pinAt(base, [...plan.pushed.map((p) => p.path), path], [...plan.pushed.map((p) => p.rect), rect]);
  return { slide: result.slide, path: result.paths[result.paths.length - 1]! };
}

/** True when a measured box still has the edges a resize leaves alone where they started. */
function anchoredEdgesKept(start: Rect, now: Rect, handle: Handle, tolerance = 1): boolean {
  const kept = (s: number, sw: number, n: number, nw: number, h: number): boolean => h === 0 || Math.abs(h < 0 ? n + nw - (s + sw) : n - s) <= tolerance;
  return kept(start.x, start.w, now.x, now.w, handle.hx) && kept(start.y, start.h, now.y, now.h, handle.hy);
}

/**
 * Drags a resize handle of one element. Pinned elements get a new rect;
 * flow elements get a fixed width and / or height (and stop growing).
 * When the flow would move a flow element instead (dragging the side it
 * places, or a centered element), the element breaks out: it is pinned
 * with the siblings it would push, its container keeps its size, and the
 * drag goes on as a pinned resize. Shift keeps the proportions (pictures
 * and icons keep them by default at the corners, Shift frees them).
 */
export function startResize(ctx: StageContext, event: PointerEvent | React.PointerEvent, path: NodePath, handle: Handle): void {
  const slide = storedSlide(ctx);
  const node = slide && nodeAt(slide, path);
  if (!slide || !node || !stageEditable(ctx)) return;
  const start = boxOf(ctx, slide, path);
  if (!start) return;
  let host = hostRect(ctx.root, slide, path, ctx.scale);
  let pinned = isPinned(node);
  let base = slide;
  let target = path;
  let breakout = pinned ? null : planFlowBreakout(ctx, slide, path, node);
  const proportional = (node.kind === 'image' || node.kind === 'icon') && handle.hx !== 0 && handle.hy !== 0;
  const startX = event.clientX;
  const startY = event.clientY;
  let guides: Guides | null = null;
  let changed = false;

  track({
    move(e) {
      changed = true;
      guides ??= guidesExcept(ctx, slide, [path]);
      const keep = proportional !== e.shiftKey;
      const delta = { x: (e.clientX - startX) / ctx.scale, y: (e.clientY - startY) / ctx.scale };
      const box = resizeBox(start, handle, delta, keep);
      let lines: Guides | null = null;
      if (!keep && !start.rotation && !(e.metaKey || e.ctrlKey)) {
        const edges = {
          x: handle.hx < 0 ? (['start'] as const) : handle.hx > 0 ? (['end'] as const) : ([] as const),
          y: handle.hy < 0 ? (['start'] as const) : handle.hy > 0 ? (['end'] as const) : ([] as const),
        };
        const snap = snapRect(box, guides, SNAP_DISTANCE / ctx.scale, { x: [...edges.x], y: [...edges.y] });
        if (handle.hx < 0) {
          box.x += snap.dx;
          box.w -= snap.dx;
        } else if (handle.hx > 0) box.w += snap.dx;
        if (handle.hy < 0) {
          box.y += snap.dy;
          box.h -= snap.dy;
        } else if (handle.hy > 0) box.h += snap.dy;
        lines = snap.lines;
      }
      const rect = { x: box.x - host.x, y: box.y - host.y, w: box.w, h: box.h };
      if (pinned) {
        useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: setNodeRect(base, target, rect) }, guides: lines });
        return;
      }
      const patch: StylePatch = { flex: undefined, 'flex-grow': undefined, 'flex-basis': undefined };
      if (handle.hx || keep) patch.width = pxValue(box.w);
      if (handle.hy || keep) patch.height = pxValue(box.h);
      const draft = patchNodeStyle(base, target, patch);
      if (!breakout) {
        useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: draft }, guides: lines });
        return;
      }
      // Lay the draft out now to see whether the flow keeps the element's other sides in place.
      flushSync(() => useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: draft }, guides: lines }));
      const el = elementOf(ctx.root, target);
      if (!el || anchoredEdgesKept(start, measure(ctx.root, el, ctx.scale), handle)) return;
      const out = applyFlowBreakout(base, target, { x: box.x, y: box.y, w: box.w, h: box.h }, breakout);
      breakout = null;
      if (!out) {
        toast.add({ title: `A slide holds at most ${LIMITS.pinnedPerHost} pinned elements`, description: 'Group some of them first.' });
        return;
      }
      // From here on this is a pinned resize, relative to the slide.
      base = out.slide;
      target = out.path;
      pinned = true;
      host = { x: 0, y: 0, w: host.w, h: host.h };
      useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: setNodeRect(base, target, { x: box.x, y: box.y, w: box.w, h: box.h }) }, guides: lines });
      // The selection follows the element to its new place.
      useView.getState().select([target]);
    },
    up() {
      if (!changed) {
        useStageGesture.getState().reset();
        return;
      }
      commitDraft(ctx, 'Resize');
    },
    cancel() {
      useStageGesture.getState().reset();
      if (!samePath(target, path)) useView.getState().select([path]);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Rotate                                                                      */
/* -------------------------------------------------------------------------- */

/** Drags the rotation handle: Shift snaps to 15°, and it settles on right angles nearby. */
export function startRotate(ctx: StageContext, event: PointerEvent | React.PointerEvent, path: NodePath): void {
  const slide = storedSlide(ctx);
  if (!slide || !nodeAt(slide, path) || !stageEditable(ctx)) return;
  const box = boxOf(ctx, slide, path);
  if (!box) return;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let changed = false;
  void event;

  track({
    move(e) {
      changed = true;
      const p = toSlidePoint(ctx.root, e.clientX, e.clientY, ctx.scale);
      let angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      else {
        const right = Math.round(angle / 90) * 90;
        if (Math.abs(angle - right) < 3) angle = right;
      }
      useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: setRotation(slide, path, angle) } });
    },
    up() {
      if (changed) commitDraft(ctx, 'Rotate');
      else useStageGesture.getState().reset();
    },
    cancel() {
      useStageGesture.getState().reset();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Connector ends                                                              */
/* -------------------------------------------------------------------------- */

/** Drags one end of a pinned connector; Shift keeps the line at 45° steps. */
export function startConnectorEnd(ctx: StageContext, event: PointerEvent | React.PointerEvent, path: NodePath, end: 0 | 1): void {
  const slide = storedSlide(ctx);
  const node = slide && nodeAt(slide, path);
  if (!slide || node?.kind !== 'connector' || !node.points || !stageEditable(ctx)) return;
  const host = hostRect(ctx.root, slide, path, ctx.scale);
  const ends = connectorEnds(node, host.w, host.h);
  if (!ends) return;
  const guides = guidesExcept(ctx, slide, [path]);
  let changed = false;
  void event;

  track({
    move(e) {
      changed = true;
      const p = toSlidePoint(ctx.root, e.clientX, e.clientY, ctx.scale);
      let point = { x: p.x - host.x, y: p.y - host.y };
      const other = ends[end === 0 ? 1 : 0];
      let lines: Guides | null = null;
      if (e.shiftKey) {
        const len = Math.hypot(point.x - other.x, point.y - other.y);
        const angle = Math.round(Math.atan2(point.y - other.y, point.x - other.x) / (Math.PI / 4)) * (Math.PI / 4);
        point = { x: other.x + len * Math.cos(angle), y: other.y + len * Math.sin(angle) };
      } else if (!(e.metaKey || e.ctrlKey)) {
        const snap = snapRect({ x: point.x + host.x, y: point.y + host.y, w: 0, h: 0 }, guides, SNAP_DISTANCE / ctx.scale, { x: ['start'], y: ['start'] });
        point = { x: point.x + snap.dx, y: point.y + snap.dy };
        lines = snap.lines;
      }
      const [a, b] = end === 0 ? [point, other] : [other, point];
      const draft = updateNodeAt(slide, path, (n) => withConnectorEnds(n as ConnectorNode, a, b));
      useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: draft }, guides: lines });
    },
    up() {
      if (changed) commitDraft(ctx, 'Move connector end');
      else useStageGesture.getState().reset();
    },
    cancel() {
      useStageGesture.getState().reset();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Marquee                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Drags a selection rectangle from the background. Shift adds to the
 * selection. A click without a drag clears the selection.
 */
export function startMarquee(ctx: StageContext, event: PointerEvent | React.PointerEvent, additive: boolean): void {
  const slide = storedSlide(ctx);
  if (!slide) return;
  const from = toSlidePoint(ctx.root, event.clientX, event.clientY, ctx.scale);
  const base = additive ? useView.getState().selection : [];
  const startX = event.clientX;
  const startY = event.clientY;
  let candidates: { path: NodePath; rect: Rect }[] | null = null;
  let dragging = false;

  track({
    move(e) {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        useView.getState().endTextEdit();
        // Top-level elements (groups count as one).
        candidates = selectableElements(slide)
          .filter((p, _, all) => !all.some((q) => isAncestorPath(q, p)))
          .flatMap((path) => {
            const el = elementOf(ctx.root, path);
            return el ? [{ path, rect: measure(ctx.root, el, ctx.scale) }] : [];
          });
      }
      const to = toSlidePoint(ctx.root, e.clientX, e.clientY, ctx.scale);
      const rect = rectFromPoints(from, to);
      useStageGesture.getState().set({ marquee: rect });
      const hits = candidates!.filter((c) => intersects(c.rect, rect)).map((c) => c.path);
      const merged = [...base.filter((p) => !hits.some((h) => samePath(h, p))), ...hits];
      useView.getState().select(merged);
    },
    up() {
      useStageGesture.getState().set({ marquee: null });
      if (!dragging && !additive) {
        useView.getState().endTextEdit();
        useView.getState().select([]);
      }
    },
    cancel() {
      useStageGesture.getState().set({ marquee: null });
      useView.getState().select([...base]);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Draw                                                                        */
/* -------------------------------------------------------------------------- */

/** Default sizes of a click (no drag) with a draw tool. */
const DEFAULT_SIZE: Partial<Record<Tool, { w: number; h: number }>> = {
  text: { w: 800, h: 120 },
  line: { w: 480, h: 16 },
  connector: { w: 360, h: 0 },
};

/**
 * Draws a new element with a draw tool: a drag sets its box (lines and
 * connectors run from the press to the release); a click uses the default
 * size centered on the pointer. Shift draws squares and 45° lines.
 */
export function startDraw(ctx: StageContext, event: PointerEvent | React.PointerEvent, tool: Exclude<Tool, 'select'>): void {
  if (!stageEditable(ctx)) return;
  const from = toSlidePoint(ctx.root, event.clientX, event.clientY, ctx.scale);
  const linear = tool === 'line' || tool === 'connector';

  const endPoint = (e: PointerEvent): { x: number; y: number } => {
    const p = toSlidePoint(ctx.root, e.clientX, e.clientY, ctx.scale);
    if (!e.shiftKey) return p;
    if (linear) {
      const len = Math.hypot(p.x - from.x, p.y - from.y);
      const angle = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / (Math.PI / 4)) * (Math.PI / 4);
      return { x: from.x + len * Math.cos(angle), y: from.y + len * Math.sin(angle) };
    }
    const side = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
    return { x: from.x + Math.sign(p.x - from.x || 1) * side, y: from.y + Math.sign(p.y - from.y || 1) * side };
  };

  track({
    move(e) {
      useStageGesture.getState().set({ draw: { tool, from, to: endPoint(e) } });
    },
    up(e) {
      useStageGesture.getState().set({ draw: null });
      const to = endPoint(e);
      const dragged = Math.hypot(to.x - from.x, to.y - from.y) * ctx.scale >= 4;
      finishDraw(tool, from, dragged ? to : null);
      useView.getState().setTool('select');
    },
    cancel() {
      useStageGesture.getState().set({ draw: null });
    },
  });
}

/** Inserts what a draw gesture made. `to` is null for a click. */
function finishDraw(tool: Exclude<Tool, 'select'>, from: { x: number; y: number }, to: { x: number; y: number } | null): void {
  const size = DEFAULT_SIZE[tool] ?? { w: 300, h: 300 };
  if (tool === 'connector') {
    const end = to ?? { x: from.x + size.w, y: from.y };
    const node = newShape('connector', rectFromPoints(from, end)) as ConnectorNode;
    insertPinned('Add connector', [withConnectorEnds(node, from, end)]);
    return;
  }
  if (tool === 'line') {
    const end = to ?? { x: from.x + size.w / 2, y: from.y };
    const start = to ? from : { x: from.x - size.w / 2, y: from.y };
    const length = Math.max(8, Math.hypot(end.x - start.x, end.y - start.y));
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
    const node = newShape('line', { x: cx - length / 2, y: cy - size.h / 2, w: length, h: size.h });
    const rounded = Math.round(angle * 100) / 100;
    insertPinned('Add line', [rounded ? { ...node, style: { ...node.style, transform: `rotate(${rounded}deg)` } } : node]);
    return;
  }
  const rect = to ? rectFromPoints(from, to) : { x: from.x - size.w / 2, y: from.y - size.h / 2, w: size.w, h: size.h };
  if (tool === 'text') insertTextBox(rect);
  else insertShape(tool, rect);
}

/* -------------------------------------------------------------------------- */
/* Crop                                                                        */
/* -------------------------------------------------------------------------- */

/** Where a cropped picture sits: its frame and the whole picture, in slide coordinates. */
export interface CropGeometry {
  frame: Rect;
  picture: Rect;
  crop: Crop;
}

/** The crop of an image, or the identity crop. */
export function cropOf(node: ImageNode): Crop {
  return node.crop ?? { zoom: 1, x: 50, y: 50 };
}

/** Measures a picture being cropped (null until its pixels have loaded). */
export function cropGeometry(ctx: StageContext, path: NodePath, node: ImageNode): CropGeometry | null {
  const el = elementOf(ctx.root, path);
  const img = el?.querySelector('img');
  if (!el || !img || !img.naturalWidth || !img.naturalHeight) return null;
  const frame = measure(ctx.root, el, ctx.scale);
  const crop = cropOf(node);
  const fw = crop.zoom * frame.w;
  const fh = crop.zoom * frame.h;
  const cover = Math.max(fw / img.naturalWidth, fh / img.naturalHeight);
  const w = img.naturalWidth * cover;
  const h = img.naturalHeight * cover;
  // The picture's left edge runs linearly from the frame's left (x = 0%) to
  // its right-aligned position (x = 100%); the same holds vertically.
  return {
    frame,
    picture: { x: frame.x + ((frame.w - w) * crop.x) / 100, y: frame.y + ((frame.h - h) * crop.y) / 100, w, h },
    crop,
  };
}

/** Drags the picture inside its frame to choose what shows. */
export function startCropPan(ctx: StageContext, event: PointerEvent | React.PointerEvent, path: NodePath): void {
  const slide = storedSlide(ctx);
  const node = slide && nodeAt(slide, path);
  if (!slide || node?.kind !== 'image' || !stageEditable(ctx)) return;
  const geometry = cropGeometry(ctx, path, node);
  if (!geometry) return;
  const { frame, picture, crop } = geometry;
  const overflowX = picture.w - frame.w;
  const overflowY = picture.h - frame.h;
  const startX = event.clientX;
  const startY = event.clientY;
  let changed = false;

  track({
    move(e) {
      changed = true;
      const dx = (e.clientX - startX) / ctx.scale;
      const dy = (e.clientY - startY) / ctx.scale;
      const x = overflowX > 0.5 ? crop.x - (dx / overflowX) * 100 : crop.x;
      const y = overflowY > 0.5 ? crop.y - (dy / overflowY) * 100 : crop.y;
      const next = { zoom: crop.zoom, x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
      const draft = updateNodeAt(slide, path, (n) => setImageCrop(n as ImageNode, next));
      useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: draft } });
    },
    up() {
      if (changed) commitDraft(ctx, 'Crop');
      else useStageGesture.getState().reset();
    },
    cancel() {
      useStageGesture.getState().reset();
    },
  });
}

/** Why a crop handle is off, by handle; null when the frame cannot be resized at all. */
export type CropHandlesOff = Partial<Record<CropEdge, string>>;

/** The message on handles the layout places. */
const CROP_LAYOUT_REASON = 'The layout places this picture, so only its right and bottom sides crop.';

/**
 * Which crop handles a picture offers. A pinned picture crops from every
 * side; one the layout places keeps its top-left corner, so only its right
 * and bottom sides move. A rotated picture only pans and zooms.
 */
export function cropHandlesOff(node: ImageNode): CropHandlesOff | null {
  if (rotationOf(node)) return null;
  if (isPinned(node)) return {};
  return Object.fromEntries((['n', 'w', 'nw', 'ne', 'sw'] as const).map((edge) => [edge, CROP_LAYOUT_REASON]));
}

/**
 * Drags a side or corner of the crop frame: the picture stays where it is
 * and the frame grows (up to the picture's edges) or shrinks around it. A
 * pinned picture gets a new rect; one the layout places gets a fixed width
 * and height.
 */
export function startCropEdge(ctx: StageContext, event: PointerEvent | React.PointerEvent, path: NodePath, edge: CropEdge): void {
  const slide = storedSlide(ctx);
  const node = slide && nodeAt(slide, path);
  if (!slide || node?.kind !== 'image' || !stageEditable(ctx)) return;
  const off = cropHandlesOff(node);
  if (!off || off[edge]) return;
  const el = elementOf(ctx.root, path);
  const img = el?.querySelector('img');
  if (!el || !img || !img.naturalWidth || !img.naturalHeight) return;
  const frame = measure(ctx.root, el, ctx.scale);
  const image = { w: img.naturalWidth, h: img.naturalHeight };
  const crop = cropOf(node);
  const host = isPinned(node) ? hostRect(ctx.root, slide, path, ctx.scale) : null;
  const startX = event.clientX;
  const startY = event.clientY;
  let changed = false;

  track({
    move(e) {
      changed = true;
      const dx = (e.clientX - startX) / ctx.scale;
      const dy = (e.clientY - startY) / ctx.scale;
      const next = resizeCropFrame(frame, image, crop, edge, dx, dy, MIN_SIZE);
      let draft = updateNodeAt(slide, path, (n) => setImageCrop(n as ImageNode, next.crop));
      draft = host
        ? setNodeRect(draft, path, { x: frame.x + next.frame.x - host.x, y: frame.y + next.frame.y - host.y, w: next.frame.w, h: next.frame.h })
        : patchNodeStyle(draft, path, { flex: undefined, 'flex-grow': undefined, 'flex-basis': undefined, width: pxValue(next.frame.w), height: pxValue(next.frame.h) });
      useStageGesture.getState().set({ draft: { slideId: ctx.slideId, slide: draft } });
    },
    up() {
      if (changed) commitDraft(ctx, 'Crop');
      else useStageGesture.getState().reset();
    },
    cancel() {
      useStageGesture.getState().reset();
    },
  });
}

/** Sets the crop zoom of a picture (the crop bar's slider). */
export function setCropZoom(slideId: string, path: NodePath, zoom: number): void {
  changeSlide(
    slideId,
    'Crop',
    (slide) => {
      const node = nodeAt(slide, path);
      if (node?.kind !== 'image') return null;
      return updateNodeAt(slide, path, (n) => setImageCrop(n as ImageNode, { ...cropOf(node), zoom }));
    },
    { coalesce: `crop-zoom:${pathKey(path)}` },
  );
}

/**
 * Keyboard cropping: moves the picture inside its frame by (dx, dy) percent
 * of its overflow, and multiplies the zoom by `zoomBy`.
 */
export function nudgeCrop(slideId: string, path: NodePath, dx: number, dy: number, zoomBy = 1): void {
  changeSlide(
    slideId,
    'Crop',
    (slide) => {
      const node = nodeAt(slide, path);
      if (node?.kind !== 'image') return null;
      const crop = cropOf(node);
      // Moving the picture right shows more of its left side: x falls.
      return updateNodeAt(slide, path, (n) => setImageCrop(n as ImageNode, { zoom: crop.zoom * zoomBy, x: crop.x - dx, y: crop.y - dy }));
    },
    { coalesce: `crop-key:${pathKey(path)}` },
  );
}

/** Removes a picture's crop. */
export function resetCrop(slideId: string, path: NodePath): void {
  changeSlide(slideId, 'Reset crop', (slide) => {
    const node = nodeAt(slide, path);
    if (node?.kind !== 'image' || !node.crop) return null;
    return updateNodeAt(slide, path, (n) => setImageCrop(n as ImageNode, undefined));
  });
}
