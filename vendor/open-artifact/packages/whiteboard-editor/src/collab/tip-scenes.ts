/**
 * The little animated scenes above the empty board's tips: each acts out
 * its tip in a 120 × 76 drawing (keys pressed, an area dragged, a request
 * typed, then the board filling with what was asked for).
 *
 * Scenes are plain SVG built here and animated with the Web Animations API
 * (every animation runs for the scene's length, {@link TIP_SCENE_MS}, and
 * holds its ends). With motion reduced, every animation jumps to its end,
 * so the scene shows the finished result. Colors come from `--wt-*` custom
 * properties on `.wb-empty-scene` (light and dark in `collab.css`); note
 * fills are the board's own.
 *
 * {@link playTipScene} draws a scene into a host element and returns a
 * function that stops it. Nothing here runs at import time.
 */

import { SHAPE_FILL_COLORS } from '@open-artifact/whiteboard-core';
import { TIP_SCENE_MS, type TipSceneKey } from './empty-tips.ts';

/** The drawing's size, in its own units. */
export const TIP_SCENE_WIDTH = 120;
export const TIP_SCENE_HEIGHT = 76;

/** The words the scenes type and label things with. */
export const TIP_SCENE_WORDS = {
  keys: { cmd: '⌘', ctrl: 'Ctrl', k: 'K', slash: '/' },
  cmdk: { ask: 'a launch plan', blocks: ['Plan', 'Build', 'Ship'] },
  drag: { ask: 'an org chart', top: 'Team', kids: ['Design', 'Build', 'Sales'] },
  slash: { ask: 'organize this' },
  prototype: { title: 'Guests', counts: ['2', '3', '4'], button: 'Book' },
  flowchart: { start: 'Idea', step: 'Draft', test: 'OK?', yes: 'yes', no: 'no', done: 'Ship', redo: 'Fix' },
  brainstorm: ['Hike', 'Tacos', 'Quiz', 'Music', 'Yoga', 'Film'],
  explain: { title: 'How tides work', moon: 'Moon', tide: 'High tide' },
  timeline: { months: ['Jan', 'Feb', 'Mar', 'Apr'], bars: ['Research', 'Design', 'Build', 'Launch'] },
  retro: { sections: ['Went well', 'To improve', 'Actions'], example: 'Demo', note: ['Long', 'calls'] },
} as const;

