/**
 * Immutable edits of a slide.
 *
 * Every function takes a slide (or node) and returns a new one; nothing is
 * mutated in place, so the editor's store can keep old slides for undo and
 * compare by reference. Paths are child-index paths from the section
 * (`[]` is the section itself, see ids.ts).
 */

import { isValidId, nodeAt, slideElementIds, type NodePath } from './ids.ts';
import {
  isPinned,
  type BoxNode,
  type Crop,
  type ImageNode,
  type ListNode,
  type Marks,
  type Run,
  type Slide,
  type SlideNode,
  type StyleMap,
  type TableCell,
  type TableNode,
  type TableRow,
  type TextBoxNode,
  type TextNode,
  type VideoSpec,
} from './model.ts';
import { cleanMarks, normalizeRuns, plainRuns, withMark } from './text.ts';
import { LIMITS } from './limits.ts';

/** A style change: a value sets, `undefined` removes. */
export type StylePatch = { [K in keyof StyleMap]?: string | undefined };

/** A box on the canvas in slide pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

/** Applies a patch to a style map (`undefined` removes the property). */
export function patchStyle(style: StyleMap, patch: StylePatch): StyleMap {
  const next: StyleMap = { ...style };
  for (const [key, value] of Object.entries(patch) as [keyof StyleMap, string | undefined][]) {
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Rounds to at most two decimals, the precision the files keep. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `12px` from a number. */
export function pxValue(value: number): string {
  return `${round2(value)}px`;
}

/* -------------------------------------------------------------------------- */
/* Tree                                                                        */
/* -------------------------------------------------------------------------- */

/** The children array a node holds (`box`), or undefined. */
function childrenOf(node: SlideNode): SlideNode[] | undefined {
  return node.kind === 'box' ? node.children : undefined;
}

/** Rebuilds the child list at `parent` with `fn`. `[]` is the section. */
export function updateChildren(slide: Slide, parent: NodePath, fn: (children: SlideNode[]) => SlideNode[]): Slide {
  if (parent.length === 0) return { ...slide, children: fn(slide.children) };
  return updateNodeAt(slide, parent, (node) => {
    const children = childrenOf(node);
    if (!children) return node;
    return { ...(node as BoxNode), children: fn(children) };
  });
}

/** Replaces the node at `path` with `fn(node)`. Unknown paths return the slide unchanged. */
export function updateNodeAt(slide: Slide, path: NodePath, fn: (node: SlideNode) => SlideNode): Slide {
  if (path.length === 0) return slide;
  const walk = (children: SlideNode[], depth: number): SlideNode[] | null => {
    const index = path[depth]!;
    const node = children[index];
    if (!node) return null;
    let next: SlideNode;
    if (depth === path.length - 1) {
      next = fn(node);
      if (next === node) return null;
    } else {
      const inner = childrenOf(node);
      if (!inner) return null;
      const updated = walk(inner, depth + 1);
      if (!updated) return null;
      next = { ...(node as BoxNode), children: updated };
    }
    const copy = children.slice();
    copy[index] = next;
    return copy;
  };
  const children = walk(slide.children, 0);
  return children ? { ...slide, children } : slide;
}

/** Replaces the node at `path`. */
export function replaceNodeAt(slide: Slide, path: NodePath, node: SlideNode): Slide {
  return updateNodeAt(slide, path, () => node);
}

/** Inserts nodes into `parent` at `index` (clamped). */
export function insertNodes(slide: Slide, parent: NodePath, index: number, nodes: readonly SlideNode[]): Slide {
  return updateChildren(slide, parent, (children) => {
    const at = Math.max(0, Math.min(children.length, index));
    return [...children.slice(0, at), ...nodes, ...children.slice(at)];
  });
}

/** Removes the nodes at `paths` (any order, any depth; descendants of removed nodes are ignored). */
export function removeNodes(slide: Slide, paths: readonly NodePath[]): Slide {
  const sorted = [...paths].filter((p) => p.length > 0).sort(comparePathsDesc);
  let next = slide;
  for (const path of sorted) {
    if (sorted.some((other) => other !== path && other.length < path.length && other.every((n, i) => path[i] === n))) continue;
    const parent = path.slice(0, -1);
    const index = path[path.length - 1]!;
    next = updateChildren(next, parent, (children) => children.filter((_, i) => i !== index));
  }
  return next;
}

/** Orders paths so later siblings and deeper nodes come first (safe removal order). */
export function comparePathsDesc(a: NodePath, b: NodePath): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return b[i]! - a[i]!;
  return b.length - a.length;
}

/** Orders paths in document order. */
export function comparePaths(a: NodePath, b: NodePath): number {
  return -comparePathsDesc(a, b);
}

/**
 * Moves the node at `from` into `parent` at `index` (the index counts the
 * parent's children before the move). Returns the slide and the new path.
 */
export function moveNode(slide: Slide, from: NodePath, parent: NodePath, index: number): { slide: Slide; path: NodePath } {
  const node = nodeAt(slide, from);
  if (!node || from.length === 0) return { slide, path: from };
  if (parent.length >= from.length && from.every((n, i) => parent[i] === n)) return { slide, path: from };
  const fromParent = from.slice(0, -1);
  const fromIndex = from[from.length - 1]!;
  let at = index;
  // Removing first shifts later siblings (and the target, if it sits after the source).
  const adjusted = parent.slice();
  if (fromParent.length <= adjusted.length && fromParent.every((n, i) => adjusted[i] === n)) {
    const depth = fromParent.length;
    if (depth === adjusted.length) {
      if (fromIndex < at) at -= 1;
    } else if (adjusted[depth]! > fromIndex) adjusted[depth] = adjusted[depth]! - 1;
  }
  let next = removeNodes(slide, [from]);
  next = insertNodes(next, adjusted, at, [node]);
  const siblings = adjusted.length === 0 ? next.children : (nodeAt(next, adjusted) as BoxNode | undefined)?.children ?? [];
  return { slide: next, path: [...adjusted, Math.max(0, Math.min(siblings.length - 1, at))] };
}

/** Where z-order moves a node among its siblings. */
export type ZMove = 'front' | 'back' | 'forward' | 'backward';

/**
 * Changes paint order. Paint order is source order, so this moves the node
 * among its siblings; only pinned siblings are stepped over by
 * `forward`/`backward` (flow siblings keep their reading order).
 */
export function reorderNode(slide: Slide, path: NodePath, move: ZMove): { slide: Slide; path: NodePath } {
  if (path.length === 0) return { slide, path };
  const parent = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const siblings = parent.length === 0 ? slide.children : (nodeAt(slide, parent) as BoxNode | undefined)?.children;
  if (!siblings) return { slide, path };
  let target = index;
  const pinned = (i: number): boolean => Boolean(siblings[i] && isPinned(siblings[i]!));
  switch (move) {
    case 'front':
      target = siblings.length - 1;
      break;
    case 'back':
      target = 0;
      break;
    case 'forward':
      for (let i = index + 1; i < siblings.length; i += 1) if (pinned(i)) { target = i; break; }
      break;
    case 'backward':
      for (let i = index - 1; i >= 0; i -= 1) if (pinned(i)) { target = i; break; }
      break;
  }
  if (target === index) return { slide, path };
  const next = updateChildren(slide, parent, (children) => {
    const copy = children.slice();
    const [node] = copy.splice(index, 1);
    copy.splice(target, 0, node!);
    return copy;
  });
  return { slide: next, path: [...parent, target] };
}

/**
 * Wraps sibling nodes in a new box at the first one's place. Returns the
 * slide and the box's path. Pinned members keep their offsets relative to
 * the box, which is pinned at their bounding rect when every member is.
 */
export function groupNodes(slide: Slide, paths: readonly NodePath[], options: { group?: boolean; style?: StyleMap } = {}): { slide: Slide; path: NodePath } | null {
  if (paths.length === 0) return null;
  const parent = paths[0]!.slice(0, -1);
  if (!paths.every((p) => p.length === parent.length + 1 && parent.every((n, i) => p[i] === n))) return null;
  const indices = [...new Set(paths.map((p) => p[p.length - 1]!))].sort((a, b) => a - b);
  const siblings = parent.length === 0 ? slide.children : (nodeAt(slide, parent) as BoxNode | undefined)?.children;
  if (!siblings) return null;
  let members = indices.map((i) => siblings[i]).filter((n): n is SlideNode => Boolean(n));
  if (members.length !== indices.length) return null;
  let style: StyleMap = options.style ?? {};
  if (members.every(isPinned)) {
    const rects = members.map(pinnedRectOf);
    if (rects.every((r): r is Rect => r !== null)) {
      const left = Math.min(...rects.map((r) => r.x));
      const top = Math.min(...rects.map((r) => r.y));
      const right = Math.max(...rects.map((r) => r.x + r.w));
      const bottom = Math.max(...rects.map((r) => r.y + r.h));
      // A pinned box is the containing block of its pinned members, so their
      // offsets become relative to the box's corner.
      style = { ...style, position: 'absolute', left: pxValue(left), top: pxValue(top), width: pxValue(right - left), height: pxValue(bottom - top) };
      members = members.map((node, i) => {
        const r = rects[i]!;
        return { ...node, style: patchStyle(node.style, { left: pxValue(r.x - left), top: pxValue(r.y - top) }) } as SlideNode;
      });
    }
  }
  const box: BoxNode = { kind: 'box', style, children: members, ...(options.group ? { group: true } : {}) };
  const first = indices[0]!;
  const next = updateChildren(slide, parent, (children) => {
    const kept = children.filter((_, i) => !indices.includes(i));
    kept.splice(first, 0, box);
    return kept;
  });
  return { slide: next, path: [...parent, first] };
}

/**
 * Replaces a box with its children. Pinned children of a pinned box are
 * moved back into the parent's coordinates.
 */
export function ungroupNode(slide: Slide, path: NodePath): { slide: Slide; paths: NodePath[] } {
  const node = nodeAt(slide, path);
  if (!node || node.kind !== 'box' || path.length === 0) return { slide, paths: [] };
  const parent = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const offset = pinnedRectOf(node);
  const children = node.children.map((child) => {
    if (!offset || !isPinned(child)) return child;
    const r = pinnedRectOf(child);
    if (!r) return child;
    return { ...child, style: patchStyle(child.style, { left: pxValue(r.x + offset.x), top: pxValue(r.y + offset.y) }) } as SlideNode;
  });
  const next = updateChildren(slide, parent, (list) => [...list.slice(0, index), ...children, ...list.slice(index + 1)]);
  return { slide: next, paths: children.map((_, i) => [...parent, index + i]) };
}

/** Sets or clears `data-group` on a box. */
export function setGroup(slide: Slide, path: NodePath, group: boolean): Slide {
  return updateNodeAt(slide, path, (node) => {
    if (node.kind !== 'box') return node;
    const next: BoxNode = { ...node };
    if (group) next.group = true;
    else delete next.group;
    return next;
  });
}

/* -------------------------------------------------------------------------- */
/* Copies                                                                      */
/* -------------------------------------------------------------------------- */

/** A deep copy of a node with element ids renamed to stay unique among `taken` (which is updated). */
export function cloneNode<T extends SlideNode>(node: T, taken: Set<string>): T {
  const copy = structuredClone(node) as T;
  const rename = (n: SlideNode): void => {
    if (n.id !== undefined) {
      n.id = uniqueId(n.id, taken);
      taken.add(n.id);
    }
    if (n.kind === 'box') n.children.forEach(rename);
  };
  rename(copy);
  return copy;
}

/** `base`, or `base-2`, `base-3`, … — the first not in `taken`. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const stem = base.replace(/-\d+$/, '').slice(0, 56) || 'e';
  if (!taken.has(base) && isValidId(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${stem}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Duplicates sibling nodes right after the last of them (pinned copies are
 * nudged by `nudge` px). Returns the slide and the copies' paths.
 */
export function duplicateNodes(slide: Slide, paths: readonly NodePath[], nudge = 24): { slide: Slide; paths: NodePath[] } {
  const sorted = [...paths].sort(comparePaths);
  if (sorted.length === 0) return { slide, paths: [] };
  const parent = sorted[0]!.slice(0, -1);
  if (!sorted.every((p) => p.length === parent.length + 1 && parent.every((n, i) => p[i] === n))) return { slide, paths: [] };
  const taken = slideElementIds(slide);
  const copies = sorted
    .map((p) => nodeAt(slide, p))
    .filter((n): n is SlideNode => Boolean(n))
    .map((node) => {
      const copy = cloneNode(node, taken);
      if (!isPinned(copy)) return copy;
      const r = pinnedRectOf(copy);
      return r ? ({ ...copy, style: patchStyle(copy.style, { left: pxValue(r.x + nudge), top: pxValue(r.y + nudge) }) } as SlideNode) : copy;
    });
  const after = sorted[sorted.length - 1]![parent.length]! + 1;
  return { slide: insertNodes(slide, parent, after, copies), paths: copies.map((_, i) => [...parent, after + i]) };
}

/** A deep copy of a slide under a new id (element ids are per slide, so they stay). */
export function duplicateSlide(slide: Slide, id: string): Slide {
  const copy = structuredClone(slide);
  copy.id = id;
  delete copy.section;
  return copy;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** The rect of a pinned node when its offsets and size are plain px. */
export function pinnedRectOf(node: SlideNode): Rect | null {
  const read = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    if (value === '0') return 0;
    const m = /^(-?[\d.]+)px$/.exec(value);
    return m ? Number(m[1]) : undefined;
  };
  const x = read(node.style.left);
  const y = read(node.style.top);
  const w = read(node.style.width);
  const h = read(node.style.height);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x, y, w, h };
}

