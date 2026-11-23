/** A seeded linear congruential generator: the same seed gives the same numbers in 0..1, in every browser. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Smooth 1-D value noise in -1..1. */
export function vnoise(seed: number): (position: number) => number {
  const next = rng(seed);
  const table = Array.from({ length: 256 }, () => next() * 2 - 1);
  return (position: number): number => {
    const whole = Math.floor(position);
    const fraction = position - whole;
    const a = table[whole & 255] ?? 0;
    const b = table[(whole + 1) & 255] ?? 0;
    const u = fraction * fraction * (3 - 2 * fraction);
    return a + (b - a) * u;
  };
}

/** The seed `Math.random` restarts from at film time `ms` (whole milliseconds), so every frame draws the same numbers. */
export const frameSeed = (ms: number): number => ((Math.round(ms) + 1) * 2654435761) >>> 0;

/** FNV-1a of a scene id, mixed with the moment: a scene's own random numbers at that moment. */
export function sceneSeed(id: string, ms: number): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash ^ Math.imul(Math.round(ms) + 1, 2654435761)) >>> 0;
}
