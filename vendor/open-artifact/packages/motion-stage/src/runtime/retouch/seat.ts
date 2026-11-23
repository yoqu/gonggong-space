import { inOwnColors } from '../snapshot/serialize.ts';
import { ART, SKIP, UNIT, drawnAs, isArtWords, isPart, isWords, kidsOf, saidOf } from '../layers/parts.ts';
import type { Entry, Peer, ReadMemo, Seat } from './entry.ts';
import { holds } from './parts.ts';

/*
 * How an entry of the record finds its thing again on a stage that may have been drawn anew: by its tag and classes,
 * its turn among like things, and its print, a short hash of its words.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What each element met on the way to a line of words is known as, for one report. */
export interface LineMemo {
  k: number;
  words: boolean | null;
  places: Map<Element, number> | null;
}

/**
 * The line of words a text node is part of, as "place/tag": which child of which, from the stage down, then the tag.
 * null: there is none, or the way leads into a picture, the cursor or the fx canvas, each of which is one thing. An
 * inline svg is entered only through g parts, down to a text.
 */
export function lineOf(stage: HTMLElement, node: Node, memo: Map<Element, LineMemo>): string | null {
  const way: Element[] = [];
  let el: Element | null = node.parentElement;
  for (; el && el !== stage; el = el.parentElement) way.unshift(el);
  if (!el) return null;
  const of = (x: Element): LineMemo => {
    let known = memo.get(x);
    if (!known) memo.set(x, (known = { k: -1, words: null, places: null }));
    return known;
  };
  const path: number[] = [];
  let up: Element = stage;
  for (const step of way) {
    const above = of(up);
    const known = of(step);
    if (!above.places) {
      const places = new Map<Element, number>();
      kidsOf(up).forEach((child, k) => places.set(child, k));
      above.places = places;
    }
    if (known.words === null) {
      const k = above.places.get(step);
      const art = step.namespaceURI === SVG_NS;
      const shut = art && up.namespaceURI === step.namespaceURI ? !(isPart(step) && /^(g|text)$/i.test(step.tagName)) : !art && UNIT.test(step.tagName);
      known.k = k === undefined || (step.id === 'fx' && up === stage) || shut || step.classList.contains('film-cursor') ? -1 : k;
      known.words = known.k >= 0 && (!art || isArtWords(step)) && isWords(step);
    }
    if (known.k < 0) return null;
    path.push(known.k);
    if (known.words) return path.join('.') + '/' + step.tagName.toLowerCase();
    up = step;
  }
  return null;
}

export function fits(el: Element, tag: string, cls: readonly string[]): boolean {
  return el.tagName.toLowerCase() === tag && cls.every((c) => el.classList.contains(c));
}

export function standsAt(stage: HTMLElement, path: readonly number[]): Element | null {
  let el: Element | undefined = stage;
  for (let k = 0; el && k < path.length; k++) el = kidsOf(el)[path[k]!];
  return el ?? null;
}

/** The things on the stage as drawn, shown or not, in document order: not the fx canvas, nor what is inside a picture, the cursor or a line of words. */
function things(stage: HTMLElement): Element[] {
  const out: Element[] = [];
  const walk = (up: Element): void => {
    for (const el of kidsOf(up)) {
      if (el.id === 'fx' && up === stage) continue;
      out.push(el);
      if (!UNIT.test(el.tagName) && !el.classList.contains('film-cursor') && !isWords(el)) walk(el);
    }
  };
  inOwnColors(() => walk(stage));
  return out;
}

/** The parts inside the svgs among `all`, in document order, listed apart so every other thing counts as if the svgs were closed. */
function partsIn(all: readonly Element[]): Element[] {
  const out: Element[] = [];
  const walk = (up: Element): void => {
    for (const el of kidsOf(up).filter(isPart)) {
      out.push(el);
      if (/^g$/i.test(el.tagName)) walk(el);
    }
  };
  all.filter((el) => /^svg$/i.test(el.tagName)).forEach(walk);
  return out;
}

/** Where a part stands in its drawing: down from the svg, its turn among the parts of its tag beside it, their number, and what its own attributes say. */
function standing(el: Element, memo: ReadMemo): string {
  const turns = (memo.turns ??= new Map());
  const parent = el.parentElement;
  if (!parent) return '';
  if (!turns.has(el)) {
    const all = kidsOf(parent).filter(isPart);
    const n = new Map<string, number>();
    const k = new Map<string, number>();
    for (const c of all) n.set(c.tagName, (n.get(c.tagName) ?? 0) + 1);
    for (const c of all) {
      k.set(c.tagName, (k.get(c.tagName) ?? 0) + 1);
      turns.set(c, k.get(c.tagName) + '/' + n.get(c.tagName) + ' ' + saidOf(c));
    }
  }
  return (isPart(parent) ? standing(parent, memo) : saidOf(parent)) + ' > ' + (turns.get(el) ?? '');
}

/** An element's words, a sheet's or a script's text left out. */
export function wordsOf(el: Element, memo: ReadMemo): string {
  const words = (memo.words ??= new Map());
  const known = words.get(el);
  if (known !== undefined) return known;
  let s = '';
  for (let n = el.firstChild; n; n = n.nextSibling) s += n instanceof Text ? n.data : n instanceof Element && !SKIP.test(n.tagName) ? ' ' + wordsOf(n, memo) + ' ' : '';
  const out = s.replace(/\s+/g, ' ').trim();
  words.set(el, out);
  return out;
}

