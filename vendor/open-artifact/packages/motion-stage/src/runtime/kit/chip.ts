import { fontFamilies } from '../fonts.ts';
import { stageSize } from '../stage-size.ts';
import { el } from './dom.ts';
import type { StageRect } from './geometry.ts';
import { ei, eo, seg } from './math.ts';

export interface ChipOptions {
  x?: number;
  y?: number;
  /** A point the chip's leader line runs to, with a dot on it. */
  anchor?: [number, number];
  lineColor?: string;
  dotColor?: string;
  style?: string;
}

/** Where a chip was placed, which `show` keeps while it raises it. */
const placed = new WeakMap<Element, [number, number]>();

/** A caption chip: a white pill in 26px sans, with an optional 1.5px leader to an anchor dot. */
export function chip(text: string, options: ChipOptions = {}): HTMLElement {
  const x = options.x ?? stageSize.width / 2;
  const y = options.y ?? stageSize.height - 120;
  const box = el('div', {
    class: 'film-chip',
    style: 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;opacity:0;pointer-events:none',
  });
  if (options.anchor) {
    const ax = options.anchor[0] - x;
    const ay = options.anchor[1] - y;
    const length = Math.hypot(ax, ay);
    const angle = (Math.atan2(ay, ax) * 180) / Math.PI;
    box.appendChild(
      el('div', {
        class: 'film-chip-line',
        style: `position:absolute;left:0;top:-0.75px;width:${length.toFixed(1)}px;height:1.5px;background:${options.lineColor ?? '#111'};transform-origin:0 50%;transform:rotate(${angle.toFixed(2)}deg)`,
      }),
    );
    box.appendChild(
      el('div', {
        class: 'film-chip-dot',
        style: `position:absolute;left:${ax - 5}px;top:${ay - 5}px;width:10px;height:10px;border-radius:50%;background:${options.dotColor ?? '#111'};box-shadow:0 0 0 3px #fff`,
      }),
    );
  }
  box.appendChild(
    el('div', {
      class: 'film-chip-pill',
      text: String(text),
      style:
        'position:absolute;left:0;top:0;transform:translate(-50%,-50%);padding:12px 22px;border-radius:999px;background:#fff;color:#111;font:500 26px/1.25 ' +
        fontFamilies.sans +
        ';letter-spacing:.005em;white-space:nowrap;box-shadow:0 6px 24px rgba(20,20,19,.14),0 0 0 1px rgba(20,20,19,.06)' +
        (options.style ? ';' + options.style : ''),
    }),
  );
  box.style.transform = `translate(${x}px,${y}px)`;
  placed.set(box, [x, y]);
  return box;
}

export interface ShowOptions {
  dur?: number;
  dy?: number;
}

/** Fades and raises a chip, or any absolutely placed node, in at `tIn` and out at `tOut`. Gives back how far in it is. */
export function show(node: HTMLElement, t: number, tIn: number, tOut: number | null | undefined, options: ShowOptions = {}): number {
  const dur = options.dur || 0.35;
  const dy = options.dy ?? 12;
  let progress = eo(seg(t, tIn, tIn + dur));
  if (tOut !== null && tOut !== undefined) progress *= 1 - ei(seg(t, tOut, tOut + dur));
  node.style.opacity = String(progress);
  const xy = placed.get(node);
  node.style.transform = (xy ? `translate(${xy[0]}px,${xy[1]}px) ` : '') + 'translateY(' + ((1 - progress) * dy).toFixed(1) + 'px)';
  return progress;
}

export function roundRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export interface SpotlightOptions {
  pad?: number;
  radius?: number;
}

/** Dims the whole stage on the fx canvas but a rounded hole round `rect`. */
export function spotlight(context: CanvasRenderingContext2D, rect: StageRect | null, amount: number, options: SpotlightOptions = {}): void {
  if (!(amount > 0.001) || !rect) return;
  const pad = options.pad ?? 24;
  const radius = options.radius ?? 18;
  context.save();
  context.fillStyle = 'rgba(20,20,19,' + (0.55 * amount).toFixed(3) + ')';
  context.beginPath();
  context.rect(0, 0, stageSize.width, stageSize.height);
  roundRectPath(context, rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2, radius);
  context.fill('evenodd');
  context.restore();
}
