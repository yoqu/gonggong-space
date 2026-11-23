/**
 * Addressing elements: the editor's internal node paths, and the stable
 * names the view context publishes for the agent.
 *
 * Internally a node is addressed by a {@link NodePath}: indices into
 * `slide.children`, then into each box's `children`. Externally (the view
 * context `selected` list) a node is named relative to an anchor:
 *
 * - A *positioned element* is a `position:absolute` child of the section (or a
 *   pinned connector / embed), or the section's implicit *flow root* (all its
 *   flow children together). It is named by its own `id` when it has one,
 *   else by a minted id `e<n>-<hash>`: `n` is its index among the section's
 *   positioned elements in source order, root included as 0; `hash` is the
 *   FNV-1a hash of the section id in base 36. Minting is deterministic, so
 *   the names are stable across reads.
 * - Any other element is named by the nearest ancestor (or itself) that has
 *   an `id` or is positioned, followed by `/index` segments walking down the
 *   markup's child order (the flow root's children are the section's flow
 *   children). At most four segments are written.
 * - A table cell being edited appends `row/col`.
 */

import { ID_PATTERN } from './limits.ts';
import { isPinned, nodeText, runsText, type BoxNode, type Slide, type SlideNode } from './model.ts';

/** Internal address: indices from `slide.children` down through box children. */
export type NodePath = readonly number[];

/** Grammar of a view-context `selected` entry. */
export const CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}(\/\d{1,2}){0,4}$/;

/** Most `/index` segments a context id carries. */
const MAX_SEGMENTS = 4;

/** 32-bit FNV-1a of a string. */
export function fnv1a(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** The minted name of the `n`th positioned element of slide `slideId`. */
export function mintedId(slideId: string, n: number): string {
  return `e${n}-${fnv1a(slideId).toString(36)}`;
}

/** Every `id` written on a slide's elements. */
export function slideElementIds(slide: Slide): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      if (node.id) ids.add(node.id);
      if (node.kind === 'box') walk(node.children);
    }
  };
  walk(slide.children);
  return ids;
}

/** One positioned element: the flow root (`index` null) or a pinned section child. */
export interface Positioned {
  /** Index in `slide.children`, or null for the flow root. */
  index: number | null;
  /** The name the view context uses. */
  name: string;
}

/** The section's positioned elements in source order, root first, each with its name. */
export function positionedElements(slide: Slide): Positioned[] {
  const pinned: number[] = [];
  slide.children.forEach((child, i) => {
    if (isPinned(child)) pinned.push(i);
  });
  const count = pinned.length + 1;
  const taken = slideElementIds(slide);
  const mint = (n: number): string => {
    let name = mintedId(slide.id, n);
    for (let k = 1; taken.has(name); k++) name = mintedId(slide.id, n + k * count);
    taken.add(name);
    return name;
  };
  const out: Positioned[] = [{ index: null, name: mint(0) }];
  pinned.forEach((index, i) => {
    const own = slide.children[index]!.id;
    out.push({ index, name: own ?? mint(i + 1) });
  });
  return out;
}

/** The node at a path, or undefined. */
export function nodeAt(slide: Slide, path: NodePath): SlideNode | undefined {
  let nodes: readonly SlideNode[] = slide.children;
  let node: SlideNode | undefined;
  for (const index of path) {
    node = nodes[index];
    if (!node) return undefined;
    nodes = node.kind === 'box' ? node.children : [];
  }
  return node;
}

/** The children list a path's last index points into (the parent's). */
export function siblingsAt(slide: Slide, path: NodePath): readonly SlideNode[] | undefined {
  if (path.length === 0) return undefined;
  if (path.length === 1) return slide.children;
  const parent = nodeAt(slide, path.slice(0, -1));
  return parent?.kind === 'box' ? parent.children : undefined;
}

/** The parent box of a path (undefined for a section child). */
export function parentAt(slide: Slide, path: NodePath): BoxNode | undefined {
  if (path.length < 2) return undefined;
  const parent = nodeAt(slide, path.slice(0, -1));
  return parent?.kind === 'box' ? parent : undefined;
}

/** True when two paths are equal. */
export function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True when `ancestor` is a strict prefix of `path`. */
export function isAncestorPath(ancestor: NodePath, path: NodePath): boolean {
  return ancestor.length < path.length && ancestor.every((v, i) => v === path[i]);
}

/** Stable string key of a path (for maps and React keys). */
export function pathKey(path: NodePath): string {
  return path.join('.');
}

