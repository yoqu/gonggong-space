import type { Sketcher } from '../scenes/install.ts';
import { stageParts } from '../stage.ts';
import { stageSize } from '../stage-size.ts';
import { sketchBox } from './strokes.ts';
import type { Sides, SketchBoxOptions } from './strokes.ts';

/*
 * A rough scene's outlines redrawn as hand-drawn strokes. It goes by what is drawn, a border or a flat colour, since
 * the class names are the film's own. If the pen itself fails, the scene loses its sketch and plays on.
 */

const SVG = 'http://www.w3.org/2000/svg';
const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const;
const LEFT_ALONE = /^(?:IMG|CANVAS|VIDEO|AUDIO|IFRAME|OBJECT|EMBED|INPUT|TEXTAREA|SELECT|BUTTON|PROGRESS|METER|DETAILS|HR|BR|STYLE|TABLE|TD|TH|TR)$/;
const KITS_OWN = '.film-cursor,.film-chip';
/** A scene of more elements is left clean, since each is read at every frame. */
const MOST = 300;
const DRAWABLE = /^(?:solid|dashed|dotted)$/;
const CLIPS = /^(?:hidden|clip|scroll|auto)$/;
const OUT_OF_FLOW = /^(?:absolute|fixed)$/;
/*
 * data-sketch on an element says what of its own is put aside while it is sketched. edge: its border's colour. fill:
 * its background's. flow: it is position: static, and is made relative so the strokes can be placed by it. label:
 * where its ::after is placed. shape: nothing; no rule reads it.
 */
const RULES =
  '[data-sketch-on] [data-sketch~=edge]{border-color:transparent!important}' +
  '[data-sketch-on] [data-sketch~=fill]{background-color:transparent!important}[data-sketch-on] [data-sketch~=flow]{position:relative!important}' +
  '[data-sketch-on] [data-sketch~=label]::after{left:50%!important;top:50%!important;right:auto!important;bottom:auto!important;transform:translate(-50%,-50%)!important;width:max-content!important;min-width:min-content!important;max-width:100%!important;margin:0!important;translate:none!important;rotate:none!important;scale:none!important;text-align:center!important}';
// Inline, so that a film's plain rules for svg, path or "every child" do not reach these properties.
const SVG_CSS =
  ';width:1px;height:1px;margin:0;padding:0;border:0;outline:0;box-sizing:content-box;display:block;visibility:inherit;opacity:1;transform:none;filter:none;clip-path:none;mix-blend-mode:normal;z-index:auto;overflow:visible;pointer-events:none';
const PATH_CSS = ';transform:none;visibility:inherit;stroke-opacity:1;stroke-dashoffset:0;stroke-linecap:round;stroke-linejoin:round;opacity:';

