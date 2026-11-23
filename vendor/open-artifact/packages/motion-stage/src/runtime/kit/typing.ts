import { rng } from './random.ts';

/**
 * The first `count` UTF-16 units of `text`, or one fewer where unit `count` would split a surrogate pair
 * (most emoji): half a pair alone draws as U+FFFD.
 */
export const uncut = (text: string, count: number): string =>
  text.slice(0, count > 0 && count < text.length && (text.charCodeAt(count - 1) & 0xfc00) === 0xd800 ? count - 1 : count);

export interface Typist {
  text: string;
  /** Film seconds at which each character lands. */
  times: number[];
  end: number;
  count(now: number): number;
  at(now: number): string;
}

/**
 * A natural typing schedule for `text` from `start` at about `cps` characters a second.
 * Every time also goes to `heard`, so a score can put a key click on each.
 */
export function typist(text: string, start: number, cps: number, seed: number = 7, heard?: number[]): Typist {
  const next = rng(seed);
  const times: number[] = [];
  let t = start;
  for (let i = 0; i < text.length; i++) {
    let gap = (1 / cps) * (0.55 + 0.9 * next());
    if (text[i] === ' ') gap += 0.035;
    if (text[i - 1] === '.' || text[i - 1] === '!') gap += 0.16;
    t += gap;
    times.push(t);
  }
  if (heard) for (const time of times) heard.push(time);
  const count = (now: number): number => {
    let typed = 0;
    while (typed < times.length && (times[typed] ?? Infinity) <= now) typed++;
    return typed;
  };
  return { text, times, end: t, count, at: (now: number) => uncut(text, count(now)) };
}

/** The part of `text` shown at `t` when it streams in chunks from `start`, like a model's reply. */
export function streamed(text: string, t: number, start: number, cps: number = 95, chunk: number = 7): string {
  if (t < start) return '';
  const shown = Math.floor(((t - start) * cps) / chunk) * chunk;
  return uncut(text, Math.min(text.length, Math.max(0, shown)));
}

export const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