/** Pins a node at a rect (position:absolute with px offsets and size). */
export function pinNode(node: SlideNode, rect: Rect): SlideNode {
  return {
    ...node,
    style: patchStyle(node.style, {
      position: 'absolute',
      left: pxValue(rect.x),
      top: pxValue(rect.y),
      width: pxValue(Math.max(1, rect.w)),
      height: pxValue(Math.max(1, rect.h)),
      right: undefined,
      bottom: undefined,
      'align-self': undefined,
      flex: undefined,
    }),
  } as SlideNode;
}

/** Moves a pinned node to `rect` (the node keeps its other style). */
export function setNodeRect(slide: Slide, path: NodePath, rect: Rect): Slide {
  return updateNodeAt(slide, path, (node) => pinNode(node, rect));
}

/** Returns a node to the flow: drops `position` and its offsets. */
export function unpinNode(node: SlideNode): SlideNode {
  return {
    ...node,
    style: patchStyle(node.style, { position: undefined, left: undefined, top: undefined, right: undefined, bottom: undefined }),
  } as SlideNode;
}

/** Sets the rotation of a node in degrees (0 removes it). */
export function setRotation(slide: Slide, path: NodePath, degrees: number): Slide {
  const normalized = round2(((degrees % 360) + 540) % 360 - 180);
  return patchNodeStyle(slide, path, { transform: normalized === 0 ? undefined : `rotate(${normalized}deg)` });
}

