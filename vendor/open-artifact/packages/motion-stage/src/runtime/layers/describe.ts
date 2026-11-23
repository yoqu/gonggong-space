import type { PlaySeconds } from '@open-artifact/motion-core';
import type { LayerEffect, LayerKind, LayerLook, LayerMotion } from '../../protocol.ts';
import { srect } from '../kit/geometry.ts';
import type { StageRect } from '../kit/geometry.ts';
import type { ReadMemo } from '../retouch/entry.ts';
import { DRAWN, FULL, MOST, tidy, union } from './item.ts';
import type { Item, Layer } from './item.ts';
import { PAINT_KEYS, laidOn } from './parts.ts';

const LONGEST_MOVE_S = 1.5;
const NAME = /^[a-z][a-z0-9]{2,}([-_][a-z0-9]+)*$/i;

/** What a reading of one stretch knows, for describing its rows. */
export interface Stretch {
  W: number;
  H: number;
  from: number;
  to: number;
  /** The looks kept, in order, and the played moment of each. */
  n: number;
  times: number[];
  /** The stretch's own name for ids: a scene's id, or 'film'. */
  stretch: string;
  prefix: string | null;
}

export interface LookSys {
  look(el: Element): LayerLook | null;
  kin(el: Element, cls: string, memo: ReadMemo): string | null;
  /** What a hide on a g inside an svg would also be found by; null: none would hold (and in a film with no scenes). */
  parts?(el: Element, memo: ReadMemo): string | null;
}

/** stays: a person's change is laid on it, so it is never looked through: its row leads to the controls that made the change. */
export const stays = (it: Item): boolean => it.own || it.laid;

export function beneath(it: Item): boolean {
  for (let u = it.up; u; u = u.up) if (stays(u)) return true;
  return false;
}

export function inOrder(a: Item, b: Item): number {
  for (let i = 0; i < a.path.length && i < b.path.length; i++) if (a.path[i] !== b.path[i]) return (a.path[i] ?? 0) - (b.path[i] ?? 0);
  return a.path.length - b.path.length;
}

/** A card's first line is its words, not the number in its corner. */
export function lead(said: string[]): string[] {
  const w = said.findIndex((s) => /\p{L}{2}/u.test(s));
  if (w > 0) said.unshift(...said.splice(w, 1));
  return said;
}

function spoken(s: string): string {
  const t = tidy(s.replace(/[-_]+/g, ' '));
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function titled(el: Element): string {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === 'title') return c.textContent ?? '';
  return '';
}

const still = (p: StageRect | null | undefined, q: StageRect | null | undefined): boolean =>
  !!p && !!q && Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.w - q.w) + Math.abs(p.h - q.h) < 1;

