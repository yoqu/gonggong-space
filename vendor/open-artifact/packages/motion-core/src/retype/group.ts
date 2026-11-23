import { decodeHtmlEntities, type RetypedLine } from '../records/retyped.ts';
import { collapseWhitespace, readScriptText, removeWhitespace } from './escapes.ts';
import type { TextSite } from './sites.ts';

/** A line of the code matched to the run of text nodes on the picture that show it. */
export interface TextGroup {
  was: string;
  /** What the panel shows for it: the line's `v` when retyped, else the words as the picture shows them. */
  text: string;
  changed: boolean;
  /** How many places in the code say it. */
  places: number;
  /** Runs of text nodes `[from, to)` that show it, in order. */
  runs: Array<[number, number]>;
}

interface ReadGroup extends TextGroup {
  /** The ways it may read on the picture. */
  reads: string[];
}

interface ReadRun {
  read: string;
  from: number;
  to: number;
}

function readsOf(site: TextSite): string[] {
  const text = (site.inScript ? readScriptText(site.was) : null) ?? site.was;
  const decoded = decodeHtmlEntities(text);
  if (site.markup) return decoded === null ? [] : [decoded];
  return decoded === null || decoded === text ? [text] : [text, decoded];
}

/**
 * Matches the code's lines to the text nodes the picture shows (`shown`, in document order): each line takes the
 * runs of whole nodes whose words, spaces left out, are its own; longer lines first, no node twice. Lines no run
 * shows are left out. `lines` are the retyped lines the film shows now (their `v` is what the picture shows).
 */
export function groupTextSites(sites: readonly TextSite[], lines: readonly RetypedLine[], shown: readonly string[]): TextGroup[] {
  const typed = new Map(lines.map((line) => [line.was, line.v] as const));
  const groups = new Map<string, ReadGroup>();
  for (const site of sites) {
    const known = groups.get(site.was);
    if (known !== undefined) {
      known.places += 1;
      if (!known.changed && site.was.includes('\\')) known.reads.push(...readsOf(site).filter((read) => !known.reads.includes(read)));
      continue;
    }
    const v = typed.get(site.was);
    const reads = v !== undefined ? [v] : readsOf(site);
    if (reads.length > 0)
      groups.set(site.was, { was: site.was, text: collapseWhitespace(reads[reads.length - 1]!), changed: v !== undefined, places: 1, runs: [], reads });
  }

  const byRead = new Map<string, ReadGroup[]>();
  for (const group of groups.values())
    for (const read of new Set(group.reads.map(removeWhitespace))) {
      if (read === '') continue;
      byRead.set(read, [...(byRead.get(read) ?? []), group]);
    }

  let joined = '';
  const nodeStarts = new Map<number, number>();
  const nodeEnds = new Map<number, number>();
  shown.forEach((text, index) => {
    const bare = removeWhitespace(text);
    if (bare === '') return;
    nodeStarts.set(joined.length, index);
    joined += bare;
    nodeEnds.set(joined.length, index + 1);
  });

  const runs: ReadRun[] = [];
  for (const read of byRead.keys())
    for (let at = joined.indexOf(read); at >= 0; at = joined.indexOf(read, at + 1)) {
      const from = nodeStarts.get(at);
      const to = nodeEnds.get(at + read.length);
      if (from !== undefined && to !== undefined) runs.push({ read, from, to });
    }

  const taken = new Set<number>();
  for (const run of runs.sort((a, b) => b.read.length - a.read.length || a.from - b.from)) {
    const nodes = Array.from({ length: run.to - run.from }, (_unused, offset) => run.from + offset);
    if (nodes.some((node) => taken.has(node))) continue;
    for (const node of nodes) taken.add(node);
    for (const group of byRead.get(run.read)!) {
      group.runs.push([run.from, run.to]);
      if (!group.changed) group.text = collapseWhitespace(group.reads.find((read) => removeWhitespace(read) === run.read) ?? group.text);
    }
  }

  return [...groups.values()]
    .filter((group) => group.runs.length > 0)
    .map(({ was, text, changed, places, runs: groupRuns }) => ({ was, text, changed, places, runs: groupRuns.sort((a, b) => a[0] - b[0]) }))
    .sort((a, b) => a.runs[0]![0] - b.runs[0]![0]);
}