const n1 = (n: number): string => String(Math.round(n * 10) / 10);
const isClear = (c: string): boolean => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
const isSet = (v: string): boolean => /\(/.test(v || '');
const toPx = (v: string | undefined, of: number): number => (v && /%$/.test(v) ? (parseFloat(v) / 100) * of : parseFloat(v ?? '') || 0);
const isPens = (n: Element): boolean => n.namespaceURI === SVG && n.hasAttribute('data-sketch-pen');

function ink(colour: string, width: string, kind: string, opacity: number): string {
  const w = Number(width);
  const dash = kind === 'dashed' ? w * 3.5 + ' ' + w * 3 : kind === 'dotted' ? '0.1 ' + w * 2.6 : 'none';
  return 'fill:none;stroke:' + colour + ';stroke-width:' + width + 'px;stroke-dasharray:' + dash + PATH_CSS + opacity;
}

interface Side {
  wide: number;
  color: string;
  kind: string;
}

/** What is known of one element of the scene across its drawings. */
interface Sketched {
  el: HTMLElement;
  svg: SVGSVGElement | null;
  paths: SVGPathElement[];
  key: string;
  path: number;
  kids: number;
  lone: number;
  after: CSSStyleDeclaration | null;
  cs: CSSStyleDeclaration;
}

interface Plan {
  w: number;
  h: number;
  left: number;
  top: number;
  fill: string;
  sides: Array<Side | null> | null;
  mark: string;
  o: SketchBoxOptions;
}

interface Todo {
  s: Sketched;
  d: Plan | null;
  key: string;
}

/** Remembered for the length of one drawing. */
const positions = new Map<Element, Map<string, string>>();
function position(n: Element, pseudo: string | null): string {
  let m = positions.get(n);
  if (!m) positions.set(n, (m = new Map()));
  const k = pseudo ?? 'self';
  let p = m.get(k);
  if (p === undefined) m.set(k, (p = getComputedStyle(n, pseudo).position));
  return p;
}

/** Does el hold anything placed absolutely or fixed, a ::before or ::after too, that an ancestor of el positions? Made relative, el would position it instead. */
function anchors(el: Element): boolean {
  const all = el.firstElementChild ? Array.from(el.querySelectorAll('*')) : [];
  const out = (n: Element, pseudo: string | null): boolean => OUT_OF_FLOW.test(position(n, pseudo));
  for (let i = -1; i < all.length; i++) {
    const n = i < 0 ? el : all[i];
    if (!n) continue;
    const inSvg = n.namespaceURI === SVG;
    if (inSvg && (isPens(n) || (n.parentNode instanceof Element && n.parentNode.namespaceURI === SVG))) continue;
    const self = i >= 0 && out(n, null);
    if (!self && (inSvg || !(out(n, '::before') || out(n, '::after')))) continue;
    let p: Element | null = self ? n.parentElement : n;
    while (p && p !== el && position(p, null) === 'static') p = p.parentElement;
    if (p === el) return true;
  }
  return false;
}

/** What to draw for an element, read from the film's own styles; null leaves it as the scene drew it. */
function plan(s: Sketched, u: number): Plan | null {
  const el = s.el;
  const cs = s.cs;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const thin = Math.min(w, h);
  const share = (w * h) / (stageSize.width * stageSize.height);
  let other = false;
  const raw: Sides = [0, 0, 0, 0];
  SIDES.forEach((side, i) => {
    raw[i] = parseFloat(cs.getPropertyValue('border-' + side.toLowerCase() + '-width')) || 0;
  });
  const sides = SIDES.map((side, i): Side | null => {
    const kind = cs.getPropertyValue('border-' + side.toLowerCase() + '-style');
    const color = cs.getPropertyValue('border-' + side.toLowerCase() + '-color');
    const wide = raw[i] ?? 0;
    if (!wide || !kind || kind === 'none' || kind === 'hidden' || isClear(color)) return null;
    if (!DRAWABLE.test(kind)) other = true;
    return { wide, color, kind };
  });
  const on = sides.filter((x): x is Side => x !== null);
  const first = on[0];
  const flat = !isClear(cs.backgroundColor);
  const empty = !(el.textContent ?? '').trim() && Array.from(el.children).every(isPens);
  if (!on.length && !(flat && empty)) return null;
  // The pen runs along and past the border, where an element that clips would cut it off.
  const mask = cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image');
  if (!w || !h || other || CLIPS.test(cs.overflowX) || CLIPS.test(cs.overflowY) || isSet(cs.clipPath) || isSet(mask) || /paint|content|strict/.test(cs.contain) || isSet(cs.borderImageSource)) return null;
  // The strokes are a positioned child, which an inline box or a table's part cannot hold.
  if (/^(?:inline|contents|table)/.test(cs.display) && !/^inline-(?:block|flex|grid)$/.test(cs.display)) return null;
  const whole = on.length === 4;
  const alike = on.every((x) => !!first && x.wide === first.wide && x.color === first.color && x.kind === first.kind);
  const radii = CORNERS.map((c) => cs.getPropertyValue('border-' + c.replace(/([a-z])([A-Z])/, '$1-$2').toLowerCase() + '-radius'));
  const r = (radii[0] ?? '').split(' ');
  const rx = toPx(r[0], w);
  const ry = toPx(r[1] || r[0], h);
  const curved = radii.some((v) => {
    const a = v.split(' ');
    const x = toPx(a[0], w);
    const y = toPx(a[1] || a[0], h);
    return Math.min(x, y) * Math.min(1, x ? w / (2 * x) : 1, y ? h / (2 * y) : 1) >= 0.3 * thin;
  });
  const meet = on.length > 0 && (raw[1] + raw[3] + 1 >= w || raw[0] + raw[2] + 1 >= h);
  // A shape: empty, and filled by its background or by four like borders that meet. An empty flat colour over 29% of the stage is the background.
  const shape = empty && (on.length ? meet && whole && alike : share < 0.29);
  if (!on.length && !shape) return null;
  // Borders that meet at a corner, clear ones too, make a triangle; one border on an element of no thickness is a line.
  if (meet && !shape && sides.some((x, i) => x && (raw[(i + 1) % 4] || raw[(i + 3) % 4]))) return null;
  // One line goes round a curve: not round an arch, a ring whose sides differ, or corners that differ.
  if (curved && (!radii.every((v) => v === radii[0]) || (!shape && !(whole && alike)))) return null;
  const inFlow = cs.position === 'static';
  if (inFlow && anchors(el)) return null;
  const hatch: 0 | 1 | 2 = shape || !whole || !empty || flat || isSet(cs.backgroundImage) || share >= 0.29 ? 0 : share > 0.077 ? 2 : 1;
  let skip: Sides | null = null;
  const pad = 8 * u;
  const bar = shape && thin <= 8 * u;
  let label = false;
  if (empty && !bar && (hatch || el.hasAttribute('data-label'))) {
    const after = (s.after ??= getComputedStyle(el, '::after'));
    let lx = parseFloat(after.left) + raw[3];
    let ly = parseFloat(after.top) + raw[0];
    const lw = parseFloat(after.width);
    const lh = parseFloat(after.height);
    const room = w - raw[1] - raw[3];
    const moved = /^matrix\(1, 0, 0, 1, (-?[\d.e-]+), (-?[\d.e-]+)\)$/.exec(after.transform || '');
    if (moved) {
      lx += parseFloat(moved[1] ?? '0');
      ly += parseFloat(moved[2] ?? '0');
    }
    // A placeholder's label goes in the middle: at a corner it would cross a circle's line. One wholly outside is a caption, and stays.
    const mx = parseFloat(after.marginLeft) || 0;
    const my = parseFloat(after.marginTop) || 0;
    label = el.hasAttribute('data-label') && after.position === 'absolute' && lx + mx < w - raw[1] && ly + my < h - raw[2] && lx + mx + lw > raw[3] && ly + my + lh > raw[0];
    if (label) {
      lx = raw[3] + (room - lw) / 2;
      ly = raw[0] + (h - raw[0] - raw[2] - lh) / 2;
    }
    if (hatch && lw > 0 && lh > 0 && !Number.isNaN(lx) && !Number.isNaN(ly)) skip = [lx - pad, ly - pad, lx + lw + pad, ly + lh + pad];
  }
  return {
    w,
    h,
    left: raw[3],
    top: raw[0],
    fill: first ? first.color : cs.backgroundColor,
    sides: shape ? null : sides,
    mark: (shape ? (bar ? 'fill edge' : 'shape') : 'edge') + (inFlow ? ' flow' : '') + (label ? ' label' : ''),
    o: {
      u,
      sides: shape ? [2, 2, 2, 2] : [sides[0]?.wide ?? 0, sides[1]?.wide ?? 0, sides[2]?.wide ?? 0, sides[3]?.wide ?? 0],
      onEdge: shape,
      bar,
      broken: !shape && !!first && first.kind !== 'solid',
      rx,
      ry,
      hatch,
      skip,
    },
  };
}

let sheet: HTMLStyleElement | null = null;

/** The pen for one rough scene: a call that sketches the scene as it stands, made after every render, since a scene may show a state by its borders. */
export const sketchScene: Sketcher = (box, id) => {
  let known = new WeakMap<Element, Sketched>();
  const owner = new WeakMap<Element, Element>();
  let seed = 7;
  let dead = false;
  let said = false;
  for (let c = 0; c < id.length; c++) seed = (seed * 31 + id.charCodeAt(c)) % 2147483646;
  const off = (): void => {
    box.removeAttribute('data-sketch-on');
    for (const n of Array.from(box.querySelectorAll('svg[data-sketch-pen]'))) n.remove();
    for (const n of Array.from(box.querySelectorAll('[data-sketch]'))) n.removeAttribute('data-sketch');
    known = new WeakMap();
  };
  const say = (why: string): void => {
    if (!said) console.warn('rough scene ' + id + ' is shown without its sketch (' + why + '); nothing in the film needs changing');
    said = true;
  };
  const root = { path: seed, kids: 0, lone: 0 };
  const draw = (): void => {
    if (!box.parentNode) return;
    const u = Math.sqrt(stageSize.width * stageSize.height) / 960;
    const all = Array.from(box.querySelectorAll('*'));
    const seen: Sketched[] = [];
    const strays: Element[] = [];
    const todo: Todo[] = [];
    let fresh: Todo[] = [];
    root.kids = root.lone = 0;
    const keyOf = (s: Sketched): Todo => {
      const d = plan(s, u);
      return { s, d, key: d ? JSON.stringify([s.path, d]) : '' };
    };
    // Not kit.css, which places by the canvas: a scene may have taken the canvas into its box.
    const stage = stageParts()?.stage;
    if (stage && (!sheet || !sheet.parentNode)) {
      sheet = document.createElement('style');
      sheet.textContent = RULES;
      stage.insertBefore(sheet, stage.firstChild);
    }
    // Read with the rules off, so that what is read is the film's own; then written, all at once.
    box.removeAttribute('data-sketch-on');
    positions.clear();
    for (const el of all) {
      // cloneNode and innerHTML copy the pen's strokes and marks.
      if (el.namespaceURI === SVG) {
        if (isPens(el) && owner.get(el) !== el.parentNode) strays.push(el);
        continue;
      }
      if (!(el instanceof HTMLElement)) continue;
      let s = known.get(el);
      if (!s) {
        s = { el, svg: null, paths: [], key: '', path: 0, kids: 0, lone: 0, after: null, cs: getComputedStyle(el) };
        known.set(el, s);
        el.removeAttribute('data-sketch');
      }
      /*
       * Seeded by where the element sits among its parent's elements, all the way down: only an earlier sibling that
       * comes or goes moves them. What is left alone has a count of its own, so the canvas moving in and out of a
       * scene's box does not change what is sketched beside it.
       */
      const parent = el.parentNode instanceof Element ? known.get(el.parentNode) : undefined;
      const up = parent ?? root;
      const alone = LEFT_ALONE.test(el.tagName) || !!el.closest(KITS_OWN);
      s.path = (up.path * 131 + (alone ? 65537 * ++up.lone : ++up.kids)) % 2147483646;
      s.kids = s.lone = 0;
      if (!alone && seen.push(s) > MOST) break;
    }
    // For this frame alone: a frame follows from t, never from the frames before it.
    if (seen.length > MOST) {
      off();
      say('over ' + MOST + ' elements');
      return;
    }
    for (const s of seen) {
      const t = keyOf(s);
      if (t.key !== s.key || (t.d && s.svg?.parentNode !== s.el)) todo.push(t);
    }
    box.setAttribute('data-sketch-on', '');
    for (const n of strays) n.remove();
    for (const t of todo) {
      const s = t.s;
      const d = t.d;
      if (!d) {
        s.el.removeAttribute('data-sketch');
        s.svg?.remove();
        s.key = '';
        continue;
      }
      let svg = s.svg;
      if (!svg) {
        svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('data-sketch-pen', '');
        svg.setAttribute('aria-hidden', 'true');
        owner.set(svg, s.el);
        s.svg = svg;
      }
      if (svg.parentNode !== s.el) {
        s.el.appendChild(svg);
        fresh.push(t);
      }
      if (t.key === s.key) continue;
      s.key = t.key;
      const k = sketchBox(s.path + 1, d.w, d.h, d.o);
      const parts: Array<[string, string]> = [
        [k.wash, 'fill:' + d.fill + ';stroke:none' + PATH_CSS + 0.05],
        [k.hatch, ink(d.fill, k.fine, 'solid', 0.36)],
        [k.cross, ink(d.fill, k.fine, 'solid', 0.2)],
      ];
      const soft = new Map<string, string>();
      const faint = new Map<string, string>();
      const firm = new Map<string, string>();
      const add = (to: Map<string, string>, css: string, path: string): void => {
        to.set(css, (to.get(css) ?? '') + path);
      };
      k.lines.forEach((l, i) => {
        if (!l) return;
        const side = d.sides?.[i] ?? { color: d.fill, kind: 'solid' };
        const wide = (part: number): string => n1(Number(l.width) * (d.o.bar ? 1 : 0.66) * part);
        // Each pass thinner and fainter than the one over it; a bar's first is as thick as the bar.
        add(firm, ink(side.color, wide(1), side.kind, 0.88), l.main);
        add(faint, ink(side.color, wide(0.74), side.kind, 0.5), l.again);
        if (l.third) add(soft, ink(side.color, wide(0.55), side.kind, 0.32), l.third);
      });
      for (const g of [soft, faint, firm]) for (const [css, path] of g) parts.push([path, css]);
      s.el.setAttribute('data-sketch', d.mark);
      svg.setAttribute('style', 'position:absolute;left:' + -d.left + 'px;top:' + -d.top + 'px' + SVG_CSS);
      while (s.paths.length < parts.length) s.paths.push(svg.appendChild(document.createElementNS(SVG, 'path')));
      while (s.paths.length > parts.length) s.paths.pop()?.remove();
      s.paths.forEach((p, i) => {
        p.setAttribute('d', parts[i]?.[0] ?? '');
        p.setAttribute('style', parts[i]?.[1] ?? '');
      });
    }
    if (!fresh.length) {
      positions.clear();
      return;
    }
    // The strokes are a child, which :empty and its like can tell. Where the film's styles ask for something else now, they come off again in this drawing.
    box.removeAttribute('data-sketch-on');
    positions.clear();
    fresh = fresh.filter((t) => keyOf(t.s).key !== t.key);
    box.setAttribute('data-sketch-on', '');
    for (const t of fresh) {
      t.s.el.removeAttribute('data-sketch');
      t.s.svg?.remove();
      t.s.key = '';
    }
    positions.clear();
  };
  return () => {
    if (dead) return;
    try {
      draw();
    } catch (error) {
      dead = true;
      let why = 'error';
      try {
        off();
        why = String(error instanceof Error ? error.message : error).slice(0, 200);
      } catch {
        // The reason could not be read.
      }
      said = false;
      say(why);
    }
  };
};
