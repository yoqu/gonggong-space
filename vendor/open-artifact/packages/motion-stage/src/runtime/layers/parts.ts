/*
 * The parts of a thing on the picture that both the reading of the layers and a person's changes by hand go by.
 * A thing is one element of the film's; inside an inline svg, a part of the drawing.
 */

export const SKIP = /^(style|script|template|link|meta|title)$/i;
export const PHRASE = /^(span|em|b|i|strong|u|a|br|small|sub|sup|mark|s|code|wbr|tspan)$/i;
export const UNIT = /^(img|svg|canvas|video|picture)$/i;
/** A g holds parts, each other tag is one part. Whatever else stands in an svg (defs, a mask, a nested svg) is passed over. */
export const ART = /^(g|path|rect|circle|ellipse|line|polyline|polygon|text|use|image|foreignObject)$/i;
/** The parts that paint themselves. */
export const SHAPE = /^(path|rect|circle|ellipse|line|polyline|polygon)$/i;
/** The two colours of a shape a person can change, each with the property it is laid as. */
export const PAINT = { svgfill: 'fill', svgstroke: 'stroke' } as const;
export type PaintKey = keyof typeof PAINT;
export const PAINT_KEYS: readonly PaintKey[] = ['svgfill', 'svgstroke'];

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** The element's own inline style, where it has one. */
export function styleOf(el: Element): CSSStyleDeclaration | null {
  return el instanceof HTMLElement || el instanceof SVGElement ? el.style : null;
}

/** A rough scene's pen strokes, which are no thing of the film's. */
export const isPen = (node: Node): boolean => node instanceof Element && node.hasAttribute('data-sketch-pen');

/**
 * The film's own elements under `el`: a thing is known by its place among them. A caption is passed over: the stage's
 * own goes to the end only after a frame is drawn, so it can stand ahead of what the film added meanwhile.
 */
export function kidsOf(el: Element | Node): Element[] {
  const out: Element[] = [];
  if (!(el instanceof Element)) return out;
  for (let child = el.firstElementChild; child; child = child.nextElementSibling) if (!isPen(child) && !SKIP.test(child.tagName) && !child.classList.contains('film-caption')) out.push(child);
  return out;
}

export function alphaOf(colour: string): number {
  if (!colour || colour === 'transparent') return 0;
  const rgba = /^rgba\((.+)\)$/.exec(colour);
  const slash = colour.indexOf('/');
  return rgba ? parseFloat(rgba[1]!.split(',')[3] ?? '1') : slash > 0 ? parseFloat(colour.slice(slash + 1)) : 1;
}

/** It paints a box: a background, a shadow or a border that shows. Read inside `inOwnColors`. */
export function paints(cs: CSSStyleDeclaration, el: Element): boolean {
  if (/\b(edge|fill)\b/.test(el.getAttribute('data-sketch') ?? '')) return true;
  const set = (value: string): boolean => !!value && value !== 'none';
  const inWords = cs.backgroundClip === 'text' || cs.getPropertyValue('-webkit-background-clip') === 'text';
  if (set(cs.boxShadow) || (!inWords && (set(cs.backgroundImage) || alphaOf(cs.backgroundColor) > 0.03))) return true;
  return SIDES.some(
    (side) =>
      parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 &&
      cs.getPropertyValue(`border-${side}-style`) !== 'none' &&
      alphaOf(cs.getPropertyValue(`border-${side}-color`)) > 0.03,
  );
}

/** A part of an svg drawing. The kit's hand-drawn marks are none: their order and number differ from runner to runner. */
export const isPart = (el: Element | Node | null): el is Element =>
  el instanceof Element && el.namespaceURI === SVG_NS && ART.test(el.tagName) && !el.hasAttribute('data-film-mark');

export const isArtWords = (el: Element): boolean => isPart(el) && /^text$/i.test(el.tagName);

/**
 * What an element's own attributes say of how it is drawn: tag, id, classes, link and paint, not its shape or place,
 * which most films change from frame to frame. `blur`: numbers in its id and classes count for nothing.
 */
