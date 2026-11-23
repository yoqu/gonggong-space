import { lerp } from './math.ts';
import { rng } from './random.ts';

export type Point = [number, number];

/** A unit polygon (radius about 1) with straight edges at uneven angles, like a shape cut from paper. */
export function cutPaper(seed: number = 1, sides: number = 7, irregularity: number = 0.28): Point[] {
  const next = rng(seed * 977 + 3);
  const points: Point[] = [];
  let angle = next() * Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    angle += ((Math.PI * 2) / sides) * (0.7 + 0.6 * next());
    const radius = 1 - irregularity * next();
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

/** Morphs polygon `from` toward `to`; `to` repeats when it has fewer points. */
export const polyLerp = (from: Point[], to: Point[], p: number): Point[] =>
  from.map((a, i) => {
    const b = to[i % to.length] ?? a;
    return [lerp(a[0], b[0], p), lerp(a[1], b[1], p)];
  });

/** An SVG `points` list: the polygon scaled, turned by `rotation` radians and centred on (cx, cy). */
export function polyStr(points: Point[], cx: number, cy: number, sx: number, sy: number, rotation: number = 0): string {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return points
    .map(([x, y]) => `${(cx + (x * cos - y * sin) * sx).toFixed(1)},${(cy + (x * sin + y * cos) * sy).toFixed(1)}`)
    .join(' ');
}
