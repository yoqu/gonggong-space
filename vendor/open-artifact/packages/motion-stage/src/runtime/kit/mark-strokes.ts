import type { Ease } from './math.ts';
import type { Point } from './paper.ts';
import { rng, vnoise } from './random.ts';

export interface MarkGeometry {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  from?: Point;
  to?: Point;
  d?: Point[];
}

/**
 * A hand-drawn mark. Geometry is in the space of the SVG layer the marks draw in. Kinds:
 * circle {x,y,w,h} (the box to circle), underline {x,y,w}, arrow {from,to,bend}, bracket {x,y,h,side},
 * scribble {x,y,w,h}, burst {x,y,r,n}, check {x,y,size}, cross {x,y,size}, path {d}.
 */
export interface Mark extends MarkGeometry {
  id?: string;
  kind: string;
  /** Draw-on start, film seconds. */
  t0: number;
  dur: number;
  /** When it starts to erase. */
  out?: number;
  outDur: number;
  until?: number;
  color: string;
  width: number;
  seed: number;
  opacity?: number;
  rough?: boolean;
  still?: boolean;
  boil?: number;
  ease?: Ease;
  /** Geometry read every frame, for a thing that moves or does not exist yet. */
  geom?: () => MarkGeometry | null | undefined;
  n?: number;
  spread?: number;
  angle?: number;
  size?: number;
  bend?: number;
  head?: number;
  side?: string;
  depth?: number;
  pad?: number;
  padX?: number;
  padY?: number;
  tilt?: number;
  startDeg?: number;
  sweepDeg?: number;
  wave?: number;
  rise?: number;
  hook?: number;
}

/** The marks redraw this many times a second, each time a little different: the boil. */
export const BOIL_FPS = 12;
export const MARK_COLOR = '#e5484d';

const point = (p: Point | undefined): Point => p ?? [NaN, NaN];

