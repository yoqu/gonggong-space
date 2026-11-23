/**
 * Find in page over the words on the board: the text of notes, shapes,
 * free text, section titles and table cells, item by item in reading
 * order. Labels and chrome are left out (screen-reader text, the agent
 * chip, a note's "last edited by", an empty title's hint), and so is an
 * item whose text is being edited.
 *
 * Revealing a match first brings its item into view, then, two frames
 * later, moves the view by the least amount that shows the match itself
 * clear of the chrome and of the find bar.
 */

import { orderElementsForReading, type ElementId } from '@open-artifact/whiteboard-core';
import { screenToBoard } from '../lib/camera.ts';
import { elementDomId } from '../elements/item.tsx';
import { revealBox, revealElements } from '../services/navigation.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import type { FindAdapter, FindMatch } from './find-controller.ts';
import { clearFindHighlights, findTextRanges, nextFrame, paintFindHighlights, rangeRect, rectsOverlap } from './find-dom.ts';

/** The parts of an item that hold its words. */
export const FIND_WORDS_SELECTOR = '.wb-note-paper, .wb-shape-text, .wb-el.wb-text, .wb-container-title-text, .wb-table td, .wb-table th';
/** Parts inside them that are not its words. */
export const FIND_SKIP_SELECTOR = '.wb-sr, .sr-only, [aria-hidden="true"], [contenteditable]:not([contenteditable="false"]), .wb-note-author, .wb-container-hint, [data-wb-chrome]';
/** The attribute that marks the find bar. */
export const FIND_BAR_ATTR = 'data-wb-find';
/** Room kept between the find bar and a match revealed under it, px. */
const BAR_GAP_PX = 8;

const skipNonWords = (element: Element): boolean => element.matches(FIND_SKIP_SELECTOR);

/** The ranges of a query in one item's words. */
export function findWordRanges(item: Element, query: string): AbstractRange[] {
  const holders = item.matches(FIND_WORDS_SELECTOR) ? [item] : [...item.querySelectorAll(FIND_WORDS_SELECTOR)];
  return holders.flatMap((holder) => findTextRanges(holder, query, { skip: skipNonWords }));
}

/** An item's view, unless its text is being edited. */
function itemNode(id: ElementId): Element | null {
  const editing = useSelection.getState().editing;
  if (editing !== null && editing.id === id) return null;
  return document.getElementById(elementDomId(id));
}

/** The board's surface (the find bar and chrome are measured against it). */
function surfaceNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.wb-surface');
}

/** The part of the view not under the chrome, in client pixels. */
function clearView(): DOMRect | null {
  const surface = surfaceNode()?.getBoundingClientRect();
  if (!surface) return null;
  const { insets } = useCamera.getState();
  return new DOMRect(surface.left + insets.left, surface.top + insets.top, Math.max(0, surface.width - insets.left - insets.right), Math.max(0, surface.height - insets.top - insets.bottom));
}

/** Moves the view by the least amount that shows a client rectangle. */
function showClientRect(rect: DOMRect): void {
  const surface = surfaceNode()?.getBoundingClientRect();
  if (!surface) return;
  const { camera } = useCamera.getState();
  const corner = screenToBoard(camera, { x: rect.left - surface.left, y: rect.top - surface.top });
  revealBox({ x: corner.x, y: corner.y, w: rect.width / camera.zoom, h: rect.height / camera.zoom });
}

/** Creates the board's find adapter. `subscribe` hears when the searched words may have changed. */
export function createBoardFindAdapter(subscribe: (listener: () => void) => () => void): FindAdapter {
  let query = '';
  const rangesFor = (id: ElementId): AbstractRange[] => {
    const node = itemNode(id);
    return node ? findWordRanges(node, query) : [];
  };
  return {
    search(text) {
      query = text;
      if (text === '') return [];
      const matches: FindMatch[] = [];
      for (const element of orderElementsForReading(useBoard.getState().board.content.elements, currentMeasures())) {
        const node = itemNode(element.id);
        if (!node) continue;
        const count = findWordRanges(node, text).length;
        for (let nth = 0; nth < count; nth++) matches.push({ key: `${element.id}|${nth}`, id: element.id, nth });
      }
      return matches;
    },
    async reveal(match, signal) {
      const element = useBoard.getState().byId.get(match.id);
      if (!element) return false;
      revealElements([element]);
      await nextFrame();
      await nextFrame();
      if (signal.aborted) return undefined;
      const range = rangesFor(match.id)[match.nth];
      if (range === undefined) return false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const rect = rangeRect(range);
        const view = clearView();
        if (rect === null || view === null) return undefined;
        const bar = document.querySelector(`[${FIND_BAR_ATTR}]`)?.getBoundingClientRect() ?? null;
        const outside = rect.left < view.left || rect.right > view.right || rect.top < view.top || rect.bottom > view.bottom;
        if (!outside && (bar === null || !rectsOverlap(rect, bar))) return undefined;
        const underBar = bar !== null && rect.right > bar.left && rect.left < bar.right ? Math.max(0, bar.bottom + BAR_GAP_PX - view.top) : 0;
        showClientRect(new DOMRect(rect.left, rect.top - underBar, rect.width, rect.height + underBar));
        await nextFrame();
        if (signal.aborted) return undefined;
      }
      return undefined;
    },
    paint(matches, current) {
      const ranges: AbstractRange[] = [];
      let currentRange: AbstractRange | null = null;
      const cache = new Map<ElementId, AbstractRange[]>();
      matches.forEach((match, index) => {
        let found = cache.get(match.id);
        if (found === undefined) cache.set(match.id, (found = rangesFor(match.id)));
        const range = found[match.nth];
        if (range === undefined) return;
        ranges.push(range);
        if (index === current) currentRange = range;
      });
      paintFindHighlights(ranges, currentRange);
    },
    clear() {
      query = '';
      clearFindHighlights();
    },
    subscribe,
  };
}
