import type { RetouchedRecord } from '@open-artifact/motion-core';
import { inOwnColors } from '../snapshot/serialize.ts';
import { stageParts } from '../stage.ts';
import { ART } from '../layers/parts.ts';
import type { Entry, ReadMemo, Seat, Told, Verdict } from './entry.ts';
import { boxes, judge, marksOf } from './judge.ts';
import { partsOf } from './parts.ts';
import { find, kinOf, lineOf, peers, printOf, seat, wordsOf } from './seat.ts';
import type { LineMemo } from './seat.ts';
import { LAID, LAPSED, MARK, basis, beaten, entriesOf, home, rulesText, state, takes, toldAt, unmark } from './state.ts';

/**
 * Draws a moment of the stretch, in its own seconds. true: drawn; false: the film threw there; null: nothing more can
 * be drawn this load (a render gave a promise).
 */
export type DrawMoment = (s: number) => boolean | null;

/** The moments spread evenly over a stretch at which what the film itself changes is looked for. */
const LOOKS = 10;

/** A verdict rests on the entry's basis and the film, so it is kept for the runner's life (bounded): a drag, or a record put back, is not told anew. */
let known = new Map<string, Map<number, Told | null | false>>();

export const stageOf = (): HTMLElement | null => stageParts()?.stage ?? null;

/** Takes the record; the caller draws the frame again. */
export function setRecord(record: RetouchedRecord | null): void {
  unmark();
  for (const e of state.list) known.set(basis(e), e.told);
  if (known.size > 512) {
    known = new Map();
    for (const e of state.list) known.set(basis(e), e.told);
  }
  state.list = record ? entriesOf(record) : [];
  for (const e of state.list) {
    const was = known.get(basis(e));
    if (was) e.told = was;
  }
  state.sheet ??= document.createElement('style');
  state.sheet.textContent = rulesText(state.list);
}

export const anyRetouch = (): boolean => state.list.length > 0 || state.marked.length > 0;
export const isDue = (scene: string, lo: number): boolean => state.list.some((e) => e.scene === scene && !e.told.has(lo));

/** unmet: no look found it yet. absent: it was not there. undrawn: its moment could not be drawn. */
type Got = Verdict | 'unmet' | 'absent' | 'undrawn';

/**
 * Reaches the verdicts on the entries of a stretch (lo to hi) not told yet, with no mark on the stage: at each
 * entry's own moment, where its thing must stand, then at moments spread over the stretch, since what the film
 * itself changes in its course is the film's. `draw` draws a second of the stretch; `far` one anywhere in the film,
 * for an entry of another stretch.
 */
export function tell(scene: string, lo: number, hi: number, draw: DrawMoment, far: DrawMoment): void {
  const stage = stageOf();
  // A page that is not displayed computes no styles, which would read as another film: a later frame will tell.
  if (!stage || !getComputedStyle(stage).display) return;
  unmark();
  const due = state.list.filter((e) => e.scene === scene && !e.told.has(lo)).sort((p, q) => p.at - q.at);
  const seats: Array<Seat | null> = due.map(() => null);
  let last: number | null = null;
  let up = false;
  let stop = false;
  let memo: ReadMemo = {};
  const drawAt = (how: DrawMoment, s: number): void => {
    last = s;
    const drawn = how(s);
    stop = drawn === null;
    up = drawn !== false && !stop;
    memo = {};
  };
  const got: Got[] = due.map((e, n) => {
    if (!home(e, lo, hi)) return 'unmet';
    if (e.at !== last && !stop) drawAt(draw, e.at);
    if (!up) return 'undrawn';
    return inOwnColors(() => {
      const found = seat(stage, e, memo, true);
      seats[n] = found;
      return found ? (judge(stage, found.el, e, null, true) ?? 'absent') : 'absent';
    });
  });
  /*
   * A part of an svg (but an svg text with no hide) whose own moment lies in another stretch: its print tells its
   * turn in the drawing, which the film may change by chapter, so it is seated at its own moment, by `far`.
   */
  const afar = due.map((e) => !stop && !home(e, lo, hi) && ART.test(e.tag) && (e.tag !== 'text' || !!e.pairs.hidden));
  const before = stop;
  last = null;
  due.forEach((e, n) => {
    if (!afar[n]) return;
    if (e.at !== last && !stop) drawAt(far, e.at);
    if (!up) return;
    const found = seat(stage, e, memo, true);
    if (!found) got[n] = 'absent';
    // A part with words is found here by its words, as html lines are.
    else seats[n] = found.worded ? null : found;
  });
  if (stop) afar.forEach((a, n) => a && (got[n] = 'undrawn'));
  stop = before;
  const look = (e: Entry, n: number): void => {
    const so = got[n];
    if (so === 'absent' || so === 'undrawn' || so === undefined) return;
    const at = seats[n] ?? seat(stage, e, memo, false);
    seats[n] = at;
    if (!at) return;
    const el = find(stage, e, at, memo);
    if (el && (at.says === undefined || printOf(stage, el, memo) === at.says)) got[n] = judge(stage, el, e, so === 'unmet' ? null : so, false) ?? so;
  };
  const looks = (some: (n: number) => boolean): void => {
    for (let i = 0; i < LOOKS && !stop; i++) {
      const drawn = draw(lo + ((hi - lo) * i) / (LOOKS - 1));
      stop = drawn === null;
      memo = {};
      if (drawn !== false && !stop) inOwnColors(() => due.forEach((e, n) => some(n) && look(e, n)));
    }
  };
  looks(() => true);
  /*
   * An entry of another stretch no look found by its print. If `far`, at its own moment, finds it by its turn (it was
   * reworded, or the print is on several), that node is its node here while on the stage, and a look counts only while
   * the node has the words it had then.
   */
  const late = due.map((e, n) => !stop && !!e.print && !home(e, lo, hi) && got[n] === 'unmet' && !seats[n]);
  const whole = stop;
  if (late.includes(true)) {
    last = null;
    due.forEach((e, n) => {
      if (!late[n]) return;
      if (e.at !== last && !stop) drawAt(far, e.at);
      const found = up ? seat(stage, e, memo, true) : null;
      if (found && !found.sure) seats[n] = { el: found.el, sure: false, worded: found.worded, k: 0, n: -1, print: null, says: printOf(stage, found.el, memo) };
    });
    if (late.some((l, n) => l && seats[n])) looks((n) => !!late[n] && !!seats[n]);
    if (stop) late.forEach((l, n) => l && (got[n] = 'undrawn'));
    stop = whole;
  }
  due.forEach((e, n) => {
    const verdict = got[n];
    const at = seats[n];
    // A hide does not count on a thing with words found by its turn: it could be another thing, and nobody would see why that is gone.
    if (typeof verdict === 'object' && e.pairs.hidden && e.print && at && !at.sure && at.worded) verdict.holds.hidden = false;
    e.told.set(lo, stop ? null : typeof verdict === 'object' && at ? { verdict, seat: at, laid: marksOf(e, verdict, true), lapsed: marksOf(e, verdict, false) } : verdict === 'undrawn' ? null : false);
  });
}

