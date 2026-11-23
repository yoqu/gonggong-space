export type Sides = [number, number, number, number];

export interface SketchBoxOptions {
  /** The square root of the stage's area over that of 1280 by 720. */
  u: number;
  /** The border's width at top, right, bottom, left; 0 for a side not drawn. */
  sides: Sides;
  /** Drawn on the box's edge, not down the border's middle. */
  onEdge: boolean;
  /** One stroke along the longer side. */
  bar: boolean;
  /** Dashed or dotted. */
  broken: boolean;
  /** The corner as CSS states it. */
  rx: number;
  ry: number;
  /** 0: none; 1: close; 2: wide. */
  hatch: 0 | 1 | 2;
  /** [x0, y0, x1, y1] that the hatching keeps off. */
  skip: Sides | null;
}

/** One line as three pencil passes, each straying further than the last, as path data. */
export interface SketchStroke {
  main: string;
  again: string;
  third: string;
  width: string;
}

export interface SketchBox {
  wash: string;
  hatch: string;
  cross: string;
  /** The hatching's pen width. */
  fine: string;
  /** Top, right, bottom, left; or the one line of a bar or a round box first. */
  lines: [SketchStroke | null, SketchStroke | null, SketchStroke | null, SketchStroke | null];
}

type Point = [number, number];
type Roll = () => number;

const n1 = (n: number): string => String(Math.round(n * 10) / 10);
const n0 = (n: number): string => String(Math.round(n));

function through(p: Point[]): string {
  const first = p[0] ?? [0, 0];
  const last = p[p.length - 1] ?? first;
  let d = 'M' + n1(first[0]) + ' ' + n1(first[1]);
  for (let k = 1; k < p.length - 1; k++) {
    const a = p[k] ?? first;
    const b = p[k + 1] ?? last;
    d += 'Q' + n1(a[0]) + ' ' + n1(a[1]) + ' ' + n1((a[0] + b[0]) / 2) + ' ' + n1((a[1] + b[1]) / 2);
  }
  return d + 'L' + n1(last[0]) + ' ' + n1(last[1]);
}

/**
 * The strokes for one element of w by h px, as path data: a pure function of its arguments, so that a frame follows
 * from t alone.
 */
