import { ei, eo, seg } from './math.ts';

export interface TextFxOptions {
  stagger?: number;
  dur?: number;
  dx?: number;
}

const WORDS = new WeakMap<Element, HTMLSpanElement[]>();

/** Splits an element's text into one inline-block span per word, once. */
function split(el: Element): HTMLSpanElement[] {
  const known = WORDS.get(el);
  if (known) return known;
  const text = el.textContent ?? '';
  el.textContent = '';
  const spans: HTMLSpanElement[] = [];
  for (const word of text.split(/(\s+)/)) {
    if (/^\s+$/.test(word)) {
      el.appendChild(document.createTextNode(word));
      continue;
    }
    if (!word) continue;
    const span = document.createElement('span');
    span.textContent = word;
    span.style.display = 'inline-block';
    span.style.willChange = 'opacity, transform';
    el.appendChild(span);
    spans.push(span);
  }
  WORDS.set(el, spans);
  return spans;
}

/** Words drift in from the right one after another; returns when the last one has landed. */
function fadeFromRight(el: Element, t: number, start: number, options: TextFxOptions = {}): number {
  const { stagger = 0.11, dur = 0.5, dx = 26 } = options;
  const words = split(el);
  words.forEach((span, i) => {
    const p = eo(seg(t, start + i * stagger, start + i * stagger + dur));
    span.style.opacity = String(p);
    span.style.transform = `translateX(${((1 - p) * dx).toFixed(1)}px)`;
  });
  return start + (words.length - 1) * stagger + dur;
}

function fadeOutLeft(el: Element, t: number, start: number, options: TextFxOptions = {}): void {
  const { stagger = 0.07, dur = 0.35, dx = 22 } = options;
  split(el).forEach((span, i) => {
    const p = ei(seg(t, start + i * stagger, start + i * stagger + dur));
    if (t < start) return;
    span.style.opacity = String(1 - p);
    span.style.transform = `translateX(${(-p * dx).toFixed(1)}px)`;
  });
}

function inOut(el: Element, t: number, tIn: number, tOut?: number, options?: TextFxOptions): void {
  if (tOut !== undefined && t >= tOut) fadeOutLeft(el, t, tOut, options);
  else fadeFromRight(el, t, tIn, options);
}

export const TextFx = { split, fadeFromRight, fadeOutLeft, inOut };
