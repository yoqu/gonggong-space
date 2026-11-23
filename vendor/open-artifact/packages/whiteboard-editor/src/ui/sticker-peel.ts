/**
 * Dragging a sticker off the picker: its flight under the pointer, the
 * peel, and the lay-down where it lands.
 *
 * The flight ({@link startStickerFlight}) is a copy of the cell's art in a
 * fixed layer above the page, growing from the cell's size to the
 * sticker's size on the board and easing after the pointer. With the peel
 * on ({@link StickerPeel}), it peels off its sheet as it goes: its trailing
 * corner folds over, showing the sticker's paper back, it lifts (a deeper
 * shadow) and leans into the motion, while the cell it came from fades.
 * Let go over the board, the sticker is placed and the peel lays down on
 * it ({@link StickerPeel.layDown}); let go over the picker or the board's
 * chrome, it flies home. With reduced motion it just follows the pointer.
 *
 * The motion model is `lib/peel-motion.ts`; this draws it.
 */

import {
  PEEL_LAY_DOWN_MS,
  STICKER_FLY_BACK_MS,
  StickerPeelMotion,
  easePeelLayDown,
  peelDropShadowFilter,
  peelFoldGeometry,
  peelFoldReach,
} from '../lib/peel-motion.ts';
import { useTheme } from '../state/theme.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The paper back of a sticker. */
const PEEL_PAPER = '#EDE9E0';
/** The shade across a folded flap: [offset, color, opacity]. */
const PEEL_SHADE_STOPS = [
  [0, '#000', 0.26],
  [0.1, '#fff', 0.95],
  [0.42, '#fff', 0],
  [1, '#000', 0.16],
] as const;
/** Attribute on the element holding a peeling sticker. */
const PEEL_ATTRIBUTE = 'data-wb-peel';

let foldCounter = 0;

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  parent?.append(element);
  return element;
}

function darkBoard(): boolean {
  return useTheme.getState().scheme === 'dark';
}

/** Polygon points as SVG `points`. */
function points(polygon: ReadonlyArray<readonly [number, number]>): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(' ');
}

/**
 * A fold drawn on sticker art: the art is clipped along the fold line and
 * a flap (the paper back of the folded-over part, shaded) lies over it.
 * The art is taken as round, filling its square box.
 */
class StickerPeelFold {
  private readonly host: HTMLElement;
  private readonly flap: SVGSVGElement;
  private readonly turned: SVGGElement;
  private readonly cut: SVGPolygonElement;
  private readonly shade: SVGLinearGradientElement;
  private readonly side: number;
  private readonly reach: number;

  /** A fold on `host` (the art), its flap added to `holder` (which centers both). */
  constructor(host: HTMLElement, holder: HTMLElement) {
    this.host = host;
    this.side = host.offsetWidth || Number.parseFloat(host.style.width) || 0;
    this.reach = peelFoldReach(this.side);
    const id = `wb-peel-fold-${++foldCounter}`;
    this.flap = svgElement('svg', { class: 'wb-peel', width: this.side, height: this.side, viewBox: `0 0 ${this.side} ${this.side}`, overflow: 'visible', 'aria-hidden': 'true' });
    this.flap.style.filter = 'drop-shadow(0 1px 1.5px rgba(0,0,0,.32))';
    const defs = svgElement('defs', {}, this.flap);
    this.cut = svgElement('polygon', {}, svgElement('clipPath', { id }, defs));
    this.shade = svgElement('linearGradient', { id: `${id}-shade`, gradientUnits: 'userSpaceOnUse' }, defs);
    for (const [offset, color, opacity] of PEEL_SHADE_STOPS) svgElement('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }, this.shade);
    this.turned = svgElement('g', {}, this.flap);
    const clipped = svgElement('g', { 'clip-path': `url(#${id})` }, this.turned);
    for (const fill of [PEEL_PAPER, `url(#${id}-shade)`]) svgElement('circle', { cx: this.side / 2, cy: this.side / 2, r: this.side / 2, fill }, clipped);
    holder.append(this.flap);
  }

  /** Draws the fold `depth` deep, the art and flap at `scale` and turned `lean` degrees. */
  draw(depth: number, scale = 1, lean = 0): void {
    this.host.style.transform = this.flap.style.transform = `scale(${scale}) rotate(${lean}deg)`;
    this.flap.style.visibility = depth > 0.001 ? 'visible' : 'hidden';
    if (depth <= 0.001) {
      this.host.style.clipPath = '';
      return;
    }
    const fold = peelFoldGeometry(depth, this.side, this.reach);
    this.cut.setAttribute('points', points(fold.cut));
    this.turned.setAttribute('transform', `matrix(${fold.matrix.join(' ')})`);
    for (const [name, value] of Object.entries(fold.shade)) this.shade.setAttribute(name, String(value));
    this.host.style.clipPath = `polygon(${fold.keep.map(([x, y]) => `${x}px ${y}px`).join(',')})`;
  }

  /** Takes the fold off the art. */
  end(): void {
    this.host.style.clipPath = this.host.style.transform = '';
    this.flap.remove();
  }
}

/** A sticker peeling: its motion, drawn as a fold on its art. */
export class StickerPeel {
  private readonly pull: StickerPeelMotion;
  private host: HTMLElement;
  private holder: HTMLElement;
  private fold: StickerPeelFold | undefined;
  private over = false;
  private drawn: string | undefined;

