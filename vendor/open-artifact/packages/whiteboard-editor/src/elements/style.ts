/**
 * Inline styles shared by the element views: rotation, text size and
 * weight, alignment and the hanging indent of lists. Colors come from the
 * core theme; layout rules live in `elements.css`.
 */

import type { CSSProperties } from 'react';
import { DEFAULT_TEXT_STYLE, HANG_CSS_VAR, TEXT_SIZE_STYLES, elementTurn, type BoardElement, type TextAlign, type TextSize } from '@open-artifact/whiteboard-core';

/** Inline style with CSS custom properties. */
export type ViewStyle = CSSProperties & { [variable: `--${string}`]: string | number | undefined };

/** The CSS rotation of an element (`rotate` plus `--wb-turn` for overlays); empty when unturned. */
export function rotationStyle(element: BoardElement): ViewStyle {
  const turn = elementTurn(element);
  return turn === 0 ? {} : { rotate: `${turn}deg`, '--wb-turn': `${turn}deg` };
}

/** The font of a note, shape or table: its size, or the default 15 px text. */
export interface PaperFont {
  px: number;
  weight: number;
  bold: number;
}

/** The font of text with an optional size (notes and shapes default to 15 px). */
export function paperFont(size: TextSize | undefined): PaperFont {
  if (size === undefined) return { px: DEFAULT_TEXT_STYLE.px, weight: DEFAULT_TEXT_STYLE.weight, bold: 700 };
  const style = TEXT_SIZE_STYLES[size];
  return { px: style.px, weight: style.weight, bold: style.bold };
}

/** Font size, weight and bold weight as inline style. */
export function fontStyle(font: PaperFont): ViewStyle {
  return { fontSize: font.px, fontWeight: font.weight, '--wb-bold': font.bold };
}

/** Text alignment as the variables `.wb-shape-label` and lists read. */
export function alignStyle(align: TextAlign): ViewStyle {
  return { '--wb-align': align, '--wb-justify': align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', textAlign: align };
}

/** The hanging indent of list text, in `ch` (`undefined` when there are no lists). */
export function hangStyle(hang: number | undefined): ViewStyle | undefined {
  return hang === undefined ? undefined : { [HANG_CSS_VAR]: `${Math.round(hang * 100) / 100}ch` };
}

/** Rounds a board coordinate for CSS (avoids long fractions in the DOM). */
export function px(value: number): number {
  return Math.round(value * 100) / 100;
}
