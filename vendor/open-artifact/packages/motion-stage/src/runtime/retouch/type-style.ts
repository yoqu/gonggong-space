import { TEXT_ALIGNS, TEXT_STYLE_BOUNDS } from '@open-artifact/motion-core';
import type { TextAlign } from '@open-artifact/motion-core';
import type { TypeLook } from '../../protocol.ts';

/*
 * The type of a line of words as a person sets it by hand: read off an element, held to a saved pair and written into
 * the retouch sheet. A typeface picked for one line is not laid on this stage.
 */

export const TYPE_KEYS = ['weight', 'italic', 'px', 'leading', 'tracking', 'align'] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];

/** The CSS property each is read off. */
export const TYPE_PROPS: Record<TypeKey, readonly string[]> = {
  weight: ['font-weight'],
  italic: ['font-style'],
  px: ['font-size'],
  leading: ['line-height'],
  tracking: ['letter-spacing'],
  align: ['text-align'],
};

/** How close two readings must be to count as the same: engines round differently. */
const NEAR: Partial<Record<TypeKey, number>> = { weight: 0.5, px: 0.05, leading: 0.005, tracking: 0.002 };

const within =
  (bounds: readonly [number, number]) =>
  (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= bounds[0] && value <= bounds[1];
const isAlign = (value: string): value is TextAlign => TEXT_ALIGNS.some((align) => align === value);
const round = (n: number, to: number): number => Math.round(n * to) / to;

const spacing = (cs: CSSStyleDeclaration): number => (cs.letterSpacing === 'normal' ? 0 : round(parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize), 1000));
const leadingOf = (cs: CSSStyleDeclaration): number | 'normal' => (cs.lineHeight === 'normal' ? 'normal' : round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), 1000));

/** The head of its font stack; '': none that is a plain name. */
export function familyHead(cs: CSSStyleDeclaration): string {
  const head = (cs.fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
  return /^[A-Za-z0-9 _-]{1,64}$/.test(head) ? head : '';
}

/** How the film sets the words now; null for what the record cannot hold. */
export function typeSeen(cs: CSSStyleDeclaration): TypeLook {
  const weight = cs.fontWeight === 'bold' ? 700 : cs.fontWeight === 'normal' ? 400 : parseFloat(cs.fontWeight);
  const said = cs.textAlign.replace(/^-webkit-/, '');
  const rtl = cs.direction === 'rtl';
  const align = said === 'start' ? (rtl ? 'right' : 'left') : said === 'end' ? (rtl ? 'left' : 'right') : said;
  const leading = leadingOf(cs);
  const px = round(parseFloat(cs.fontSize), 100);
  const tracking = spacing(cs);
  return {
    weight: within(TEXT_STYLE_BOUNDS.weight.was)(weight) ? weight : null,
    italic: /^(italic|oblique)/.test(cs.fontStyle) ? 1 : 0,
    px: within(TEXT_STYLE_BOUNDS.px.was)(px) ? px : null,
    leading: leading === 'normal' || within(TEXT_STYLE_BOUNDS.leading.was)(leading) ? leading : null,
    tracking: within(TEXT_STYLE_BOUNDS.tracking.was)(tracking) ? tracking : null,
    align: isAlign(align) ? align : null,
  };
}

/** Whether another text-align would move anything: the box lays out lines of its own, and has more than one, or one shorter than it is wide. */
function loose(cs: CSSStyleDeclaration, el: Element): boolean {
  if (!/^(block|inline-block|list-item|table-cell|flow-root)$/.test(cs.display) || !(el instanceof HTMLElement)) return false;
  const range = document.createRange();
  const tops: number[] = [];
  range.selectNodeContents(el);
  for (const rect of Array.from(range.getClientRects())) if (rect.width > 0 && tops.every((top) => Math.abs(top - rect.top) > rect.height / 2)) tops.push(rect.top);
  const inner = el.offsetWidth > 0 ? (el.getBoundingClientRect().width * (el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))) / el.offsetWidth : 0;
  return tops.length > 1 || range.getBoundingClientRect().width < inner * 0.98;
}

/**
 * What a change would not show on is not offered. For offering alone: a pair that was saved goes on counting by what
 * the film gives, though the line may come to fill its box at some moment.
 */
export function offerType(cs: CSSStyleDeclaration, el: Element, now: TypeLook): void {
  // Words in an svg have no line box: neither text-align nor line-height moves them.
  const art = el.namespaceURI === 'http://www.w3.org/2000/svg';
  if (art || !loose(cs, el)) now.align = null;
  if (art) now.leading = null;
  // An svg's units may put the size outside what a person may give, and the Size field could not return to it.
  if (art && now.px !== null && !within(TEXT_STYLE_BOUNDS.px.v)(now.px)) now.px = null;
}

/** What the film itself changes in the course of a stretch is not offered: compared look to look. */
export function typeHues(cs: CSSStyleDeclaration): Record<TypeKey, string> {
  return {
    weight: cs.fontWeight,
    italic: cs.fontStyle,
    px: cs.fontSize,
    leading: String(leadingOf(cs)),
    tracking: String(spacing(cs)),
    align: cs.textAlign,
  };
}

export function sameType(key: TypeKey, now: string | number | null, was: string | number): boolean {
  const near = NEAR[key];
  if (now === null) return false;
  return near === undefined || typeof now !== 'number' || typeof was !== 'number' ? now === was : Math.abs(now - was) <= near;
}

/** The declaration that lays value `v`. The record was parsed by the core, so `v` is within its bounds. */
export function typeRule(key: TypeKey, v: string | number): string {
  switch (key) {
    case 'weight':
      return 'font-weight:' + Number(v) + '!important';
    case 'italic':
      return 'font-style:' + (v ? 'italic' : 'normal') + '!important';
    case 'px':
      return 'font-size:' + Number(v) + 'px!important';
    case 'leading':
      return 'line-height:' + Number(v) + '!important';
    case 'tracking':
      return 'letter-spacing:' + Number(v) + 'em!important';
    case 'align':
      return 'text-align:' + (typeof v === 'string' && isAlign(v) ? v : 'left') + '!important';
    default: {
      const never: never = key;
      return never;
    }
  }
}