export function saidOf(el: Element, blur: boolean = false): string {
  const own = el.id + ' ' + (el.getAttribute('class') ?? '');
  const style = styleOf(el);
  return [el.tagName, blur ? own.replace(/\d+/g, '#') : own]
    .concat(['href', 'fill', 'stroke', 'stroke-width', 'color'].map((name) => el.getAttribute(name) ?? ''))
    .concat(style ? [style.fill, style.stroke, style.color] : [])
    .join(' ');
}

/** The same of a part and all the parts under it. `memo` lasts while the stage stands as drawn. */
export function drawnAs(el: Element, blur: boolean, memo: Map<Element, string>): string {
  const known = memo.get(el);
  if (known !== undefined) return known;
  const out =
    saidOf(el, blur) +
    kidsOf(el)
      .filter(isPart)
      .map((child) => '(' + drawnAs(child, blur, memo) + ')')
      .join('');
  memo.set(el, out);
  return out;
}

/** A paint shows at all: a colour or a pattern, not see-through. */
export function showsPaint(paint: string, opacity: string): boolean {
  const o = parseFloat(opacity);
  return !!paint && paint !== 'none' && (/^url\(/.test(paint) ? 1 : alphaOf(paint)) * (isNaN(o) ? 1 : o) > 0.03;
}

/** A filled shape, or a use of one: only such a part can be the Background. */
export function fills(cs: CSSStyleDeclaration, el: Element): boolean {
  if (/^use$/i.test(el.tagName)) {
    const id = (el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '').slice(1);
    const to = id ? el.ownerDocument.getElementById(id) : null;
    if (to) return !/^use$/i.test(to.tagName) && fills(getComputedStyle(to), to);
  }
  return !/^(g|use|image|foreignObject|line)$/i.test(el.tagName) && showsPaint(cs.fill, cs.fillOpacity);
}

/** A use, an image, a foreignObject and a g read as one thing always count: what they show is not theirs to paint. */
export function inks(cs: CSSStyleDeclaration, el: Element): boolean {
  return /^(g|use|image|foreignObject)$/i.test(el.tagName) || fills(cs, el) || (parseFloat(cs.strokeWidth) > 0 && showsPaint(cs.stroke, cs.strokeOpacity));
}

export function ownText(el: Element): boolean {
  for (let node = el.firstChild; node; node = node.nextSibling) if (node instanceof Text && /\S/.test(node.data)) return true;
  return false;
}

/** A line of words: text, and nothing under it but spans and the like. Spans that paint with no text beside them are things of their own. */
export function isWords(el: Element): boolean {
  // kit.h's holder has no box, so what is in it is read for itself.
  if (styleOf(el)?.display === 'contents') return false;
  const all = el.getElementsByTagName('*');
  // The tag first: it settles nearly every case, and a walk up to look for a pen is dear.
  for (const each of Array.from(all)) if (!PHRASE.test(each.tagName) && !each.closest('[data-sketch-pen]')) return false;
  if (!/\S/.test(el.textContent ?? '')) return false;
  if (ownText(el)) return true;
  for (const each of Array.from(all)) if (PHRASE.test(each.tagName) && paints(getComputedStyle(each), each)) return false;
  return true;
}

/** A declared value that uses a var(), with each fallback taken out that uses none itself; null: it uses none, or a var() is not closed. */
export function drawnValue(text: string): string | null {
  if (!/var\(/i.test(text)) return null;
  let out = '';
  let any = false;
  for (let i = 0; i < text.length; ) {
    const found = /[\w-]/.test(text[i - 1] ?? '') ? null : /^var\(\s*(--[^\s,)]+)\s*/i.exec(text.slice(i));
    if (!found) {
      out += text[i++];
      continue;
    }
    let deep = 1;
    let j = i + 4;
    for (; j < text.length && deep; j++) deep += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0;
    if (deep) return null;
    const rest = text.slice(i + found[0].length, j - 1);
    const back = rest[0] === ',' ? drawnValue(rest.slice(1).trim()) : null;
    out += 'var(' + found[1] + (back ? ', ' + back : '') + ')';
    i = j;
    any = true;
  }
  return any ? out : null;
}

/** What of a person's change is laid on the element (the retouch marks). */
export const laidOn = (el: Element, what: string): boolean => (el.getAttribute('data-film-laid') ?? '').split(' ').includes(what);
export const hiddenByHand = (el: Element): boolean => laidOn(el, 'hidden');
