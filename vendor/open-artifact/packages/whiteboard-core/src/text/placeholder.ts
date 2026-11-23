/**
 * Text placeholders: a hint a free text shows while it holds nothing but
 * whitespace. The hint is laid out, measured and hit like text, but it is
 * not content: it is not exported and an empty text keeping one is not
 * removed when its edit ends.
 */

import type { BoardElement, TextElement } from '../schema.ts';

/** A free text whose placeholder is showing. */
export type PlaceholderText = TextElement & { placeholder: string };

/** Smallest on-screen height, px, a text showing its placeholder is hit over. */
export const PLACEHOLDER_HIT_MIN_PX = 40;

/** True when the element is a text showing its placeholder (its text is blank after trimming). */
export function showsTextPlaceholder(element: BoardElement): element is PlaceholderText {
  return element.type === 'text' && element.placeholder !== undefined && element.placeholder !== '' && element.text.trim() === '';
}

/** What a text lays out as: its placeholder while that shows, else its text. */
export function textOrPlaceholder(element: TextElement): string {
  return showsTextPlaceholder(element) ? element.placeholder : element.text;
}