/** Parses {@link pathKey}. */
export function parsePathKey(key: string): NodePath {
  return key === '' ? [] : key.split('.').map(Number);
}

/** Calls `visit` for every node with its path (depth first, source order). */
export function walkNodes(slide: Slide, visit: (node: SlideNode, path: NodePath) => void | false): void {
  const walk = (nodes: readonly SlideNode[], base: number[]): void => {
    nodes.forEach((node, i) => {
      const path = [...base, i];
      if (visit(node, path) === false) return;
      if (node.kind === 'box') walk(node.children, path);
    });
  };
  walk(slide.children, []);
}

/** The path of the first node with `id`. */
export function findById(slide: Slide, id: string): NodePath | undefined {
  let found: NodePath | undefined;
  walkNodes(slide, (node, path) => {
    if (found) return false;
    if (node.id === id) found = path;
  });
  return found;
}

/** A context id with its optional table cell. */
export interface ContextAddress {
  path: NodePath;
  /** `[row, col]` while a cell is being edited. */
  cell?: [number, number];
}

/**
 * The view-context name of the node at `path` (and an edited cell), or null
 * when the path does not resolve.
 */
export function contextId(slide: Slide, path: NodePath, cell?: readonly [number, number]): string | null {
  if (!nodeAt(slide, path)) return null;
  const positioned = positionedElements(slide);
  // Child indices below the anchor, nearest first.
  const segments: number[] = [];
  for (let depth = path.length; depth >= 1; depth--) {
    const node = nodeAt(slide, path.slice(0, depth))!;
    if (depth === 1 && isPinned(node)) {
      const entry = positioned.find((p) => p.index === path[0]);
      return finish(entry!.name, segments, cell);
    }
    if (node.id) return finish(node.id, segments, cell);
    if (depth === 1) {
      // A flow child of the section: index among the flow root's children.
      const flowIndex = slide.children.slice(0, path[0]).filter((child) => !isPinned(child)).length;
      segments.unshift(flowIndex);
      return finish(positioned[0]!.name, segments, cell);
    }
    segments.unshift(path[depth - 1]!);
  }
  return null;
}

/** Appends segments (and cell) to an anchor, keeping at most four segments. */
function finish(anchor: string, segments: number[], cell?: readonly [number, number]): string | null {
  // Deeper than the grammar allows: name the deepest addressable ancestor
  // (and drop the cell when it no longer fits).
  const kept = cell && segments.length + 2 <= MAX_SEGMENTS ? [...segments, cell[0], cell[1]] : segments.slice(0, MAX_SEGMENTS);
  if (kept.some((n) => n > 99)) return anchor;
  const id = [anchor, ...kept].join('/');
  return CONTEXT_ID_PATTERN.test(id) ? id : null;
}

/** Resolves a context id against a slide; null when it does not resolve. */
export function resolveContextId(slide: Slide, entry: string): ContextAddress | null {
  if (!CONTEXT_ID_PATTERN.test(entry)) return null;
  const [anchor, ...rest] = entry.split('/');
  const segments = rest.map(Number);
  const positioned = positionedElements(slide);
  let path: number[];
  let nodes: readonly SlideNode[];
  const hit = positioned.find((p) => p.name === anchor);
  if (hit && hit.index === null) {
    // The flow root: the first segment counts flow children only.
    if (segments.length === 0) return null;
    const flowIndex = segments.shift()!;
    const index = slide.children.findIndex((child, i) => !isPinned(child) && slide.children.slice(0, i).filter((c) => !isPinned(c)).length === flowIndex);
    if (index < 0) return null;
    path = [index];
  } else if (hit) {
    path = [hit.index!];
  } else {
    const found = anchor ? findById(slide, anchor) : undefined;
    if (!found) return null;
    path = [...found];
  }
  let node = nodeAt(slide, path);
  for (let i = 0; i < segments.length; i++) {
    if (node?.kind === 'table' && segments.length - i === 2) {
      const [row, col] = [segments[i]!, segments[i + 1]!];
      if (!node.rows[row]?.cells[col]) return null;
      return { path, cell: [row, col] };
    }
    nodes = node?.kind === 'box' ? node.children : [];
    const next = nodes[segments[i]!];
    if (!next) return null;
    path = [...path, segments[i]!];
    node = next;
  }
  return node ? { path } : null;
}

