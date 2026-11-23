import type { LayerDrawn, LayerKind, LayerLook, LayerMotion } from '../../protocol.ts';
import { RealMessageChannel } from '../determinism.ts';
import type { StageRect } from '../kit/geometry.ts';
import { SKIP, isPen } from './parts.ts';

/** Rows in the list, and texts of one row. */
export const MOST = 24;
/** A box as large as this share of the stage each way is as large as the stage. */
export const FULL = 0.95;
export const FAINT = 0.02;
/** What the film itself changes, as the walk tells it: a value laid over it would stop that. */
export interface Vary {
  fill: boolean;
  ink: boolean;
  radius: boolean;
  size: boolean;
  hidden: boolean;
  svgfill: boolean;
  svgstroke: boolean;
  /** How it, or all under it, is drawn. */
  drawn: boolean;
  /** Something under it changes how it is drawn. */
  within: boolean;
  /** The number of parts of each tag it holds. */
  tags: Record<string, boolean>;
}

/** One thing as the reading finds it, look after look. */
export interface Item {
  key: string;
  path: number[];
  up: Item | null;
  el: Element;
  /** At some look as large as the stage (a camera, a world). */
  big: boolean;
  /** Its own box differs between two looks. */
  pans: boolean;
  lay: StageRect | null;
  tf: string | null;
  sig: string | null;
  moved: boolean;
  named: boolean;
  unit: boolean;
  words: boolean;
  paint: boolean;
  round: boolean | null;
  /** The classes it has at every look. */
  always: string[] | null;
  hues: Record<string, string> | null;
  vary: Vary;
  /** It draws something itself. */
  cand: boolean;
  full: number;
  shown: number;
  on: boolean[];
  op: number[];
  box: Array<StageRect | null>;
  text: string;
  /** A part of an svg drawing. */
  art: boolean;
  /** An svg, or a g in one, read part by part; false: shut for the rest of the reading; null: not decided. */
  easel: boolean | null;
  anew: boolean;
  /** A person's change is laid on it. */
  laid: boolean;
  /** A person hid it. */
  own: boolean;
  /** Something under it had a change laid on it. */
  marked: boolean;
  /** It holds something that may draw but has no row. */
  odd: boolean;
  filled: boolean;
  speck: boolean;
  /** Of the things that hold it, the outermost a person hid; false: none. */
  held: Item | false;
  hid: Item | false;
  as: string | null;
  tally: Record<string, number> | null;
  most: number;
  head: Item | null;
}

export function newItem(el: Element, key: string, path: number[], up: Item | null, named: boolean, unit: boolean): Item {
  return {
    key,
    path,
    up,
    el,
    big: false,
    pans: false,
    lay: null,
    tf: null,
    sig: null,
    moved: false,
    named,
    unit,
    words: false,
    paint: false,
    round: null,
    always: null,
    hues: null,
    vary: { fill: false, ink: false, radius: false, size: false, hidden: false, svgfill: false, svgstroke: false, drawn: false, within: false, tags: {} },
    cand: false,
    full: 0,
    shown: 0,
    on: [],
    op: [],
    box: [],
    text: '',
    art: false,
    easel: null,
    anew: false,
    laid: false,
    own: false,
    marked: false,
    odd: false,
    filled: false,
    speck: false,
    held: false,
    hid: false,
    as: null,
    tally: null,
    most: 0,
    head: null,
  };
}

/** One row as the reading describes it, before it is told to the page. */
export interface Layer {
  id: string;
  kind: LayerKind;
  round: boolean;
  drawn: LayerDrawn;
  full: boolean;
  name: string;
  texts: string[];
  spans: Array<[number, number]>;
  long: number;
  at: number;
  enter: LayerMotion;
  leave: LayerMotion;
  /** All that is drawn of it. */
  parts: Item[];
  it: Item;
  kids: Layer[];
  pack: boolean;
  many: number;
  /** A pack that holds something pinned. */
  keep: boolean;
  sole: Layer | null;
  /** The svg whose parts the row holds, and all that it draws. */
  svg: Item | null;
  inked: Item[];
  /** The level its row will stand at once a change pins it under what holds it. */
  below: number;
  n: number;
  now: LayerLook | null;
}

