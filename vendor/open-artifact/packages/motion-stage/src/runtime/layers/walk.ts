import { srect } from '../kit/geometry.ts';
import type { StageRect } from '../kit/geometry.ts';
import { inOwnColors } from '../snapshot/serialize.ts';
import { paintsOver, seenAt } from '../texts.ts';
import { FAINT, FULL, newItem, opacityOf, wordsIn } from './item.ts';
import type { Item, Vary } from './item.ts';
import { PAINT, PAINT_KEYS, SKIP, UNIT, drawnAs, fills, hiddenByHand, inks, isPart, isPen, isWords, kidsOf, ownText, paints, saidOf, showsPaint, styleOf } from './parts.ts';

/*
 * One look at the stage as drawn at one moment: every thing on it, where it is, how solid, and what of it the film
 * changes from look to look.
 */

const MOST_ELS = 1500;
/** Parts of svg drawings read part by part at one look, over all of them. */
const MOST_ART = 400;
/** A thing this share of the stage or more, solid, may hide what lies under it. */
const COVER = 0.25;
/** A part's box is this many px at the least each way: a straight stroke's has no height. */
const THIN = 8;

export interface Reading {
  stage: HTMLElement;
  W: number;
  H: number;
  /** The class prefix by which the scene names its things. */
  prefix: string | null;
  els: Map<string, Item>;
  nodes: WeakMap<Element, Item>;
  /** The ids that a use on the stage points to at any look. */
  used: Set<string>;
}

interface LookState {
  count: number;
  open: Set<Element>;
  away: Set<Element>;
  watch: number;
  /** The last look, at the moment on show: it adds no thing and changes no finding. */
  closed: boolean;
  on: Item[];
  covers: Item[];
}

const SVG_TAGS = /^(svg|g)$/i;

function named(r: Reading, el: Element): boolean {
  if (el.hasAttribute('data-label') || el.id) return true;
  return !!r.prefix && Array.from(el.classList).some((name) => name.indexOf(r.prefix ?? '') === 0);
}

/** It holds something that may draw but has no row, so no row can stand for all of it. */
export function markOdd(it: Item | null): void {
  for (; it && (it.art || it.easel); it = it.up) it.odd = true;
}

function thick(r: StageRect): StageRect {
  const w = Math.max(r.w, THIN);
  const h = Math.max(r.h, THIN);
  return r.w + r.h < 1 ? r : { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}

/** An svg as large as the stage, or a holder with no size of its own, is as large as what it holds. */
function unitRect(r: Reading, el: Element): StageRect {
  const box = srect(el);
  if (box.w >= 1 && box.h >= 1 && !(/^svg$/i.test(el.tagName) && box.w * box.h >= FULL * r.W * r.H)) return box;
  let u: StageRect | null = null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (/^(defs|style|title|desc)$/i.test(c.tagName)) continue;
    const k = srect(c);
    if (k.w >= 0.5 && k.h >= 0.5) u = u ? { x: Math.min(u.x, k.x), y: Math.min(u.y, k.y), w: Math.max(u.x + u.w, k.x + k.w) - Math.min(u.x, k.x), h: Math.max(u.y + u.h, k.y + k.h) - Math.min(u.y, k.y) } : k;
  }
  return u ?? { x: 0, y: 0, w: 0, h: 0 };
}

const setVary = (it: Item, key: keyof Omit<Vary, 'tags'>): void => {
  it.vary[key] = true;
};

