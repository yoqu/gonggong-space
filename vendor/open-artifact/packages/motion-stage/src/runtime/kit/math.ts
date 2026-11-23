export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, low: number, high: number): number => (x < low ? low : x > high ? high : x);
/** 0 to 1 across `a` to `b`. */
export const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

/** Ease-out cubic. */
export const eo = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
/** Ease-in cubic. */
export const ei = (x: number): number => Math.pow(clamp01(x), 3);
export const eio = (x: number): number => {
  const p = clamp01(x);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};
/** Ease-out quart. */
export const eoq = (x: number): number => 1 - Math.pow(1 - clamp01(x), 4);
/** Ease-out expo: a whip. */
export const eox = (x: number): number => 1 - Math.pow(2, -10 * clamp01(x));
/** Back-out: overshoots, then settles. */
export const eob = (x: number, overshoot: number = 1.4): number => {
  const p = clamp01(x);
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + overshoot * Math.pow(p - 1, 2);
};
export const spring = (x: number, damp: number = 6, freq: number = 2.2): number => {
  const p = clamp01(x);
  return 1 - Math.exp(-damp * p) * Math.cos(freq * Math.PI * 2 * p) * (1 - p);
};
export const step = (t: number, a: number): 0 | 1 => (t >= a ? 1 : 0);
export const pulse = (t: number, a: number, b: number): 0 | 1 => (t >= a && t < b ? 1 : 0);
export const smoothstep = (a: number, b: number, x: number): number => {
  const p = clamp01((x - a) / (b - a));
  return p * p * (3 - 2 * p);
};
/** A scale that swells and shrinks gently around 1. */
export const breathe = (t: number, amount: number = 0.012, period: number = 3.2): number =>
  1 + amount * Math.sin((t / period) * Math.PI * 2);

export type Ease = (x: number) => number;