/** Marks what is laid on the stretch just drawn, which starts at lo. scene null: nothing is laid (a rough scene is a sketch). */
export function apply(scene: string | null, lo: number): void {
  if (state.marked.length) unmark();
  const stage = stageOf();
  if (!state.list.length || scene === null || !stage || !state.sheet) return;
  if (state.sheet.parentNode !== stage) stage.appendChild(state.sheet);
  const out = beaten(scene, lo);
  const memo: ReadMemo = {};
  const on = new Map<Element, Entry>();
  state.list.forEach((e, i) => {
    const told = e.scene === scene ? toldAt(e, lo) : null;
    const el = told && !out.includes(e) ? find(stage, e, told.seat, memo) : null;
    if (!told || !el) return;
    // In a film that makes its nodes anew two entries seated on two nodes may meet on one.
    const w = on.get(el);
    if (w && !takes(e, w, lo)) return;
    el.setAttribute(MARK, String(i));
    el.setAttribute(LAID, told.laid);
    if (told.lapsed) el.setAttribute(LAPSED, told.lapsed);
    else el.removeAttribute(LAPSED);
    if (!w) state.marked.push(el);
    on.set(el, e);
  });
}

/** The entries whose own moment lies in the stretch and whose thing could not be told then, or is another entry's. */
export function lostIn(scene: string, lo: number, hi: number): string[] {
  const out = beaten(scene, lo);
  return state.list.filter((e) => e.scene === scene && home(e, lo, hi) && (e.told.get(lo) === false || out.includes(e))).map((e) => e.id);
}

/**
 * Of those, the hides that would count on their thing, where another entry's hide is laid: the thing is hidden all the
 * same, so the page says nothing of them.
 */
export function underHideIn(scene: string, lo: number, hi: number): string[] {
  const by = new Map<Element, Entry>();
  for (const e of state.list) {
    const told = e.scene === scene ? toldAt(e, lo) : null;
    if (!told) continue;
    const w = by.get(told.seat.el);
    if (!w || takes(e, w, lo)) by.set(told.seat.el, e);
  }
  return beaten(scene, lo)
    .filter((e) => {
      const told = toldAt(e, lo);
      const w = told ? by.get(told.seat.el) : undefined;
      return !!told && home(e, lo, hi) && told.verdict.holds.hidden === true && w !== undefined && w !== e && toldAt(w, lo)?.verdict.holds.hidden === true;
    })
    .map((e) => e.id);
}

/** Told of each scene's box as it comes up: notes the classes in it, so a class counts as an element's own alike in every runner. */
export function noteBox(node: HTMLElement): void {
  const names = new Set<string>();
  for (const el of Array.from(node.getElementsByTagName('*'))) for (const name of Array.from(el.classList)) names.add(name);
  boxes.push({ node, names });
}

/** The kin of an element held to the classes `cls`, on the stage as it is now. */
export function kinFor(el: Element, cls: string, memo: ReadMemo): string | null {
  const stage = stageOf();
  if (!stage) return null;
  return kinOf(stage, peers(stage, memo, el.tagName.toLowerCase()), el, cls.split(' ').filter(Boolean), memo);
}

/** The parts a hide on this g inside an svg would also be found by, on the stage as it is now; null: none would hold. */
export function partsFor(el: Element, memo: ReadMemo): string | null {
  const stage = stageOf();
  if (!stage) return null;
  // Lists the stage's svg parts, which the hashes are counted against.
  peers(stage, memo, 'g');
  return wordsOf(el, memo) ? null : partsOf(el, memo);
}

/** The line of words a text node of the stage is part of. */
export function lineFor(node: Node, memo: Map<Element, LineMemo>): string | null {
  const stage = stageOf();
  return stage ? inOwnColors(() => lineOf(stage, node, memo)) : null;
}
