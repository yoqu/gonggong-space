import { inOwnColors } from '../snapshot/serialize.ts';
import { PAINT, PAINT_KEYS, SHAPE, isArtWords, isPart, styleOf } from '../layers/parts.ts';
import type { PaintKey } from '../layers/parts.ts';
import { TYPE_KEYS, TYPE_PROPS, sameType, typeHues, typeSeen } from './type-style.ts';
import type { TypeKey } from './type-style.ts';

/** What a person may set by hand that this stage lays. A picked typeface is not among them. */
export type Key = 'fill' | 'ink' | 'size' | 'radius' | 'hidden' | TypeKey | PaintKey;
export const KEYS: readonly Key[] = ['fill', 'ink', 'size', 'radius', 'hidden', ...TYPE_KEYS, ...PAINT_KEYS];
/** What only a box that paints has, and what only a line of words has. */
export const OF_BOX: readonly Key[] = ['fill', 'radius'];
export const OF_WORDS: readonly Key[] = ['ink', ...TYPE_KEYS];
export const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
export type Corner = (typeof CORNERS)[number];

export type Value = string | number;
/** Each value as computed now; null: nothing the record can hold, or that a change would show on. */
export type Values = Record<Key, Value | null>;
export interface Seen {
  values: Values;
  /** The corners the film rounds. */
  round: Corner[];
}

export const isPaintKey = (key: Key): key is PaintKey => key === 'svgfill' || key === 'svgstroke';
export const isTypeKey = (key: Key): key is TypeKey => TYPE_KEYS.some((each) => each === key);

/**
 * Set while the style attribute on the element is a trial's, or a trial took the film's off: an !important there
 * is then not the film's.
 */
export const trial = { on: false };

let dot: CanvasRenderingContext2D | null = null;

/** A computed colour as #rrggbb or #rrggbbaa; null: none a picker can show. What is not spelled rgb() is painted on one pixel and read back. */
export function hex(colour: string): string | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(colour || '');
  let p: ArrayLike<number> | null = m ? [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 255 : +m[4] * 255] : null;
  if (!p && colour) {
    try {
      dot = dot ?? document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!dot) return null;
      dot.canvas.width = dot.canvas.height = 1;
      dot.fillStyle = '#000';
      dot.fillStyle = colour;
      dot.fillRect(0, 0, 1, 1);
      p = dot.getImageData(0, 0, 1, 1).data;
    } catch {
      return null;
    }
  }
  if (!p) return null;
  let out = '#';
  for (let i = 0; i < ((p[3] ?? 255) >= 254.5 ? 3 : 4); i++) out += ('0' + Math.round(Math.max(0, Math.min(255, p[i] ?? 0))).toString(16)).slice(-2);
  return out;
}

export const inkOf = (cs: CSSStyleDeclaration, el: Element): string => (!isArtWords(el) ? cs.color : /^(none|url|context)/i.test(cs.fill) ? '' : cs.fill);

function cornersOf(cs: CSSStyleDeclaration): string[] {
  return CORNERS.map((corner) => cs.getPropertyValue('border-' + corner + '-radius'));
}

/** A shape's fill and stroke, each as one plain colour; null where hex() would read black or the film's own !important wins. */
function painted(cs: CSSStyleDeclaration, el: Element, values: Values): void {
  const shape = isPart(el) && SHAPE.test(el.tagName);
  const style = styleOf(el);
  for (const key of PAINT_KEYS) {
    const property = PAINT[key];
    const paint = cs.getPropertyValue(property) || 'none';
    const pinned = !trial.on && !!style && !!style.getPropertyPriority(property);
    values[key] = !shape || (property === 'fill' && /^line$/i.test(el.tagName)) || /^(none|url|context)/i.test(paint) || pinned ? null : hex(paint);
  }
}

/**
 * The element's look as computed now. fill: a gradient counts as its first colour; over a picture there is none.
 * size: the scale property, which does nothing to an inline box but a picture's. radius: its roundest corner, not
 * where the film gives it in percent.
 */
function readLook(cs: CSSStyleDeclaration, el: Element): Seen {
  const art = cs.backgroundImage === 'none' ? '' : cs.backgroundImage;
  const first = /(rgba?\([^)]*\)|color\([^)]*\))/i.exec(art);
  const radii = cornersOf(cs);
  const scale = isNaN(parseFloat(cs.scale)) ? 1 : parseFloat(cs.scale);
  const style = styleOf(el);
  const type = typeSeen(cs);
  const values: Values = {
    fill: /url\(/i.test(art) ? null : hex(first ? first[1]! : cs.backgroundColor),
    ink: hex(inkOf(cs, el)),
    size: (cs.display === 'inline' && !/^(img|svg|canvas|video)$/i.test(el.tagName)) || scale < 0.1 || scale > 4 ? null : scale,
    radius: radii.some((value) => /%/.test(value)) ? null : Math.min(2000, Math.max(...radii.map((value) => parseFloat(value) || 0))),
    hidden: style && (style.visibility === 'visible' || style.getPropertyPriority('visibility')) ? null : 0,
    weight: type.weight,
    italic: type.italic,
    px: type.px,
    leading: type.leading,
    tracking: type.tracking,
    align: type.align,
    svgfill: null,
    svgstroke: null,
  };
  painted(cs, el, values);
  return { values, round: CORNERS.filter((_, i) => parseFloat(radii[i] ?? '0') > 0) };
}

/** How the film draws the element now, under its own colours. */
export const seenLook = (cs: CSSStyleDeclaration, el: Element): Seen => inOwnColors(() => readLook(cs, el));

/** Compared look to look for the film's own changes; called inside `inOwnColors`. */
export function hues(cs: CSSStyleDeclaration, el: Element): Partial<Record<Key, string>> {
  return {
    fill: cs.backgroundColor + cs.backgroundImage,
    ink: inkOf(cs, el),
    radius: cornersOf(cs).join(''),
    size: cs.scale,
    ...typeHues(cs),
  };
}

/** Engines round a mixed colour differently. */
export function alike(a: string | null, b: string | null): boolean {
  if (a === null || b === null || a.length !== b.length) return false;
  for (let i = 1; i < a.length; i += 2) if (Math.abs(parseInt(a.substr(i, 2), 16) - parseInt(b.substr(i, 2), 16)) > 2) return false;
  return true;
}

export function same(key: Key, now: Value | null, was: Value): boolean {
  if (key === 'fill' || key === 'ink' || isPaintKey(key)) return alike(typeof now === 'string' ? now : null, String(was).toLowerCase());
  if (key === 'size') return typeof now === 'number' && typeof was === 'number' && Math.abs(now - was) < 0.005;
  if (key === 'radius') return typeof now === 'number' && typeof was === 'number' && Math.abs(now - was) <= 0.5;
  if (key === 'hidden') return now === was;
  return sameType(key, now, was);
}

const PROPS: Partial<Record<Key, readonly string[]>> = {
  fill: ['background-color', 'background-image'],
  ink: ['color'],
  size: ['scale'],
  radius: CORNERS.map((corner) => 'border-' + corner + '-radius'),
  svgfill: ['fill'],
  svgstroke: ['stroke'],
};

/** The CSS properties a key is read off; the ink of an svg text is its fill. */
export function propsOf(key: Key, el: Element): readonly string[] {
  if (key === 'ink' && isArtWords(el)) return ['fill'];
  if (isTypeKey(key)) return TYPE_PROPS[key];
  return PROPS[key] ?? [];
}