export function union(a: StageRect | null, b: StageRect | null): StageRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export const opacityOf = (cs: CSSStyleDeclaration): number => {
  const o = parseFloat(cs.opacity);
  return isNaN(o) ? 1 : o;
};

export const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A change is laid on the row's thing or on something in it: the cuts of the list pass over such a row, the way to take the change back. */
export const pinned = (l: Layer): boolean => l.keep || l.it.own || l.it.laid || l.it.marked;

/** The order the looks are taken in: both ends, then the middle of each gap. Whenever the time is up, the stretch has been looked at evenly. */
export function inTurn(n: number): number[] {
  const out = [0, n - 1];
  const gaps: Array<[number, number]> = [[0, n - 1]];
  for (let gap = gaps.shift(); gap; gap = gaps.shift()) {
    const m = (gap[0] + gap[1]) >> 1;
    if (m !== gap[0]) {
      out.push(m);
      gaps.push([gap[0], m], [m, gap[1]]);
    }
  }
  return out;
}

/** The page shares this thread: the reading stops every few ms to let it draw and answer. */
export function breath(): Promise<void> {
  return new Promise((go) => {
    if (!RealMessageChannel) {
      setTimeout(go, 0);
      return;
    }
    const channel = new RealMessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      go();
    };
    channel.port2.postMessage(0);
  });
}

const GAP = '\u0001';
const GAPS_AT_ENDS = /^\u0001+|\u0001+$/g;

/** A tspan starts a line when it goes back to the last x set, or before it, and down: letters laid along a line, or nudged, don't. */
function startsLine(n: Element, column: boolean | null, at: { x: string | null; y: string | null }): boolean {
  if (/^br$/i.test(n.tagName)) return true;
  if (/^tspan$/i.test(n.tagName)) {
    const x = parseFloat(n.getAttribute('x') ?? '');
    const y = parseFloat(n.getAttribute('y') ?? '');
    return n.hasAttribute('x') && (at.x === null || x <= parseFloat(at.x)) && ((parseFloat(n.getAttribute('dy') ?? '') || 0) > 0 || (at.y !== null && y > parseFloat(at.y)));
  }
  const cs = getComputedStyle(n);
  if (/^(absolute|fixed)$/.test(cs.position) || (cs.float || 'none') !== 'none') return false;
  return column !== null ? column : /^(block|flex|grid|list-item|flow-root|table|table-row|table-caption)$/.test(cs.display);
}

/**
 * An element's words with a gap where a line breaks: textContent runs lines together. Items of a flex row or a grid,
 * floats and absolute elements also compute as display: block, so display alone can't tell.
 */
function spaced(el: Element, deep: number): string {
  const cs = getComputedStyle(el);
  const grid = /grid$/.test(cs.display);
  const column = /flex$/.test(cs.display)
    ? /^column/.test(cs.flexDirection)
    : grid
      ? !/column/.test(cs.gridAutoFlow) && cs.gridTemplateColumns.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).length === 1
      : null;
  // An inline box keeps the spaces put round its lines inside it: letters each in a box of their own stay one word.
  const words = (n: Element): string => {
    const w = deep < 24 ? spaced(n, deep + 1) : (n.textContent ?? '');
    return /^inline-/.test(getComputedStyle(n).display) ? w.replace(GAPS_AT_ENDS, '') : w;
  };
  let s = '';
  const at = { x: el.getAttribute('x'), y: el.getAttribute('y') };
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n instanceof Text) s += n.data;
    else if (n instanceof Element && !SKIP.test(n.tagName) && !isPen(n)) {
      // A tspan starts a line and runs on into what follows it: the gap goes before it alone.
      s += startsLine(n, column, at) ? GAP + words(n) + (/^tspan$/i.test(n.tagName) ? '' : GAP) : words(n);
    }
    if (n instanceof Element && n.hasAttribute('x')) at.x = n.getAttribute('x');
    if (n instanceof Element && n.hasAttribute('y')) at.y = n.getAttribute('y');
  }
  return s;
}

export function wordsIn(el: Element): string {
  return tidy(el.firstElementChild ? spaced(el, 0).replace(/\u0001/g, ' ') : (el.textContent ?? ''));
}

/** What the list calls a drawing that has no name, where its kind does not say. */
export const DRAWN: Record<string, LayerDrawn> = { svg: 'graphic', g: 'group', line: 'line', path: 'path', polyline: 'path', polygon: 'polygon' };