/** The rotation of a node in degrees. */
export function rotationOf(node: SlideNode): number {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(node.style.transform ?? '');
  return m ? Number(m[1]) : 0;
}

/** Patches the style of the node at `path` (`[]` patches the section). */
export function patchNodeStyle(slide: Slide, path: NodePath, patch: StylePatch): Slide {
  if (path.length === 0) return { ...slide, style: patchStyle(slide.style, patch) };
  return updateNodeAt(slide, path, (node) => ({ ...node, style: patchStyle(node.style, patch) }) as SlideNode);
}

/* -------------------------------------------------------------------------- */
/* Slide fields                                                                */
/* -------------------------------------------------------------------------- */

/** Sets the speaker notes. */
export function setNotes(slide: Slide, notes: string): Slide {
  return { ...slide, notes: notes.slice(0, LIMITS.notes) };
}

/** Hides or shows a slide when presenting. */
export function setHidden(slide: Slide, hidden: boolean): Slide {
  return { ...slide, hidden };
}

/** Sets the transition into the slide. */
export function setTransition(slide: Slide, transition: Slide['transition']): Slide {
  const next = { ...slide };
  if (transition) next.transition = transition;
  else delete next.transition;
  return next;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

/** Maps every run array a node holds (text, list items, text box blocks, table cells). */
export function mapRuns(node: SlideNode, fn: (runs: Run[]) => Run[]): SlideNode {
  switch (node.kind) {
    case 'text':
      return { ...node, runs: normalizeRuns(fn(node.runs)) };
    case 'list':
      return { ...node, items: node.items.map((item) => ({ ...item, runs: normalizeRuns(fn(item.runs)) })) };
    case 'textbox':
      return { ...node, blocks: node.blocks.map((block) => mapRuns(block, fn) as TextNode | ListNode) };
    case 'table':
      return { ...node, rows: node.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, runs: normalizeRuns(fn(cell.runs)) })) })) };
    case 'box':
      return { ...node, children: node.children.map((child) => mapRuns(child, fn)) };
    default:
      return node;
  }
}

