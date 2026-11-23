/** The lines listed under Text, from what the stage reports and what the film's code says. Pure. */

import {
  editableWords,
  filmTextSources,
  hideLaterWords,
  scanTextSites,
  type EditableWord,
  type EditableWordGroup,
  type Film,
  type RetypedLine,
  type ShownText,
  type TextScan,
  type TextSite,
} from '@open-artifact/motion-core';
import type { StageText } from '@open-artifact/motion-stage';

/** A stage's text node as the word list reads it: a box only when every side of it is known. */
export function shownText(node: StageText): ShownText {
  const { x, y, w, h } = node;
  const box = x !== undefined && y !== undefined && w !== undefined && h !== undefined ? { x, y, w, h } : null;
  return { text: node.text, box, line: node.line ?? 0, ...(node.id !== undefined ? { id: node.id } : {}), seen: node.seen ?? box !== null };
}

export function sameLines(a: readonly RetypedLine[], b: readonly RetypedLine[]): boolean {
  if (a.length !== b.length) return false;
  const v = new Map(a.map((line) => [line.was, line.v] as const));
  return b.every((line) => v.get(line.was) === line.v);
}

const scans = new WeakMap<Film, TextScan | null>();

/** Where the film's code spells text, read once per decoded film; `null` when the code could not be read. */
export function filmScan(film: Film | null): TextScan | null {
  if (film === null) return null;
  if (scans.has(film)) return scans.get(film) ?? null;
  let scan: TextScan | null;
  try {
    scan = scanTextSites(filmTextSources(film));
  } catch (error) {
    console.warn('video: the film’s text could not be read', error);
    scan = null;
  }
  scans.set(film, scan);
  return scan;
}

export interface WordListInput {
  nodes: readonly ShownText[];
  keptLine: string | null;
  sites: readonly TextSite[];
  /** The lines the stage on show was loaded with. */
  shown: readonly RetypedLine[];
  /** The lines as typed, saved or not. */
  typed: readonly RetypedLine[];
  /** List lines shown later in the scene (a film with scenes); else only those retyped, as not on screen. */
  elsewhere: boolean;
}

export function wordList(input: WordListInput): EditableWord[] {
  const words = editableWords({
    nodes: input.nodes,
    keptLine: input.keptLine,
    sites: input.sites,
    shown: input.shown,
    typed: input.typed,
    pending: !sameLines(input.shown, input.typed),
  });
  return input.elsewhere ? words : hideLaterWords(words);
}

/**
 * The words in the order a field was focused in, so the list does not move under the person typing: known lines
 * keep their places, new ones follow. The focused line `held` stays under its heading, and stays listed (last, as it
 * was) when the list lost it.
 */
export function inSteadyOrder(words: readonly EditableWord[], order: readonly string[] | null, held: EditableWord | null): EditableWord[] {
  const listed = words.map((word) => (held !== null && word.id === held.id && word.group !== held.group ? { ...word, group: held.group } : word));
  const kept = held !== null && !words.some((word) => word.id === held.id) ? [...listed, held] : listed;
  if (order === null) return kept;
  const place = new Map(order.map((id, index) => [id, index] as const));
  const rank = (word: EditableWord): number => place.get(word.id) ?? order.length;
  return kept.map((word, index) => ({ word, index })).sort((a, b) => rank(a.word) - rank(b.word) || a.index - b.index).map(({ word }) => word);
}

export interface WordGroup {
  group: EditableWordGroup;
  words: EditableWord[];
}

const GROUP_ORDER: readonly EditableWordGroup[] = [null, 'more', 'later', 'not-on-screen'];

/** The words under their headings, headings in a fixed order, each word keeping its place within its group. */
export function groupWords(words: readonly EditableWord[]): WordGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const listed = words.filter((word) => word.group === group);
    return listed.length === 0 ? [] : [{ group, words: listed }];
  });
}
