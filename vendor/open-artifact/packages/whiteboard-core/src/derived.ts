/**
 * Derived elements: elements the page computes from stored ones (a sticker
 * that followed its moved host, an element whose groups were rewritten)
 * remember the element that should be stored instead, so saving a board
 * does not write positions that only exist for display.
 *
 * The codec and history consult {@link persistedElementByDerived} when they
 * turn an element back into a stored record.
 */

import { normalizeElement } from './normalize.ts';
import type { BoardElement } from './schema.ts';

/** Derived element → the element to store in its place. */
export const persistedElementByDerived = new WeakMap<BoardElement, BoardElement>();

/** The element to store for a (possibly derived) element. */
export function persistedElementOf(element: BoardElement): BoardElement {
  return persistedElementByDerived.get(element) ?? element;
}

/** Normalizes an element (as the board would on load), keeping it as is when it does not normalize. */
export function normalizeElementOrKeep<T extends BoardElement>(element: T): T {
  return (normalizeElement(element, new Set()) as T | undefined) ?? element;
}
