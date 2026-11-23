/**
 * Measuring a rendered page for the PDF text layer: the words drawn, in
 * reading (document) order, and the clickable areas of web links. Lines are
 * grouped from the words by text-layer.ts.
 *
 * The editors measure differently framed pages (a slide offscreen on the
 * editor's own page, an artboard alone in a hidden frame), so where to
 * measure from, how far up "drawn" is decided, which elements hold no text
 * and how a word broken across lines is boxed are options, not guesses.
 */

import { isWebLink, type LinkArea, type Word } from './text-layer.ts';

/** Where measures are taken from, and what decides whether something is drawn. */
export interface MeasureOptions {
  /**
   * `root`: from the root element's top left (a slide offscreen); `client`:
   * client rects as they are (an unscrolled frame, where they are document
   * coordinates).
   */
  origin: 'root' | 'client';
  /**
   * The topmost element whose styles can hide what it holds (the root, for
   * a slide inside the editor's page); null checks every ancestor.
   */
  drawnWithin: Element | null;
}

/** How words are measured. */
export interface WordOptions extends MeasureOptions {
  /** Text whose parent element's local name matches is skipped (scripts, styles…). */
  skip?: RegExp;
  /**
   * The box of a word broken across lines, for each piece on one line:
   * `domrect` is a `DOMRect` from the first character's top left to the
   * last character's right, as tall as the tallest character; `extent` runs
   * from the first character's left and top to the last character's right
   * and the lowest character's bottom.
   */
  brokenWord: 'domrect' | 'extent';
}

/** How links are measured. */
export interface LinkOptions extends MeasureOptions {
  /** Leave out links that are not drawn. */
  drawnOnly: boolean;
}

const styleOf = (element: Element): CSSStyleDeclaration => element.ownerDocument.defaultView!.getComputedStyle(element);

/**
 * Is this element (and every ancestor up to `within`, or to the document
 * root when null) drawn: not `display: none`, `visibility: hidden` or
 * `opacity: 0`? Answers are kept in `cache`.
 */
export function isDrawn(element: Element, within: Element | null, cache: Map<Element, boolean> = new Map()): boolean {
  const known = cache.get(element);
  if (known !== undefined) return known;
  const style = styleOf(element);
  const own = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  const result = own && (element === within || !element.parentElement ? true : isDrawn(element.parentElement, within, cache));
  cache.set(element, result);
  return result;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The words drawn under `root`, in reading (document) order. */
export function measureWords(root: Element, options: WordOptions): Word[] {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const origin = options.origin === 'root' ? root.getBoundingClientRect() : { left: 0, top: 0 };
  const out: Word[] = [];
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const shown = new Map<Element, boolean>();
  const info = new Map<Element, { size: number; upper: boolean }>();
  const grow =
    options.brokenWord === 'domrect'
      ? (box: Box, rect: DOMRect): Box => new view.DOMRect(box.left, box.top, rect.right - box.left, Math.max(box.bottom - box.top, rect.height))
      : (box: Box, rect: DOMRect): Box => ({ left: box.left, top: box.top, right: rect.right, bottom: Math.max(box.bottom, rect.bottom) });
  const start = (rect: DOMRect): Box => (options.brokenWord === 'domrect' ? rect : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (!text.trim()) continue;
    const parent = node.parentElement;
    if (!parent || options.skip?.test(parent.localName) || !isDrawn(parent, options.drawnWithin, shown)) continue;
    let meta = info.get(parent);
    if (!meta) {
      const style = styleOf(parent);
      meta = { size: parseFloat(style.fontSize) || 16, upper: style.textTransform === 'uppercase' };
      info.set(parent, meta);
    }
    const { size, upper } = meta;
    for (const match of text.matchAll(/\S+/g)) {
      const from = match.index!;
      const end = from + match[0].length;
      const space = end < text.length;
      range.setStart(node, from);
      range.setEnd(node, end);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      const push = (value: string, rect: Box, trailing: boolean): void => {
        out.push({
          text: upper ? value.toUpperCase() : value,
          left: rect.left - origin.left,
          right: rect.right - origin.left,
          top: rect.top - origin.top,
          bottom: rect.bottom - origin.top,
          size,
          space: trailing,
        });
      };
      if (rects.length === 1) push(match[0], rects[0]!, space);
      else if (rects.length > 1) {
        // A word broken across lines: split it where its characters land.
        let piece = '';
        let box: Box | null = null;
        let offset = from;
        for (const char of match[0]) {
          range.setStart(node, offset);
          range.setEnd(node, offset + char.length);
          offset += char.length;
          const rect = range.getBoundingClientRect();
          if (box && Math.abs(rect.top - box.top) > size * 0.5) {
            push(piece, box, false);
            piece = '';
            box = null;
          }
          piece += char;
          box = box ? grow(box, rect) : start(rect);
        }
        if (box) push(piece, box, space);
      }
    }
  }
  return out;
}

/** The clickable areas of web links (http, https, mailto) under `root`. */
export function measureLinks(root: Element, options: LinkOptions): LinkArea[] {
  const origin = options.origin === 'root' ? root.getBoundingClientRect() : { left: 0, top: 0 };
  const areas: LinkArea[] = [];
  const shown = new Map<Element, boolean>();
  for (const link of Array.from(root.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    if (!isWebLink(href) || (options.drawnOnly && !isDrawn(link, options.drawnWithin, shown))) continue;
    for (const rect of Array.from(link.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) areas.push({ href, x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height });
    }
  }
  return areas;
}
