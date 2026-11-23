import { clamp, eio, seg } from './math.ts';
import { BOIL_FPS, MARK_COLOR, markStrokes, strokeBox, strokeLength, strokePath, type Mark } from './mark-strokes.ts';
import type { Point } from './paper.ts';
import { vnoise } from './random.ts';
import { stageSize } from '../stage-size.ts';

const SVG = 'http://www.w3.org/2000/svg';

interface MarkFilters {
  pattern: Element;
  copies: Map<SVGPathElement, Element>;
}

// Kept apart from the Marks object, whose properties a film may overwrite.
const FILTERS = new WeakMap<Marks, MarkFilters>();
let filterCount = 0;

/**
 * A browser filters a filter's whole region, so each stroke gets its own copy of the stage-wide `#mk-rough`,
 * only as large as the stroke (half the pen and 12 px for the displacement). The noise at a point depends on
 * where it sits in the layer, so a stroke looks as it would under the one big filter.
 */
function strokeFilter(marks: Marks, path: SVGPathElement, points: Point[], width: number): string {
  const box = strokeBox(points);
  const more = width / 2 + 12;
  const own = FILTERS.get(marks);
  if (!own || !(width >= 0) || !isFinite(more + box[0] + box[1] + box[2] + box[3])) return 'url(#mk-rough)';
  let filter = own.copies.get(path);
  if (!filter) {
    // A film may take a mark's nodes away itself, without clear().
    for (const [stroke, copy] of own.copies)
      if (!stroke.isConnected && !marks.svg.contains(stroke)) {
        copy.remove();
        own.copies.delete(stroke);
      }
    const copy = own.pattern.cloneNode(true);
    if (!(copy instanceof Element)) return 'url(#mk-rough)';
    copy.id = 'mk-rough-' + ++filterCount;
    copy.setAttribute('filterUnits', 'userSpaceOnUse');
    marks.svg.appendChild(copy);
    own.copies.set(path, copy);
    filter = copy;
  }
  const x = Math.floor(box[0] - more);
  const y = Math.floor(box[1] - more);
  const region = [x, y, Math.ceil(box[2] + more) - x, Math.ceil(box[3] + more) - y];
  ['x', 'y', 'width', 'height'].forEach((name, i) => {
    const value = String(region[i]);
    if (filter.getAttribute(name) !== value) filter.setAttribute(name, value);
  });
  return 'url(#' + filter.id + ')';
}

export type MarkInput = Partial<Mark> & { kind: string; t0: number };

/** Hand-drawn marks on an SVG layer: they draw on, boil, and erase. */
export class Marks {
  svg: SVGSVGElement;
  items: Mark[] = [];
  nodes = new Map<Mark, SVGGElement>();

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    // Strokes copy this element rather than look it up by id later: svg may not be in the document yet.
    let pattern: Element | null = document.getElementById('mk-rough');
    if (!pattern) {
      const defs = document.createElementNS(SVG, 'defs');
      defs.innerHTML =
        '<filter id="mk-rough" filterUnits="userSpaceOnUse" x="-400" y="-400" width="2720" height="1880"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter>';
      const filter = defs.firstElementChild;
      // Marks in a camera's space draw past the edges of a small stage, so the filter never covers less than at 1920×1080.
      filter?.setAttribute('width', String(Math.max(1920, stageSize.width) + 800));
      filter?.setAttribute('height', String(Math.max(1080, stageSize.height) + 800));
      svg.appendChild(defs);
      pattern = filter;
    }
    if (pattern) FILTERS.set(this, { pattern, copies: new Map() });
  }

  /** Geometry as numbers, or `geom: () => ({x, y, w, h})` read every frame. Getters on `mark` stay getters. */
  add(mark: MarkInput): this {
    const item = { dur: 0.45, color: MARK_COLOR, width: 10, seed: 1, outDur: 0.3 } as Mark;
    Object.defineProperties(item, Object.getOwnPropertyDescriptors(mark));
    this.items.push(item);
    return this;
  }

  get(id: string): Mark | undefined {
    return this.items.find((mark) => mark.id === id);
  }

  clear(): void {
    const copies = FILTERS.get(this)?.copies;
    this.items = [];
    for (const node of this.nodes.values()) node.remove();
    if (copies) for (const copy of copies.values()) copy.remove();
    this.nodes.clear();
    copies?.clear();
  }

  strokes(mark: Mark, boil: number): Point[][] {
    return markStrokes(mark, boil);
  }

  static toPath(points: Point[]): string {
    return strokePath(points);
  }

  render(t: number): void {
    const boil = Math.floor(t * BOIL_FPS);
    for (const mark of this.items) {
      const gone = mark.out !== undefined && t >= mark.out + mark.outDur;
      const on = t >= mark.t0 && !gone && !(mark.until !== undefined && t >= mark.until);
      let group = this.nodes.get(mark);
      if (!on) {
        if (group) group.style.display = 'none';
        continue;
      }
      if (!group) {
        group = document.createElementNS(SVG, 'g');
        // Layers passes over the kit's marks: they are not parts of the film's drawing.
        group.setAttribute('data-film-mark', '');
        this.svg.appendChild(group);
        this.nodes.set(mark, group);
      }
      group.style.display = '';
      this.drawMark(mark, group, t, boil);
    }
  }

  private drawMark(mark: Mark, group: SVGGElement, t: number, boil: number): void {
    const strokes = this.strokes(mark, mark.still ? 0 : boil);
    while (group.childNodes.length < strokes.length) group.appendChild(document.createElementNS(SVG, 'path'));
    const lengths = strokes.map(strokeLength);
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    const drawOn = mark.ease ?? ((x: number) => 1 - Math.pow(1 - x, 2.4));
    const drawn = drawOn(seg(t, mark.t0, mark.t0 + mark.dur)) * total;
    const erased = mark.out !== undefined ? eio(seg(t, mark.out, mark.out + mark.outDur)) * total : 0;
    const weight = mark.still ? 1 : 1 + 0.04 * vnoise(mark.seed + 77)(boil * 1.7);
    let before = 0;
    for (let i = 0; i < group.childNodes.length; i++) {
      const path = group.childNodes[i];
      if (!(path instanceof SVGPathElement)) continue;
      const stroke = strokes[i];
      if (!stroke) {
        path.style.display = 'none';
        continue;
      }
      path.style.display = '';
      const length = lengths[i] ?? 0;
      const from = clamp(erased - before, 0, length);
      const to = clamp(drawn - before, 0, length);
      before += length;
      path.setAttribute('d', strokePath(stroke));
      path.setAttribute('stroke', mark.color);
      path.setAttribute('stroke-width', (mark.width * weight).toFixed(2));
      if (mark.opacity !== undefined) path.setAttribute('opacity', String(mark.opacity));
      if (mark.rough !== false) path.setAttribute('filter', strokeFilter(this, path, stroke, mark.width * weight));
      else {
        const copy = FILTERS.get(this)?.copies.get(path);
        if (copy && path.getAttribute('filter') === 'url(#' + copy.id + ')') path.removeAttribute('filter');
      }
      const shown = Math.max(0, to - from);
      path.setAttribute('stroke-dasharray', `${shown.toFixed(1)} ${(length + 50).toFixed(1)}`);
      path.setAttribute('stroke-dashoffset', (-from).toFixed(1));
      path.style.opacity = String(shown < 0.5 ? 0 : mark.opacity !== undefined ? mark.opacity : 1);
    }
  }
}
