import type { RetypedLine } from '../records/retyped.ts';
import { textSiteWords, type TextScan, type TextSite } from './sites.ts';
import type { FilmSource } from './sources.ts';

/** A retyped line as it stood before the agent's turn: the words it replaced and the sources (by name) that said it. */
export interface StoodRetypedLine extends RetypedLine {
  words: string;
  sources: Set<string>;
}

/** The retyped lines that showed before the agent's turn, and every site's key (source name and `was`). */
export interface StoodRetypedSites {
  lines: StoodRetypedLine[];
  sites: Set<string>;
}

/** A retyped line that stopped showing: the agent rewrote its words `old` into `now`, which the code spells `nowWas`. */
export interface EndedRetypedLine extends RetypedLine {
  old: string;
  now: string;
  nowWas: string;
}

/** How long the search for ended lines may take, in milliseconds. */
export const ENDED_LINES_BUDGET_MS = 50;
/** How long after the agent's turn a change to the film still counts as the turn's, in milliseconds. */
export const ENDED_LINES_WINDOW_MS = 60_000;

const WORD_CHARACTER_PATTERN = /[\p{L}\p{M}\p{N}]/u;

const siteKey = (sourceName: string, was: string): string => `${sourceName}\0${was}`;
const siteSourceName = (sources: readonly FilmSource[], site: TextSite): string => sources[site.source]?.name ?? '';

/** Words compared loosely: lower case, anything but letters and digits as one space. */
export const normalizeEndedWords = (words: string): string =>
  words
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Words telling enough to be found again: two words or more, or eight letters. */
export const isDistinctiveWords = (words: string): boolean => words.trim().split(/\s+/).length >= 2 || (words.match(/\p{L}/gu)?.length ?? 0) >= 8;

/** Whether `words` shows in `text` as whole words. */
export function containsWholeWords(text: string, words: string): boolean {
  if (words === '') return false;
  for (let at = text.indexOf(words); at >= 0; at = text.indexOf(words, at + 1))
    if (!WORD_CHARACTER_PATTERN.test(text.slice(Math.max(0, at - 1), at)) && !WORD_CHARACTER_PATTERN.test(text.slice(at + words.length, at + words.length + 1)))
      return true;
  return false;
}

/** The retyped lines as they stand now, to compare with after the agent's turn. */
export function snapshotRetypedSites(sources: readonly FilmSource[], sites: readonly TextSite[], lines: readonly RetypedLine[]): StoodRetypedSites {
  const names = new Map<string, Set<string>>();
  const words = new Map<string, string>();
  for (const site of sites) {
    if (!names.has(site.was)) names.set(site.was, new Set());
    names.get(site.was)!.add(siteSourceName(sources, site));
    const shown = words.has(site.was) ? null : textSiteWords(site);
    if (shown !== null) words.set(site.was, shown);
  }
  return {
    lines: lines.flatMap((line) => {
      const lineSources = names.get(line.was);
      const lineWords = words.get(line.was);
      return lineSources === undefined || lineWords === undefined ? [] : [{ was: line.was, v: line.v, words: lineWords, sources: lineSources }];
    }),
    sites: new Set(sites.map((site) => siteKey(siteSourceName(sources, site), site.was))),
  };
}

export interface EndedLinesOptions {
  budgetMs?: number;
  now?: () => number;
}

/**
 * The retyped lines (as they `stood` before the agent's turn) that no longer show because the agent rewrote the
 * text round them, each with the one new text that took their words in: offered to the person to put their words
 * back. Gives up after the budget.
 */
export function findEndedRetypedLines(
  stood: StoodRetypedSites,
  sources: readonly FilmSource[],
  scan: TextScan,
  lines: readonly RetypedLine[],
  options: EndedLinesOptions = {},
): EndedRetypedLine[] {
  const now = options.now ?? (() => performance.now());
  const until = now() + (options.budgetMs ?? ENDED_LINES_BUDGET_MS);
  const typed = new Map(lines.map((line) => [line.was, line.v] as const));
  const { sites, unread } = scan;
  const siteWords = sites.map((site) => textSiteWords(site));
  return stood.lines.flatMap((line): EndedRetypedLine[] => {
    if (now() > until) return [];
    if (typed.get(line.was) !== line.v || !isDistinctiveWords(line.words) || line.v.includes(line.words)) return [];
    if (sites.some((site) => site.was === line.was) || unread.some((text) => text.includes(line.was))) return [];
    if (sites.some((site, index) => site.was.includes(line.v) || siteWords[index]?.includes(line.v) === true)) return [];
    const found = new Map(
      sites.flatMap((site, index): Array<[string, string]> => {
        const name = siteSourceName(sources, site);
        const shown = siteWords[index];
        return line.sources.has(name) &&
          !stood.sites.has(siteKey(name, site.was)) &&
          site.was.includes(line.was) &&
          shown != null &&
          containsWholeWords(shown, line.words)
          ? [[site.was, shown]]
          : [];
      }),
    );
    const [first] = found;
    if (found.size !== 1 || first === undefined) return [];
    const [nowWas, nowWords] = first;
    return normalizeEndedWords(nowWords) === normalizeEndedWords(line.words) || typed.has(nowWas)
      ? []
      : [{ was: line.was, v: line.v, old: line.words, now: nowWords, nowWas }];
  });
}