/** Every run of a node in reading order. */
export function allRuns(node: SlideNode): Run[] {
  const out: Run[] = [];
  mapRuns(node, (runs) => {
    out.push(...runs);
    return runs;
  });
  return out;
}

/** True when every non-empty run of the node has the mark. */
export function nodeHasMark(node: SlideNode, key: 'b' | 'i' | 'u'): boolean {
  const runs = allRuns(node).filter((run) => run.text.trim() !== '');
  return runs.length > 0 && runs.every((run) => run.marks?.[key] === true);
}

/** Sets or clears a mark on all of a node's text. */
export function setNodeMark<K extends keyof Marks>(node: SlideNode, key: K, value: Marks[K] | undefined): SlideNode {
  return mapRuns(node, (runs) =>
    runs.map((run) => {
      const clean = cleanMarks(withMark(run.marks, key, value));
      return clean ? { text: run.text, marks: clean } : { text: run.text };
    }),
  );
}

/** Toggles bold, italic or underline on all of a node's text. */
export function toggleNodeMark(node: SlideNode, key: 'b' | 'i' | 'u'): SlideNode {
  return setNodeMark(node, key, nodeHasMark(node, key) ? undefined : true);
}

/** The link every run of the node shares, if any. */
export function nodeUniformLink(node: SlideNode): string | undefined {
  const runs = allRuns(node).filter((run) => run.text !== '');
  const first = runs[0]?.marks?.href;
  return first !== undefined && runs.every((run) => run.marks?.href === first) ? first : undefined;
}

