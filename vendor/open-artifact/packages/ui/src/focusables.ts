/**
 * Which descendants a keyboard user can Tab to, and whether a box scrolls.
 * {@link ScrollBody} uses both to give a scrolling region with no tab stop
 * of its own one, so it can be scrolled from the keyboard.
 */

/** Elements that may be tab stops. */
export const TABBABLE_CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'iframe',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  "[contenteditable]:not([contenteditable='false'])",
  '[tabindex]',
].join(', ');

/** Elements that are tab stops without a `tabindex` attribute even when `tabIndex` reads -1. */
const IMPLICIT_TAB_STOP_SELECTOR = "audio[controls], video[controls], [contenteditable]:not([contenteditable='false'])";

/** True when `element` is a tab stop: enabled, shown, not hidden from assistive technology. */
export function isTabbable(element: HTMLElement): boolean {
  const stop = element.tabIndex >= 0 || (!element.hasAttribute('tabindex') && element.matches(IMPLICIT_TAB_STOP_SELECTOR));
  if (!stop || element.getAttribute('aria-hidden') === 'true' || element.matches(':disabled')) return false;
  return typeof element.checkVisibility !== 'function' || element.checkVisibility({ visibilityProperty: true });
}

/** The tab stops inside `root`, in document order. */
export function tabbableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_CANDIDATE_SELECTOR)).filter(isTabbable);
}

/** The sizes and overflow styles {@link scrollsOverflow} reads. */
export interface ScrollMetrics {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
}

/**
 * True when the content overflows an axis that scrolls (`auto` or
 * `scroll`; `visible`, `hidden` and `clip` do not). A pixel of rounding is
 * ignored.
 */
export function scrollsOverflow(metrics: ScrollMetrics): boolean {
  const scrolls = (overflow: string) => !/visible|hidden|clip/.test(overflow);
  return (
    (metrics.scrollWidth > metrics.clientWidth + 1 && scrolls(metrics.overflowX)) ||
    (metrics.scrollHeight > metrics.clientHeight + 1 && scrolls(metrics.overflowY))
  );
}
