import { eio, eo, lerp, seg } from './math.ts';
import type { Point } from './paper.ts';

export const CURSOR_ARROW = `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5.2 2.9v17.4l4.3-4.1 2.7 6.2 2.9-1.25-2.65-6.05h5.85z" fill="#111" stroke="#fff" stroke-width="1.35" stroke-linejoin="round"/></svg>`;
const DOUBLE_ARROW = `<path d="M2.5 12l4.2-4.2v2.7h10.6V7.8L21.5 12l-4.2 4.2v-2.7H6.7v2.7z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`;
export const CURSOR_EW = `<svg width="46" height="46" viewBox="0 0 24 24" style="margin:-23px 0 0 -23px">${DOUBLE_ARROW}</svg>`;
export const CURSOR_NESW = `<svg width="46" height="46" viewBox="0 0 24 24" style="margin:-23px 0 0 -23px"><g transform="rotate(-45 12 12)">${DOUBLE_ARROW}</g></svg>`;
export const CURSOR_NWSE = `<svg width="46" height="46" viewBox="0 0 24 24" style="margin:-23px 0 0 -23px"><g transform="rotate(45 12 12)">${DOUBLE_ARROW}</g></svg>`;
export const CURSOR_COPY = `<svg width="40" height="40" viewBox="0 0 32 32"><path d="M5.2 2.9v17.4l4.3-4.1 2.7 6.2 2.9-1.25-2.65-6.05h5.85z" fill="#111" stroke="#fff" stroke-width="1.35" stroke-linejoin="round"/><circle cx="22.5" cy="22" r="7" fill="#34c84a" stroke="#fff" stroke-width="1.6"/><path d="M22.5 18.2v7.6M18.7 22h7.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
const I_BEAM = 'M8 3h3.2c.5 0 .8.3.8.8V24.2c0 .5-.3.8-.8.8H8M16 3h-3.2c-.5 0-.8.3-.8.8M16 25h-3.2c-.5 0-.8-.3-.8-.8M9.5 14h5';
export const CURSOR_TEXT = `<svg width="30" height="34" viewBox="0 0 24 28" style="margin:-17px 0 0 -12px"><path d="${I_BEAM}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="${I_BEAM}" fill="none" stroke="#111" stroke-width="1.3" stroke-linecap="round"/></svg>`;

/** `kit.cursors`: glyphs a film passes to `kit.cursor(...)` or a cursor's `shapes`. */
export const CURSORS = {
  arrow: CURSOR_ARROW,
  ew: CURSOR_EW,
  nesw: CURSOR_NESW,
  nwse: CURSOR_NWSE,
  copy: CURSOR_COPY,
  text: CURSOR_TEXT,
} as const;

/** A cursor for the stage: a press ring and a glyph, the arrow or the SVG markup the film passes. */
export function cursorElement(glyph: string | undefined): HTMLElement {
  const box = document.createElement('div');
  box.className = 'film-cursor';
  box.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none';
  box.innerHTML =
    '<div class="cursor-ring" style="position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;border:3px solid rgba(20,20,19,.55);opacity:0"></div>' +
    '<div class="cursor-gfx" style="position:absolute;left:-4px;top:-3px;transform-origin:4px 3px">' +
    (glyph || CURSOR_ARROW) +
    '</div>';
  return box;
}

export interface CursorKey {
  t: number;
  at: Point | (() => Point);
  /** How far the path bows sideways, as a share of its length. */
  bow?: number;
  /** Move at an even pace instead of easing. */
  lin?: boolean;
}

export interface CursorShape {
  spans: Array<[number, number]>;
  gfx: string;
}

/** keys [{t, at, bow?, lin?}], clicks [t…], holds [[a, b]…], ewSpans and shapes pick the glyph. */
export class Cursor {
  el: HTMLElement;
  gfx: HTMLElement | null;
  ring: HTMLElement | null;
  keys: CursorKey[] = [];
  clicks: number[] = [];
  holds: Array<[number, number]> = [];
  ewSpans: Array<[number, number]> = [];
  shapes: CursorShape[] = [];
  cur = '';
  visible: (t: number) => number = () => 1;

  constructor(el: HTMLElement) {
    this.el = el;
    this.gfx = el.querySelector<HTMLElement>('.cursor-gfx');
    this.ring = el.querySelector<HTMLElement>('.cursor-ring');
  }

  pos(t: number): Point {
    const keys = this.keys;
    const place = (key: CursorKey): Point => (typeof key.at === 'function' ? key.at() : key.at);
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (!first || !last) return [-100, -100];
    if (t <= first.t) return place(first);
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (!a || !b || !(t >= a.t && t < b.t)) continue;
      const p = b.lin ? seg(t, a.t, b.t) : eio(seg(t, a.t, b.t));
      const from = place(a);
      const to = place(b);
      let x = lerp(from[0], to[0], p);
      let y = lerp(from[1], to[1], p);
      if (b.bow) {
        const bend = Math.sin(Math.PI * p) * b.bow;
        x += -(to[1] - from[1]) * bend;
        y += (to[0] - from[0]) * bend;
      }
      return [x, y];
    }
    return place(last);
  }

  render(t: number): void {
    const opacity = this.visible(t);
    this.el.style.display = opacity > 0.001 ? '' : 'none';
    if (opacity <= 0.001) return;
    const [x, y] = this.pos(t);
    this.el.style.opacity = String(opacity);
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    const within = ([a, b]: [number, number]): boolean => t >= a && t < b;
    const shape = this.shapes.find((s) => s.spans.some(within));
    const glyph = shape ? shape.gfx : this.ewSpans.some(within) ? CURSOR_EW : CURSOR_ARROW;
    if (glyph !== this.cur && this.gfx) {
      this.gfx.innerHTML = glyph;
      this.cur = glyph;
    }
    let press = 0;
    let ringAge = 9;
    for (const click of this.clicks) {
      const age = t - click;
      if (age >= 0 && age < ringAge) ringAge = age;
      if (age >= -0.04 && age < 0.14) press = 1;
    }
    const held = this.holds.some(within);
    if (this.gfx) this.gfx.style.transform = `scale(${press || held ? 0.86 : 1})`;
    if (this.ring) {
      this.ring.style.opacity = String(ringAge < 0.4 ? 0.55 * (1 - ringAge / 0.4) : 0);
      this.ring.style.transform = `scale(${lerp(0.35, 1, eo(ringAge / 0.4))})`;
    }
  }
}