/** Replaces the text of a text node, list item or table cell (marks of the first run kept). */
export function setPlainText(node: SlideNode, text: string): SlideNode {
  const marks = allRuns(node)[0]?.marks;
  const runs = (value: string): Run[] => normalizeRuns(marks ? [{ text: value, marks }] : plainRuns(value));
  switch (node.kind) {
    case 'text':
      return { ...node, runs: runs(text) };
    case 'list':
      return { ...node, items: text.split('\n').map((line, i) => ({ ...node.items[i], runs: runs(line) })) };
    case 'textbox': {
      const first = node.blocks[0];
      const block: TextNode = first && first.kind === 'text' ? { ...first, runs: runs(text) } : { kind: 'text', tag: 'p', style: {}, runs: runs(text) };
      return { ...node, blocks: [block] };
    }
    default:
      return node;
  }
}

/** Sets the runs of a text node (or the block at `block` of a text box). */
export function setRuns(slide: Slide, path: NodePath, runs: readonly Run[], block?: number, item?: number): Slide {
  const clean = normalizeRuns(runs);
  return updateNodeAt(slide, path, (node) => {
    if (node.kind === 'text') return { ...node, runs: clean };
    if (node.kind === 'list' && item !== undefined) return { ...node, items: node.items.map((it, i) => (i === item ? { ...it, runs: clean } : it)) };
    if (node.kind === 'textbox' && block !== undefined) {
      return {
        ...node,
        blocks: node.blocks.map((b, i) => {
          if (i !== block) return b;
          if (b.kind === 'text') return { ...b, runs: clean };
          if (item !== undefined) return { ...b, items: b.items.map((it, j) => (j === item ? { ...it, runs: clean } : it)) };
          return b;
        }),
      };
    }
    return node;
  });
}

