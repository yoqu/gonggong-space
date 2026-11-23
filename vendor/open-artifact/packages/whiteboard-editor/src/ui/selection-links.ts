/**
 * The web links a selected item offers to open, shared by the selection
 * bar's Open link button and the More actions menu: a link card's address,
 * a linked picture's, or the links written in a note, shape or text.
 * Either control offers one link only; with several, a click on the one
 * wanted opens it.
 */

import { markdownLinkUrls, type BoardElement } from '@open-artifact/whiteboard-core';
import { boardLinkTarget } from '../elements/links.ts';

/** The web links of one item, in reading order, without repeats. */
export function elementLinks(element: BoardElement | undefined): string[] {
  switch (element?.type) {
    case 'link': {
      const target = boardLinkTarget(element.href);
      return target ? [target] : [];
    }
    case 'image':
      return element.href !== undefined ? [element.href] : [];
    case 'note':
    case 'shape':
    case 'text':
      return [...markdownLinkUrls(element.text)];
    default:
      return [];
  }
}

/** The links a selection offers: those of its only item (none for several items). */
export function selectionLinks(selected: readonly BoardElement[]): string[] {
  return selected.length === 1 ? elementLinks(selected[0]) : [];
}