function walk(r: Reading, el: Element, op: number, i: number, memo: Map<Element, boolean>, state: LookState, path: number[], up: Item | null, hid: Item | false, dark: boolean): void {
  const art = !!up && !!up.easel;
  if ((!art && state.count++ > MOST_ELS) || SKIP.test(el.tagName) || (el.id === 'fx' && el.parentNode === r.stage)) return;
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return;
  const o = op * opacityOf(cs);
  let key = path.join('.') + '/' + el.tagName.toLowerCase();
  let it = r.nodes.get(el);
  // A place and tag already taken by a node still there: the next of that name, which may be a thing whose node is gone.
  if (!it) for (it = r.els.get(key); it && it.el !== el && it.el.isConnected; it = r.els.get(key)) key += '+';
  if (!it) {
    if (state.closed) return;
    it = newItem(el, key, path, up, named(r, el), UNIT.test(el.tagName) || el.classList.contains('film-cursor'));
    r.els.set(key, it);
  }
  if (art && !it.art) {
    it.art = true;
    it.unit = !/^(g|text)$/i.test(el.tagName);
    it.words = /^text$/i.test(el.tagName);
    it.round = /^(circle|ellipse)$/i.test(el.tagName);
  }
  if (it.el !== el) it.anew = true;
  if (el.hasAttribute('data-film-over')) it.laid = true;
  // An svg or a g not read part by part at some look is one thing for the rest of the reading. away: not on the picture at this look.
  const away = state.away.has(el);
  if (!away && it.easel !== false && SVG_TAGS.test(el.tagName) && art === /^g$/i.test(el.tagName) && !(it.easel = state.open.has(el))) it.unit = true;
  it.el = el;
  r.nodes.set(el, it);
  it.held = hid;
  it.own = hiddenByHand(el);
  if (!hid && it.own) hid = it;
  it.hid = hid;
  if (it.own || it.laid) for (let a = up; a && !a.marked; a = a.up) a.marked = true;
  const style = styleOf(el);
  const said = style ? style.visibility : '';
  dark = said === 'visible' ? false : said === 'hidden' || said === 'collapse' || dark;
  // A style attribute that says visible, or any visibility with !important, ends a hide, so none is offered.
  if (!state.closed && style && (said === 'visible' || (said && style.getPropertyPriority('visibility')))) it.vary.hidden = true;
  if (!it.unit && !it.words && !it.art) it.words = isWords(el);
  let sig = (el.getAttribute('style') ?? '') + '|' + (el.getAttribute('class') ?? '');
  if (it.words) for (let w = el.firstChild; w; w = w.nextSibling) sig += w instanceof Element ? (isPen(w) ? '' : w.outerHTML) : w instanceof Text ? w.data : '';
  if (it.sig !== null && it.sig !== sig) it.moved = true;
  it.sig = sig;
  // A class that comes and goes with the moment (a state, such as "on") is no part of what the thing is known by.
  if (!state.closed) it.always = it.always ? it.always.filter((name) => el.classList.contains(name)) : Array.from(el.classList);
  if (!state.closed && (it.art || it.easel)) {
    // A g read as one thing is watched with all under it, and a text with its words, since its print is of them.
    const whole = it.art && it.unit && /^g$/i.test(el.tagName);
    const spent = whole && (state.watch -= el.getElementsByTagName('*').length) < 0;
    const as = (whole && !spent ? drawnAs(el, false, new Map()) : saidOf(el)) + (whole || it.words ? '|' + (el.textContent ?? '') : '');
    if (spent || (it.as !== null && it.as !== as)) {
      it.vary.drawn = true;
      for (let v: Item | null = it; v && v.art; v = v.up) v.vary.within = true;
    }
    it.as = as;
  }
  // A part's paint as computed: a class, a rule or a script may change it where no attribute of the part's changes.
  if (!state.closed && it.art && it.unit) {
    const was = it.hues;
    const now: Record<string, string> = {};
    for (const p of PAINT_KEYS) {
      now[p] = cs.getPropertyValue(PAINT[p]);
      if (was && was[p] !== now[p]) setVary(it, p);
    }
    it.hues = now;
    if (/^(path|line|polyline|polygon)$/i.test(el.tagName) && [cs.markerStart, cs.markerMid, cs.markerEnd].some((m) => !!m && m !== 'none')) markOdd(it);
  }
  if (!state.closed && !it.art) {
    const now: Record<string, string> = {
      fill: cs.backgroundColor + cs.backgroundImage,
      ink: cs.color,
      radius: cs.borderTopLeftRadius + cs.borderTopRightRadius + cs.borderBottomRightRadius + cs.borderBottomLeftRadius,
      size: cs.scale,
    };
    const was = it.hues;
    if (was) for (const h of ['fill', 'ink', 'radius', 'size'] as const) if (now[h] !== was[h]) setVary(it, h);
    it.hues = now;
  }
  const under = (it.unit && !it.easel) || it.words || away ? [] : kidsOf(el);
  // How many parts of each tag it holds: where that changes, so does the print of each of that tag.
  if (!state.closed && it.easel && !away) {
    const tally: Record<string, number> = {};
    for (const c of under) if (isPart(c)) tally[c.tagName] = (tally[c.tagName] ?? 0) + 1;
    const before = it.tally;
    if (before)
      for (const tag of Object.keys(tally).concat(Object.keys(before)))
        if (before[tag] !== tally[tag]) {
          it.vary.tags[tag] = true;
          for (let h: Item | null = it; h && h.art; h = h.up) h.vary.within = true;
        }
    it.tally = tally;
  }
  // For a camera: whatever holds others, is at some moment as large as the stage, and whose own box differs between two looks.
  if (!(it.big && it.pans) && under.length) {
    const wr = srect(el);
    if (wr.w >= FULL * r.W && wr.h >= FULL * r.H) it.big = true;
    it.most = Math.max(it.most, wr.w * wr.h);
    // The box of a g is only the box round what it holds, which shifts as a part moves: it pans if it is itself moved.
    const tf = it.art ? [el.getAttribute('transform'), cs.transform, cs.translate, cs.scale, cs.rotate].join() : it.easel ? [el.getAttribute('viewBox'), el.getAttribute('preserveAspectRatio')].join() : null;
    const lay = it.lay;
    if (lay && (tf !== it.tf || (!it.art && Math.abs(wr.x - lay.x) + Math.abs(wr.y - lay.y) + Math.abs(wr.w - lay.w) + Math.abs(wr.h - lay.h) >= 1))) it.pans = true;
    it.lay = wr;
    it.tf = tf;
  }
  const paint = !it.unit && paints(cs, el);
  if (paint) it.paint = true;
  if ((it.unit || it.words || paint) && (!it.art || inks(cs, el))) {
    it.cand = true;
    if (it.art && fills(cs, el)) it.filled = true;
    const box = it.art ? thick(srect(el)) : it.unit ? unitRect(r, el) : srect(el);
    const lit = o >= FAINT && (hid ? !dark : cs.visibility !== 'hidden');
    let on = lit && box.w >= 1 && box.h >= 1 && box.x < r.W && box.y < r.H && box.x + box.w > 0 && box.y + box.h > 0;
    // Of no length a stroke draws its caps, but for a path with no d; a rect, circle or ellipse its stroke, if it has any extent.
    if (
      !state.closed &&
      it.art &&
      lit &&
      box.w + box.h < 1 &&
      (/^(rect|circle|ellipse)$/i.test(el.tagName) ? box.w + box.h > 0 : /^(round|square)$/.test(cs.strokeLinecap) && !(/^path$/i.test(el.tagName) && !el.getAttribute('d'))) &&
      parseFloat(cs.strokeWidth) > 0 &&
      showsPaint(cs.stroke, cs.strokeOpacity)
    )
      it.speck = true;
    if (on && it.words && !ownText(el)) {
      on = false;
      for (let c = el.firstElementChild; c && !on; c = c.nextElementSibling) on = !isPen(c) && opacityOf(getComputedStyle(c)) >= FAINT;
    }
    it.on[i] = on;
    it.op[i] = on ? o : 0;
    it.box[i] = on ? box : null;
    // Round or not is told once, at the first look at which it is on, and so has a size to go by.
    if (on && paint && it.round === null && el instanceof HTMLElement) {
      const ew = el.offsetWidth;
      const eh = el.offsetHeight;
      const rad = cs.borderTopLeftRadius;
      it.round = ew < eh * 1.25 && eh < ew * 1.25 && parseFloat(rad) >= (/%$/.test(rad) ? 45 : Math.min(ew, eh) * 0.45);
    }
    if (on) {
      state.on.push(it);
      if (!hid && !it.words && o > 0.9 && box.w * box.h >= COVER * r.W * r.H && paintsOver(el, r.stage, memo)) state.covers.push(it);
    }
    if (it.words) {
      const s = wordsIn(el);
      if (s.length > it.text.length) it.text = s.slice(0, 300);
    }
  }
  under.forEach((child, k) => {
    const part: boolean = isPart(child);
    if (!it.easel || part) walk(r, child, o, i, memo, state, path.concat(k), it, hid, dark);
    else if (!state.closed && (/^(svg|a|switch)$/i.test(child.tagName) || child.hasAttribute('data-film-mark'))) markOdd(it);
  });
}

