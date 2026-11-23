/**
 * The template fragment (`<x-dc>` … last `</x-dc>`) as a tree, and the two
 * ways to address one of its elements:
 *
 * - **tid**: every element numbered depth-first in source order from 0. All
 *   tags count (`<helmet>` and its `<style>`, `<sc-for>`, `<sc-if>`,
 *   `<dc-import>`); text and comments do not.
 * - **path**: the index among the fragment's top-level elements, then the
 *   index among each element's element children, down to the element.
 *
 * Together they form a view-context address: `File.dc.html#tid:path`, the
 * file stem percent-encoded with `encodeURIComponent`. An agent resolves an
 * address against its own copy of the file by the same rules; when tid and
 * path disagree, the copies differ.
 */

import {
  attributeValue,
  elementChildren,
  parseHtml,
  textContent,
  type HtmlElement,
  type HtmlNode,
} from './html.ts';

/** A parsed template with its elements indexed by tid. */
export interface TemplateModel {
  /** The template text this model was parsed from. */
  text: string;
  /** Top-level nodes. Offsets index into {@link text}. */
  nodes: HtmlNode[];
  /** Every element in tid order: `elements[tid]`. */
  elements: HtmlElement[];
  /** The tid of an element of this model. */
  tidOf: Map<HtmlElement, number>;
}

/** Parses template text (the part between `<x-dc>` and the last `</x-dc>`). */
export function parseTemplate(text: string): TemplateModel {
  const nodes = parseHtml(text);
  const elements: HtmlElement[] = [];
  const visit = (list: HtmlNode[]): void => {
    for (const node of list) {
      if (node.type !== 'element') continue;
      elements.push(node);
      visit(node.children);
    }
  };
  visit(nodes);
  return { text, nodes, elements, tidOf: new Map(elements.map((element, tid) => [element, tid])) };
}

/** The child-index path of an element, top-level index first. */
export function elementPath(model: TemplateModel, element: HtmlElement): number[] {
  const path: number[] = [];
  for (let node: HtmlElement | null = element; node; node = node.parent) {
    const siblings = node.parent ? elementChildren(node.parent) : elementChildren(model.nodes);
    path.unshift(siblings.indexOf(node));
  }
  return path;
}

/** Finds an element by its path, or `null`. */
export function elementAtPath(model: TemplateModel, path: readonly number[]): HtmlElement | null {
  let siblings = elementChildren(model.nodes);
  let element: HtmlElement | null = null;
  for (const index of path) {
    element = siblings[index] ?? null;
    if (!element) return null;
    siblings = elementChildren(element);
  }
  return element;
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

/** Grammar of an encoded artboard file name. */
export const BOARD_NAME_PATTERN = /^(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2}){1,200}\.dc\.html$/;

/** Grammar of an element address. */
export const ADDRESS_PATTERN =
  /^(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2}){1,200}\.dc\.html#\d{1,4}:\d{1,2}(\/\d{1,2}){0,8}(@\d{1,3})?$/;

/** Longest encoded file name the view context writes. */
export const MAX_ENCODED_NAME = 220;

/**
 * Encodes an artboard path for the view context: the base name with the part
 * before `.dc.html` percent-encoded. Returns `null` when the result would not
 * match {@link BOARD_NAME_PATTERN} (such entries are left out).
 */
export function encodeBoardName(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const match = /^(.*)\.dc\.html$/i.exec(base);
  if (!match || !match[1]) return null;
  const encoded = `${encodeURIComponent(match[1])}.dc.html`;
  return encoded.length <= MAX_ENCODED_NAME && BOARD_NAME_PATTERN.test(encoded) ? encoded : null;
}

/** A decoded element address. */
export interface ElementAddress {
  /** The encoded file name, as written in the address. */
  file: string;
  tid: number;
  path: number[];
  /** Instance index inside a loop; never written today. */
  instance?: number;
}

/** Builds `File.dc.html#tid:path`, or `null` when the grammar cannot express it. */
export function formatAddress(boardPath: string, tid: number, path: readonly number[]): string | null {
  const file = encodeBoardName(boardPath);
  if (!file || path.length === 0 || path.length > 9 || tid > 9999) return null;
  if (path.some((index) => index < 0 || index > 99)) return null;
  const address = `${file}#${tid}:${path.join('/')}`;
  return ADDRESS_PATTERN.test(address) ? address : null;
}