/** The strokes of a mark at boil frame `boil`: each a polyline, drawn one after another. */
export function markStrokes(mark: Mark, boil: number): Point[][] {
  if (typeof mark.geom === 'function') {
    const geometry = mark.geom();
    if (!geometry) return [];
    Object.assign(mark, geometry);
  }
  const x = mark.x ?? NaN;
  const y = mark.y ?? NaN;
  const w = mark.w ?? NaN;
  const h = mark.h ?? NaN;
  if ((mark.kind === 'circle' || mark.kind === 'scribble') && !(w > 0 && h > 0 && isFinite(x + y))) return [];
  const next = rng(mark.seed * 7919 + 13);
  const jitter = vnoise(mark.seed * 31 + boil * 977);
  const amp = mark.boil !== undefined ? mark.boil : 1.1;
  const shake = (i: number, scale: number = amp): number => jitter(i * 0.37 + boil * 3.1) * scale;
  const out: Point[][] = [];
  switch (mark.kind) {
    case 'circle': {
      const pad = mark.pad !== undefined ? mark.pad : 0.18;
      const cx = x + w / 2 + (next() - 0.5) * w * 0.04;
      const cy = y + h / 2 + (next() - 0.5) * h * 0.06;
      const rx = mark.padX !== undefined ? w / 2 + mark.padX : (w / 2) * (1 + pad) + h * 0.25;
      const ry = mark.padY !== undefined ? h / 2 + mark.padY : (h / 2) * (1 + pad) + Math.min(h * 0.35, 26);
      const tilt = ((mark.tilt !== undefined ? mark.tilt : -4 + next() * 5) * Math.PI) / 180;
      const start = ((mark.startDeg !== undefined ? mark.startDeg : 195 + next() * 30) * Math.PI) / 180;
      const sweep = ((mark.sweepDeg !== undefined ? mark.sweepDeg : 385 + next() * 30) * Math.PI) / 180;
      const wobble = vnoise(mark.seed * 3 + 1);
      const squash = vnoise(mark.seed * 5 + 2);
      const points: Point[] = [];
      for (let i = 0; i <= 90; i++) {
        const u = i / 90;
        const a = start + sweep * u;
        // The radius grows over the sweep, so the tail passes outside the start: an open spiral.
        const drift = 1 + 0.07 * u + 0.045 * wobble(u * 3.2);
        const px = Math.cos(a) * rx * drift * (1 + 0.03 * squash(u * 4 + 1));
        const py = Math.sin(a) * ry * drift * (1 + 0.04 * wobble(u * 4 + 7));
        points.push([
          cx + px * Math.cos(tilt) - py * Math.sin(tilt) + shake(i),
          cy + px * Math.sin(tilt) + py * Math.cos(tilt) + shake(i + 500),
        ]);
      }
      out.push(points);
      break;
    }
    case 'underline': {
      const wave = vnoise(mark.seed * 11 + 4);
      const over = w * 0.04;
      const points: Point[] = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        let py = y + wave(u * 2.3) * (mark.wave !== undefined ? mark.wave : 3.5) - u * (mark.rise || 2);
        if (u > 0.93) py -= ((u - 0.93) / 0.07) * (mark.hook !== undefined ? mark.hook : 7);
        points.push([x - over + (w + 2 * over) * u + shake(i), py + shake(i + 300)]);
      }
      out.push(points);
      break;
    }
    case 'arrow':
      out.push(...arrowStrokes(mark, shake));
      break;
    case 'bracket': {
      const side = mark.side === 'right' ? -1 : 1;
      const depth = mark.depth || 18;
      const wave = vnoise(mark.seed + 9);
      const points: Point[] = [];
      for (let i = 0; i <= 30; i++) {
        const u = i / 30;
        const bulge = (u < 0.08 ? (0.08 - u) / 0.08 : u > 0.92 ? (u - 0.92) / 0.08 : 0) * depth;
        points.push([x + side * bulge + wave(u * 3) * 2 + shake(i), y + h * u + shake(i + 90)]);
      }
      out.push(points);
      break;
    }
    case 'scribble': {
      const rows = Math.max(3, Math.round(w / (h * 0.55)));
      const wave = vnoise(mark.seed + 21);
      const points: Point[] = [];
      for (let i = 0; i <= rows; i++) {
        const top = i % 2 === 0;
        const px = x + w * (i / rows) + wave(i) * 4;
        points.push([px + (top ? -h * 0.25 : h * 0.25) + shake(i), (top ? y + h * 0.12 : y + h * 0.88) + shake(i + 40, amp * 1.5)]);
      }
      out.push(points);
      break;
    }
    case 'burst': {
      const count = mark.n || 3;
      const spread = mark.spread || 70;
      const base = (mark.angle !== undefined ? mark.angle : -90) - spread / 2;
      const r = mark.r ?? NaN;
      for (let k = 0; k < count; k++) {
        const a = ((base + spread * (count === 1 ? 0.5 : k / (count - 1))) * Math.PI) / 180;
        const r0 = r * 0.55;
        const r1 = r * (0.95 + 0.12 * ((k * 37) % 3));
        out.push([
          [x + Math.cos(a) * r0 + shake(k), y + Math.sin(a) * r0 + shake(k + 5)],
          [x + Math.cos(a) * r1 + shake(k + 9), y + Math.sin(a) * r1 + shake(k + 14)],
        ]);
      }
      break;
    }
    case 'check': {
      const s = mark.size || 40;
      out.push([
        [x - s * 0.45 + shake(1), y - s * 0.05 + shake(2)],
        [x - s * 0.12 + shake(3), y + s * 0.32 + shake(4)],
        [x + s * 0.55 + shake(5), y - s * 0.48 + shake(6)],
      ]);
      break;
    }
    case 'cross': {
      const s = mark.size || 40;
      out.push([
        [x - s / 2 + shake(1), y - s / 2 + shake(2)],
        [x + s / 2 + shake(3), y + s / 2 + shake(4)],
      ]);
      out.push([
        [x + s / 2 + shake(5), y - s / 2 + shake(6)],
        [x - s / 2 + shake(7), y + s / 2 + shake(8)],
      ]);
      break;
    }
    case 'path':
      out.push((mark.d ?? []).map(([px, py], i): Point => [px + shake(i), py + shake(i + 60)]));
      break;
    default:
      break;
  }
  return out;
}

