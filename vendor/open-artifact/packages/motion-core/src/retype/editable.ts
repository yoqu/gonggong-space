import { MAX_RETYPED_LINE_CHARS, type RetypedLine } from '../records/retyped.ts';
import { removeWhitespace } from './escapes.ts';
import { groupTextSites, type TextGroup } from './group.ts';
import { matchRetypedLines, type TextSite } from './sites.ts';

/** A box on the picture, in film pixels. */
export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A text node the stage reports, in document order. */
export interface ShownText {
  text: string;
  /** Where it is; `null` while it is hidden. */
  box: TextBox | null;
  /** The height of its first line, in film pixels. */
  line: number;
  /** The line of words it is part of (`<stretch>:<place>`), where the page asked for places. */
  id?: string;
  /** On the picture now. */
  seen: boolean;
}

/**
 * Where a line is listed under Text: `null` among the prominent lines on the picture, `more` among the others on
 * it, `later` for one the film shows at another moment, `not-on-screen` for a retyped line the film no longer shows.
 */
export type EditableWordGroup = null | 'more' | 'later' | 'not-on-screen';

/** A line a person can retype. */
export interface EditableWord {
  /** The line's `was`. */
  id: string;
  text: string;
  boxes: TextBox[];
  max: number;
  changed: boolean;
  group: EditableWordGroup;
  /** How many places in the film say it (shown when more than one). */
  places: number;
  /** The stage's line id, when one whole line of words shows it. */
  line?: string;
  /** It shows more than once in its scene, each time as a whole line of its own. */
  twice?: boolean;
}

export interface EditableWordsInput {
  nodes: readonly ShownText[];
  /** A line id the panel keeps listed though no node of it is on the picture (the line being edited). */
  keptLine: string | null;
  sites: readonly TextSite[];
  /** The retyped lines the film shows now (none while it shows the original after a failed change). */
  shown: readonly RetypedLine[];
  /** The retyped lines as typed, saved or not. */
  typed: readonly RetypedLine[];
  /** Typed lines wait to show: their words are listed in place of what the picture shows. */
  pending: boolean;
}

interface PlacedGroup extends TextGroup {
  boxes: TextBox[];
  size: number;
  line?: string;
  twice: boolean;
}

/** The smallest box round all of them. */
export function unionTextBoxes(boxes: readonly TextBox[]): TextBox {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, w: Math.max(...boxes.map((box) => box.x + box.w)) - x, h: Math.max(...boxes.map((box) => box.y + box.h)) - y };
}

/**
 * The lines set biggest on the picture, at most twelve: sizes rank together within 0.3 px of the next bigger one;
 * with more than eight lines, those ranked below every size over 60% of the biggest are left out.
 */
export function prominentWords<W extends { size: number }>(words: readonly W[]): W[] {
  const sizes = words.map((word) => word.size).sort((a, b) => b - a);
  const ranks = new Map<number, number>();
  sizes.forEach((size, index) => ranks.set(size, index === 0 ? 0 : ranks.get(sizes[index - 1]!)! + (sizes[index - 1]! - size >= 0.3 ? 1 : 0)));
  const cutoff = words.length > 8 ? ranks.get(sizes.filter((size) => size > sizes[0]! * 0.6 - 0.02).at(-1)!)! : Infinity;
  return words
    .filter((word) => ranks.get(word.size)! <= cutoff)
    .sort((a, b) => ranks.get(a.size)! - ranks.get(b.size)!)
    .slice(0, 12);
}