/** Parses an address; `null` when it does not match the grammar. */
export function parseAddress(address: string): ElementAddress | null {
  if (!ADDRESS_PATTERN.test(address)) return null;
  const hash = address.indexOf('#');
  const file = address.slice(0, hash);
  const rest = address.slice(hash + 1);
  const [ref, instance] = rest.split('@') as [string, string | undefined];
  const colon = ref.indexOf(':');
  const tid = Number(ref.slice(0, colon));
  const path = ref.slice(colon + 1).split('/').map(Number);
  return instance === undefined ? { file, tid, path } : { file, tid, path, instance: Number(instance) };
}

/**
 * Resolves a tid/path pair against a model. Returns the element only when
 * both name the same node; otherwise the caller's copy differs from the
 * viewer's.
 */
export function resolveElement(model: TemplateModel, tid: number, path: readonly number[]): HtmlElement | null {
  const byTid = model.elements[tid];
  const byPath = elementAtPath(model, path);
  return byTid && byTid === byPath ? byTid : null;
}

/* -------------------------------------------------------------------------- */
/* Kinds and labels                                                            */
/* -------------------------------------------------------------------------- */

/** What a selected element is, for the view context. */
export type ElementKind = 'text' | 'image' | 'shape' | 'line' | 'other';

const TEXT_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button', 'label', 'li', 'td', 'th', 'strong', 'em',
  'b', 'i', 'small', 'blockquote', 'figcaption', 'caption', 'code', 'pre', 'dt', 'dd', 'summary', 'legend',
]);
const SHAPE_TAGS = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure']);
const SVG_SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path']);
const SVG_LINES = new Set(['line', 'polyline']);

/** Template-level structure tags: they render no box of their own. */
export const STRUCTURE_TAGS: ReadonlySet<string> = new Set(['helmet', 'sc-for', 'sc-if']);

/** True when the element holds words directly (text children, no element children). */
export function holdsText(element: HtmlElement): boolean {
  const kids = elementChildren(element);
  return kids.length === 0 && textContent(element).trim().length > 0;
}

/** Classifies an element. */
export function elementKind(element: HtmlElement): ElementKind {
  const tag = element.tag;
  if (tag === 'img' || tag === 'picture' || tag === 'image' || tag === 'video') return 'image';
  if (SVG_LINES.has(tag)) return 'line';
  if (tag === 'svg') {
    // An svg whose only drawing is lines (an arrow or rule) counts as a line.
    const drawn: HtmlElement[] = [];
    const collect = (list: HtmlNode[]): void => {
      for (const child of list) {
        if (child.type !== 'element') continue;
        if (SVG_LINES.has(child.tag) || SVG_SHAPES.has(child.tag)) drawn.push(child);
        collect(child.children);
      }
    };
    collect(element.children);
    const isStroke = (child: HtmlElement): boolean =>
      SVG_LINES.has(child.tag) || (child.tag === 'path' && attributeValue(child, 'fill')?.trim() === 'none');
    if (drawn.length > 0 && drawn.every(isStroke)) return 'line';
    return 'shape';
  }
  if (SVG_SHAPES.has(tag)) return 'shape';
  if (TEXT_TAGS.has(tag) || holdsText(element)) return 'text';
  if (SHAPE_TAGS.has(tag)) return 'shape';
  return 'other';
}

/** Collapses whitespace and cuts to about `max` characters. */
export function clip(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * The label of an element: its template text cut to about 60 characters
 * (holes arrive as written), an image's `alt`, or `undefined` when it has no
 * words.
 */
export function elementLabel(element: HtmlElement): string | undefined {
  if (element.tag === 'img') {
    const alt = attributeValue(element, 'alt')?.trim();
    return alt ? clip(alt) : undefined;
  }
  if (element.tag === 'style' || element.tag === 'script' || element.tag === 'helmet') return undefined;
  const words: string[] = [];
  const collect = (list: HtmlNode[]): void => {
    for (const node of list) {
      if (node.type === 'text') words.push(node.value);
      else if (node.type === 'element' && node.tag !== 'style' && node.tag !== 'script') collect(node.children);
      if (words.join(' ').length > 200) return;
    }
  };
  collect(element.children);
  const text = clip(words.join(' '));
  return text || undefined;
}
