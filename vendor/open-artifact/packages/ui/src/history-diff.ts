/**
 * The pure parts of {@link HistoryPanel}: a line diff with context hunks,
 * and grouping versions by day and author. Kept free of React so tests can
 * run them directly.
 */

/** One line of a diff: kept (`' '`), removed (`'-'`) or added (`'+'`), with its line numbers. */
export interface DiffLine {
  op: ' ' | '-' | '+';
  text: string;
  /** 1-based line number before (kept, removed) and after (kept, added). */
  before?: number;
  after?: number;
}

/** A run of changed lines with some kept lines around it. */
export interface DiffHunk {
  lines: DiffLine[];
  /** Kept lines left out before this hunk (0 for the first one when it starts at the top). */
  skippedBefore: number;
}

/** Above this many cells (lines before × lines after, after trimming the common ends) the middle is shown as removed then added. */
export const DIFF_MAX_CELLS = 4_000_000;

function splitLines(text: string | null): string[] {
  if (text === null || text === '') return [];
  const lines = text.split('\n');
  // A trailing newline ends the last line; it does not start another.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The line diff of `before` → `after` (`null`: the file did not exist):
 * every line in order, kept, removed or added. Common leading and trailing
 * lines are matched first, the middle by longest common subsequence.
 */
export function diffLines(before: string | null, after: string | null): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  const keep = (): void => void out.push({ op: ' ', text: a[i]!, before: ++i, after: ++j });
  const remove = (): void => void out.push({ op: '-', text: a[i]!, before: ++i });
  const add = (): void => void out.push({ op: '+', text: b[j]!, after: ++j });

  while (i < start) keep();
  const n = endA - start;
  const m = endB - start;
  if (n * m > DIFF_MAX_CELLS) {
    while (i < endA) remove();
    while (j < endB) add();
  } else if (n && m) {
    // lcs[x][y]: the longest common subsequence of a[start+x..endA) and b[start+y..endB).
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let x = n - 1; x >= 0; x--) {
      for (let y = m - 1; y >= 0; y--) {
        lcs[x * width + y] =
          a[start + x] === b[start + y] ? lcs[(x + 1) * width + y + 1]! + 1 : Math.max(lcs[(x + 1) * width + y]!, lcs[x * width + y + 1]!);
      }
    }
    while (i < endA && j < endB) {
      const x = i - start;
      const y = j - start;
      if (a[i] === b[j]) keep();
      else if (lcs[(x + 1) * width + y]! >= lcs[x * width + y + 1]!) remove();
      else add();
    }
    while (i < endA) remove();
    while (j < endB) add();
  } else {
    while (i < endA) remove();
    while (j < endB) add();
  }
  while (i < a.length) keep();
  return out;
}

/** How many lines `diffLines` removed and added. */
export function diffStats(lines: readonly DiffLine[]): { removed: number; added: number } {
  let removed = 0;
  let added = 0;
  for (const line of lines) {
    if (line.op === '-') removed++;
    else if (line.op === '+') added++;
  }
  return { removed, added };
}

/** The changed parts of a diff, each with up to `context` kept lines around it. */
export function diffHunks(lines: readonly DiffLine[], context = 3): DiffHunk[] {
  const changed = lines.flatMap((line, index) => (line.op === ' ' ? [] : [index]));
  const hunks: DiffHunk[] = [];
  let shownTo = 0;
  let k = 0;
  while (k < changed.length) {
    const from = Math.max(changed[k]! - context, shownTo);
    let to = changed[k]! + 1;
    // Join changes whose context would touch.
    while (k + 1 < changed.length && changed[k + 1]! - to <= context * 2) to = changed[++k]! + 1;
    k++;
    const end = Math.min(to + context, lines.length);
    hunks.push({ lines: lines.slice(from, end), skippedBefore: from - shownTo });
    shownTo = end;
  }
  return hunks;
}

/** The fields of a version that grouping reads (structurally the runtime's `HistoryVersion`). */
export interface GroupableVersion {
  at: string;
  author: { kind: string; id: string };
  restoredFrom?: number;
}

/** Versions of one day, as runs of one author each. */
export interface VersionDay<V> {
  /** Local `YYYY-MM-DD`. */
  key: string;
  /** Noon of that day, for formatting. */
  date: Date;
  runs: { author: V extends { author: infer A } ? A : never; versions: V[] }[];
}

/** Local `YYYY-MM-DD` of a time. */
export function dayKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Groups versions (newest first, as listed) by local day, and within a day
 * into runs of consecutive versions by one author. A restore starts a run
 * of its own, so it stands out.
 */
export function groupVersions<V extends GroupableVersion>(versions: readonly V[]): VersionDay<V>[] {
  const days: VersionDay<V>[] = [];
  for (const version of versions) {
    const at = new Date(version.at);
    const key = dayKey(at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, date: new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12), runs: [] };
      days.push(day);
    }
    const run = day.runs[day.runs.length - 1];
    const last = run?.versions[run.versions.length - 1];
    if (
      run &&
      last &&
      last.restoredFrom === undefined &&
      version.restoredFrom === undefined &&
      run.author.kind === version.author.kind &&
      (run.author as GroupableVersion['author']).id === version.author.id
    ) {
      run.versions.push(version);
    } else {
      day.runs.push({ author: version.author as VersionDay<V>['runs'][number]['author'], versions: [version] });
    }
  }
  return days;
}
