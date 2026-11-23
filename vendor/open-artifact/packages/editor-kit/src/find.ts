/**
 * Find (⌘F) as every editor has it: a query, the matches in reading order,
 * the one shown, Enter / ⇧Enter to step (wrapping), Escape to close, and
 * the matched words highlighted with the CSS Custom Highlight API where the
 * browser has it. There is no replace.
 *
 * The editor supplies what differs: how it searches its document, where it
 * starts, how it shows a match, and which element owns a run of rendered
 * text. Pure (no DOM until a highlight is drawn).
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/** Start offsets of each case-insensitive occurrence of `needle` in `text` (no overlaps). */
export function occurrences(text: string, needle: string): number[] {
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return [];
  const out: number[] = [];
  for (let at = hay.indexOf(n); at >= 0; at = hay.indexOf(n, at + n.length)) out.push(at);
  return out;
}

/** A short excerpt around an occurrence, for the find bar and screen readers. */
export function excerpt(text: string, at: number, length: number, radius = 24): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Steps through `count` matches from `index`, wrapping around; -1 when there are none. */
export function stepIndex(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return (((index + delta) % count) + count) % count;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/** The find bar's state. */
export interface FindState<M> {
  query: string;
  matches: M[];
  /** The match shown, or -1. */
  index: number;
  setQuery(query: string): void;
  step(delta: 1 | -1): void;
  close(): void;
}

/** What an editor supplies to {@link createFind}. */
export interface FindAdapter<M> {
  /** Every match of `query` in the document as it is now (none for a blank query). */
  search(query: string): M[];
  /** The match a new search starts at (default: the first). */
  start?(matches: readonly M[]): number;
  /** Shows a match: its page or slide, its element selected and in view. */
  reveal(match: M, index: number, count: number): void;
  /** A non-blank query found nothing. */
  noResults?(): void;
  /** After the state was reset on close: hide the bar, remove highlights. */
  onClose(): void;
}

/**
 * The find bar's store. Stepping searches again first: the document may
 * have changed since the search.
 */
export function createFind<M>(adapter: FindAdapter<M>): UseBoundStore<StoreApi<FindState<M>>> {
  return create<FindState<M>>()((set, get) => ({
    query: '',
    matches: [],
    index: -1,
    setQuery(query) {
      const matches = adapter.search(query);
      const index = matches.length ? (adapter.start?.(matches) ?? 0) : -1;
      set({ query, matches, index });
      if (!query.trim()) return;
      if (matches.length) adapter.reveal(matches[index]!, index, matches.length);
      else adapter.noResults?.();
    },
    step(delta) {
      const { index, query } = get();
      const fresh = adapter.search(query);
      const next = stepIndex(Math.min(index, fresh.length - 1), fresh.length, delta);
      set({ matches: fresh, index: next });
      if (next >= 0) adapter.reveal(fresh[next]!, next, fresh.length);
    },
    close() {
      set({ query: '', matches: [], index: -1 });
      adapter.onClose();
    },
  }));
}

/* -------------------------------------------------------------------------- */
/* Highlights                                                                  */
/* -------------------------------------------------------------------------- */

/** Highlight names: every match, and the one shown. */
export const FIND_HIGHLIGHT = 'open-artifact-find';
export const FIND_HIGHLIGHT_CURRENT = 'open-artifact-find-current';

type HighlightRegistry = Map<string, unknown>;
type HighlightCtor = new (...ranges: Range[]) => unknown;

/** A window's highlight registry, when the browser has one. */
function registry(win: Window | null | undefined): { highlights: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (win as unknown as { CSS?: { highlights?: HighlightRegistry } } | null | undefined)?.CSS;
  const Highlight = (win as unknown as { Highlight?: HighlightCtor } | null | undefined)?.Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null;
}

/**
 * The highlight colors, injected at runtime: `::highlight()` is newer than
 * the build's CSS minifier, which warns about it in a stylesheet.
 */
const HIGHLIGHT_CSS = `::highlight(${FIND_HIGHLIGHT}){background-color:rgb(250 204 21 / .45);color:inherit}::highlight(${FIND_HIGHLIGHT_CURRENT}){background-color:rgb(249 115 22 / .75);color:inherit}`;

function installStyles(doc: Document): void {
  if (doc.getElementById('open-artifact-find-styles')) return;
  const style = doc.createElement('style');
  style.id = 'open-artifact-find-styles';
  style.textContent = HIGHLIGHT_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** Removes the find highlights of a document. */
export function clearFindHighlights(doc: Document): void {
  const reg = registry(doc.defaultView);
  reg?.highlights.delete(FIND_HIGHLIGHT);
  reg?.highlights.delete(FIND_HIGHLIGHT_CURRENT);
}

/** The element a run of text belongs to, as matches count occurrences. */
export interface TextOwner {
  /** Occurrences are counted per key, in document order. */
  key: string;
  /** The shown match is in this element. */
  current: boolean;
}

/**
 * Highlights `query` in the text under `root` (replacing the document's
 * find highlights). `ownerOf` names the element each text node counts
 * under (`null`: skip the text); the occurrence `currentOccurrence` of the
 * current owner gets the stronger color.
 */
export function highlightText(doc: Document, root: Node | null, query: string, ownerOf: (parent: Element) => TextOwner | null, currentOccurrence?: number): void {
  const reg = registry(doc.defaultView);
  if (!reg) return;
  reg.highlights.delete(FIND_HIGHLIGHT);
  reg.highlights.delete(FIND_HIGHLIGHT_CURRENT);
  const needle = query.trim().toLowerCase();
  if (!root || !needle) return;
  installStyles(doc);
  const all: Range[] = [];
  const strong: Range[] = [];
  const counts = new Map<string, number>();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const owner = parent ? ownerOf(parent) : null;
    if (!owner) continue;
    const text = node.textContent?.toLowerCase() ?? '';
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const n = counts.get(owner.key) ?? 0;
      counts.set(owner.key, n + 1);
      if (owner.current && n === currentOccurrence) strong.push(range);
      else all.push(range);
    }
  }
  if (all.length) reg.highlights.set(FIND_HIGHLIGHT, new reg.Highlight(...all));
  if (strong.length) reg.highlights.set(FIND_HIGHLIGHT_CURRENT, new reg.Highlight(...strong));
}