/** The lines listed under Text for what the picture shows now. */
export function editableWords(input: EditableWordsInput): EditableWord[] {
  const { nodes, sites } = input;
  const typedNow = new Map(matchRetypedLines(sites, input.typed).map((line) => [line.was, line.v] as const));
  const word = (group: Pick<TextGroup, 'was' | 'text' | 'places'>, boxes: TextBox[], list: EditableWordGroup, line?: string, twice = false): EditableWord => ({
    id: group.was,
    text: group.text,
    boxes,
    max: MAX_RETYPED_LINE_CHARS,
    changed: typedNow.has(group.was),
    group: list,
    places: group.places,
    ...(line !== undefined ? { line } : {}),
    ...(twice ? { twice: true } : {}),
  });
  const kept = nodes.some((node) => node.id === input.keptLine && node.seen) ? null : input.keptLine;
  const groups = nodes.length === 0 ? [] : groupTextSites(sites, matchRetypedLines(sites, input.shown), nodes.map((node) => node.text));
  const placed = groups.flatMap((group): PlacedGroup[] => {
    const runs = group.runs
      .map(([from, to]) => nodes.slice(from, to))
      .filter((run) => run.some((node) => node.seen) || (kept !== null && run.every((node) => node.id === kept)));
    if (runs.length === 0) return [];
    const boxes = runs.map((run) => run.flatMap((node) => (node.box === null ? [] : [node.box]))).filter((list) => list.length > 0).map(unionTextBoxes);
    const first = runs[0]!;
    return [
      {
        ...group,
        text: (input.pending ? typedNow.get(group.was) : undefined) ?? group.text,
        boxes,
        size: Math.max(...runs.flat().map((node) => node.line)),
        line: runs.length === 1 && first.every((node) => node.id === first[0]!.id) ? first[0]!.id : undefined,
        twice: runs.length > 1 && runs.every((run) => run[0]?.id !== undefined && run.every((node) => node.id === run[0]!.id)),
      },
    ];
  });
  const prominent = new Set(prominentWords(placed));
  const later = groups.filter((group) => !placed.some((shown) => shown.was === group.was));
  const listed = new Set([...placed, ...later].map((group) => group.was));
  return [
    ...[...prominent].map((group) => word(group, group.boxes, null, group.line, group.twice)),
    ...placed.filter((group) => !prominent.has(group)).map((group) => word(group, group.boxes, 'more', group.line, group.twice)),
    ...later.map((group) => word({ ...group, text: (input.pending ? typedNow.get(group.was) : undefined) ?? group.text }, [], 'later')),
    ...[...typedNow]
      .filter(([was]) => !listed.has(was))
      .map(([was, v]) => word({ was, text: v, places: sites.filter((site) => site.was === was).length }, [], 'not-on-screen')),
  ];
}

/** The list as the panel shows it: a line shown later is listed only when retyped, then as not on screen. */
export function hideLaterWords(words: readonly EditableWord[]): EditableWord[] {
  return words.flatMap((word) => (word.group !== 'later' ? [word] : word.changed ? [{ ...word, group: 'not-on-screen' as const }] : []));
}

/**
 * The boxes of words on the picture that no line of the code gives a place to change, kept out of the way of the
 * editable ones: seen nodes with letters or digits that no line takes, and that do not start a longer line.
 */
export function fieldlessTextBoxes(input: Pick<EditableWordsInput, 'nodes' | 'sites' | 'shown' | 'typed'>): TextBox[] {
  const { nodes, sites } = input;
  const typed = new Map(input.typed.map((line) => [line.was, line.v] as const));
  const names = sites.map((site) => removeWhitespace(typed.get(site.was) ?? site.was));
  const covered = new Set(
    groupTextSites(sites, matchRetypedLines(sites, input.shown), nodes.map((node) => node.text)).flatMap((group) =>
      group.runs.flatMap(([from, to]) => Array.from({ length: to - from }, (_unused, offset) => from + offset)),
    ),
  );
  const startsLonger = (text: string): boolean => /\p{L}/u.test(text) && names.some((name) => name.length > text.length && name.startsWith(text));
  return nodes.flatMap((node, index) =>
    node.seen && node.box !== null && !covered.has(index) && /[\p{L}\p{N}]/u.test(node.text) && !startsLonger(removeWhitespace(node.text)) ? [node.box] : [],
  );
}
