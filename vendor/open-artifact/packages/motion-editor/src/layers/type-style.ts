/**
 * The arithmetic of the text style controls: the range each number offers, letter spacing shown in pixels and kept in
 * ems, and which weight Bold turns a line to. Pure.
 */

import { TEXT_STYLE_BOUNDS, TEXT_STYLE_UI_BOUNDS } from '@open-artifact/motion-core';

export type TypeNumber = 'px' | 'leading' | 'tracking';

export const roundTo = (value: number, per: number): number => Math.round(value * per) / per;

/** How finely each number is kept. */
const KEPT: Readonly<Record<TypeNumber, number>> = { px: 10, leading: 100, tracking: 1e4 };
/** The step of each control. */
export const TYPE_STEPS: Readonly<Record<TypeNumber, number>> = { px: 1, leading: 0.05, tracking: 0.5 };

export interface TypeRange {
  /** The ends the control offers, in what it shows (letter spacing in pixels). */
  min: number;
  max: number;
  /** A value the control gave, as the record keeps it (letter spacing in ems), held to the range. */
  keep(shown: number): number;
}

/**
 * The range a number offers: what the panel offers, widened to take in the film's own value, and never past what the
 * record may hold. `filmValue`: the film's own value; `height`: the film's height (no font size beyond it);
 * `per`: shown units per kept unit (the font size in pixels, for letter spacing).
 */
export function typeRange(key: TypeNumber, filmValue: number | 'normal' | null, height: number, per = 1): TypeRange {
  const base = typeof filmValue === 'number' ? filmValue : TEXT_STYLE_UI_BOUNDS[key][0];
  const top = key === 'px' ? Math.max(TEXT_STYLE_UI_BOUNDS.px[0], Math.min(TEXT_STYLE_UI_BOUNDS.px[1], height)) : TEXT_STYLE_UI_BOUNDS[key][1];
  const lo = Math.max(TEXT_STYLE_BOUNDS[key].v[0], Math.min(TEXT_STYLE_UI_BOUNDS[key][0], base));
  const hi = Math.min(TEXT_STYLE_BOUNDS[key].v[1], Math.max(top, base));
  const scale = key === 'leading' ? 100 : 10;
  const unit = per > 0 ? per : 1;
  return {
    min: Math.floor(roundTo(lo * unit * scale, 100)) / scale,
    max: Math.ceil(roundTo(hi * unit * scale, 100)) / scale,
    keep: (shown) => Math.min(hi, Math.max(lo, roundTo(shown / unit, KEPT[key]))),
  };
}

/** Letter spacing in pixels, as the control shows it: ems times the font size, to a tenth. */
export const trackingPx = (tracking: number, px: number): number => roundTo(tracking * px, 10) || 0;

/** What Bold does on a line: whether it is pressed, and the weight it turns the line to (null: no weight to turn to). */
export interface BoldToggle {
  pressed: boolean;
  to: number;
}

/**
 * Bold, given the weight on show, the film's own weight and the weights the font has. Pressed at 600 or more (or just
 * above the lightest weight, for a font whose weights are all heavy); pressing it goes to the film's own weight when
 * that is on the other side, else to the weight nearest 700 (or, letting go, 400).
 */
export function boldToggle(shown: number | null, filmWeight: number | null, weights: readonly number[]): BoldToggle | null {
  if (shown === null || weights.length === 0) return null;
  const all = [...new Set(weights)];
  const threshold = Math.max(600, Math.min(...all) + 1);
  const pressed = shown >= threshold;
  const other = all.filter((weight) => (pressed ? weight < threshold : weight >= threshold));
  if (other.length === 0) return null;
  if (filmWeight !== null && other.includes(filmWeight)) return { pressed, to: filmWeight };
  const aim = pressed ? 400 : 700;
  const to = other.reduce((best, weight) => (Math.abs(weight - aim) < Math.abs(best - aim) ? weight : best));
  return { pressed, to };
}

/** A color the ink is invisible in (alpha 00): no color control for it. */
export const isClearInk = (ink: string): boolean => /^#[0-9a-f]{6}00$/i.test(ink);