/** Turns a text node into a list (or back), keeping its lines. */
export function setListKind(node: TextNode | ListNode, kind: 'ul' | 'ol' | null): TextNode | ListNode {
  if (node.kind === 'list') {
    if (kind) return node.tag === kind ? node : retagList(node, kind);
    const runs: Run[] = [];
    node.items.forEach((item, i) => {
      if (i > 0) runs.push({ text: '\n' });
      runs.push(...item.runs);
    });
    const { items: _items, tag: _tag, start: _start, reversed: _reversed, levels: _levels, itemMargin: _itemMargin, ...rest } = node;
    return { ...rest, style: withoutMarkers(rest.style), kind: 'text', tag: 'p', runs: normalizeRuns(runs) };
  }
  if (!kind) return node;
  const lines: Run[][] = [[]];
  for (const run of node.runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push(run.marks ? { text: part, marks: run.marks } : { text: part });
    });
  }
  const { runs: _runs, tag: _tag, ...rest } = node;
  return { ...rest, kind: 'list', tag: kind, items: lines.map((line) => ({ runs: normalizeRuns(line) })) };
}

const NUMBER_MARKERS = new Set(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);
const BULLET_MARKERS = new Set(['disc', 'circle', 'square']);

function withoutMarkers(style: StyleMap): StyleMap {
  const { 'list-style-type': _type, 'list-style-position': _position, ...rest } = style;
  return rest;
}

/** A marker kept across a change of list kind: text and none stay, the other kind's keywords go. */
function keptMarkers(style: StyleMap, kind: 'ul' | 'ol'): StyleMap {
  const type = style['list-style-type'];
  if (type === undefined || !(kind === 'ul' ? NUMBER_MARKERS : BULLET_MARKERS).has(type)) return style;
  const { 'list-style-type': _type, ...rest } = style;
  return rest;
}

function retagList(node: ListNode, kind: 'ul' | 'ol'): ListNode {
  const { start: _start, reversed: _reversed, levels, ...rest } = node;
  const next: ListNode = { ...rest, tag: kind, style: keptMarkers(node.style, kind) };
  if (kind === 'ol') {
    if (node.start !== undefined) next.start = node.start;
    if (node.reversed) next.reversed = true;
  }
  const kept = Object.entries(levels ?? {})
    .map(([level, look]) => [level, keptMarkers(look, kind)] as const)
    .filter(([, look]) => Object.keys(look).length > 0);
  if (kept.length) next.levels = Object.fromEntries(kept);
  return next;
}

