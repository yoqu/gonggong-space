import { RETOUCH_PROPERTIES } from '@open-artifact/motion-core';
import type { FilmSeconds, RetouchProperty } from '@open-artifact/motion-core';
import type { AskedLook, LayerLook } from '../../protocol.ts';
import { inOwnColors } from '../snapshot/serialize.ts';
import { PAINT, PAINT_KEYS, SHAPE, fills, isArtWords, isPart, isWords, paints, showsPaint } from '../layers/parts.ts';
import type { ReadMemo } from './entry.ts';
import { KEYS, OF_BOX, hues, seenLook } from './look.ts';
import type { Key, Value } from './look.ts';
import type { DrawMoment } from './retouch.ts';
import { stageOf } from './retouch.ts';
import { fits, kinOf, like, peers, standsAt } from './seat.ts';
import { ID, blind, home, lapsedOn, marks, toldAt, unmark } from './state.ts';
import { TYPE_KEYS, familyHead, offerType, typeSeen } from './type-style.ts';

const LOOKS = 10;
const MOST_CLASS_CHARS = 200;

const colour = (value: Value | null): string | null => (typeof value === 'string' ? value : null);
const number = (value: Value | null): number | null => (typeof value === 'number' ? value : null);
const isProperty = (name: string): name is RetouchProperty => RETOUCH_PROPERTIES.some((each) => each === name);

/** As many classes as the record can hold: it is held to those it names, so fewer is no fault. */
export function classesFor(names: readonly string[]): string {
  return names.reduce((all, name) => (all.length + name.length < MOST_CLASS_CHARS ? (all ? all + ' ' : '') + name : all), '');
}

function mostRadius(el: Element): number {
  const box = el instanceof HTMLElement ? [el.offsetWidth, el.offsetHeight] : [0, 0];
  return Math.round(Math.min(box[0] ?? 0, box[1] ?? 0) / 2);
}

/**
 * How the film itself draws the thing an id names in the stretch on show, read with no mark on the stage at second
 * `at` and at the moments `tell` looks at. A value the film changes among them is null; so are the fill and corners of
 * what never paints a box, and the ink and type of what is no line of words. null: nothing could be told of an entry
 * of the scene, no such thing stands there, another node takes its place, or the film's render gives promises. The
 * caller draws the frame again.
 */
export function ask(scene: string, id: string, lo: number, hi: number, at: number, draw: DrawMoment): AskedLook | null {
  const stage = stageOf();
  const m = ID.exec(id);
  if (!stage || !m || m[1] !== scene || blind(scene, lo) || !getComputedStyle(stage).display) return null;
  const path = m[2]!.split('.').map(Number);
  const tag = m[3]!;
  const here = (): Element | null => {
    const x = standsAt(stage, path);
    return x && fits(x, tag, []) ? x : null;
  };
  const shown = here();
  const mine = shown ? marks(shown) : undefined;
  const lapsed = shown ? lapsedOn(shown).filter(isProperty) : [];
  unmark();
  const drawn = draw(at);
  const el = drawn !== false && drawn !== null ? here() : null;
  if (!el) return null;
  const memo: ReadMemo = {};
  const cs = getComputedStyle(el);
  const read = inOwnColors(() => ({ all: like(stage, peers(stage, memo, tag), [], memo), now: seenLook(cs, el).values, first: hues(cs, el), boxed: paints(cs, el), worded: isWords(el) }));
  const now = read.now;
  let boxed = read.boxed;
  let cls = Array.from(el.classList);
  const most = mostRadius(el);
  const family = familyHead(cs);
  const type = typeSeen(cs);
  offerType(cs, el, type);
  const changed = new Set<Key>();
  if (!read.worded) {
    now.ink = null;
    for (const key of TYPE_KEYS) type[key] = null;
  }
  for (let i = 0; i < LOOKS; i++) {
    const s = draw(lo + ((hi - lo) * i) / (LOOKS - 1));
    if (s === null) return null;
    const x = s !== false ? here() : null;
    if (x && x !== el && el.isConnected) return null;
    const xs = x ? getComputedStyle(x) : null;
    if (!x || !xs || xs.display === 'none') continue;
    const h = inOwnColors(() => {
      boxed = boxed || paints(xs, x);
      return hues(xs, x);
    });
    cls = cls.filter((name) => x.classList.contains(name));
    for (const key of KEYS) if (h[key] !== read.first[key]) changed.add(key);
  }
  if (!boxed) for (const key of OF_BOX) changed.add(key);
  for (const key of changed) now[key] = null;
  for (const key of TYPE_KEYS) if (changed.has(key)) type[key] = null;
  const kept = classesFor(cls);
  return {
    ...type,
    cls: kept,
    kin: kinOf(stage, read.all, el, kept.split(' ').filter(Boolean), memo),
    at: at as FilmSeconds,
    fill: colour(now.fill),
    ink: colour(now.ink),
    radius: number(now.radius),
    most,
    size: number(now.size),
    hidden: now.hidden === 0 ? 0 : null,
    entry: mine ? mine.id : null,
    home: !!mine && home(mine, lo, hi),
    lapsed,
    family,
  };
}

/**
 * How the film itself draws an element now, whatever is laid on it, for the layers' rows. `cls`, `kin` and `at` are
 * the caller's to set. null: nothing could be told of an entry of the scene.
 */
export function lookOn(el: Element, lo: number, hi: number, scene: string | null): LayerLook | null {
  if (scene !== null && blind(scene, lo)) return null;
  const cs = getComputedStyle(el);
  const now = seenLook(cs, el).values;
  const e = marks(el);
  const lapsed = lapsedOn(el).filter(isProperty);
  // No colour is offered where another would not show now: on a clear paint, or on a stroke that has no width.
  for (const key of PAINT_KEYS) {
    const property = PAINT[key];
    if (!showsPaint(cs.getPropertyValue(property), cs.getPropertyValue(property + '-opacity')) || (property === 'stroke' && !(parseFloat(cs.strokeWidth) > 0))) now[key] = null;
  }
  const told = e ? toldAt(e, lo) : null;
  if (e)
    for (const key of KEYS) {
      const pair = e.pairs[key];
      if (pair && !lapsed.some((name) => name === key)) now[key] = told?.verdict.own[key] ?? pair.was;
    }
  const loose = !!(e && (e.print || isArtWords(el)) && told && !told.seat.sure && told.seat.worded);
  // A hide that the film's own style attribute has ended: the same pair saved again would change nothing.
  if (lapsed.includes('hidden') && !loose) now.hidden = null;
  return {
    cls: el.getAttribute('class') ?? '',
    kin: null,
    at: 0 as FilmSeconds,
    fill: colour(now.fill),
    ink: colour(now.ink),
    radius: number(now.radius),
    most: mostRadius(el),
    size: number(now.size),
    hidden: now.hidden === 0 ? 0 : null,
    svgfill: colour(now.svgfill),
    svgstroke: colour(now.svgstroke),
    // The shape's fill shows even where no colour is offered for it, so the page calls the stroke's row Stroke, not Color.
    ...(isPart(el) && SHAPE.test(el.tagName) && fills(cs, el) ? { filled: true as const } : {}),
    entry: e ? e.id : null,
    loose,
    home: !!e && home(e, lo, hi),
    lapsed,
  };
}
