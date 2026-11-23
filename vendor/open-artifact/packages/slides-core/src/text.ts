/**
 * Rich text helpers. Text is a list of runs with marks; these functions keep
 * runs normalized (no empty runs, no two neighbours with equal marks) so that
 * comparing two texts is comparing their runs.
 */

import type { Marks, Run } from './model.ts';

/** Mark keys in serialization nesting order (outermost first). */
export const MARK_KEYS = ['href', 'color', 'b', 'i', 'u'] as const;
export type MarkKey = (typeof MARK_KEYS)[number];

/** True when two mark sets are equal. */
export function marksEqual(a: Marks | undefined, b: Marks | undefined): boolean {
  return (
    (a?.b ?? false) === (b?.b ?? false) &&
    (a?.regular ?? false) === (b?.regular ?? false) &&
    (a?.i ?? false) === (b?.i ?? false) &&
    (a?.u ?? false) === (b?.u ?? false) &&
    (a?.color ?? '') === (b?.color ?? '') &&
    (a?.href ?? '') === (b?.href ?? '')
  );
}

/** Drops empty keys; returns `undefined` for no marks. */
export function cleanMarks(marks: Marks | undefined): Marks | undefined {
  if (!marks) return undefined;
  const out: Marks = {};
  if (marks.b) out.b = true;
  else if (marks.regular) out.regular = true;
  if (marks.i) out.i = true;
  if (marks.u) out.u = true;
  if (marks.color) out.color = marks.color;
  if (marks.href) out.href = marks.href;
  return Object.keys(out).length ? out : undefined;
}

/** Merges neighbours with equal marks and drops empty runs. */
export function normalizeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const marks = cleanMarks(run.marks);
    const last = out[out.length - 1];
    if (last && marksEqual(last.marks, marks)) {
      last.text += run.text;
      continue;
    }
    out.push(marks ? { text: run.text, marks } : { text: run.text });
  }
  return out;
}

/** True when two run lists hold the same rich text. */
export function runsEqual(a: readonly Run[], b: readonly Run[]): boolean {
  const na = normalizeRuns(a);
  const nb = normalizeRuns(b);
  if (na.length !== nb.length) return false;
  return na.every((run, i) => run.text === nb[i]!.text && marksEqual(run.marks, nb[i]!.marks));
}

/** Total characters of runs. */
export function runsLength(runs: readonly Run[]): number {
  let n = 0;
  for (const run of runs) n += run.text.length;
  return n;
}

/** Counts inline marks the way the limit counts them (one per marked run per mark). */
export function countMarks(runs: readonly Run[]): number {
  let n = 0;
  for (const run of runs) {
    const m = run.marks;
    if (!m) continue;
    if (m.b) n++;
    if (m.regular) n++;
    if (m.i) n++;
    if (m.u) n++;
    if (m.color) n++;
    if (m.href) n++;
  }
  return n;
}

/** The runs covering `[start, end)` (split at the edges). */
export function sliceRuns(runs: readonly Run[], start: number, end: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const from = Math.max(start, pos);
    const to = Math.min(end, runEnd);
    if (to > from) out.push({ text: run.text.slice(from - pos, to - pos), marks: run.marks });
    pos = runEnd;
  }
  return normalizeRuns(out);
}

/** Replaces `[start, end)` with `insert` (inheriting the marks at `start` when `marks` is not given). */
export function replaceRange(runs: readonly Run[], start: number, end: number, insert: string, marks?: Marks): Run[] {
  const before = sliceRuns(runs, 0, start);
  const after = sliceRuns(runs, end, Infinity);
  const inherited = marks ?? marksAt(runs, start);
  return normalizeRuns([...before, { text: insert, marks: inherited }, ...after]);
}

/** The marks in effect just before `offset` (or at it, at the start). */
export function marksAt(runs: readonly Run[], offset: number): Marks | undefined {
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (offset > pos && offset <= end) return run.marks;
    if (offset === 0 && pos === 0) return run.marks;
    pos = end;
  }
  return runs[runs.length - 1]?.marks;
}

/** Applies a mark change to `[start, end)`. `value` undefined/false removes it. */
export function setMark<K extends keyof Marks>(runs: readonly Run[], start: number, end: number, key: K, value: Marks[K] | undefined): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const from = Math.max(start, pos);
    const to = Math.min(end, runEnd);
    if (to <= from) {
      out.push(run);
    } else {
      if (from > pos) out.push({ text: run.text.slice(0, from - pos), marks: run.marks });
      const marks = withMark(run.marks, key, value);
      out.push({ text: run.text.slice(from - pos, to - pos), marks });
      if (to < runEnd) out.push({ text: run.text.slice(to - pos), marks: run.marks });
    }
    pos = runEnd;
  }
  return normalizeRuns(out);
}

/** A copy of `marks` with one mark set or cleared; bold and regular weight replace each other. */
export function withMark<K extends keyof Marks>(marks: Marks | undefined, key: K, value: Marks[K] | undefined): Marks {
  const out: Marks = { ...(marks ?? {}) };
  if (value === undefined || (value as unknown) === false) {
    delete out[key];
    return out;
  }
  out[key] = value;
  if (key === 'b') delete out.regular;
  if (key === 'regular') delete out.b;
  return out;
}

/** True when every character of `[start, end)` carries the boolean mark. */
export function rangeHasMark(runs: readonly Run[], start: number, end: number, key: 'b' | 'i' | 'u'): boolean {
  if (end <= start) return Boolean(marksAt(runs, start)?.[key]);
  const slice = sliceRuns(runs, start, end);
  return slice.length > 0 && slice.every((run) => run.marks?.[key]);
}

/** Toggles a boolean mark over `[start, end)`. */
export function toggleMark(runs: readonly Run[], start: number, end: number, key: 'b' | 'i' | 'u'): Run[] {
  return setMark(runs, start, end, key, rangeHasMark(runs, start, end, key) ? undefined : true);
}

/** Plain runs from a string. */
export function plainRuns(text: string): Run[] {
  return text ? [{ text }] : [];
}

/** True when a link target is allowed (http or https only). */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\/[^\s<>"]+$/i.test(href.trim());
}
