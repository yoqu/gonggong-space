/**
 * Find in the deck (⌘F; ⌘G / F3 next, ⇧⌘G / ⇧F3 previous): every text of
 * every slide in deck order, matched case-insensitively. Each match shows
 * its slide and selects its element; the matched words on stage are
 * highlighted with the CSS Custom Highlight API where the browser has it.
 * There is no replace. The store and the highlighting are
 * `@open-artifact/editor-kit`.
 */

import { nodeText, walkNodes, type NodePath, type Slide, type SlideNode } from '@open-artifact/slides-core';
import { clearFindHighlights, createFind, highlightText } from '@open-artifact/editor-kit';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';

/** One match: an element of a slide, and which occurrence in its text. */
export interface FindMatch {
  slideId: string;
  path: NodePath;
  /** Occurrence of the query in the element's text (0-based). */
  occurrence: number;
}

/** The text an element is searched by (tables: all cells). */
function searchable(node: SlideNode): string {
  if (node.kind === 'box') return '';
  return nodeText(node);
}

/** Every match of `query` across the deck, in order. */
export function findMatches(query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const state = useDeck.getState();
  const out: FindMatch[] = [];
  for (const id of deckOrder(state)) {
    const slide: Slide | undefined = state.slides[id]?.slide;
    if (!slide) continue;
    walkNodes(slide, (node, path) => {
      const text = searchable(node).toLowerCase();
      let at = text.indexOf(needle);
      let occurrence = 0;
      while (at >= 0) {
        out.push({ slideId: id, path, occurrence: occurrence++ });
        at = text.indexOf(needle, at + needle.length);
      }
    });
  }
  return out;
}

/** Shows a match: its slide on stage, its element selected. */
function reveal(match: FindMatch): void {
  const view = useView.getState();
  if (view.mode !== 'edit') view.setMode('edit');
  if (view.current !== match.slideId) view.showSlide(match.slideId);
  useView.getState().select([match.path]);
}

/** The find bar's state (`createFind`, `@open-artifact/editor-kit`). */
export const useFind = createFind<FindMatch>({
  search: findMatches,
  // Start at the first match on or after the current slide.
  start(matches) {
    const order = deckOrder(useDeck.getState());
    const current = useView.getState().current;
    const from = current ? order.indexOf(current) : 0;
    return Math.max(0, matches.findIndex((m) => order.indexOf(m.slideId) >= from));
  },
  reveal,
  onClose() {
    useView.getState().toggle('findOpen', false);
    clearHighlights();
  },
});

/** Removes the find highlights. */
export function clearHighlights(): void {
  clearFindHighlights(document);
}

/**
 * Highlights the query inside the rendered slide `root`. The current match
 * (element path key and occurrence) gets the stronger highlight.
 */
export function highlightMatches(root: HTMLElement | null, query: string, current?: { pathKey: string; occurrence: number }): void {
  highlightText(
    root?.ownerDocument ?? document,
    root,
    query,
    (parent) => {
      const key = (parent.closest('[data-open-artifact-path]') as HTMLElement | null)?.dataset.openArtifactPath ?? '';
      return { key, current: current !== undefined && key === current.pathKey };
    },
    current?.occurrence,
  );
}
