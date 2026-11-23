/**
 * The DOM half of find in page: walks the text of a subtree as it is drawn
 * (hidden parts skipped, block boundaries ending runs, spaces collapsed by
 * the element's `white-space`), turns matches into ranges, and paints them
 * with the CSS Custom Highlight API (`::highlight(wb-find)` and
 * `::highlight(wb-find-active)` in `find.css`). Where that API is missing,
 * matches still count and reveal; they are just not tinted.
 */

import { createFindRunBuilder, matchesInRun, whiteSpaceMode, type FindTextRun } from './find-text.ts';

/** The highlight of every match. */
export const FIND_HIGHLIGHT = 'wb-find';
/** The highlight of the current match. */
export const FIND_ACTIVE_HIGHLIGHT = 'wb-find-active';

/** Elements whose text is never searched. */
const SKIPPED_TAGS: ReadonlySet<string> = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'IFRAME']);
/** Elements that end a run of text when their display is unknown. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
/** Most nodes one walk visits. */
const MAX_FIND_NODES = 200_000;

/** Whether an element starts a new run of text (blocks and line breaks do). */
function breaksTextRun(element: Element, display: string): boolean {
  if (element.tagName === 'BR') return true;
  if (display === '') return BLOCK_TAGS.has(element.tagName);
  return display !== 'inline' && display !== 'contents' && display !== 'inline-block' && display !== 'inline-flex';
}

/** Whether an element's own text shows (visibility, and opacity through `checkVisibility`). */
function isFindVisible(element: Element, style: CSSStyleDeclaration | undefined): boolean {
  const visibility = style?.visibility ?? '';
  if (visibility !== '' && visibility !== 'visible') return false;
  let box: Element | null = element;
  const view = element.ownerDocument.defaultView;
  while (box !== null && (box === element ? style?.display : view?.getComputedStyle(box).display) === 'contents') box = box.parentElement;
  if (box === null || typeof box.checkVisibility !== 'function') return true;
  return box.checkVisibility({ opacityProperty: true });
}

/**
 * Walks the drawn text under `root` in runs (see `createFindRunBuilder`).
 * `skip` leaves out whole subtrees; `onRun` returns `false` to stop.
 */
export function walkTextRuns(root: Element, skip: ((element: Element) => boolean) | undefined, onRun: (run: FindTextRun<Text>) => boolean): void {
  const view = root.ownerDocument.defaultView;
  const builder = createFindRunBuilder<Text>(onRun);
  let visited = 0;
  let stopped = false;
  const visit = (element: Element): void => {
    if (stopped || SKIPPED_TAGS.has(element.tagName.toUpperCase()) || skip?.(element) === true) return;
    const style = view?.getComputedStyle(element);
    const display = style?.display ?? '';
    if (display === 'none') return;
    const breaks = element !== root && breaksTextRun(element, display);
    if (breaks) builder.end();
    let visible: boolean | undefined;
    let mode: ReturnType<typeof whiteSpaceMode> = 'none';
    for (let child = element.firstChild; child !== null && builder.going; child = child.nextSibling) {
      if (++visited > MAX_FIND_NODES) {
        stopped = true;
        return;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        if (visible === undefined) {
          visible = isFindVisible(element, style);
          mode = visible ? whiteSpaceMode(style?.whiteSpace ?? '', element.closest('pre, textarea') !== null) : 'none';
        }
        if (visible) builder.add(child as Text, (child as Text).data, mode);
      } else if (child.nodeType === Node.ELEMENT_NODE) visit(child as Element);
    }
    if (breaks) builder.end();
  };
  visit(root);
  builder.end();
}

/** The ranges of a query in the drawn text under `root`. */
export function findTextRanges(root: Element, query: string, options: { skip?: (element: Element) => boolean; limit?: number } = {}): AbstractRange[] {
  const ranges: AbstractRange[] = [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const StaticRangeClass = root.ownerDocument.defaultView?.StaticRange;
  walkTextRuns(root, options.skip, (run) => {
    for (const match of matchesInRun(run, query, limit - ranges.length)) {
      const init = { startContainer: match.start.node, startOffset: match.start.offset, endContainer: match.end.node, endOffset: match.end.offset };
      if (typeof StaticRangeClass === 'function') ranges.push(new StaticRangeClass(init));
      else {
        const range = root.ownerDocument.createRange();
        range.setStart(init.startContainer, init.startOffset);
        range.setEnd(init.endContainer, init.endOffset);
        ranges.push(range);
      }
    }
    return ranges.length < limit;
  });
  return ranges;
}

/** Where a range is drawn now (`null` once its text left the page). */
export function rangeRect(range: AbstractRange): DOMRect | null {
  const start = range.startContainer;
  const doc = start.ownerDocument;
  if (!doc || !start.isConnected || !range.endContainer.isConnected) return null;
  try {
    const live = doc.createRange();
    live.setStart(start, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
    return live.getBoundingClientRect();
  } catch {
    return null;
  }
}

/** The page's highlight registry, when the browser has one. */
function highlightRegistry(): { set(name: string, value: unknown): void; delete(name: string): void } | undefined {
  const css = (globalThis as { CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } } }).CSS;
  const Highlight = (globalThis as { Highlight?: unknown }).Highlight;
  return css?.highlights !== undefined && typeof Highlight === 'function' ? css.highlights : undefined;
}

/** Tints every match, the current one brighter. */
export function paintFindHighlights(ranges: readonly AbstractRange[], current: AbstractRange | null): void {
  const registry = highlightRegistry();
  if (!registry) return;
  const HighlightClass = (globalThis as unknown as { Highlight: new (...ranges: AbstractRange[]) => unknown }).Highlight;
  registry.set(FIND_HIGHLIGHT, new HighlightClass(...ranges.filter((range) => range !== current)));
  if (current) registry.set(FIND_ACTIVE_HIGHLIGHT, new HighlightClass(current));
  else registry.delete(FIND_ACTIVE_HIGHLIGHT);
}

/** Takes the tints away. */
export function clearFindHighlights(): void {
  const registry = highlightRegistry();
  registry?.delete(FIND_HIGHLIGHT);
  registry?.delete(FIND_ACTIVE_HIGHLIGHT);
}

/** One animation frame. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Whether two rectangles overlap. */
export function rectsOverlap(a: DOMRectReadOnly, b: DOMRectReadOnly): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}
