import { beneath, inOrder, lead, measures, stays } from './describe.ts';
import type { Stretch } from './describe.ts';
import { MOST, pinned } from './item.ts';
import type { Item, Layer } from './item.ts';
import { SHAPE, drawnAs } from './parts.ts';
import { markOdd } from './walk.ts';

const ALIKE = 4;
const BRIEF_S = 0.15;
const MOST_KIDS = 12;

/** The rows of a reading, in the order they come on, the ground last, before the cut of what each shows. */
export function buildRows(s: Stretch, els: Map<string, Item>): Layer[] {
  const { W, H, from, to } = s;
  // Inside an svg the rows follow the drawing's own tree.
  const below = new Map<Item | null, Item[]>();
  const all = new Map<Item, Item[]>();
  for (const it of els.values()) if (it.art) below.set(it.up, (below.get(it.up) ?? []).concat(it));
  /** All that is drawn of it: a g that was shut in the course of the reading counts with the parts read before that. */
  const inked = (it: Item): Item[] => {
    let got = all.get(it);
    if (!got) {
      got = (below.get(it) ?? []).reduce<Item[]>((some, c) => some.concat(inked(c)), it.cand && it.shown ? [it] : []).sort(inOrder);
      all.set(it, got);
    }
    return got;
  };
  const { isFull, swelled, grown, describe } = measures(s, inked);
  const heads = new Map<Item, Item[]>();
  const order: Item[] = [];
  for (const it of els.values()) {
    if (!it.cand || it.shown === 0 || it.art) continue;
    /*
     * It belongs to the nearest thing above it that moves, that the film named, that paints a box round it, or that a
     * person changed or hid; unless it is such a thing itself. A thing as large as the stage looks for no holder, and is
     * no holder, unless a hand-set Scale made it that large.
     */
    let head = it;
    if ((!isFull(it) || grown(it)) && !it.moved && !it.named && !(it.easel && it.big && !beneath(it)))
      for (let up = it.up; up; up = up.up)
        if ((!isFull(up) || swelled(up) || grown(up)) && (up.moved || up.named || up.paint || stays(up))) {
          head = up;
          break;
        }
    let group = heads.get(head);
    if (!group) {
      group = [];
      heads.set(head, group);
      order.push(head);
    }
    group.push(it);
    it.head = head;
  }
  order.sort(inOrder);

  const lasting = (l: Layer): boolean => l.long >= Math.min(BRIEF_S, (to - from) / 4);
  let list = order
    .map((head) => {
      const parts = (heads.get(head) ?? []).sort(inOrder);
      const l = describe(head, parts);
      /*
       * What it holds, without the box it paints round them. A full row lists up to MOST of those, and each of them lists
       * what it holds in turn; a kid that holds things also has a row of its own under the same id.
       */
      const under = (p: Item): Layer => {
        const k = describe(p, [p]);
        const own = (heads.get(p) ?? []).filter((q) => q !== p);
        if (own.length && !(own.length === 1 && own[0]?.easel))
          k.kids = own
            .sort(inOrder)
            .map(under)
            .filter(lasting)
            .filter((c, i) => i < MOST || pinned(c));
        return k;
      };
      if (parts.length > 1)
        l.kids = parts
          .filter((p) => p !== head)
          .map(l.full ? under : (p: Item) => describe(p, [p]))
          .filter(lasting)
          .filter((k, i) => i < (l.full ? MOST : MOST_KIDS) || (pinned(k) && (l.full || !(heads.get(k.it) ?? []).some((q) => q !== k.it))));
      return l;
    })
    .filter(lasting);

  // Four or more alike side by side (a grid's cells, a list's rows) are one layer, which holds them.
  const drawnNow = new Map<Element, string>();
  const alike = (l: Layer): string | null =>
    l.kind === 'ground'
      ? null
      : l.it.path.slice(0, -1).join('.') +
        '|' +
        l.kind +
        '|' +
        (l.it.el.getAttribute('class') ?? '').replace(/\d+/g, '#') +
        '|' +
        l.it.el.tagName +
        (l.it.art ? '|' + (l.name.replace(/\d+/g, '#') || drawnAs(l.it.el, true, drawnNow)) : '');
  const fold = (rows: Layer[]): Layer[] => {
    const folded: Layer[] = [];
    const packs = new Map<string, Layer[]>();
    for (const l of rows) {
      const k = alike(l);
      if (k) packs.set(k, (packs.get(k) ?? []).concat(l));
    }
    for (const l of rows) {
      const k = alike(l);
      const pack = k ? (packs.get(k) ?? [l]) : [l];
      if (pack.length < ALIKE) {
        folded.push(l);
        continue;
      }
      if (pack[0] !== l) continue;
      let every: Item[] = [];
      for (const p of pack) {
        every = every.concat(p.parts);
        if (!p.it.art && !p.full) p.kids = p.kids.filter(pinned);
      }
      const g = describe(l.it, every);
      // "*": the pack, as against its first member, whose place and tag it is called by.
      g.id += '*';
      g.pack = true;
      g.kind = 'group';
      g.round = false;
      g.drawn = '';
      g.full = false;
      g.name = pack.every((p) => p.name === l.name) ? l.name : '';
      g.many = pack.length;
      g.keep = pack.some(pinned);
      g.at = pack[pack.length - 1]?.at ?? g.at;
      g.kids = l.it.art ? pack : pack.filter((p, i) => i < MOST_KIDS || pinned(p));
      folded.push(g);
    }
    return folded;
  };
  // A speck that is on at no look has no row; one that only begins so (a line that grows) has.
  for (const it of els.values()) if (it.speck && !it.shown) markOdd(it);
  const heldBy = (it: Item): Item[] => (below.get(it) ?? []).filter((c) => inked(c).length).sort(inOrder);
  const groups = (c: Item): boolean => heldBy(c).some((x) => !x.cand);
  /*
   * A g that is no thing on the picture, like any wrapper: at some look as large as the stage; or over half of it and
   * holding other groups (a camera, a world); or alone in its holder, if it holds groups itself or its holder has a row.
   */
  const wraps = (c: Item, alone: boolean, bare: boolean): boolean => !c.cand && !stays(c) && (c.big || (groups(c) && c.most >= (W * H) / 2) || (alone && (!bare || groups(c))));
  /*
   * A row takes what it holds, if that is more than one thing or must keep its row. A g that holds only things alike
   * stands for them, as a pack does; an svg does not. sole: the one shape that is all a row holds, unless a person hid it.
   */
  const hold = (l: Layer, held: Layer[]): Layer => {
    let kids = held;
    const only = kids[0];
    if (l.it.art && kids.length === 1 && only?.pack) {
      l.many = only.many;
      kids = only.kids;
    }
    const one = kids[0];
    if (kids.length === 1 && one && !one.pack && SHAPE.test(one.it.el.tagName) && !one.it.own) l.sole = one;
    else if (kids.length > 1 || kids.some((k) => k.pack || pinned(k))) l.kids = kids;
    return l;
  };
  const rowsIn = (up: Item, bare: boolean): Layer[] => {
    const held = heldBy(up);
    return held
      .reduce<Layer[]>((rows, c) => {
        if (wraps(c, held.length === 1, bare)) return rows.concat(rowsIn(c, bare));
        const l = describe(c, inked(c));
        const only = heldBy(c);
        const sole = only.length === 1 ? only[0] : undefined;
        if (sole) l.name = l.name || describe(sole, l.parts).name;
        return rows.concat(hold(l, c.easel ? fold(rowsIn(c, false)) : []));
      }, [])
      .filter(lasting);
  };
  /*
   * An svg as large as the stage is such a wrapper too, if what it holds fits the list beside the other rows: else its
   * row stays and holds them ('drawing'). A smaller one keeps its row, which holds its parts.
   */
  const wide = (l: Layer): boolean => !!l.it.easel && l.it.big && !stays(l.it);
  let others = Math.min(MOST, fold(list.filter((l) => !wide(l))).length);
  const down = (k: Layer): Layer[] => k.kids.reduce<Layer[]>((a, c) => a.concat(down(c)), [k]);
  list = list.reduce<Layer[]>((every, l) => {
    let rows = wide(l) ? fold(rowsIn(l.it, true)) : [];
    if (wide(l) && rows.length + others > 2 * MOST) {
      hold(l, rows);
      l.drawn = 'drawing';
      rows = [];
      others++;
    }
    others += rows.length;
    // A box that paints round one svg has two rows under one id; each holds the svg's parts, which count once.
    for (const k of down(l)) {
      if (k.it.art) continue;
      const own = heads.get(k.it) ?? [];
      const e = k.it.easel ? k.it : own.length === 1 && own[0]?.easel ? own[0] : null;
      if (e && !k.kids.length && !rows.length) {
        hold(k, fold(rowsIn(e, false)));
        k.svg = e;
        k.inked = inked(e).filter((p) => p !== e);
        if (!k.parts.includes(e))
          k.texts = k.texts
            .concat(lead(k.inked.filter((p) => p.text).map((p) => p.text)))
            .slice(0, MOST);
      }
    }
    return every.concat(rows.length ? rows : l);
  }, []);
  const folded = fold(list);
  const lvl = new Map<Item, number>();
  // below: the level at which the box's row will stand once a change pins it under what holds it.
  for (const p of folded) {
    lvl.set(p.it, 1);
    if (p.pack) for (const m of p.kids) lvl.set(m.it, 2);
  }
  for (const l of folded) if (l.svg && l.it.head && l.it.head !== l.it) l.below = (lvl.get(l.it.head) ?? 2) + 1;
  // As they come on; the ground last.
  folded.forEach((l, i) => {
    l.n = i;
  });
  list = folded.sort((a, b) => Number(a.kind === 'ground') - Number(b.kind === 'ground') || (a.spans[0]?.[0] ?? 0) - (b.spans[0]?.[0] ?? 0) || a.n - b.n);
  // MOST of them, what is pinned first, and beside those the rows of drawings, which were let in only as far as they fit.
  let room = MOST - list.filter((l) => !l.it.art && pinned(l)).length;
  return list.filter((l) => l.it.art || pinned(l) || room-- > 0);
}
