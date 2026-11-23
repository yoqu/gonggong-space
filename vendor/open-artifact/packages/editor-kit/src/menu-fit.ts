/** The inline style {@link menuFit} gives a popup. */
export interface MenuFitStyle {
  maxHeight: string;
  overflowY: 'auto';
}

/**
 * Keeps a menu inside a short window: a popup with no height limit of its
 * own scrolls, headings and all, within the height Base UI measured free
 * next to its trigger (`--available-height`). A popup whose classes set a
 * `max-h-*` keeps that limit.
 */
export function menuFit(className?: string): MenuFitStyle | undefined {
  return className && /(^|\s)max-h-/.test(className) ? undefined : { maxHeight: 'var(--available-height)', overflowY: 'auto' };
}
