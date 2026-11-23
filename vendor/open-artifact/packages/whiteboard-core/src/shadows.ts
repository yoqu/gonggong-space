/**
 * Card shadows: the soft two-layer shadow under notes and other paper-like
 * cards, per color scheme.
 */

import type { ColorScheme } from './theme.ts';

/** One shadow layer. */
export interface CardShadow {
  x: number;
  y: number;
  blur: number;
  /** CSS color. */
  ink: string;
}

/** The note shadow, light and dark. */
export const NOTE_SHADOWS: Readonly<Record<ColorScheme, readonly CardShadow[]>> = {
  light: [
    { x: 0, y: 1, blur: 2, ink: 'rgba(11,11,11,.06)' },
    { x: 0, y: 2, blur: 8, ink: 'rgba(0,0,0,.08)' },
  ],
  dark: [
    { x: 0, y: 1, blur: 2, ink: 'rgba(11,11,11,.06)' },
    { x: 0, y: 2, blur: 8, ink: 'rgba(0,0,0,.24)' },
  ],
};

/** Narrowest a note may be drawn. */
export const NOTE_MIN_WIDTH = 32;

/** Shadow layers as a CSS `box-shadow` value. */
export function boxShadowCss(shadows: readonly CardShadow[]): string {
  return shadows.map((shadow) => `${[shadow.x, shadow.y, shadow.blur].map((length) => `${length}px`).join(' ')} ${shadow.ink}`).join(',');
}