/** How a scene plays. */
export interface TipSceneOptions {
  /** Motion reduced: show the end at once. */
  rest: boolean;
  /** An Apple platform (⌘ rather than Ctrl). */
  mac: boolean;
  /** The agent's display name (the slash scene mentions it). */
  name: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const EASE_SWEEP = 'cubic-bezier(.4,0,.15,1)';
const EASE_POP = 'cubic-bezier(.2,.7,.2,1)';
/** Ink on notes (they are light in both themes). */
const NOTE_INK = '#1f1e1d';
/** Longest agent name the slash scene mentions, in characters. */
const MENTION_MAX = 12;

/** A color from the scene's custom properties. */
const tip = (name: string): string => `var(--wt-${name})`;
const COLORS = {
  ink: tip('ink'),
  soft: tip('soft'),
  label: tip('label'),
  paper: tip('paper'),
  surface: tip('surface'),
  line: tip('line'),
  shade: tip('shade'),
  key: tip('key'),
  down: tip('down'),
  wire: tip('wire'),
  select: tip('select'),
  agent: tip('agent'),
  agentFill: tip('agent-fill'),
  chat: tip('chat'),
  blue: tip('blue'),
  water: tip('water'),
  moon: tip('moon'),
  crater: tip('crater'),
  check: tip('check'),
};

/** One keyframe at a time in the scene: `[ms, keyframe, easing to the next]`. */
type Frame = readonly [at: number, keyframe: Keyframe, easing?: string];

type Attrs = Record<string, string | number>;

let clipSeq = 0;

/** Makes an SVG element under `parent`; `var(…)` values go in its style (attributes do not take them). */
function svgChild<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent: Element, text?: string): SVGElementTagNameMap[K] {
  const node = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string' && value.startsWith('var(')) node.style.setProperty(key, value);
    else node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return parent.appendChild(node);
}

/** A scene being drawn: its elements and their animations. */
class SceneDrawing {
  readonly anims: Animation[] = [];
  readonly root: SVGGElement;
  /** The scene's length, ms. */
  readonly ms: number;
  readonly on: TipSceneOptions;

  constructor(svg: SVGSVGElement, ms: number, on: TipSceneOptions) {
    this.root = svgChild('g', {}, svg);
    this.ms = ms;
    this.on = on;
  }

  /** Animates `node` through `frames` over the whole scene, holding the first and last. */
  move(node: Element, frames: readonly Frame[]): void {
    const first = frames[0];
    const last = frames.at(-1);
    if (first === undefined || last === undefined) return;
    const all: Frame[] = [...(first[0] > 0 ? [[0, first[1]] as const] : []), ...frames, ...(last[0] < this.ms ? [[this.ms, last[1]] as const] : [])];
    this.anims.push(
      node.animate(
        all.map(([at, keyframe, easing = EASE_SWEEP]) => ({ ...keyframe, offset: Math.min(1, Math.max(0, at / this.ms)), easing })),
        { duration: this.ms, fill: 'both' },
      ),
    );
  }

  /** Fades `node` through `[ms, opacity]` steps. */
  fade(node: Element, steps: ReadonlyArray<readonly [number, number]>): void {
    this.move(
      node,
      steps.map(([at, opacity]) => [at, { opacity }, 'ease-out'] as const),
    );
  }

  /** Pops `node` in at `at`: fading in while rising `rise`. */
  appear(node: Element, at: number, duration = 320, rise = 2.5): void {
    this.move(node, [
      [at, { opacity: 0, transform: `translateY(${rise}px)` }, EASE_POP],
      [at + duration, { opacity: 1, transform: 'translateY(0px)' }],
    ]);
  }

  /** Draws `path` on (stroke) from `at` to `end`. */
  drawOn(path: SVGPathElement, at: number, end: number): void {
    path.setAttribute('pathLength', '1');
    path.setAttribute('stroke-dasharray', '1');
    this.move(path, [
      [at, { strokeDashoffset: 1 }, 'ease-in-out'],
      [end, { strokeDashoffset: 0 }],
    ]);
  }

  /** A group at `x, y`; animate the returned inner group (its outer one holds the place). */
  group(x: number, y: number, parent: Element = this.root, className?: string): SVGGElement {
    const outer = svgChild('g', { transform: `translate(${x} ${y})` }, parent);
    return svgChild('g', className === undefined ? {} : { class: className }, outer);
  }

  rect(parent: Element, [x, y, w, h, r]: readonly number[], fill: string, stroke?: string, strokeWidth = 0.6): SVGRectElement {
    return svgChild('rect', { x: x ?? 0, y: y ?? 0, width: w ?? 0, height: h ?? 0, rx: r ?? 0, fill, ...(stroke === undefined ? {} : { stroke, 'stroke-width': strokeWidth }) }, parent);
  }

  text(parent: Element, x: number, y: number, words: string, size: number, fill: string, attrs: Attrs = {}): SVGTextElement {
    return svgChild('text', { x, y, 'font-size': size, fill, ...attrs }, parent, words);
  }

  path(parent: Element, d: string, stroke: string, width = 0.8, attrs: Attrs = {}): SVGPathElement {
    return svgChild('path', { d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...attrs }, parent);
  }

  /** A labeled box centered on `cx, cy` (a note, a block, a step). */
  node(cx: number, cy: number, w: number, h: number, fill: string, words: string, ink = NOTE_INK, radius = 2): SVGGElement {
    const box = this.group(cx, cy, this.root, 'wb-tip-mid');
    this.rect(box, [-w / 2 + 0.4, -h / 2 + 0.9, w, h, radius], COLORS.shade);
    this.rect(box, [-w / 2, -h / 2, w, h, radius], fill);
    this.text(box, 0, Math.min(h, 12) * 0.17, words, Math.min(5.6, h * 0.42), ink, { 'text-anchor': 'middle', 'font-weight': 500 });
    return box;
  }

  /** A connector drawn on between `at` and `end`, with a small arrow head appearing at its end. */
  link(d: string, head: readonly [number, number, number], at: number, end: number): void {
    const line = this.path(this.root, d, COLORS.wire, 0.7);
    this.drawOn(line, at, end);
    const [x, y, angle] = head;
    const tipGroup = svgChild('g', { transform: `translate(${x} ${y}) rotate(${angle})` }, this.root);
    const arrow = this.path(tipGroup, 'M-1.8 -1.5 L0 0 L-1.8 1.5', COLORS.wire, 0.7);
    this.fade(arrow, [
      [end - 60, 0],
      [end, 1],
    ]);
  }

  /** The mouse pointer, its tip at `x, y`; move it with `translate(…)` transforms on the returned group. */
  pointer(x = 0, y = 0): SVGGElement {
    const holder = svgChild('g', { transform: `translate(${x} ${y})` }, this.root);
    const hand = svgChild('g', {}, holder);
    svgChild('path', { d: 'M0 0 V9.6 L2.5 7.3 L4.3 11.1 L6 10.3 L4.2 6.7 H7.6 Z', fill: COLORS.ink, stroke: COLORS.paper, 'stroke-width': 0.7, 'stroke-linejoin': 'round' }, hand);
    return hand;
  }

  /**
   * A key cap at `x, y` (top left), `w` wide: it shows at `times[0]`, is
   * pressed at `times[1]`, comes up at `times[2]` and is gone by `times[3]`.
   */
  key(x: number, y: number, label: string, w: number, times: readonly [number, number, number, number]): void {
    const [show, press, release, gone] = times;
    const cap = this.group(x, y);
    this.rect(cap, [0, 1, w, 13, 2.6], COLORS.shade);
    const top = svgChild('g', {}, cap);
    this.rect(top, [0, 0, w, 13, 2.6], COLORS.key, COLORS.line);
    const pressed = this.rect(top, [0, 0, w, 13, 2.6], COLORS.down, COLORS.line);
    this.text(top, w / 2, 8.9, label, label.length > 1 ? 5.2 : 6.4, COLORS.ink, { 'text-anchor': 'middle', 'font-weight': 500 });
    this.fade(cap, [
      [show, 0],
      [show + 160, 1],
      [release, 1],
      [gone, 0],
    ]);
    this.move(top, [
      [press, { transform: 'translateY(0px)' }, 'ease-out'],
      [press + 80, { transform: 'translateY(0.9px)' }],
      [release - 40, { transform: 'translateY(0.9px)' }, 'ease-out'],
      [release + 40, { transform: 'translateY(0px)' }],
    ]);
    this.fade(pressed, [
      [press, 0],
      [press + 80, 1],
      [release - 40, 1],
      [release + 40, 0],
    ]);
  }

  /**
   * Types `parts` (each with an optional pause after it, ms) from `at`, one
   * character every `perChar` ms, as a clip that uncovers the text. Returns
   * where each character starts (from `x`) and when the typing ends.
   */
  typed(parent: Element, x: number, y: number, parts: ReadonlyArray<readonly [string, number?]>, at: number, perChar: number, fill: string, size: number): { count: number; advance: (index: number) => number; times: number[] } {
    const full = parts.map(([words]) => words).join('');
    const words = this.text(parent, x, y, full, size, fill);
    const advance = (index: number): number => {
      if (index <= 0) return 0;
      try {
        const length = words.getSubStringLength(0, Math.min(index, full.length));
        if (length > 0) return length;
      } catch {
        // Not laid out (or a cut surrogate pair): estimate below.
      }
      return index * size * 0.56;
    };
    const id = `wb-tip-clip-${(clipSeq += 1)}`;
    const clip = svgChild('clipPath', { id }, parent);
    const reveal = svgChild('rect', { x: x - 0.5, y: y - size * 1.1, width: 0, height: size * 1.6 }, clip);
    words.setAttribute('clip-path', `url(#${id})`);
    const times: number[] = [];
    let time = at;
    let index = 0;
    for (const [part, pause = 0] of parts) {
      for (let char = 0; char < part.length; char += 1) {
        times.push(time);
        time += perChar;
        index += 1;
      }
      time += pause;
    }
    times.push(time);
    this.move(
      reveal,
      times.map((when, i) => [when, { width: `${(i === 0 ? 0 : advance(i) + 0.8).toFixed(2)}px` }, 'step-end'] as const),
    );
    return { count: index, advance, times };
  }

  /**
   * The Ask panel in miniature, centered on `y`: it shows at `show`, types
   * `words` from `typeAt` and goes at `gone`.
   */
  askBar(words: string, show: number, typeAt: number, y: number, gone: number): void {
    const bar = this.group(10, y - 6.5);
    this.rect(bar, [0.3, 0.9, 100, 13, 6.5], COLORS.shade);
    this.rect(bar, [0, 0, 100, 13, 6.5], COLORS.surface, COLORS.line);
    svgChild('circle', { cx: 7, cy: 6.5, r: 2.3, fill: COLORS.agent }, bar);
    this.typed(bar, 12.5, 8.6, [[words]], typeAt, 38, COLORS.ink, 5.6);
    svgChild('circle', { cx: 93.5, cy: 6.5, r: 3.6, fill: COLORS.select }, bar);
    this.path(bar, 'M93.5 8.4 V4.7 M92 6.1 L93.5 4.6 L95 6.1', '#fff', 0.7);
    this.move(bar, [
      [show, { opacity: 0, transform: 'translateY(2px)' }, EASE_POP],
      [show + 220, { opacity: 1, transform: 'translateY(0px)' }],
      [gone, { opacity: 1, transform: 'translateY(0px)' }, 'ease-in'],
      [gone + 180, { opacity: 0, transform: 'translateY(-1.5px)' }],
    ]);
  }
}

/** How each scene is drawn. */
const SCENES: Readonly<Record<TipSceneKey, (d: SceneDrawing) => void>> = {
  cmdk(d) {
    const modWidth = d.on.mac ? 15 : 23;
    const keysX = (TIP_SCENE_WIDTH - modWidth - 15 - 3) / 2;
    d.key(keysX, 50, d.on.mac ? TIP_SCENE_WORDS.keys.cmd : TIP_SCENE_WORDS.keys.ctrl, modWidth, [0, 340, 700, 800]);
    d.key(keysX + modWidth + 3, 50, TIP_SCENE_WORDS.keys.k, 15, [0, 460, 700, 800]);
    d.askBar(TIP_SCENE_WORDS.cmdk.ask, 860, 1080, 48, 1790);
    const [size, y, pitch] = [28, 31, 37];
    [SHAPE_FILL_COLORS.yellow, SHAPE_FILL_COLORS.pink, SHAPE_FILL_COLORS.green].forEach((fill, index) => {
      const x = 9 + index * pitch;
      d.appear(d.node(x + size / 2, y, size, size, fill, TIP_SCENE_WORDS.cmdk.blocks[index] ?? '', NOTE_INK, 2.4), 2000 + index * 300, 340, 3);
      if (index < 2) d.link(`M${x + size + 1.8} ${y} H${x + pitch - 1.8}`, [x + pitch - 1.6, y, 0], 2170 + index * 300, 2330 + index * 300);
    });
  },

  drag(d) {
    const [x, y, w, h] = [10, 4, 100, 46];
    // The drag draws the area itself (the rubber band is an area frame), so it stays once let go.
    const area = d.rect(d.root, [x, y, 0, 0, 5.5], COLORS.agentFill, COLORS.agent, 1.1);
    d.move(area, [
      [320, { width: '0px', height: '0px' }],
      [1080, { width: `${w}px`, height: `${h}px` }],
    ]);
    d.fade(area, [
      [300, 0],
      [340, 1],
      [2700, 1],
      [3000, 0.45],
    ]);
    d.askBar(TIP_SCENE_WORDS.drag.ask, 1240, 1500, 46, 2110);
    d.appear(d.node(60, y + 12.25, 30, 12.5, COLORS.agent, TIP_SCENE_WORDS.drag.top, '#fff'), 2280, 300, 2);
    const [stem, bar, kids] = [y + 18.5, y + 23, y + 27.5];
    d.fade(d.path(d.root, `M60 ${stem} V${kids} M28 ${kids} V${bar + 2} Q28 ${bar} 30 ${bar} H90 Q92 ${bar} 92 ${bar + 2} V${kids}`, COLORS.wire, 0.7), [
      [2420, 0],
      [2640, 1],
    ]);
    [SHAPE_FILL_COLORS.blue, SHAPE_FILL_COLORS.green, SHAPE_FILL_COLORS.yellow].forEach((fill, index) => {
      d.appear(d.node(28 + index * 32, kids + 6.25, 29, 12.5, fill, TIP_SCENE_WORDS.drag.kids[index] ?? ''), 2500 + index * 90, 300, 2);
    });
    const hand = d.pointer();
    d.move(hand, [
      [0, { transform: `translate(${x - 3}px, ${y + 3}px)` }],
      [300, { transform: `translate(${x}px, ${y}px)` }],
      [320, { transform: `translate(${x}px, ${y}px)` }],
      [1080, { transform: `translate(${x + w}px, ${y + h}px)` }],
    ]);
    d.fade(hand, [
      [0, 0],
      [220, 1],
      [1240, 1],
      [1480, 0],
    ]);
  },

  slash(d) {
    const [x, y] = [9, 29.5];
    const [bx, by] = [x + 8, y + 11.5];
    d.key(bx, by, TIP_SCENE_WORDS.keys.slash, 15, [180, 480, 700, 800]);
    const bubble = d.group(bx, by, d.root, 'wb-tip-corner');
    const shadow = d.rect(bubble, [0.5, 1.5, 13, 15, 4.6], COLORS.shade);
    const body = d.rect(bubble, [0, 0, 13, 15, 4.6], COLORS.chat);
    const pill = d.rect(bubble, [3.6, 2.6, 10, 9.8, 3], 'rgba(255,255,255,.24)');
    const name = [...(d.on.name.trim() || 'Agent')];
    const mention = `@${name.length > MENTION_MAX ? `${name.slice(0, MENTION_MAX - 1).join('')}…` : name.join('')}`;
    const [typeAt, perChar] = [1000, 44];
    const typing = d.typed(bubble, 5.6, 9.9, [[mention, 500], [`  ${TIP_SCENE_WORDS.slash.ask}`]], typeAt, perChar, '#fff', 6.2);
    pill.setAttribute('width', String(typing.advance(mention.length) + 4));
    const mentionDone = typing.times[mention.length] ?? typeAt;
    d.fade(pill, [
      [mentionDone, 0],
      [mentionDone + 140, 1],
    ]);
    const widths = typing.times.map((when, index) => [when, { width: `${(index > 0 ? typing.advance(index) + 6.4 : 13).toFixed(2)}px` }, 'linear'] as const);
    d.move(body, widths);
    d.move(shadow, widths);
    d.move(bubble, [
      [840, { opacity: 0, transform: 'scale(.7)' }, EASE_POP],
      [1000, { opacity: 1, transform: 'scale(1)' }],
    ]);
    d.fade(d.pointer(x, y), [
      [0, 0],
      [220, 1],
    ]);
  },

  prototype(d) {
    const card = d.group(22, 10, d.root, 'wb-tip-mid');
    d.rect(card, [0.4, 1.2, 76, 52, 5], COLORS.shade);
    d.rect(card, [0, 0, 76, 52, 5], COLORS.surface, COLORS.line);
    d.text(card, 8, 12, TIP_SCENE_WORDS.prototype.title, 6.6, COLORS.ink, { 'font-weight': 600 });
    const picked = d.rect(card, [8, 17, 18, 12, 3], COLORS.blue);
    d.move(picked, [
      [1260, { transform: 'translateX(0px)' }, EASE_SWEEP],
      [1420, { transform: 'translateX(20px)' }],
    ]);
    // Each count in ink and in white (on the picked one); the pick moves from 2 to 3.
    TIP_SCENE_WORDS.prototype.counts.forEach((count, index) => {
      d.rect(card, [8 + index * 20, 17, 18, 12, 3], 'none', COLORS.line);
      const attrs = { 'text-anchor': 'middle', 'font-weight': 500 };
      const dark = d.text(card, 17 + index * 20, 25.2, count, 5.8, COLORS.ink, attrs);
      if (index > 1) return;
      const light = d.text(card, 17 + index * 20, 25.2, count, 5.8, '#fff', attrs);
      const lit = index === 0 ? [1, 0] : [0, 1];
      d.fade(light, [
        [1300, lit[0] ?? 0],
        [1380, lit[1] ?? 0],
      ]);
      d.fade(dark, [
        [1300, 1 - (lit[0] ?? 0)],
        [1380, 1 - (lit[1] ?? 0)],
      ]);
    });
    const button = d.group(8, 35, card, 'wb-tip-mid');
    d.rect(button, [0, 0, 58, 11, 5.5], COLORS.ink);
    d.text(button, 29, 7.6, TIP_SCENE_WORDS.prototype.button, 5.6, COLORS.paper, { 'text-anchor': 'middle', 'font-weight': 600 });
    d.move(button, [
      [2000, { transform: 'scale(1)' }, 'ease-out'],
      [2080, { transform: 'scale(.94)' }],
      [2200, { transform: 'scale(1)' }],
    ]);
    const done = d.group(96, 12, d.root, 'wb-tip-mid');
    svgChild('circle', { cx: 0, cy: 0, r: 4.6, fill: COLORS.check }, done);
    d.path(done, 'M-2 0.2 L-0.6 1.6 L2.1 -1.3', '#fff', 1);
    d.move(done, [
      [2250, { opacity: 0, transform: 'scale(.4)' }, EASE_POP],
      [2500, { opacity: 1, transform: 'scale(1)' }],
    ]);
    d.appear(card, 0, 360, 3);
    const hand = d.pointer();
    d.move(hand, [
      [500, { transform: 'translate(104px, 72px)' }],
      [1180, { transform: 'translate(52px, 33px)' }],
      [1260, { transform: 'translate(52px, 33px) scale(.86)' }, 'ease-out'],
      [1360, { transform: 'translate(52px, 33px) scale(1)' }],
      [1900, { transform: 'translate(60px, 50px)' }],
      [2000, { transform: 'translate(60px, 50px) scale(.86)' }, 'ease-out'],
      [2120, { transform: 'translate(60px, 50px) scale(1)' }],
    ]);
    d.fade(hand, [
      [500, 0],
      [700, 1],
      [2400, 1],
      [2650, 0],
    ]);
  },

  sketch(d) {
    const pen = COLORS.ink;
    const strokes: Array<[string, number, number]> = [
      ['M30 62 L30 36 L58 36 L58 62 Z', 200, 1000],
      ['M26 38 L44 22 L62 38', 1000, 1500],
      ['M41 62 V50 H48 V62', 1500, 1850],
      ['M86 24 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0', 1900, 2350],
      ['M86 12 V9 M98 24 H101 M86 36 V39 M74 24 H71 M94.5 15.5 L96.6 13.4 M94.5 32.5 L96.6 34.6 M77.5 32.5 L75.4 34.6 M77.5 15.5 L75.4 13.4', 2350, 2650],
      ['M14 64 Q40 60 66 64 T106 63', 2550, 2850],
    ];
    for (const [shape, at, end] of strokes) d.drawOn(d.path(d.root, shape, pen, 1.3), at, end);
  },

  flowchart(d) {
    const y = 26;
    d.appear(d.node(15, y, 22, 12, SHAPE_FILL_COLORS.yellow, TIP_SCENE_WORDS.flowchart.start, NOTE_INK, 6), 200, 300, 2);
    d.link(`M27 ${y} H33`, [33.2, y, 0], 450, 600);
    d.appear(d.node(46, y, 22, 12, SHAPE_FILL_COLORS.blue, TIP_SCENE_WORDS.flowchart.step), 600, 300, 2);
    d.link(`M58 ${y} H63`, [63.2, y, 0], 850, 1000);
    const test = d.group(76, y, d.root, 'wb-tip-mid');
    svgChild('path', { d: 'M0 -9 L12 0 L0 9 L-12 0 Z', fill: SHAPE_FILL_COLORS.purple }, test);
    d.text(test, 0, 2, TIP_SCENE_WORDS.flowchart.test, 5.2, NOTE_INK, { 'text-anchor': 'middle', 'font-weight': 500 });
    d.appear(test, 1000, 300, 2);
    d.link(`M88.5 ${y} H95`, [95.2, y, 0], 1300, 1450);
    d.fade(d.text(d.root, 91.5, y - 3, TIP_SCENE_WORDS.flowchart.yes, 4.4, COLORS.label, { 'text-anchor': 'middle' }), [
      [1350, 0],
      [1500, 1],
    ]);
    d.appear(d.node(106, y, 20, 12, SHAPE_FILL_COLORS.green, TIP_SCENE_WORDS.flowchart.done, NOTE_INK, 6), 1450, 300, 2);
    d.link(`M76 ${y + 9.5} V${y + 20}`, [76, y + 20.2, 90], 1750, 1900);
    d.fade(d.text(d.root, 79.5, y + 16, TIP_SCENE_WORDS.flowchart.no, 4.4, COLORS.label), [
      [1800, 0],
      [1950, 1],
    ]);
    d.appear(d.node(76, y + 27, 20, 12, SHAPE_FILL_COLORS.pink, TIP_SCENE_WORDS.flowchart.redo), 1900, 300, 2);
    d.link(`M66 ${y + 27} H46 V${y + 7.5}`, [46, y + 7.3, -90], 2200, 2500);
  },

  brainstorm(d) {
    const fills = [SHAPE_FILL_COLORS.yellow, SHAPE_FILL_COLORS.pink, SHAPE_FILL_COLORS.green, SHAPE_FILL_COLORS.blue, SHAPE_FILL_COLORS.purple, SHAPE_FILL_COLORS.peach];
    const tilts = [-4, 3, -2, 2, -3, 4];
    TIP_SCENE_WORDS.brainstorm.forEach((words, index) => {
      const [column, row] = [index % 3, Math.floor(index / 3)];
      const note = d.node(27 + column * 33, 21 + row * 30, 28, 24, fills[index] ?? SHAPE_FILL_COLORS.yellow, words);
      note.parentElement?.setAttribute('transform', `translate(${27 + column * 33} ${21 + row * 30}) rotate(${tilts[index] ?? 0})`);
      d.move(note, [
        [250 + index * 280, { opacity: 0, transform: 'scale(.6)' }, EASE_POP],
        [250 + index * 280 + 300, { opacity: 1, transform: 'scale(1)' }],
      ]);
    });
  },

  explain(d) {
    d.appear(d.text(d.root, 60, 9, TIP_SCENE_WORDS.explain.title, 6.6, COLORS.ink, { 'text-anchor': 'middle', 'font-weight': 600 }), 100, 320, 2);
    const globe = d.group(44, 44);
    const water = svgChild('ellipse', { cx: 0, cy: 0, rx: 16, ry: 16, fill: COLORS.water, class: 'wb-tip-mid' }, globe);
    svgChild('circle', { cx: 0, cy: 0, r: 12, fill: COLORS.blue }, globe);
    d.appear(globe, 300, 320, 0);
    // The water bulges toward the moon: high tide.
    d.move(water, [
      [1300, { transform: 'scaleX(1)' }, EASE_SWEEP],
      [2000, { transform: 'scaleX(1.3)' }],
    ]);
    const moon = d.group(100, 44);
    svgChild('circle', { cx: 0, cy: 0, r: 6, fill: COLORS.moon }, moon);
    svgChild('circle', { cx: -1.8, cy: -1.5, r: 1.3, fill: COLORS.crater }, moon);
    svgChild('circle', { cx: 2, cy: 1.8, r: 0.9, fill: COLORS.crater }, moon);
    d.move(moon, [
      [700, { opacity: 0, transform: 'translateY(-10px)' }, EASE_SWEEP],
      [1200, { opacity: 1, transform: 'translateY(0px)' }],
    ]);
    d.appear(d.text(d.root, 100, 58, TIP_SCENE_WORDS.explain.moon, 5, COLORS.label, { 'text-anchor': 'middle' }), 1150, 300, 2);
    d.link('M85 44 H68', [67.6, 44, 180], 1500, 1900);
    d.fade(d.path(d.root, 'M64 40 L70 31', COLORS.wire, 0.6), [
      [2100, 0],
      [2250, 1],
    ]);
    d.appear(d.text(d.root, 71, 29.5, TIP_SCENE_WORDS.explain.tide, 5, COLORS.ink, { 'font-weight': 500 }), 2150, 300, 2);
  },

  timeline(d) {
    const [left, column] = [16, 25];
    TIP_SCENE_WORDS.timeline.months.forEach((month, index) => {
      const x = left + index * column;
      d.fade(d.path(d.root, `M${x} 13 V68`, COLORS.line, 0.5), [
        [100, 0],
        [400, 1],
      ]);
      d.appear(d.text(d.root, x + column / 2, 10, month, 5, COLORS.label, { 'text-anchor': 'middle' }), 100 + index * 80, 280, 1.5);
    });
    const fills = [SHAPE_FILL_COLORS.blue, SHAPE_FILL_COLORS.purple, SHAPE_FILL_COLORS.green, SHAPE_FILL_COLORS.peach];
    const spans: Array<[number, number]> = [
      [0, 40],
      [22, 36],
      [44, 40],
      [76, 24],
    ];
    TIP_SCENE_WORDS.timeline.bars.forEach((words, index) => {
      const [start, width] = spans[index] ?? [0, 20];
      const y = 18 + index * 12.5;
      const bar = d.group(left + start, y, d.root, 'wb-tip-corner');
      d.rect(bar, [0, 0, width, 9, 2.4], fills[index] ?? SHAPE_FILL_COLORS.blue);
      d.text(bar, 2.6, 6.3, words, 4.8, NOTE_INK, { 'font-weight': 500 });
      const at = 500 + index * 380;
      d.move(bar, [
        [at, { opacity: 0, transform: 'scaleX(.15)' }, EASE_SWEEP],
        [at + 80, { opacity: 1, transform: 'scaleX(.2)' }, EASE_SWEEP],
        [at + 460, { opacity: 1, transform: 'scaleX(1)' }],
      ]);
    });
  },

  retro(d) {
    const [width, gap] = [34, 4];
    TIP_SCENE_WORDS.retro.sections.forEach((title, index) => {
      const x = 4 + index * (width + gap);
      const column = d.group(x, 4);
      d.rect(column, [0, 0, width, 66, 3], COLORS.surface, COLORS.line);
      d.text(column, width / 2, 8.5, title, 4.6, COLORS.ink, { 'text-anchor': 'middle', 'font-weight': 600 });
      d.appear(column, 150 + index * 160, 320, 2);
    });
    d.appear(d.node(21, 26, 26, 18, SHAPE_FILL_COLORS.green, TIP_SCENE_WORDS.retro.example), 1100, 320, 2.5);
    const long = d.group(59, 27, d.root, 'wb-tip-mid');
    d.rect(long, [-12.6, -9.1, 26, 20, 2], COLORS.shade);
    d.rect(long, [-13, -10, 26, 20, 2], SHAPE_FILL_COLORS.pink);
    TIP_SCENE_WORDS.retro.note.forEach((line, index) => d.text(long, 0, -1.6 + index * 6.2, line, 5.2, NOTE_INK, { 'text-anchor': 'middle', 'font-weight': 500 }));
    d.appear(long, 1650, 320, 2.5);
    const action = d.group(97, 26, d.root, 'wb-tip-mid');
    d.rect(action, [-12.6, -8.1, 26, 18, 2], COLORS.shade);
    d.rect(action, [-13, -9, 26, 18, 2], SHAPE_FILL_COLORS.blue);
    d.rect(action, [-8, -3.5, 7, 7, 1.4], 'none', NOTE_INK, 0.7);
    d.path(action, 'M2 -1 H8 M2 2 H6', NOTE_INK, 0.7);
    d.appear(action, 2200, 320, 2.5);
    d.drawOn(d.path(action, 'M-6.6 0 L-5 1.8 L-2.2 -1.8', NOTE_INK, 0.9), 2500, 2800);
  },
};

/** How long `scene` plays, ms. */
export function tipSceneDurationMs(scene: TipSceneKey): number {
  return TIP_SCENE_MS[scene];
}

/**
 * Draws and plays `scene` in `host` (redrawn, at the same moment, once web
 * fonts load, since text widths change). Returns a function that stops it
 * and clears the drawing.
 */
export function playTipScene(host: HTMLElement, scene: TipSceneKey, options: TipSceneOptions): () => void {
  if (typeof host.animate !== 'function') return () => {};
  let drawing: SceneDrawing | undefined;
  let svg: SVGSVGElement | undefined;
  let stopped = false;
  const clear = (): void => {
    for (const animation of drawing?.anims ?? []) animation.cancel();
    svg?.remove();
    drawing = undefined;
    svg = undefined;
  };
  const draw = (): void => {
    const elapsed = drawing?.anims[0]?.currentTime ?? 0;
    clear();
    try {
      svg = svgChild('svg', { viewBox: `0 0 ${TIP_SCENE_WIDTH} ${TIP_SCENE_HEIGHT}`, 'aria-hidden': 'true', focusable: 'false' }, host);
      drawing = new SceneDrawing(svg, TIP_SCENE_MS[scene], options);
      SCENES[scene](drawing);
      for (const animation of drawing.anims) {
        if (options.rest) animation.finish();
        else animation.currentTime = elapsed;
      }
    } catch (error) {
      console.error('whiteboard: tip scene failed', error);
      clear();
    }
  };
  draw();
  const fonts = host.ownerDocument.fonts as FontFaceSet | undefined;
  if (fonts && fonts.status !== 'loaded') void fonts.ready.then(() => void (stopped || draw()));
  return () => {
    stopped = true;
    clear();
  };
}
