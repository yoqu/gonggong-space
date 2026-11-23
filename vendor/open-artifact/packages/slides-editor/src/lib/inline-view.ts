/**
 * The read-only view another page frames a deck in (at `#view-inline`):
 * which slides it pages through and where it stays when the deck changes.
 */

import { INLINE_VIEW_FRAGMENT } from '@open-artifact/protocol';

/** The page is framed by another and was opened at the inline fragment. */
export function isInlineView(win: { parent: unknown; location: { hash: string } }): boolean {
  return win.parent !== win && win.location.hash === INLINE_VIEW_FRAGMENT;
}

/** The slides to page through: the ones that are not skipped, or all of them when every slide is. */
export function inlineSlides(order: readonly string[], skipped: (id: string) => boolean): string[] {
  const shown = order.filter((id) => !skipped(id));
  return shown.length > 0 ? shown : [...order];
}

/**
 * The slide to show after the list changed: the same one while it is still
 * there, otherwise the one that took its place (the last when the list got shorter).
 */
export function slideAfterChange(slides: readonly string[], current: string | null, index: number): string | null {
  if (current && slides.includes(current)) return current;
  if (slides.length === 0) return null;
  return slides[Math.min(Math.max(index, 0), slides.length - 1)]!;
}

/** What the pager says, and what screen readers hear when the slide changes. */
export function pagerText(index: number, count: number, title: string | undefined): { counter: string; announcement: string } {
  const counter = `${index + 1} / ${count}`;
  const place = `Slide ${index + 1} of ${count}`;
  return { counter, announcement: title ? `${place}: ${title}` : place };
}
