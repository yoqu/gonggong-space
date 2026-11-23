/**
 * Shrink-to-fit for squeezed text.
 *
 * A text element, list, text box or table whose box is smaller than its
 * content (a fixed height, or squeezed by its flex parent) shrinks all of its
 * text by one factor, `--open-artifact-fit`, down to {@link FIT_FLOOR} (60% of the base
 * size, never under 8px). If the text still does not fit at the floor, the
 * box clips. `data-fit="none"` keeps the size (and overflows); `data-fit="grow"`
 * is never squeezed in the first place (its flex-shrink is 0).
 *
 * The factor is found by measuring: the element is laid out with its natural
 * height at a trial factor and compared with the height it actually has.
 */

import { useLayoutEffect, useEffect, useRef, type RefObject } from 'react';
import { FIT_FLOOR, type FitMode } from '@open-artifact/slides-core';

/** The custom property every scaled font size multiplies by. */
export const FIT_VAR = '--open-artifact-fit';

/** Remembers an element's own font size while fitting restates it. */
const FONT_ATTR = 'data-open-artifact-fs';

/** Slack in px under which content counts as fitting. */
const EPSILON = 0.5;
/** Bisection steps (precision ≈ 0.4% of the range). */
const STEPS = 7;

/** Height the element would take with its content laid out freely, at `scale`. */
function naturalHeight(el: HTMLElement, scale: number): number {
  if (scale === 1) el.style.removeProperty(FIT_VAR);
  else el.style.setProperty(FIT_VAR, String(scale));
  const saved = {
    flexGrow: el.style.flexGrow,
    flexShrink: el.style.flexShrink,
    flexBasis: el.style.flexBasis,
    height: el.style.height,
    minHeight: el.style.minHeight,
    maxHeight: el.style.maxHeight,
  };
  Object.assign(el.style, { flexGrow: '0', flexShrink: '0', flexBasis: 'auto', height: 'auto', minHeight: '0', maxHeight: 'none' });
  // Measure the unconstrained line boxes. scrollHeight includes glyph ink
  // outside a tight line-height and would shrink a heading that already fits.
  const height = el.clientHeight;
  Object.assign(el.style, saved);
  return height;
}

/** The element's base font size in px (at factor 1). */
function baseFontSize(el: HTMLElement): number {
  el.style.removeProperty(FIT_VAR);
  const size = parseFloat(getComputedStyle(el).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 32;
}

/**
 * Fits one element now. Returns the factor applied (1 when the text fits)
 * and whether it had to clip.
 */
export function fitElement(el: HTMLElement): { scale: number; clipped: boolean } {
  el.removeAttribute('data-open-artifact-clip');
  el.style.removeProperty(FIT_VAR);
  if (el.hasAttribute('data-open-artifact-basis')) {
    el.style.flexBasis = '';
    el.removeAttribute('data-open-artifact-basis');
  }
  if (el.hasAttribute(FONT_ATTR)) {
    el.style.fontSize = el.getAttribute(FONT_ATTR) ?? '';
    el.removeAttribute(FONT_ATTR);
  }
  const available = el.clientHeight;
  if (available <= 0) return { scale: 1, clipped: false };
  const natural = naturalHeight(el, 1);
  if (natural <= available + EPSILON) {
    el.style.removeProperty(FIT_VAR);
    return { scale: 1, clipped: false };
  }
  // A squeezed item of a flex column gets its share from its content size;
  // pin that basis so shrinking the text does not shrink the share too.
  const parent = el.parentElement ? getComputedStyle(el.parentElement) : undefined;
  if (parent && parent.display.endsWith('flex') && parent.flexDirection.startsWith('column') && !el.style.flexBasis && !el.style.height) {
    el.style.flexBasis = `${natural}px`;
    el.setAttribute('data-open-artifact-basis', '');
  }
  const base = baseFontSize(el);
  // An inherited size arrives as a computed px value that the factor cannot
  // reach; restate it on the element in terms of the factor.
  if (!el.style.fontSize.includes(FIT_VAR)) {
    el.setAttribute(FONT_ATTR, el.style.fontSize);
    el.style.fontSize = `calc(${base}px * var(${FIT_VAR}, 1))`;
  }
  const floor = Math.min(1, Math.max(FIT_FLOOR.ratio, FIT_FLOOR.px / base));
  if (naturalHeight(el, floor) > available + EPSILON) {
    el.style.setProperty(FIT_VAR, String(floor));
    el.setAttribute('data-open-artifact-clip', '');
    return { scale: floor, clipped: true };
  }
  let low = floor;
  let high = 1;
  for (let i = 0; i < STEPS; i++) {
    const mid = (low + high) / 2;
    if (naturalHeight(el, mid) <= available + EPSILON) low = mid;
    else high = mid;
  }
  const scale = Math.round(low * 1000) / 1000;
  el.style.setProperty(FIT_VAR, String(scale));
  return { scale, clipped: false };
}

/**
 * Keeps an element's text fitted to its box: refits after every render that
 * changes `deps`, when the box or its parent resizes, and when web fonts
 * finish loading.
 */
export function useTextFit(ref: RefObject<HTMLElement | null>, mode: FitMode | undefined, deps: readonly unknown[]): void {
  const active = mode !== 'none';
  const run = useRef<() => void>(() => undefined);
  run.current = () => {
    const el = ref.current;
    if (!el) return;
    if (!active) {
      el.style.removeProperty(FIT_VAR);
      el.removeAttribute('data-open-artifact-clip');
      return;
    }
    fitElement(el);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => run.current(), [active, ...deps]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let width = el.offsetWidth;
    let height = el.clientHeight;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (Math.abs(el.offsetWidth - width) > EPSILON || Math.abs(el.clientHeight - height) > EPSILON) {
              run.current();
              width = el.offsetWidth;
              height = el.clientHeight;
            }
          });
    observer?.observe(el);
    if (el.parentElement) observer?.observe(el.parentElement);
    const fonts = el.ownerDocument.fonts;
    const refit = (): void => run.current();
    fonts?.addEventListener('loadingdone', refit);
    let alive = true;
    if (fonts && fonts.status !== 'loaded') void fonts.ready.then(() => alive && refit());
    return () => {
      alive = false;
      observer?.disconnect();
      fonts?.removeEventListener('loadingdone', refit);
    };
  }, [ref, active]);
}