/** Changes a text node's tag (h1/h2/h3/p) and replaces its type declarations. */
export function setTextTag(node: TextNode, tag: TextNode['tag'], declarations: StyleMap): TextNode {
  const style = patchStyle(node.style, {
    'font-size': undefined,
    'font-weight': undefined,
    'line-height': undefined,
    'text-transform': undefined,
    'letter-spacing': undefined,
    ...declarations,
  });
  return { ...node, tag, style };
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/** An empty cell like `like` (same tag and style). */
function emptyCell(like: TableCell | undefined, tag: TableCell['tag'] = 'td'): TableCell {
  return { tag: like?.tag ?? tag, runs: [], style: like ? { ...like.style } : {} };
}

/** Number of columns (the widest row). */
export function tableColumns(table: TableNode): number {
  return table.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
}

/** Sets the text of one cell. */
export function setCellRuns(table: TableNode, row: number, col: number, runs: readonly Run[]): TableNode {
  return {
    ...table,
    rows: table.rows.map((r, i) => (i !== row ? r : { ...r, cells: r.cells.map((c, j) => (j !== col ? c : { ...c, runs: normalizeRuns(runs) })) })),
  };
}

/** Patches the style of cells (`cells` = [row, col] pairs). */
export function patchCellStyle(table: TableNode, cells: readonly (readonly [number, number])[], patch: StylePatch): TableNode {
  const hit = new Set(cells.map(([r, c]) => `${r}:${c}`));
  return {
    ...table,
    rows: table.rows.map((row, r) => ({
      ...row,
      cells: row.cells.map((cell, c) => (hit.has(`${r}:${c}`) ? { ...cell, style: patchStyle(cell.style, patch) } : cell)),
    })),
  };
}

/** Inserts a row at `at`, styled like its neighbor (a body row when the neighbor is the header). */
export function insertTableRow(table: TableNode, at: number): TableNode {
  if (table.rows.length >= LIMITS.tableRows) return table;
  const index = Math.max(0, Math.min(table.rows.length, at));
  const like = table.rows[Math.min(index, table.rows.length - 1)] ?? table.rows[index - 1];
  const bodyLike = like && like.cells.every((c) => c.tag === 'th') ? table.rows.find((r) => r.cells.some((c) => c.tag === 'td')) ?? like : like;
  const columns = Math.max(1, tableColumns(table));
  const row: TableRow = {
    style: bodyLike ? { ...bodyLike.style } : {},
    cells: Array.from({ length: columns }, (_, c) => {
      const cell = emptyCell(bodyLike?.cells[c]);
      if (index > 0 && cell.tag === 'th' && !bodyLike?.cells.every((x) => x.tag === 'th')) cell.tag = 'td';
      if (index > 0 && bodyLike?.cells.every((x) => x.tag === 'th')) cell.tag = 'td';
      return cell;
    }),
  };
  const rows = table.rows.slice();
  rows.splice(index, 0, row);
  return { ...table, rows };
}

/** Removes a row (the last row stays). */
export function removeTableRow(table: TableNode, row: number): TableNode {
  if (table.rows.length <= 1) return table;
  return { ...table, rows: table.rows.filter((_, i) => i !== row) };
}

/** Inserts a column at `at`, each cell styled like its row neighbor. */
export function insertTableColumn(table: TableNode, at: number, headerLabel = ''): TableNode {
  if (tableColumns(table) >= LIMITS.tableColumns) return table;
  return {
    ...table,
    rows: table.rows.map((row) => {
      const index = Math.max(0, Math.min(row.cells.length, at));
      const like = row.cells[Math.min(index, row.cells.length - 1)] ?? row.cells[index - 1];
      const cell = emptyCell(like);
      if (cell.tag === 'th' && headerLabel) cell.runs = plainRuns(headerLabel);
      const cells = row.cells.slice();
      cells.splice(index, 0, cell);
      return { ...row, cells };
    }),
  };
}

/** Removes a column (the last column stays). */
export function removeTableColumn(table: TableNode, col: number): TableNode {
  if (tableColumns(table) <= 1) return table;
  return { ...table, rows: table.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== col) })) };
}

/** Resizes a table to `rows` × `cols`, adding empty cells or dropping trailing ones. */
export function resizeTable(table: TableNode, rows: number, cols: number): TableNode {
  const r = Math.max(1, Math.min(LIMITS.tableRows, Math.floor(rows)));
  const c = Math.max(1, Math.min(LIMITS.tableColumns, Math.floor(cols)));
  let next = table;
  while (next.rows.length < r) next = insertTableRow(next, next.rows.length);
  if (next.rows.length > r) next = { ...next, rows: next.rows.slice(0, r) };
  while (tableColumns(next) < c) next = insertTableColumn(next, tableColumns(next));
  if (tableColumns(next) > c) next = { ...next, rows: next.rows.map((row) => ({ ...row, cells: row.cells.slice(0, c) })) };
  return next;
}

/** Makes the first row a header row (`th`) or a body row (`td`). */
export function setHeaderRow(table: TableNode, header: boolean): TableNode {
  const first = table.rows[0];
  if (!first) return table;
  const tag = header ? 'th' : 'td';
  return { ...table, rows: [{ ...first, cells: first.cells.map((cell) => ({ ...cell, tag })) }, ...table.rows.slice(1)] };
}

/** True when the first row is all `th`. */
export function hasHeaderRow(table: TableNode): boolean {
  const first = table.rows[0];
  return Boolean(first && first.cells.length > 0 && first.cells.every((cell) => cell.tag === 'th'));
}

/** Sets the text alignment of one column. */
export function setColumnAlign(table: TableNode, col: number, align: 'left' | 'center' | 'right' | undefined): TableNode {
  const cells: [number, number][] = table.rows.map((_, r) => [r, col]);
  return patchCellStyle(table, cells, { 'text-align': align === 'left' ? undefined : align });
}