/**
 * Which svgs, and which g in them, are read part by part at this look: MOST_ART parts in all, level by level over all
 * the drawings on the picture, so a heavy one loses its depth and not its breadth, and in a level what lies in front
 * first. What holds a part a person's change is laid on is opened whatever is left.
 */
function opened(r: Reading): { open: Set<Element>; away: Set<Element> } {
  const open = new Set<Element>();
  const away = new Set<Element>();
  const must = new Set<Node>();
  let left = MOST_ART;
  const dim = new Map<Node, number>();
  const through = (n: Node | null): number => {
    if (!n || n === r.stage || !(n instanceof Element)) return 1;
    const known = dim.get(n);
    if (known !== undefined) return known;
    const out = through(n.parentNode) * opacityOf(getComputedStyle(n));
    dim.set(n, out);
    return out;
  };
  // Of an svg a person's change is laid on, or that stands in such a thing, opacity and visibility are not asked: that change may be what hides it.
  const shows = (s: Element): boolean => {
    const box = srect(s);
    if (!(box.w > 0) || box.x >= r.W || box.y >= r.H || box.x + box.w <= 0 || box.y + box.h <= 0) return false;
    if (s.closest('[data-film-over]')) return true;
    return through(s) >= FAINT && getComputedStyle(s).visibility !== 'hidden';
  };
  let level = Array.from(r.stage.getElementsByTagName('svg')).filter((s) => {
    if (s.ownerSVGElement || isPen(s)) return false;
    if (shows(s)) return true;
    away.add(s);
    return false;
  }) as Element[];
  for (const m of Array.from(r.stage.querySelectorAll('svg [data-film-over]'))) for (let p = m.parentNode; p && p !== r.stage && !must.has(p); p = p.parentNode) must.add(p);
  while (level.length) {
    let next: Element[] = [];
    for (const h of level.reverse()) {
      const parts = kidsOf(h).filter(isPart);
      if (parts.length > left && !must.has(h)) continue;
      left -= parts.length;
      open.add(h);
      next = parts.filter((p) => /^g$/i.test(p.tagName)).concat(next);
    }
    level = next;
  }
  return { open, away };
}

