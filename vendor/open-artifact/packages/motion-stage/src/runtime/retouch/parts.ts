import { RETOUCH_PARTS_MANY as MANY, RETOUCH_PARTS_NAMES as NAMES } from '@open-artifact/motion-core';
import { isPart, kidsOf, saidOf } from '../layers/parts.ts';
import type { ReadMemo } from './entry.ts';

/*
 * What a hide on a g inside an svg is also found by (an entry's "parts"), once a change inside the g ends its print:
 * a hash of each named g in it and of each of its shapes. A g whose shapes are mostly still there, with little put in,
 * is still the g that was hidden. The hashes match the player's that the record is shared with, to the letter.
 */

/** The longest a `parts` gets. */
const MOST = 32;
/** What a shape's outline and place are written in. A missing one counts as the word "null". */
const OUTLINE = ['d', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'transform', 'xlink:href'];

/** FNV-1a over UTF-16 code units, unsigned. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const isGroup = (el: Element): boolean => /^g$/i.test(el.tagName);

/** The name a g has of its own: its id, its classes, its data-label and its aria-label. */
function named(g: Element): string {
  return [g.id, g.getAttribute('class') ?? '', g.getAttribute('data-label') ?? '', g.getAttribute('aria-label') ?? ''].join(' ').trim();
}

/** What a g is known by: the shapes under it (parts that are no g's) and the g's under it that have a name, however deep. */
function piecesIn(up: Element, out: Element[] = []): Element[] {
  for (const el of kidsOf(up).filter(isPart)) {
    if (!isGroup(el) || named(el)) out.push(el);
    if (isGroup(el)) piecesIn(el, out);
  }
  return out;
}

/**
 * The paint written on the svg and the g's round a part, as one short hash. A holder's tag, id and classes do not
 * count, so a drawing is known again under another name; a holder with no paint adds nothing, so a new wrapper
 * changes nothing.
 */
function lent(el: Element, memo: ReadMemo): string {
  const up = el.parentElement;
  if (!up) return '';
  const known = (memo.lent ??= new Map()).get(up);
  if (known !== undefined) return known;
  const above = isPart(up) ? lent(up, memo) : '';
  const paint = saidOf(up).slice((up.tagName + ' ' + up.id + ' ' + (up.getAttribute('class') ?? '')).length);
  const out = /\S/.test(paint) ? String(fnv(above + paint)) : above;
  memo.lent.set(up, out);
  return out;
}

/**
 * A piece in six hex digits. A g: a hash of its name, led by 0, which tells it from a shape. A shape: a hash from
 * 100000 up of how it is written: what its own attributes say (saidOf), its outline and place, and the paint it may
 * take from what holds it.
 */
export function written(el: Element, memo: ReadMemo): string {
  const known = (memo.written ??= new Map()).get(el);
  if (known !== undefined) return known;
  const n = isGroup(el)
    ? fnv(named(el)) >>> 12
    : ((fnv(lent(el, memo) + saidOf(el) + OUTLINE.map((name) => ' ' + String(el.getAttribute(name))).join('')) >>> 8) % 0xf00000) + 0x100000;
  const out = ('00000' + n.toString(16)).slice(-6);
  memo.written.set(el, out);
  return out;
}

/** How many of the pieces are written each way. */
function tally(pieces: readonly Element[], memo: ReadMemo): Map<string, number> {
  const n = new Map<string, number>();
  for (const el of pieces) {
    const w = written(el, memo);
    n.set(w, (n.get(w) ?? 0) + 1);
  }
  return n;
}

/** The shapes on the whole stage, tallied. `memo.art` is read: the caller has listed the stage's g's (peers). */
function onStage(memo: ReadMemo): Map<string, number> {
  return (memo.pieces ??= tally((memo.art ?? []).filter((el) => isPart(el) && !isGroup(el)), memo));
}

