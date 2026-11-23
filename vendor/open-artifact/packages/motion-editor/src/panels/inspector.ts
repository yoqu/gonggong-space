/**
 * Marks the page root for the compact inspector layout. `styles.css` keys the density of shared fields, tabs and
 * sections on this root attribute; the editor's own parts are styled compact directly.
 */

export const INSPECTOR_ATTRIBUTE = 'data-inspector-v1';

/** Marks the page's root for the compact inspector; returns a function that unmarks it. */
export function markInspector(root: HTMLElement = document.documentElement): () => void {
  root.setAttribute(INSPECTOR_ATTRIBUTE, '');
  return () => root.removeAttribute(INSPECTOR_ATTRIBUTE);
}