/**
 * A thing's print: a short hash (FNV-1a) of its words; with none, of "|" and the words of the nearest element round
 * it that has some; for a part of an svg with none, of "#", where it stands in the drawing and how it is drawn.
 */
export function printOf(stage: HTMLElement, el: Element, memo: ReadMemo): string {
  let s = wordsOf(el, memo);
  if (!s && isPart(el)) s = '#' + standing(el, memo) + ' ' + drawnAs(el, false, (memo.drawn ??= new Map()));
  else if (!s) {
    for (let up = el.parentElement; up && up !== stage && !s; up = up.parentElement) s = wordsOf(up, memo);
    s = '|' + s;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The things of a tag as they are now, their classes as values: the stage may be drawn anew before they are read. */
export function peers(stage: HTMLElement, memo: ReadMemo, tag: string): Peer[] {
  const all = (memo.all ??= things(stage));
  const tags = (memo.tags ??= new Map());
  const known = tags.get(tag);
  if (known) return known;
  const pool = ART.test(tag) ? (memo.art ??= all.concat(partsIn(all))) : all;
  const out = pool.filter((el) => el.tagName.toLowerCase() === tag).map((el) => ({ el, cls: Array.from(el.classList), print: null }));
  tags.set(tag, out);
  return out;
}

/** Those of them that have every class of `cls`, with their prints, made now unless they were before. */
export function like(stage: HTMLElement, all: Peer[], cls: readonly string[], memo: ReadMemo): Peer[] {
  return all
    .filter((x) => cls.every((c) => x.cls.includes(c)))
    .map((x) => {
      if (x.print === null) x.print = printOf(stage, x.el, memo);
      return x;
    });
}

/** An entry's kin: which of how many like things the element is, then its print if no other of them has it. null: it is not one of them. */
export function kinOf(stage: HTMLElement, all: Peer[], el: Element, cls: readonly string[], memo: ReadMemo): string | null {
  const l = like(stage, all, cls, memo);
  const k = l.findIndex((x) => x.el === el);
  if (k < 0) return null;
  return k + '/' + l.length + (l.some((x, i) => i !== k && x.print === l[k]!.print) ? '' : '/' + l[k]!.print);
}

/** A part of an svg is found by its print alone, but for an svg text that the entry does not hide. */
const byPrintAlone =
  (e: Entry) =>
  (x: Peer): boolean =>
    isPart(x.el) && (!!e.pairs.hidden || !isArtWords(x.el));

/**
 * The hidden g of a scene that its entry's print no longer finds, after a change inside it: only where one g had the
 * entry's classes when it was saved and one has them now, with no other class and no words, and it still holds the
 * entry's parts.
 */
function byParts(e: Entry, l: readonly Peer[], memo: ReadMemo): Peer | null {
  const only = l.length === 1 ? l[0]! : null;
  if (!only || !e.pairs.hidden || !e.print || !e.parts || e.scene === 'film' || e.n !== 1) return null;
  if (!/^g$/i.test(only.el.tagName) || !only.cls.every((c) => e.cls.includes(c)) || wordsOf(only.el, memo)) return null;
  return holds(only.el, e.parts, memo) ? only : null;
}

/**
 * An entry's thing on the stage as drawn: the one like thing with its print; else, among as many as there were, the
 * one in its turn, unless its print is on others only; and a hidden g whose print is on nothing, by its parts. null:
 * it cannot be told. `own`: at the entry's own moment; in another stretch one that has a print is found by that alone.
 */
export function seat(stage: HTMLElement, e: Entry, memo: ReadMemo, own: boolean): Seat | null {
  const l = like(stage, peers(stage, memo, e.tag), e.cls, memo);
  const said = e.print ? l.filter((x) => x.print === e.print) : [];
  const inTurn = l[e.k];
  const found = said.length === 1 ? said[0]! : !l.some(byPrintAlone(e)) && (own || !e.print) && l.length === e.n && inTurn && (!said.length || said.includes(inTurn)) ? inTurn : null;
  const held = found ? null : byParts(e, l, memo);
  const it = found ?? held;
  if (!it) return null;
  const shared = like(stage, peers(stage, memo, e.tag), [], memo).some((x) => x !== it && x.print === it.print);
  return {
    el: it.el,
    sure: said.length === 1,
    ...(held ? { held: true, had: it.print } : {}),
    worded: !!wordsOf(it.el, memo),
    k: l.indexOf(it),
    n: l.length,
    print: shared ? null : it.print,
  };
}

/**
 * The element an entry is laid on now: the node it was found on, while that is on the stage. Once the node has left,
 * the like thing in the same turn while there are as many; else the one thing of its tag with the print it had then.
 * What is found by its print alone: the one like part with the entry's print, or the print it had when its parts found it.
 */
export function find(stage: HTMLElement, e: Entry, s: Seat, memo: ReadMemo): Element | null {
  if (stage.contains(s.el)) return s.el;
  const all = peers(stage, memo, e.tag);
  const l = like(stage, all, e.cls, memo);
  const print = s.held ? s.had : e.print;
  const mine = (e.pairs.hidden || e.pairs.svgfill || e.pairs.svgstroke) && e.print ? l.filter((x) => x.print === print) : [];
  if (mine.length || l.some(byPrintAlone(e))) return mine.length === 1 ? mine[0]!.el : null;
  if (l.length === s.n) return l[s.k]?.el ?? null;
  const said = s.print === null ? [] : like(stage, all, [], memo).filter((x) => x.print === s.print);
  return said.length === 1 ? said[0]!.el : null;
}