/** Draws moment `t` (played) and reads look `i` of the stage. */
export function lookAt(r: Reading, render: (t: number) => void, t: number, i: number, closed: boolean): void {
  render(t);
  for (const use of Array.from(r.stage.getElementsByTagName('use'))) {
    const id = (use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '').slice(1);
    r.used.add(id);
    try {
      r.used.add(decodeURIComponent(id));
    } catch {
      // As written.
    }
  }
  const memo = new Map<Element, boolean>();
  const plan = opened(r);
  const state: LookState = { count: 0, open: plan.open, away: plan.away, watch: MOST_ART, closed, on: [], covers: [] };
  // One inOwnColors for the whole walk: under a contrast theme each makes the browser work out every style twice more.
  inOwnColors(() => kidsOf(r.stage).forEach((c, k) => walk(r, c, 1, i, memo, state, [k], null, false, false)));
  // Hit testing is dear, so only what has its middle under something large and solid is tested.
  for (const it of state.on) {
    const box = it.box[i];
    if (!box) continue;
    const x = box.x + box.w / 2;
    const y = box.y + box.h / 2;
    for (const cover of state.covers) {
      const b = cover.box[i];
      if (!b || cover === it || cover.el.contains(it.el) || it.el.contains(cover.el) || x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
      if (!it.hid && !seenAt(it.el, it.el.getBoundingClientRect(), r.stage, memo, true)) {
        it.on[i] = false;
        it.op[i] = 0;
        it.box[i] = null;
      }
      break;
    }
    if (!closed && it.on[i]) {
      it.shown++;
      if (Math.min(box.x + box.w, r.W) - Math.max(box.x, 0) >= FULL * r.W && Math.min(box.y + box.h, r.H) - Math.max(box.y, 0) >= FULL * r.H) it.full++;
    }
  }
}