  /** A peel of `host` (the art) in `holder`, starting at `startScale`. */
  constructor(host: HTMLElement, holder: HTMLElement, startScale: number) {
    this.pull = new StickerPeelMotion(performance.now(), startScale);
    this.host = host;
    this.holder = holder;
    holder.setAttribute(PEEL_ATTRIBUTE, '');
    holder.style.filter = peelDropShadowFilter(1, darkBoard());
    this.show();
  }

  /** The sticker's scale now. */
  get scale(): number {
    return this.pull.scale;
  }

  /** The sticker's lean now, degrees. */
  get lean(): number {
    return this.pull.lean;
  }

  /** Advances the motion (see {@link StickerPeelMotion.step}) and redraws. */
  step(time: number, dx: number, dy: number, tdx: number, tdy: number): void {
    if (this.pull.step(time, dx, dy, tdx, tdy)) this.show();
  }

  private show(): void {
    this.draw(this.pull.depth);
  }

  private draw(depth: number, scale = 1, lean = 0): void {
    const key = `${depth.toFixed(4)} ${scale.toFixed(4)} ${lean.toFixed(4)}`;
    if (this.over || key === this.drawn) return;
    this.drawn = key;
    try {
      (this.fold ??= new StickerPeelFold(this.host, this.holder)).draw(depth, scale, lean);
    } catch (error) {
      console.warn('whiteboard: a sticker animation failed and was skipped; the board itself is unaffected', error);
      this.end();
    }
  }

  /**
   * Lays the peel down on the placed sticker's view (`cell`, holding its
   * art first): the fold flattens and the sticker settles to its size and
   * straightens. Any press ends it at once. Resolves `true` when it ran to
   * the end.
   */
  layDown(cell: HTMLElement): Promise<boolean> {
    const art = cell.firstElementChild;
    if (!(art instanceof HTMLElement)) {
      this.end();
      return Promise.resolve(false);
    }
    this.fold?.end();
    this.fold = undefined;
    this.holder.removeAttribute(PEEL_ATTRIBUTE);
    this.holder.style.filter = '';
    this.drawn = undefined;
    this.host = art;
    this.holder = cell;
    cell.setAttribute(PEEL_ATTRIBUTE, '');
    const pull = this.pull;
    const { depth, scale, lean } = pull;
    return new Promise<boolean>((resolve) => {
      let startedAt: number | undefined;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (done: boolean): void => {
        clearTimeout(timer);
        document.removeEventListener('pointerdown', cancel, true);
        this.end();
        resolve(done);
      };
      const cancel = (): void => finish(false);
      const armTimeout = (): ReturnType<typeof setTimeout> => setTimeout(() => finish(false), PEEL_LAY_DOWN_MS + 500);
      document.addEventListener('pointerdown', cancel, true);
      timer = armTimeout();
      const frame = (time?: number): void => {
        if (time !== undefined && startedAt === undefined) {
          startedAt = performance.now();
          clearTimeout(timer);
          timer = armTimeout();
        }
        const progress = startedAt === undefined ? 0 : Math.min(1, (performance.now() - startedAt) / PEEL_LAY_DOWN_MS);
        if (progress === 1 || this.over || !cell.isConnected || cell.hasAttribute('data-wb-lifted')) {
          finish(progress === 1);
          return;
        }
        const remaining = 1 - easePeelLayDown(progress);
        this.draw(depth * remaining, 1 + (scale - 1) * remaining, lean * remaining);
        requestAnimationFrame(frame);
      };
      frame();
    });
  }

