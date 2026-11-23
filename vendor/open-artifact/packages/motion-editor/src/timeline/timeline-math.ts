/** The timeline's geometry: seconds as played across a strip of pixels. Pure. */

import { snapToFrame } from '../transport/time-format.ts';

/** A scene's card on the strip. */
export interface PartSpan {
  index: number;
  key: string | null;
  label: string;
  /** Where it starts and how long it plays, in seconds as played. */
  start: number;
  dur: number;
  /** Left edge and width, in strip pixels. */
  left: number;
  width: number;
}

export interface SpanInput {
  key: string | null;
  label: string;
  playStart: number;
  playDur: number;
}

export function timeToX(t: number, total: number, width: number): number {
  if (!(total > 0) || !(width > 0)) return 0;
  return (Math.min(total, Math.max(0, t)) / total) * width;
}

export function xToTime(x: number, total: number, width: number): number {
  if (!(total > 0) || !(width > 0)) return 0;
  return (Math.min(width, Math.max(0, x)) / width) * total;
}

/** The scene cards' places; a film of one part (or none) has none. */
export function partSpans(parts: readonly SpanInput[], total: number, width: number): PartSpan[] {
  if (parts.length < 2) return [];
  return parts.map((part, index) => {
    const left = timeToX(part.playStart, total, width);
    const right = timeToX(part.playStart + part.playDur, total, width);
    return { index, key: part.key, label: part.label, start: part.playStart, dur: part.playDur, left, width: Math.max(0, right - left) };
  });
}

/** The moment a pointer at `x` scrubs to: on a frame, and never past the last frame's start. */
export function scrubTime(x: number, total: number, width: number, fps: number): number {
  const t = snapToFrame(xToTime(x, total, width), fps);
  const last = Math.max(0, total - 1 / (fps > 0 ? fps : 60));
  return Math.min(t, last);
}

/** The span under a moment, or `null`. */
export function spanAt(spans: readonly PartSpan[], t: number): PartSpan | null {
  for (const span of spans) if (t >= span.start - 1e-6 && t < span.start + span.dur - 1e-6) return span;
  return spans.at(-1) ?? null;
}

/** Thumbnails along a card: how many fit, and the moment each one shows (its middle). */
export function thumbnailTimes(span: { start: number; dur: number; width: number }, thumbWidth: number): number[] {
  if (!(thumbWidth > 0) || span.width <= 0 || span.dur <= 0) return [];
  const count = Math.max(1, Math.floor(span.width / thumbWidth));
  const step = span.dur / count;
  return Array.from({ length: count }, (_, i) => span.start + step * (i + 0.5));
}

/** Seconds on a card, as its label shows them: `4 s`, `2.5 s`. */
export function formatSceneSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} s`;
}
