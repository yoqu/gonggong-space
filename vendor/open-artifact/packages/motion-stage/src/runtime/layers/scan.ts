import type { PlaySeconds } from '@open-artifact/motion-core';
import type { LayerBox, LayerLook, LayerRow, LayersReport } from '../../protocol.ts';
import { srect } from '../kit/geometry.ts';
import type { StageRect } from '../kit/geometry.ts';
import type { ReadMemo } from '../retouch/entry.ts';
import { inOwnColors } from '../snapshot/serialize.ts';
import { stageSize } from '../stage-size.ts';
import { lookOf } from './describe.ts';
import type { LookSys, Stretch } from './describe.ts';
import { MOST, breath, inTurn, pinned, union } from './item.ts';
import type { Item, Layer } from './item.ts';
import { SHAPE, fills, showsPaint } from './parts.ts';
import { buildRows } from './rows.ts';
import { lookAt } from './walk.ts';
import type { Reading } from './walk.ts';

const MOST_LOOKS = 96;
const FEWEST_LOOKS = 5;
const STEP_S = 1 / 15;
const SLICE_MS = 12;
const WHOLE_MS = 1500;
const LAST_MS = 4000;
const MOST_TOLD = 400;
const DEEP = 4;

export interface ScanSys extends LookSys {
  stage: HTMLElement;
  /** Draws a played moment at once; throws where it cannot. */
  render(t: number): void;
  /** The record's entries for the stretch on show that find nothing. */
  lost(): string[];
  /** Of those, the hides whose thing is hidden by another entry all the same. */
  underHide(): string[];
}

export interface LayersAsk {
  seq: number;
  from: number;
  to: number;
  at: number;
  scene: string | null;
}

interface Kept {
  key: string;
  list: Layer[];
  reading: Reading;
  n: number;
}

/** The last reading, kept while the stretch asked of is the same: a new moment on show needs only a new look. */
let kept: Kept | null = null;

export const forgetReading = (): void => {
  kept = null;
};

const boxOf = (r: StageRect): LayerBox => [r.x, r.y, r.w, r.h];

/** The box round an element's text alone: a Range over the element would also take in each child element's whole box. */
function wordsBox(el: Element): StageRect | null {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const span = doc.createRange();
  let out: StageRect | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n instanceof Text) || !/\S/.test(n.data)) continue;
    span.selectNodeContents(n);
    const r = srect(span);
    if (r.w > 0 && r.h > 0) out = union(out, r);
  }
  return out;
}

/**
 * Reads the layers of a stretch: what is on the picture, when, how it comes and goes, and how the film draws it at the
 * moment on show. `gone`: a newer question has come, or none is wanted any more; the reading then ends with null.
 */
