import { parseRetouchedRecord } from '@open-artifact/motion-core';
import type { RetouchedRecord } from '@open-artifact/motion-core';
import { PAINT, PAINT_KEYS, SHAPE } from '../layers/parts.ts';
import type { Entry, Told } from './entry.ts';
import { CORNERS, KEYS } from './look.ts';
import type { Key } from './look.ts';
import { TYPE_KEYS, typeRule } from './type-style.ts';

/*
 * What a person did by hand to the look of things, as this stage lays it. After each frame is drawn the thing's
 * element is marked with attributes, and one sheet in the stage styles what is marked. So the live view, the
 * thumbnails, an export and a still made offline all show it; the film's own code and inline styles are not touched,
 * and come back when the mark goes.
 */

/** Which entry marks the element. */
export const MARK = 'data-film-over';
/** What of it is laid on the element: its keys; for the radius, the corners that take it; for an svg text's ink, "paint". */
export const LAID = 'data-film-laid';
/** What of it no longer counts. */
export const LAPSED = 'data-film-lapsed';

export const ID = /^([a-z][a-z0-9-]{0,31}):(\d{1,3}(?:\.\d{1,3}){0,23})\/([a-z][a-z0-9-]{0,31})$/;
const KIN = /^(\d{1,4})\/(\d{1,4})(?:\/([0-9a-z]{1,7}))?$/;

export const state = {
  list: [] as Entry[],
  /** The elements this stage marked at its last pass: a mark a film's copy of a node brings along does not count. */
  marked: [] as Element[],
  sheet: null as HTMLStyleElement | null,
};

/** The record's entries as this stage lays them; the record is parsed again, since this is the trust boundary for the sheet. */
export function entriesOf(record: RetouchedRecord): Entry[] {
  const out: Entry[] = [];
  for (const layer of parseRetouchedRecord({ v: 1, layers: record.layers }).layers) {
    const id = ID.exec(layer.id);
    const kin = KIN.exec(layer.kin);
    if (!id || !kin) continue;
    const tag = id[3]!;
    const entry: Entry = {
      id: layer.id,
      at: layer.at,
      told: new Map(),
      scene: id[1]!,
      tag,
      cls: layer.cls.split(/\s+/).filter(Boolean),
      kin: layer.kin,
      k: Number(kin[1]),
      n: Number(kin[2]),
      print: kin[3] ?? null,
      parts: layer.parts ? layer.parts.split('.') : null,
      pairs: {},
    };
    for (const key of KEYS) {
      const pair = layer[key];
      if (!pair) continue;
      if ((key === 'svgfill' || key === 'svgstroke') && !SHAPE.test(tag)) continue;
      entry.pairs[key] = { was: pair.was, v: pair.v };
    }
    // With no pair it lays it changes nothing.
    if (KEYS.some((key) => entry.pairs[key])) out.push(entry);
  }
  return out;
}

/** The sheet's text. Of a pair only `v` reaches it, a colour, a number or a word out of a closed set; no selector is made of anything in the record. */
export function rulesText(list: readonly Entry[]): string {
  return list
    .map((e, n) => {
      const at = (what: string): string => '[' + MARK + '="' + n + '"][' + LAID + '~="' + what + '"]';
      // Twice: in a layer it also wins over every rule of the film's that says !important outside one; a browser that knows no layers takes the first.
      const twice = (rule: string): string => rule + '@layer film-laid{' + rule + '}';
      const colour = (key: Key): string => String(e.pairs[key]?.v ?? '').toLowerCase();
      let out = '';
      if (e.pairs.fill) out += at('fill') + '{background-image:none!important;background-color:' + colour('fill') + '!important}';
      if (e.pairs.ink) out += twice(at('ink') + '{color:' + colour('ink') + '!important}') + twice(at('paint') + '{fill:' + colour('ink') + '!important}');
      // The property, not a transform: the film's own transform, and the point it turns on, go on counting.
      if (e.pairs.size) out += at('size') + '{scale:' + Number(e.pairs.size.v) + '!important}';
      if (e.pairs.radius) for (const corner of CORNERS) out += at(corner) + '{border-' + corner + '-radius:' + Number(e.pairs.radius.v) + 'px!important}';
      // Visibility keeps its room, so nothing round it moves; on all under it too, since a child that says visible would otherwise show.
      if (e.pairs.hidden) out += at('hidden') + ',' + at('hidden') + ' *{visibility:hidden!important}';
      for (const key of TYPE_KEYS) {
        const pair = e.pairs[key];
        if (pair) out += twice(at(key) + '{' + typeRule(key, pair.v) + '}');
      }
      for (const key of PAINT_KEYS) if (e.pairs[key]) out += twice(at(key) + '{' + PAINT[key] + ':' + colour(key) + '!important}');
      return out;
    })
    .join('\n');
}

export function unmark(): void {
  for (const el of state.marked) {
    el.removeAttribute(MARK);
    el.removeAttribute(LAID);
    el.removeAttribute(LAPSED);
  }
  state.marked = [];
}

/** The entry that marks an element. */
export function marks(el: Element): Entry | undefined {
  if (!state.marked.includes(el)) return undefined;
  const i = el.getAttribute(MARK);
  return i !== null && /^\d+$/.test(i) ? state.list[Number(i)] : undefined;
}

export const lapsedOn = (el: Element): string[] => (el.getAttribute(LAPSED) ?? '').split(' ').filter(Boolean);

export function toldAt(e: Entry, lo: number): Told | null {
  const told = e.told.get(lo);
  return told ? told : null;
}

/** Of an entry of the scene nothing could be told in this load: which element is its own is not known, so no look is told of any. */
export const blind = (scene: string, lo: number): boolean => state.list.some((e) => e.scene === scene && e.told.get(lo) === null);

/** An entry's own moment lies in the stretch: a scene's always does, since it counts from the scene's start. */
export const home = (e: Entry, lo: number, hi: number): boolean => e.scene !== 'film' || (e.at >= lo && e.at < hi);

/**
 * One found otherwise keeps an element from one found by its parts, and one found by its print from one found by its
 * turn; else the later in the record, changed last, takes it.
 */
export function takes(e: Entry, w: Entry, lo: number): boolean {
  const a = toldAt(e, lo)?.seat;
  const b = toldAt(w, lo)?.seat;
  if (!a?.held !== !b?.held) return !a?.held;
  return !!a?.sure || !b?.sure;
}

/** Of entries seated on one node one is laid; the others, which apply passes over and lost names. */
export function beaten(scene: string, lo: number): Entry[] {
  const by = new Map<Element, Entry>();
  const out: Entry[] = [];
  for (const e of state.list) {
    const told = e.scene === scene ? toldAt(e, lo) : null;
    if (!told) continue;
    const w = by.get(told.seat.el);
    if (w && !takes(e, w, lo)) {
      out.push(e);
      continue;
    }
    if (w) out.push(w);
    by.set(told.seat.el, e);
  }
  return out;
}

/** All of an entry that a verdict on it rests on: not `v`. */
export function basis(e: Entry): string {
  return JSON.stringify([e.id, e.cls, e.kin, e.parts, e.at, ...KEYS.map((key) => e.pairs[key]?.was ?? null)]);
}
