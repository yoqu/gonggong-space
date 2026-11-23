import type { FilmModule } from '../documents.ts';
import type { RetypedLine, RetypedRecord } from '../records/retyped.ts';
import { matchRetypedLines, scanTextSites, type TextSite } from './sites.ts';
import { CUT_SOURCE_NAME, type FilmSource } from './sources.ts';

/** The film's code with a person's retyped lines swapped in. */
export interface RetypedFilm<M extends FilmSource = FilmModule> {
  script: string;
  modules: M[];
  /** How many lines were swapped in. */
  swapped: number;
  /** The record's lines the code no longer says anywhere. */
  unmatched: RetypedLine[];
}

/** The sources with each site whose `was` a line names written over with the line's `v`. */
export function replaceTextSites<M extends FilmSource>(sources: readonly M[], sites: readonly TextSite[], lines: readonly RetypedLine[]): M[] {
  const replacements = new Map(lines.map((line) => [line.was, line.v] as const));
  const texts = sources.map((source) => source.text);
  for (const site of [...sites].sort((a, b) => b.source - a.source || b.start - a.start)) {
    const v = replacements.get(site.was);
    if (v === undefined) continue;
    const text = texts[site.source]!;
    texts[site.source] = text.slice(0, site.start) + (site.markup ? v.split('&').join('&amp;') : v) + text.slice(site.end);
  }
  return sources.map((source, index) => (texts[index] === source.text ? source : { ...source, text: texts[index]! }));
}

/**
 * The cut and modules as the player runs them with `retyped.json` applied: wherever a whole string, or the text
 * between two tags, is a line's `was` (as the code spells it), the film shows its `v`.
 */
export function applyRetyped<M extends FilmSource>(film: { script: string; modules: readonly M[] }, record: RetypedRecord): RetypedFilm<M> {
  if (record.lines.length === 0) return { script: film.script, modules: [...film.modules], swapped: 0, unmatched: [] };
  const cut: FilmSource = { name: CUT_SOURCE_NAME, kind: 'js', text: film.script };
  const sources: FilmSource[] = [cut, ...film.modules];
  const { sites } = scanTextSites(sources);
  const matched = matchRetypedLines(sites, record.lines);
  const replaced = replaceTextSites(sources, sites, matched);
  const said = new Set(matched.map((line) => line.was));
  return {
    script: replaced[0]!.text,
    modules: film.modules.map((module, index) => {
      const text = replaced[index + 1]!.text;
      return text === module.text ? module : { ...module, text };
    }),
    swapped: matched.length,
    unmatched: record.lines.filter((line) => !said.has(line.was)),
  };
}