export async function scanLayers(d: LayersAsk, sys: ScanSys, gone: () => boolean): Promise<LayersReport | null> {
  const stage = sys.stage;
  const W = stageSize.width;
  const H = stageSize.height;
  const from = Math.max(0, d.from || 0);
  const to = Math.max(from + 0.01, d.to || 0);
  const stretch = d.scene || 'film';
  if (srect(stage).w < 1) throw new Error('the page has no layout');
  const key = from + '|' + to;
  let read = kept && kept.key === key ? kept : null;
  if (!read) {
    const reading: Reading = { stage, W, H, prefix: d.scene ? d.scene + '-' : null, els: new Map(), nodes: new WeakMap(), used: new Set() };
    const all = Math.max(8, Math.min(MOST_LOOKS, Math.ceil((to - from) / STEP_S)));
    const turn = inTurn(all);
    const taken: number[] = [];
    let spent = 0;
    const moment = (i: number): number => from + ((to - from - 1 / 240) * i) / (all - 1);
    let s0 = performance.now();
    for (let q = 0; q < turn.length; q++) {
      // A film that is slow to draw is looked at less often.
      if ((spent > WHOLE_MS && q >= FEWEST_LOOKS) || spent > LAST_MS) break;
      if (performance.now() - s0 > SLICE_MS) {
        await breath();
        if (gone()) return null;
        s0 = performance.now();
      }
      const i = turn[q] ?? 0;
      const l0 = performance.now();
      lookAt(reading, sys.render, moment(i), i, false);
      spent += performance.now() - l0;
      taken.push(i);
    }
    taken.sort((a, b) => a - b);
    const n = taken.length;
    const times = taken.map(moment);
    for (const it of reading.els.values()) {
      const on = it.on;
      const op = it.op;
      const box = it.box;
      it.on = taken.map((i) => on[i] ?? false);
      it.op = taken.map((i) => op[i] ?? 0);
      it.box = taken.map((i) => box[i] ?? null);
    }
    const s: Stretch = { W, H, from, to, n, times, stretch, prefix: reading.prefix };
    read = { key, list: buildRows(s, reading.els), reading, n };
    // A reading that found nothing is not kept: the page may have been parked.
    kept = read.list.length ? read : null;
  }
  const reading = read.reading;
  const at = Math.max(from, Math.min(to - 1 / 240, d.at || 0));
  const NOW = read.n;
  for (const it of reading.els.values()) {
    it.on[NOW] = false;
    it.box[NOW] = null;
  }
  lookAt(reading, sys.render, at, NOW, true);
  /*
   * What each row shows of what it holds: DEEP levels, MOST to a row and MOST_TOLD rows in all, shared out level by
   * level. A cut takes all that is pinned, then what is on the picture now, which a press can pick, and keeps the order.
   */
  const memo: ReadMemo = {};
  const shows = new Map<Layer, Layer[]>();
  const met = new Set<string>();
  let total = read.list.length;
  const rank = (k: Layer): number => (pinned(k) ? 0 : k.parts.some((p) => p.on[NOW]) ? 1 : 2);
  for (let level = read.list, deep = 1; level.length && deep < DEEP; deep++) {
    level = level.reduce<Layer[]>((next, l) => {
      const most = Math.min(MOST, Math.max(0, MOST_TOLD - total));
      const pick = [0, 1, 2].reduce<Layer[]>((some, r) => some.concat(l.kids.filter((k) => rank(k) === r)), []).filter((k, i) => i < most || pinned(k) || met.has(k.id));
      const kids = l.kids.filter((k) => pick.includes(k));
      shows.set(l, kids);
      for (const k of kids)
        if (!met.has(k.id)) {
          met.add(k.id);
          total++;
        }
      return next.concat(kids);
    }, []);
  }
  const used = reading.used;
  const rows = inOwnColors(() => {
    const depth = (x: Layer): number => x.kids.reduce((most, k) => Math.max(most, 1 + depth(k)), 0);
    /*
     * entire: all that is drawn in the svg is listed under the row, each a shape of which every paint that shows is
     * offered, so a colour changed on the row leaves none of it behind. ever: a part off the picture now counts as on.
     */
    const entire = (l: Layer, ever: boolean): boolean => {
      const tips: Layer[] = [];
      const tip = (x: Layer): void => {
        if (x.sole) tips.push(x.sole);
        else if (x.kids.length) (shows.get(x) ?? []).forEach(tip);
        else if (x !== l) tips.push(x);
      };
      tip(l);
      if (!tips.length || !l.svg || l.svg.odd || l.below + depth(l) > DEEP) return false;
      if (!l.inked.every((p) => tips.some((x) => x.it === p))) return false;
      return tips.every((x) => {
        const el = x.it.el;
        const cs = getComputedStyle(el);
        const k: LayerLook | null = x.now ?? (ever ? lookOf(x, sys, memo, used) : null);
        if (ever && !el.isConnected) return true;
        const stroked = parseFloat(cs.strokeWidth) > 0 && showsPaint(cs.stroke, cs.strokeOpacity);
        return !!k && SHAPE.test(el.tagName) && (!fills(cs, el) || k.svgfill !== null) && (!stroked || k.svgstroke !== null);
      });
    };
    const told = (l: Layer): LayerRow => {
      let b: StageRect | null = null;
      for (const p of l.parts) if (p.on[NOW]) b = union(b, p.box[NOW] ?? null);
      l.now = b ? lookOf(l, sys, memo, used) : null;
      const only = l.parts[0];
      const words = b && l.kind === 'text' && l.parts.length === 1 && only ? wordsBox(only.el) : null;
      let kids = (shows.get(l) ?? []).map(told);
      let sole = l.sole ? told(l.sole) : null;
      const whole = !!l.svg && entire(l, false);
      // A lone shape the row can never stand for has a row while a person's change is laid on it, the way to take that back.
      if (sole && l.svg && !whole) {
        if (l.sole && pinned(l.sole) && !entire(l, true)) kids = [sole];
        sole = null;
      }
      const held: Item | false = l.it.held;
      return {
        id: l.id,
        kind: l.kind,
        round: l.round,
        name: l.name,
        hidden: held ? 'held' : l.it.own && !l.pack ? 'own' : false,
        under: held ? stretch + ':' + held.key : null,
        own: l.it.own && !l.pack,
        many: l.many,
        texts: l.texts,
        spans: l.spans.slice(0, 6).map(([a, z]) => [a as PlaySeconds, z as PlaySeconds]),
        at: l.at as PlaySeconds,
        enter: l.enter,
        leave: l.leave,
        box: b ? boxOf(b) : null,
        wordsBox: words ? boxOf(words) : null,
        look: l.now,
        kids,
        sole,
        whole,
        drawn: l.drawn === 'group' && (shows.get(l) ?? []).length < l.kids.length ? '' : l.drawn,
        full: l.full,
      };
    };
    return read.list.map(told);
  });
  return { seq: d.seq, from: from as PlaySeconds, to: to as PlaySeconds, at: at as PlaySeconds, lost: sys.lost(), underHide: sys.underHide(), rows };
}