/** The measures of one reading: what is as large as the stage, what grew by a hand-set Scale, and each row's description. */
export function measures(s: Stretch, inked: (it: Item) => Item[]) {
  const { W, H, n, times, from, to } = s;
  /** A wrapper as large as the stage (a scene's box, a camera) is never a thing on the picture. */
  const isFull = (it: Item): boolean => {
    if (it.cand) return it.shown > 0 && it.full >= it.shown * 0.8 && !it.words;
    const r = srect(it.el);
    return r.w >= FULL * W && r.h >= FULL * H;
  };
  /** The Scale a person set on it (1: none). */
  const grew = (it: Item): number => {
    if (!stays(it) || !laidOn(it.el, 'size')) return 1;
    const g = parseFloat(getComputedStyle(it.el).scale);
    return g > 0 ? g : 1;
  };
  /** It has a Scale set by hand above 1, and without it would be smaller than the stage. */
  const swelled = (it: Item): boolean => {
    const g = grew(it);
    if (!(g > 1) || !it.el.isConnected) return false;
    const r = srect(it.el);
    return r.w >= 1 && r.h >= 1 && (r.w / g < FULL * W || r.h / g < FULL * H);
  };
  /** The Scales set by hand above it grow it; before them it was smaller than the stage; and it lies inside one that grew. */
  const grown = (it: Item): boolean => {
    let g = 1;
    for (let u = it.up; u; u = u.up) g *= grew(u);
    if (!(g > 1) || !it.el.isConnected) return false;
    const r = srect(it.el);
    const e = 4 * g;
    if (!(r.w >= 1 && r.h >= 1) || (r.w / g >= FULL * W && r.h / g >= FULL * H)) return false;
    for (let u = it.up; u; u = u.up) {
      if (!(grew(u) > 1) || !u.el.isConnected) continue;
      const h = srect(u.el);
      if (h.w >= 1 && h.h >= 1 && r.x >= h.x - e && r.y >= h.y - e && r.x + r.w <= h.x + h.w + e && r.y + r.h <= h.y + h.h + e) return true;
    }
    return false;
  };
  const growth = (it: Item): number => {
    let g = grew(it);
    for (let u = it.up; u; u = u.up) g *= grew(u);
    return g;
  };
  const covers = (r: StageRect): boolean => Math.min(r.x + r.w, W) - Math.max(r.x, 0) >= FULL * W && Math.min(r.y + r.h, H) - Math.max(r.y, 0) >= FULL * H;

  /** One layer: it, the thing it is called after, and parts, all that is drawn of it. */
  const describe = (it: Item, parts: Item[]): Layer => {
    const el = it.el;
    const on: boolean[] = [];
    const op: number[] = [];
    const box: Array<StageRect | null> = [];
    for (let i = 0; i < n; i++) {
      on[i] = false;
      op[i] = 0;
      box[i] = null;
      for (const p of parts)
        if (p.on[i]) {
          on[i] = true;
          op[i] = Math.max(op[i] ?? 0, p.op[i] ?? 0);
          box[i] = union(box[i] ?? null, p.box[i] ?? null);
        }
    }
    let texts: string[] = [];
    for (const p of parts) if (p.text && texts.length < MOST) texts.push(p.text);
    // What is drawn inside an opened svg never joins a row's parts, so each opened svg among the parts adds its words here.
    const within: string[] = [];
    for (const p of parts) if (p.easel && !p.art) for (const q of inked(p)) if (q.text) within.push(q.text);
    texts = lead(texts).concat(lead(within)).slice(0, MOST);
    const one = parts.length === 1 ? (parts[0] ?? null) : null;
    const tag = (one ?? it).el.tagName.toLowerCase();
    let ground = one !== null && isFull(one) && (!one.unit || one.filled);
    let full = one !== null && one.art && !ground && isFull(one);
    const drawn = it.art && !it.cand && one === null ? 'group' : one !== null && one.unit && (one.art || tag === 'svg') ? (DRAWN[tag] ?? '') : '';
    // The Background has no controls: a thing a person changed or hid, or that grew by a hand-set Scale, keeps its kind and is full.
    if (one && ground && (stays(one) || grown(one))) {
      ground = false;
      full = true;
    }
    if (one !== null && !ground && !full && one.unit && isFull(one) && grown(one)) full = true;
    // A row of several parts that grew is full when, at most looks it is on, its box covers the picture and was smaller before every Scale.
    if (one === null && (swelled(it) || grown(it))) {
      const g = growth(it);
      let seen = 0;
      let over = 0;
      for (let i = 0; i < n; i++) {
        const b = box[i];
        if (!on[i] || !b) continue;
        seen++;
        if (covers(b) && !(b.w / g >= FULL * W && b.h / g >= FULL * H)) over++;
      }
      full = seen > 0 && over >= seen * 0.8;
    }
    const kind: LayerKind = ground
      ? 'ground'
      : one === null || (one.art && tag === 'g')
        ? 'group'
        : one.unit
          ? one.art && !/^(use|image|foreignobject)$/.test(tag)
            ? 'shape'
            : 'image'
          : one.words && !one.paint
            ? 'text'
            : 'shape';
    // Its own name, if the film gave it one: a label, or for what is not plain words the class the scene calls it by.
    let cls = '';
    const prefix = s.prefix;
    if (prefix) for (const c of Array.from(el.classList)) if (c.indexOf(prefix) === 0) cls = c.slice(prefix.length);
    if (!cls) cls = el.id || (it.art ? Array.from(el.classList).filter((x) => NAME.test(x)).pop() : el.classList[el.classList.length - 1]) || '';
    if (kind === 'text' || kind === 'ground' || !NAME.test(cls)) cls = '';
    const name =
      tidy(el.getAttribute('data-label') || el.getAttribute('aria-label') || el.getAttribute('alt') || titled(el)) || (el.classList.contains('film-cursor') ? 'Cursor' : spoken(cls));
    // The stretches it is on for; an edge lies half-way between the two looks that differ.
    const spans: Array<[number, number]> = [];
    let a = -1;
    let top = 0;
    let long = 0;
    const time = (i: number): number => times[i] ?? from;
    for (let i = 0; i <= n; i++) {
      if (i < n && on[i]) {
        if (a < 0) a = i;
        top = Math.max(top, op[i] ?? 0);
      } else if (a >= 0) {
        spans.push([a === 0 ? from : (time(a - 1) + time(a)) / 2, i === n ? to : (time(i - 1) + time(i)) / 2]);
        a = -1;
      }
    }
    for (const x of spans) long += x[1] - x[0];
    // Where to look at it: the first moment it is as solid as it gets and at rest; if it never rests, the first at which it is as solid.
    let best = -1;
    for (let i = 0; i + 1 < n && best < 0; i++) if (on[i] && (op[i] ?? 0) >= top * 0.98 && still(box[i], box[i + 1])) best = i;
    for (let i = 0; i < n && best < 0; i++) if (on[i] && (op[i] ?? 0) >= top * 0.98) best = i;
    // How it comes and goes, from look p, part of the way, to look q, at rest; null where opacity and box cannot tell.
    const way = (pa: number, pb: number): LayerEffect[] | null => {
      const p = box[pa];
      const q = box[pb];
      const how: LayerEffect[] = [];
      // Parts that come one after another make a box that grows, which nothing on the picture does.
      if (!p || !q || Math.abs(time(pa) - time(pb)) > LONGEST_MOVE_S || !parts.every((x) => x.on[pa] && x.on[pb])) return null;
      if (pa === pb) return how;
      if ((op[pa] ?? 0) < (op[pb] ?? 0) * 0.7) how.push('fade');
      // Under a camera every box moves, so only fading can be told.
      for (let cam = it.up; cam; cam = cam.up) if (cam.pans && cam.big) return how.length ? how : null;
      const fw = p.w / q.w;
      const fh = p.h / q.h;
      const dx = p.x + p.w / 2 - q.x - q.w / 2;
      const dy = p.y + p.h / 2 - q.y - q.h / 2;
      const same = (f: number): boolean => f >= 0.85 && f <= 1.15;
      const small = (f: number): boolean => f < 0.85;
      if (same(fw) && same(fh)) {
        if (Math.abs(dx) + Math.abs(dy) > W / 200) how.push(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom');
      }
      // Smaller both ways alike, or, if it is not words, one way only (a bar of a chart). Words that get longer are being typed.
      else if ((small(fw) && small(fh) && Math.abs(fw - fh) < 0.2) || (kind !== 'text' && ((small(fw) && same(fh)) || (same(fw) && small(fh))))) how.push('grow');
      else return null;
      return how;
    };
    const first = on.indexOf(true);
    const last = on.lastIndexOf(true);
    let rest = last;
    while (rest > best && !((op[rest] ?? 0) >= top * 0.98 && still(box[rest], box[rest - 1]))) rest--;
    const motion = (how: LayerEffect[] | null, f: number, t: number): LayerMotion => ({ how, from: f as PlaySeconds, to: t as PlaySeconds });
    const enter = motion(way(first, best), spans.length ? (spans[0]?.[0] ?? from) : from, time(Math.max(0, best)));
    const leave = motion(way(last, rest), time(Math.max(0, rest)), spans.length ? (spans[spans.length - 1]?.[1] ?? to) : to);
    // Still on as the stretch ends: at rest, it stays; moving, it may be leaving or not, so nothing is said.
    if (last === n - 1 && leave.how && leave.how.length && (op[last] ?? 0) >= top * 0.7) leave.how = null;
    return {
      id: s.stretch + ':' + it.key,
      kind,
      round: kind === 'shape' && one?.round === true,
      drawn: ground ? '' : drawn,
      full,
      name: name.slice(0, 80),
      texts,
      spans,
      long,
      at: time(Math.max(0, best)),
      enter,
      leave,
      parts,
      it,
      kids: [],
      pack: false,
      many: 0,
      keep: false,
      sole: null,
      svg: null,
      inked: [],
      below: 0,
      n: 0,
      now: null,
    };
  };
  return { isFull, swelled, grown, describe };
}

/**
 * How the film itself draws a layer now, for what the page can change by itself: only of one thing, whose place tells
 * it from all others. What the film itself changes in the course of the stretch is left out: a value laid over it
 * would stop that.
 */
export function lookOf(l: Layer, sys: LookSys, memo: ReadMemo, used: ReadonlySet<string>): LayerLook | null {
  const it = l.it;
  const el = it.el;
  if (l.kind === 'ground' || /[+*]/.test(l.id) || !el.isConnected) return null;
  const k = sys.look(el);
  const boxed = it.paint && !it.unit;
  if (!k) return null;
  // As many as the record can hold: it is held to those it names, so fewer is no fault.
  k.cls = (it.always ?? []).reduce((all, c) => (all.length + c.length < 200 ? (all ? all + ' ' : '') + c : all), '');
  k.kin = sys.kin(el, k.cls, memo);
  if (!boxed || it.vary.fill) k.fill = null;
  if (!boxed || it.vary.radius) k.radius = null;
  if (!it.words || it.vary.ink) k.ink = null;
  if (it.vary.size) k.size = null;
  if (it.vary.hidden && !it.own) k.hidden = null;
  const printed = (k.kin ?? '').split('/').length === 3;
  if (it.art) {
    // None of these four is offered on a part inside an svg; an svg text's colour is offered with its text styles instead.
    k.fill = k.ink = null;
    k.radius = k.size = null;
    /*
     * A hide must hold at every frame and on this part alone: none is offered where the print is not the part's own,
     * the film makes its node anew, or what the print is of changes in the stretch.
     */
    let firm = !it.anew && !it.vary.within && printed;
    for (let u: Item | null = it; firm && u && (u.art || u.easel); u = u.up) firm = !u.vary.drawn && !(u.art && !!u.up?.vary.tags[u.el.tagName]);
    if (!firm && !it.own) k.hidden = null;
    // So must a colour, which would also show on every copy a use draws of the part or of what holds it.
    for (let u: Item | null = it; firm && u && (u.art || u.easel); u = u.up) firm = !(u.el.id && used.has(u.el.id));
    for (const p of PAINT_KEYS) if ((!firm || it.vary[p]) && !laidOn(el, p)) k[p] = null;
  }
  // A loose entry's hide would be saved with this kin; with no print in it, it would count by its turn from then on.
  if (k.loose && !printed) k.hidden = null;
  // A hide on a g is also saved with its parts, where the g has a class and no other g has its classes (kin 0/1/…).
  if (it.art && k.hidden !== null && sys.parts && /^g$/i.test(el.tagName) && k.cls && /^0\/1\//.test(k.kin ?? '')) {
    const parts = sys.parts(el, memo);
    if (parts !== null) k.parts = parts;
  }
  return k;
}