function arrowStrokes(mark: Mark, shake: (i: number) => number): Point[][] {
  const [x0, y0] = point(mark.from);
  const [x1, y1] = point(mark.to);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bend = (mark.bend !== undefined ? mark.bend : 0.18) * length;
  const wave = vnoise(mark.seed * 13 + 5);
  const shaft: Point[] = [];
  for (let i = 0; i <= 44; i++) {
    const u = i / 44;
    const b = Math.sin(Math.PI * u) * bend + wave(u * 2) * 3;
    shaft.push([x0 + dx * u + nx * b + shake(i), y0 + dy * u + ny * b + shake(i + 200)]);
  }
  // The head: two strokes back from the tip, off the shaft's last direction.
  const [ax, ay] = shaft[41] ?? [x0, y0];
  const tl = Math.hypot(x1 - ax, y1 - ay) || 1;
  const ux = (x1 - ax) / tl;
  const uy = (y1 - ay) / tl;
  const head = mark.head !== undefined ? mark.head : Math.min(46, length * 0.28);
  const spread = 0.5;
  const left: Point[] = [
    [x1, y1],
    [x1 - (ux * Math.cos(spread) - uy * Math.sin(spread)) * head + shake(7), y1 - (uy * Math.cos(spread) + ux * Math.sin(spread)) * head + shake(8)],
  ];
  const right: Point[] = [
    [x1, y1],
    [
      x1 - (ux * Math.cos(-spread) - uy * Math.sin(-spread)) * head * 0.9 + shake(9),
      y1 - (uy * Math.cos(-spread) + ux * Math.sin(-spread)) * head * 0.9 + shake(10),
    ],
  ];
  return [shaft, left, right];
}

const fixed = (n: number): string => n.toFixed(1);

/** A smooth hand line through the points: Catmull-Rom as cubic Béziers. */
export function strokePath(points: Point[]): string {
  if (points.length < 3) return 'M' + points.map((p) => fixed(p[0]) + ' ' + fixed(p[1])).join(' L');
  const first = points[0] ?? [0, 0];
  let d = `M${fixed(first[0])} ${fixed(first[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [c1, c2, end] = controls(points, i);
    d += ` C${fixed(c1[0])} ${fixed(c1[1])},${fixed(c2[0])} ${fixed(c2[1])},${fixed(end[0])} ${fixed(end[1])}`;
  }
  return d;
}

function controls(points: Point[], i: number): [Point, Point, Point] {
  const p1 = points[i] ?? [0, 0];
  const p0 = points[i - 1] ?? p1;
  const p2 = points[i + 1] ?? p1;
  const p3 = points[i + 2] ?? p2;
  return [
    [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
    [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
    p2,
  ];
}

/** [left, top, right, bottom] of a stroke's points and control points: a cubic never leaves the box of its four points. */
export function strokeBox(points: Point[]): [number, number, number, number] {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (p: Point): void => {
    box[0] = Math.min(box[0], p[0]);
    box[1] = Math.min(box[1], p[1]);
    box[2] = Math.max(box[2], p[0]);
    box[3] = Math.max(box[3], p[1]);
  };
  for (const p of points) take(p);
  for (let i = 0; i < points.length - 1; i++) {
    const [c1, c2] = controls(points, i);
    take(c1);
    take(c2);
  }
  return box;
}

export function strokeLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] ?? [0, 0];
    const b = points[i] ?? a;
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}