export function sketchBox(seed: number, w: number, h: number, o: SketchBoxOptions): SketchBox {
  const u = o.u;
  const step = 110 * u;
  const thin = Math.min(w, h);
  const b = o.sides;
  // Each line has random numbers of its own, drawn in an order its length does not change: as a box grows, what is drawn stays put.
  const stream = (k: number): Roll => {
    // Mixed first: the generator is linear, and would give neighbouring seeds the same numbers a constant apart.
    let m = seed + k * 104729;
    m ^= m >>> 16;
    m = Math.imul(m, 0x45d9f3b);
    m ^= m >>> 16;
    let s = ((m >>> 1) % 2147483646) + 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  };
  const line = (roll: Roll, x0: number, y0: number, x1: number, y1: number, amp: number): string => {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    const over = Math.min(37 * u, len * 0.11, thin * 0.16);
    const a = over * (0.3 + roll());
    const all = len + a + over * (0.3 + roll());
    const far = amp * Math.min(1, all / step);
    const p: Point[] = [];
    let off = roll() * 2 - 1;
    const put = (s: number, f: number): void => {
      p.push([x0 + ux * (s - a) - uy * f * far, y0 + uy * (s - a) + ux * f * far]);
    };
    for (let s = 0; ; s += step) {
      const next = roll() * 2 - 1;
      put(s, off);
      if (!(s + step < all) || p.length > 400) {
        put(all, off + ((next - off) * (all - s)) / step);
        return through(p);
      }
      off = next;
    }
  };
  // On one box a wider border is never a thinner pen: what chance adds is the box's own, and under 1 px.
  const base = (3 + Math.max(0, Math.min(1, thin / u / 100 - 1.5))) * u;
  const chance = stream(0)() * Math.min(0.5 * u, 0.8);
  const pen = (bw: number): number => Math.max(2 * u, base + bw - 2) + chance;
  // Pencil: three thin passes; the third is spared on a small element, where it would only thicken the line.
  const stroke = (k: number, bw: number, draw: (roll: Roll, amplitude: number) => string): SketchStroke => ({
    main: draw(stream(1 + k), 1),
    again: draw(stream(11 + k), 1.5),
    third: Math.max(w, h) > step ? draw(stream(31 + k), 2.1) : '',
    width: n1(pen(bw)),
  });
  const out: SketchBox = { wash: '', hatch: '', cross: '', fine: n1(1.5 * u), lines: [null, null, null, null] };
  if (o.bar) {
    // With its round ends the stroke covers what the element covers: a dot where the sides are equal.
    out.lines[0] = stroke(0, thin - base + 2, (roll, k) => (w >= h ? line(roll, h / 2, h / 2, w - h / 2, h / 2, 3 * u * k) : line(roll, w / 2, w / 2, w / 2, h - w / 2, 3 * u * k)));
    return out;
  }
  const mid = o.onEdge ? 0 : 0.5;
  const x0 = b[3] * mid;
  const y0 = b[0] * mid;
  const x1 = w - b[1] * mid;
  const y1 = h - b[2] * mid;
  const whole = !!(b[0] && b[1] && b[2] && b[3]);
  // As CSS does, radii too large for the box are shrunk by one factor.
  const fit = Math.min(1, o.rx ? w / (2 * o.rx) : 1, o.ry ? h / (2 * o.ry) : 1);
  const round = whole && Math.min(o.rx, o.ry) * fit >= 0.3 * thin;
  const rx = round ? Math.max(0, o.rx * fit - x0) : 0;
  const ry = round ? Math.max(0, o.ry * fit - y0) : 0;
  if (round) out.lines[0] = stroke(0, b[0], (roll, k) => ring(roll, k));
  else {
    const edges: Sides[] = [
      [x0, y0, x1, y0],
      [x1, y0, x1, y1],
      [x1, y1, x0, y1],
      [x0, y1, x0, y0],
    ];
    edges.forEach((e, k) => {
      if (b[k]) out.lines[k] = stroke(k, b[k] ?? 0, (roll, more) => line(roll, e[0], e[1], e[2], e[3], 4.5 * u * more));
    });
  }
  function ring(roll: Roll, k: number): string {
    // Each point: x, y, the outward normal, and a weight, 0 on a corner and 1 mid-way along a straight run.
    const p: Array<[number, number, number, number, number]> = [];
    const q: Point[] = [];
    const starts: number[] = [];
    const full = 4.5 * u * k * 0.8;
    const amp = Math.min(full, (full * Math.min(rx, ry)) / (96 * u));
    const corners: Array<[number, number, number, number, number]> = [
      [x1 - rx, y0 + ry, -90, 0, 1],
      [x1 - rx, y1 - ry, 0, -1, 0],
      [x0 + rx, y1 - ry, 90, 0, -1],
      [x0 + rx, y0 + ry, 180, 1, 0],
    ];
    corners.forEach((corner, j) => {
      starts.push(p.length + 3);
      for (let i = 0; i <= 6; i++) {
        const t = ((corner[2] + 15 * i) * Math.PI) / 180;
        p.push([corner[0] + rx * Math.cos(t), corner[1] + ry * Math.sin(t), Math.cos(t), Math.sin(t), 0]);
      }
      const run = j % 2 ? x1 - x0 - 2 * rx : y1 - y0 - 2 * ry;
      const n = Math.min(Math.floor(run / step), 400);
      const end = p[p.length - 1];
      if (end) for (let m = 1; m <= n; m++) p.push([end[0] + (corner[3] * run * m) / (n + 1), end[1] + (corner[4] * run * m) / (n + 1), end[2], end[3], Math.sin((Math.PI * m) / (n + 1))]);
    });
    // A dashed ring stops where it began: dashes laid over dashes would show out of step.
    const from = starts[Math.floor(roll() * 4)] ?? 0;
    const p1 = roll() * 6.3;
    const p2 = roll() * 6.3;
    const p3 = roll() * 6.3;
    const last = p.length + (o.broken ? 0 : 3);
    let was: [number, number, number, number, number] | null = null;
    for (let i = 0; i <= last; i++) {
      // A slow swell and a drift, so that the end misses the beginning.
      const at = p[(from + i) % p.length];
      if (!at) continue;
      const t = ((from + i) * 2 * Math.PI) / p.length;
      const off = (amp + at[4] * (full - amp)) * (0.55 * Math.sin(t + p1) + 0.35 * Math.sin(2 * t + p2) + 0.2 * Math.sin(3 * t + p3)) + amp * 0.9 * (i / last - 0.5);
      // With no straight run between two corners, one ends on the point the next begins with.
      if (!was || Math.hypot(at[0] - was[0], at[1] - was[1]) > 0.5) q.push([at[0] + at[2] * off, at[1] + at[3] * off]);
      was = at;
    }
    return through(q);
  }
  if (!whole || !o.hatch) return out;
  const arc = (x: number, y: number): string => (round ? 'A' + n1(rx) + ' ' + n1(ry) + ' 0 0 1 ' + n1(x) + ' ' + n1(y) : '');
  out.wash =
    'M' + n1(x0 + rx) + ' ' + n1(y0) + 'H' + n1(x1 - rx) + arc(x1, y0 + ry) + 'V' + n1(y1 - ry) + arc(x1 - rx, y1) + 'H' + n1(x0 + rx) + arc(x0, y1 - ry) + 'V' + n1(y0 + ry) + arc(x0 + rx, y0) + 'Z';
  const skip = o.skip;
  const inside = (x: number, y: number): boolean => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || (skip && x > skip[0] && x < skip[2] && y > skip[1] && y < skip[3])) return false;
    const ex = x < x0 + rx ? x0 + rx - x : x > x1 - rx ? x - (x1 - rx) : 0;
    const ey = y < y0 + ry ? y0 + ry - y : y > y1 - ry ? y - (y1 - ry) : 0;
    return !ex || !ey || (ex * ex) / (rx * rx) + (ey * ey) / (ry * ry) <= 1;
  };
  // Shading is two layers a few degrees apart, the second more open, and spared in a small box.
  const layer = (k: number, lean: number, wide: number): string => {
    let d = '';
    const roll = stream(k);
    const turn = ((38 + lean + roll() * 10) * Math.PI) / 180;
    const dx = -Math.sin(turn);
    const dy = Math.cos(turn);
    const gap = ((o.hatch === 2 ? 20 : 12) * wide * u) / dy;
    const inch = 3 * u;
    for (let px = gap * (0.3 + roll() * 0.5); px < w - (h * dx) / dy && d.length < 6000; px += gap * (0.7 + roll() * 0.6)) {
      const trim = roll() * 2 * inch;
      let from = -1;
      for (let a = 0; a <= h / dy + inch; a += inch) {
        const on = a <= h / dy && inside(px + dx * a, dy * a);
        if (on && from < 0) from = a;
        if (!on && from >= 0) {
          if (a - inch - from > 4 * inch) d += 'M' + n0(px + dx * (from + trim)) + ' ' + n0(dy * (from + trim)) + 'L' + n0(px + dx * (a - inch)) + ' ' + n0(dy * (a - inch));
          from = -1;
        }
      }
    }
    return d;
  };
  out.hatch = layer(21, 0, 1);
  if (thin > step) out.cross = layer(22, 7, 1.7);
  return out;
}