  /** Ends the peel: the fold comes off and the sticker is drawn as usual. */
  end(): void {
    this.over = true;
    this.fold?.end();
    this.fold = undefined;
    this.holder.removeAttribute(PEEL_ATTRIBUTE);
    if (this.holder.isConnected && this.holder.classList.contains('wb-flyer')) this.holder.style.filter = '';
  }
}

/** A sticker in flight from the picker. */
export interface StickerFlight {
  /** The pointer moved to (`x`, `y`), client px. */
  move(x: number, y: number): void;
  /** Let go over the board: the flight ends; returns the peel, to lay down on the placed sticker. */
  drop(): StickerPeel | undefined;
  /** Let go elsewhere: the sticker flies home. */
  back(): void;
}

/** How many flights dim each source cell (the cell shows again when none do). */
const dimmed = new Map<HTMLElement, number>();
let flyerLayer: HTMLElement | null = null;

/** A z-index above every ancestor of `element`. */
function zIndexAboveAncestors(element: Element): string {
  let zIndex = 0;
  for (let node: Element | null = element; node !== null; node = node.parentElement) zIndex = Math.max(zIndex, Number(getComputedStyle(node).zIndex) || 0);
  return String(zIndex + 1);
}

/**
 * Starts a flight of the art `source` (a picker cell's art, drawn `artPx`
 * px) that grows to `size` px (the art's size on the board, on screen).
 * `still` (reduced motion) just follows the pointer; `peels` adds the peel.
 */
export function startStickerFlight(source: HTMLElement, artPx: number, size: number, still: boolean, peels: boolean): StickerFlight {
  const flyer = document.createElement('div');
  flyer.className = 'wb-flyer';
  flyer.setAttribute('aria-hidden', 'true');
  flyer.style.width = flyer.style.height = `${size}px`;
  flyer.style.zIndex = zIndexAboveAncestors(source);
  const art = source.cloneNode(true) as HTMLElement;
  art.style.fontSize = art.style.width = art.style.height = `${size}px`;
  flyer.append(art);
  const bounds = source.getBoundingClientRect();
  if (flyerLayer?.parentNode !== document.body) {
    flyerLayer = document.body.appendChild(document.createElement('div'));
    flyerLayer.style.display = 'contents';
  }
  flyerLayer.append(flyer);

  let lastTransform = '';
  const place = (x: number, y: number, scale: number, rotate = 0): void => {
    const transform = `translate(${x - size / 2}px,${y - size / 2}px) scale(${scale}) rotate(${rotate}deg)`;
    if (transform !== lastTransform) flyer.style.transform = lastTransform = transform;
  };
  const home = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  if (still) {
    place(home.x, home.y, 1);
    return { move: (x, y) => place(x, y, 1), drop: () => void flyer.remove(), back: () => flyer.remove() };
  }

  const peel = peels ? new StickerPeel(art, flyer, artPx / size) : undefined;
  dimmed.set(source, (dimmed.get(source) ?? 0) + 1);
  if (peel !== undefined) source.style.opacity = '.22';
  const restore = (): void => {
    const count = (dimmed.get(source) ?? 1) - 1;
    if (count <= 0) {
      dimmed.delete(source);
      source.style.opacity = '';
    } else dimmed.set(source, count);
    flyer.remove();
  };

  const shown = { ...home };
  const target = { ...home };
  let lastTarget: { x: number; y: number } | undefined;
  let scale = artPx / size;
  let flyBack: { x: number; y: number; scale: number; t?: number } | undefined;
  const tick = (time: number): void => {
    if (!flyer.isConnected) return;
    const previous = { ...shown };
    let progress = 0;
    if (flyBack !== undefined) {
      flyBack.t ??= time;
      progress = Math.min(1, (time - flyBack.t) / STICKER_FLY_BACK_MS);
    }
    const eased = 1 - (1 - progress) ** 3;
    if (flyBack !== undefined) {
      shown.x = flyBack.x + (home.x - flyBack.x) * eased;
      shown.y = flyBack.y + (home.y - flyBack.y) * eased;
    } else {
      shown.x += (target.x - shown.x) * 0.34;
      shown.y += (target.y - shown.y) * 0.34;
    }
    const aimX = flyBack !== undefined ? shown.x - previous.x : lastTarget !== undefined ? target.x - lastTarget.x : 0;
    const aimY = flyBack !== undefined ? shown.y - previous.y : lastTarget !== undefined ? target.y - lastTarget.y : 0;
    peel?.step(time, shown.x - previous.x, shown.y - previous.y, aimX, aimY);
    if (lastTarget !== undefined) lastTarget = { ...target };
    scale = flyBack !== undefined ? flyBack.scale + (artPx / size - flyBack.scale) * eased : (peel?.scale ?? scale + (1 - scale) * 0.2);
    place(shown.x, shown.y, scale, (peel?.lean ?? 0) * (1 - eased));
    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    peel?.end();
    restore();
  };
  place(home.x, home.y, scale);
  requestAnimationFrame(tick);
  return {
    move(x, y) {
      lastTarget ??= { x, y };
      target.x = x;
      target.y = y;
    },
    drop() {
      restore();
      return peel;
    },
    back() {
      if (document.hidden) {
        peel?.end();
        restore();
      } else flyBack ??= { ...shown, scale };
    },
  };
}