/** A g holds something that may draw and is not read: a nested svg, a link, a switch, the kit's marks, what a foreignObject holds. */
function odd(g: Element): boolean {
  return Array.from(g.getElementsByTagName('*')).some(
    (el) => /^(svg|a|switch)$/i.test(el.tagName) || el.hasAttribute('data-film-mark') || /^foreignObject$/i.test(el.parentElement?.tagName ?? ''),
  );
}

/** A use on the stage draws a copy of the g, which would be hidden with it. */
function copied(g: Element, memo: ReadMemo): boolean {
  return !!g.id && (memo.art ?? []).some((el) => /^use$/i.test(el.tagName) && (el.getAttribute('href') || el.getAttribute('xlink:href')) === '#' + g.id);
}

/** The lowest of some hashes, none kept more than MANY times, so that many alike do not crowd out the rest. */
function lowest(hashes: readonly string[], most: number): string[] {
  return hashes
    .slice()
    .sort()
    .filter((w, i, all) => w !== all[i - MANY])
    .slice(0, most);
}

/**
 * The `parts` of an entry that hides this g now: the lowest hashes of the named g's in it (NAMES at most), then of its
 * shapes, MOST in all; those kept do not depend on the drawing's order. null: it holds what may draw unread, or at most
 * half of its shapes stand only in it, so a copy of it could pass for it. The caller has seen that it has no words.
 */
export function partsOf(g: Element, memo: ReadMemo): string | null {
  const own = piecesIn(g);
  const inside = tally(own, memo);
  const all = onStage(memo);
  const said = own.map((el) => written(el, memo));
  const names = lowest(
    said.filter((w) => w < '1'),
    NAMES,
  );
  const shapes = said.filter((w) => w >= '1');
  if (odd(g) || 2 * shapes.filter((w) => all.get(w) === inside.get(w)).length <= shapes.length) return null;
  return names.concat(lowest(shapes, MOST - names.length)).join('.');
}

/**
 * Whether a g is still the one that held these pieces: more of the saved shapes are in it than elsewhere on the
 * stage, and over three quarters of them are (or nothing new stands in it); and little was put in, so that not much is
 * hidden that nobody hid: new shapes are at most a third of its shapes, and under a g whose name is new, or on more g's
 * than were saved, stand only saved shapes. Nor may it hold what draws unread, or be drawn again by a use.
 */
export function holds(g: Element, parts: readonly string[], memo: ReadMemo): boolean {
  const inside = tally(piecesIn(g), memo);
  const all = onStage(memo);
  const times = new Map<string, number>();
  const seen = new Map<string, number>();
  const shapes = parts.filter((w) => w >= '1');
  // Where all MOST places are used, a shape hashed above the highest saved may be saved or new.
  const top = parts.length < MOST ? 'g' : parts[MOST - 1]!;
  // More of a piece than were saved; one saved MANY times may have been there any number of times.
  const over = (w: string, n: number): boolean => n > (times.get(w) ?? 0) && times.get(w) !== MANY;
  let here = 0;
  let away = 0;
  let old = 0;
  let fresh = 0;
  let dark = 0;
  let alien = false;
  for (const w of parts) {
    const t = (times.get(w) ?? 0) + 1;
    times.set(w, t);
    if (w < '1') continue;
    if (t <= (inside.get(w) ?? 0)) here++;
    if (t <= (all.get(w) ?? 0) - (inside.get(w) ?? 0)) away++;
  }
  const walk = (up: Element, strange: boolean): void => {
    for (const el of kidsOf(up).filter(isPart)) {
      const w = written(el, memo);
      if (isGroup(el)) {
        walk(el, strange || over(w, inside.get(w) ?? 0));
        continue;
      }
      const n = (seen.get(w) ?? 0) + 1;
      seen.set(w, n);
      if (!over(w, n)) old++;
      else if (w < top) fresh++;
      else dark++;
      if (strange && over(w, inside.get(w) ?? 0)) alien = true;
    }
  };
  walk(g, false);
  return here > away && !odd(g) && !copied(g, memo) && !alien && 3 * fresh <= old + fresh && (4 * here > 3 * shapes.length || !(fresh || dark));
}
