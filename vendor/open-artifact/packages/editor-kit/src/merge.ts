/**
 * Three-way line merge of a text file both this page and someone else (the
 * agent, another viewer) changed since the page last read it. When the two
 * sides changed different lines of the version both started from, the
 * merge keeps both changes; when they changed the same lines differently
 * (or inserted different lines at the same place) there is no merge and
 * the editor asks the person.
 *
 * Changes to lines right next to each other merge by default; an editor
 * whose files read as one unit (a slide's HTML) passes
 * `{ adjacent: 'conflict' }` to give up on those too. Pure.
 */

/** Largest LCS table the merge builds (base lines × other lines); larger files are not merged. */
const MAX_CELLS = 4_000_000;

/** One change: `base[start, end)` replaced by `lines`. */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((line, i) => line === b[i]);

/** The changes that turn `a` into `b`; `null` when the files are too large to compare. */
function hunks(a: readonly string[], b: readonly string[]): Hunk[] | null {
  // Common head and tail first: most edits are small.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if ((x.length + 1) * (y.length + 1) > MAX_CELLS) return null;
  const width = y.length + 1;
  const table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) table[i * width + j] = x[i] === y[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  }
  const out: Hunk[] = [];
  let current: Hunk | null = null;
  let i = 0;
  let j = 0;
  const flush = (): void => {
    if (current) out.push(current);
    current = null;
  };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      flush();
      i++;
      j++;
    } else if (j >= y.length || (i < x.length && table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      current ??= { start: head + i, end: head + i, lines: [] };
      current.end = head + i + 1;
      i++;
    } else {
      current ??= { start: head + i, end: head + i, lines: [] };
      current.lines.push(y[j]!);
      j++;
    }
  }
  flush();
  return out;
}

/** True when two changes touch the same base lines (or insert at the same place); with `adjacent`, also when they meet. */
function clash(a: Hunk, b: Hunk, adjacent: boolean): boolean {
  if (adjacent) return Math.max(a.start, b.start) <= Math.min(a.end, b.end);
  if (a.start === b.start && (a.start === a.end || b.start === b.end)) return true;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

/** How {@link mergeLines} treats changes to neighbouring lines. */
export interface LineMergeOptions {
  /** `merge` (default): neighbouring changes both apply. `conflict`: they need the person. */
  adjacent?: 'merge' | 'conflict';
}

/**
 * Merges `ours` and `theirs`, both edited from `base`, line by line. Returns
 * the merged text, or `null` when both changed the same region differently
 * (or the files are too large to compare).
 */
export function mergeLines(base: string, ours: string, theirs: string, options: LineMergeOptions = {}): string | null {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;
  const adjacent = options.adjacent === 'conflict';
  const lines = base.split('\n');
  const mine = hunks(lines, ours.split('\n'));
  const other = hunks(lines, theirs.split('\n'));
  if (!mine || !other) return null;
  const all: Hunk[] = [];
  for (const hunk of mine) {
    const twin = other.find((candidate) => clash(hunk, candidate, adjacent));
    if (!twin) {
      all.push(hunk);
      continue;
    }
    // The same change on both sides is no conflict.
    if (twin.start === hunk.start && twin.end === hunk.end && same(twin.lines, hunk.lines)) continue;
    return null;
  }
  all.push(...other);
  all.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: string[] = [];
  let at = 0;
  for (const hunk of all) {
    out.push(...lines.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  out.push(...lines.slice(at));
  return out.join('\n');
}