/* -------------------------------------------------------------------------- */
/* Kinds and labels                                                            */
/* -------------------------------------------------------------------------- */

/** What the view context calls an element. */
export type ContextKind =
  | 'text'
  | 'img'
  | 'icon'
  | 'shape'
  | 'table'
  | 'html'
  | 'spacer'
  | 'stack'
  | 'grid'
  | 'overlay'
  | 'slide'
  | 'section'
  | 'cell';

/** Display names of shape kinds (also the label of a shape). */
export const SHAPE_LABELS = {
  rect: 'Rectangle',
  rounded: 'Rounded rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond (decision)',
  'arrow-right': 'Arrow right',
  'arrow-left': 'Arrow left',
  'arrow-up': 'Arrow up',
  'arrow-down': 'Arrow down',
  line: 'Line',
} as const;

/** The context kind of a node. */
export function contextKind(node: SlideNode): ContextKind {
  switch (node.kind) {
    case 'text':
    case 'list':
    case 'textbox':
      return 'text';
    case 'image':
    case 'svg':
      return 'img';
    case 'icon':
      return 'icon';
    case 'shape':
    case 'connector':
    case 'rule':
      return 'shape';
    case 'table':
      return 'table';
    case 'embed':
      return 'html';
    case 'box':
      if (node.children.length === 0 && !node.group && (node.style.flex !== undefined || node.style['flex-grow'] !== undefined)) {
        return 'spacer';
      }
      if (node.style.position === 'relative') return 'overlay';
      if (node.style.display === 'grid') return 'grid';
      return 'stack';
  }
}

/** Cuts text to `max` characters (UTF-16 safe) with an ellipsis. */
export function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  // Never split a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The first words of a node or its descendants. */
function firstText(node: SlideNode): string | undefined {
  if (node.kind === 'box') {
    for (const child of node.children) {
      const text = firstText(child);
      if (text) return text;
    }
    return undefined;
  }
  if (node.kind === 'image') return undefined;
  const text = squash(nodeText(node));
  return text || undefined;
}

/** The context label of a node: its first words, or a short name. */
export function nodeLabel(node: SlideNode, max = 60): string {
  switch (node.kind) {
    case 'text':
    case 'list':
    case 'textbox': {
      const text = squash(nodeText(node));
      return text ? truncate(text, max) : 'Empty text';
    }
    case 'image': {
      const alt = squash(node.alt ?? '');
      return alt ? truncate(`Image — ${alt}`, max) : 'Image';
    }
    case 'svg':
      return 'Image';
    case 'icon':
      return truncate(`Icon — ${node.name}`, max);
    case 'shape':
      return SHAPE_LABELS[node.shape];
    case 'connector':
      return 'Connector';
    case 'rule':
      return 'Line';
    case 'embed':
      return 'Web embed';
    case 'table':
      return `Table ${node.rows.length}×${Math.max(0, ...node.rows.map((r) => r.cells.length))}`;
    case 'box': {
      const kind = contextKind(node);
      if (kind === 'spacer') return 'Spacer';
      const name = kind === 'grid' ? 'Grid' : kind === 'overlay' ? 'Overlay' : 'Group';
      const text = firstText(node);
      return text ? truncate(`${name} — ${text}`, max) : name;
    }
  }
}

/** A slide's title: its first heading, else its first text (≈ 60 chars); undefined when wordless. */
export function slideTitle(slide: Slide, max = 60): string | undefined {
  let heading: string | undefined;
  let any: string | undefined;
  const visit = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      if (heading) return;
      if (node.kind === 'text') {
        const text = squash(runsText(node.runs));
        if (!text) continue;
        if (node.tag !== 'p') heading = text;
        else any ??= text;
      } else if (node.kind === 'textbox') {
        for (const block of node.blocks) {
          const text = squash(nodeText(block));
          if (!text) continue;
          if (block.kind === 'text' && block.tag !== 'p' && !heading) heading = text;
          else any ??= text;
        }
      } else if (node.kind === 'list' || node.kind === 'table') {
        const text = squash(nodeText(node));
        if (text) any ??= text;
      } else if (node.kind === 'box') visit(node.children);
    }
  };
  visit(slide.children);
  const title = heading ?? any;
  return title ? truncate(title, max) : undefined;
}

/** True for a valid slide / element id. */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** A fresh slide id not in `taken`: `s-<6 base36 chars>`. */
export function newSlideId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    const id = `s-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!taken.has(id)) return id;
  }
}