/** Table cells of a slide (deck limit). */
export function countSlideCells(slide: Slide): number {
  let count = 0;
  const visit = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'table') count += node.rows.reduce((n, row) => n + row.cells.length, 0);
      else if (node.kind === 'box') visit(node.children);
    }
  };
  visit(slide.children);
  return count;
}

/** Embeds on a slide (per-slide limit). */
export function countSlideEmbeds(slide: Slide): number {
  let count = 0;
  const visit = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'embed') count += 1;
      else if (node.kind === 'box') visit(node.children);
    }
  };
  visit(slide.children);
  return count;
}

/* -------------------------------------------------------------------------- */
/* Pictures and clips                                                          */
/* -------------------------------------------------------------------------- */

/** Sets the picture of an image frame (clears any crop when the picture changes). */
export function setImageSource(node: ImageNode, src: string | undefined, alt?: string): ImageNode {
  const next: ImageNode = { ...node };
  if (src) next.src = src;
  else delete next.src;
  if (alt !== undefined) {
    if (alt) next.alt = alt.slice(0, LIMITS.alt);
    else delete next.alt;
  }
  if (src !== node.src) delete next.crop;
  return next;
}

/** Sets or clears the crop. A zoom of 1 at the center is no crop. */
export function setImageCrop(node: ImageNode, crop: Crop | undefined): ImageNode {
  const next: ImageNode = { ...node };
  if (!crop || (crop.zoom === 1 && crop.x === 50 && crop.y === 50)) delete next.crop;
  else next.crop = { zoom: round2(Math.min(50, Math.max(1, crop.zoom))), x: round2(Math.min(100, Math.max(0, crop.x))), y: round2(Math.min(100, Math.max(0, crop.y))) };
  return next;
}

/** `object-fit` of a picture: cover fills and crops, contain shows all. */
export function setImageFit(node: ImageNode, fit: 'cover' | 'contain' | 'fill'): ImageNode {
  return { ...node, style: patchStyle(node.style, { 'object-fit': fit === 'fill' ? 'fill' : fit }) };
}

/** Patches the clip of an image frame; `null` removes the clip. */
export function setVideo(node: ImageNode, patch: Partial<VideoSpec> | null): ImageNode {
  const next: ImageNode = { ...node };
  if (patch === null) {
    delete next.video;
    return next;
  }
  const video: VideoSpec = { ...node.video, ...patch };
  for (const key of Object.keys(video) as (keyof VideoSpec)[]) if (video[key] === undefined) delete video[key];
  if (video.src === undefined && video.link === undefined) delete next.video;
  else next.video = video;
  return next;
}

/* -------------------------------------------------------------------------- */
/* Factories                                                                   */
/* -------------------------------------------------------------------------- */

/** A new pinned text box. */
export function newTextBox(rect: Rect, text: string, style: StyleMap = {}): TextBoxNode {
  return pinNode({ kind: 'textbox', style, blocks: [{ kind: 'text', tag: 'p', style: {}, runs: plainRuns(text) }] }, rect) as TextBoxNode;
}

/** A new pinned table of `rows` × `cols` with a header row. */
export function newTable(rect: Rect, rows: number, cols: number, headerLabel: string): TableNode {
  const header: TableRow = { style: {}, cells: Array.from({ length: cols }, (_, c) => ({ tag: 'th' as const, runs: plainRuns(`${headerLabel} ${c + 1}`), style: {} })) };
  const body: TableRow[] = Array.from({ length: Math.max(0, rows - 1) }, () => ({ style: {}, cells: Array.from({ length: cols }, () => ({ tag: 'td' as const, runs: [], style: {} })) }));
  return pinNode({ kind: 'table', style: {}, rows: [header, ...body] }, { ...rect, h: rect.h }) as TableNode;
}

/** A new pinned picture frame. */
export function newImage(rect: Rect, src?: string, alt?: string): ImageNode {
  const node: ImageNode = { kind: 'image', style: { 'object-fit': 'cover' } };
  if (src) node.src = src;
  if (alt) node.alt = alt.slice(0, LIMITS.alt);
  return pinNode(node, rect) as ImageNode;
}
