import type { Film } from '../film/decode.ts';
import { MAX_RETYPED_LINE_CHARS, decodeHtmlEntities, type RetypedLine } from '../records/retyped.ts';
import { collapseWhitespace, countCodeEscapes, escapesPreserveMarkup, readScriptText } from './escapes.ts';
import { scanStringLiterals, type StringScan } from './js-strings.ts';
import { MARKUP_START_PATTERN, MARKUP_TAG_OPEN_AT_END_PATTERN, markupTextSpans } from './markup.ts';
import { filmTextSources, isDataSource, type FilmSource, type TextSpan } from './sources.ts';

/** A place in the film's code whose whole text is a line the film shows: a JS string (or part of one) or text between tags. */
export interface TextSite extends TextSpan {
  /** The index of its source among those scanned. */
  source: number;
  /** The text as the code spells it, escapes and character references and all. */
  was: string;
  /** It sits between tags (in an html module or markup in a string): `&` is written `&amp;` there. */
  markup: boolean;
  /** It sits in a JS string, so it may carry escapes. */
  inScript: boolean;
}

export interface TextScan {
  sites: TextSite[];
  /** The scripts that could not be read to their end: a line may hide in them. */
  unread: string[];
}

/** A line the film shows, with every place the code spells it so. */
export interface FilmWord {
  was: string;
  /** What it shows: escapes and character references decoded, spaces collapsed. */
  words: string;
  places: number;
  /** The sources it is in, by name (`''`: the cut). */
  sources: string[];
}

const NUMERIC_TEXT_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const SCENE_ID_ARGUMENT_PATTERN = /\bkit\.scene\(\s*$/;
const byStart = (a: TextSpan, b: TextSpan): number => a.start - b.start;

/** The places of each source a record line can stand for, and the scripts that could not be read. */
export function scanTextSites(sources: readonly FilmSource[]): TextScan {
  const sites: TextSite[] = [];
  const unread: string[] = [];
  sources.forEach((source, index) => {
    if (isDataSource(source)) return;
    const { kind, text } = source;
    const found: TextSite[] = [];
    const excluded: TextSpan[] = [];
    let unescaped: TextSpan[] = [];
    const consider = (span: TextSpan, markup: boolean, inScript: boolean): void => {
      if (inScript && SCENE_ID_ARGUMENT_PATTERN.test(text.slice(Math.max(0, span.start - 200), span.start - 1))) return;
      let { start, end } = span;
      while (start < end && /\s/.test(text[start]!)) start++;
      while (end > start && /\s/.test(text[end - 1]!)) end--;
      const was = text.slice(start, end);
      if (was === '' || was.length > MAX_RETYPED_LINE_CHARS) return;
      const words = inScript ? readScriptText(was) : was;
      if (words === null || words !== words.trim() || (!markup && (NUMERIC_TEXT_PATTERN.test(words) || !/[\p{L}\p{N}]/u.test(words)))) return;
      found.push({ source: index, start, end, was, markup, inScript });
    };
    if (kind === 'html') for (const span of markupTextSpans(text, [{ start: 0, end: text.length }], false)) consider(span, true, false);
    const scan: StringScan | null = kind === 'js' ? scanStringLiterals(text) : { literals: [], script: new Set() };
    if (scan === null) unread.push(text);
    else {
      let escapesSafe = true;
      for (const literal of scan.literals) {
        const markup = literal.some((span) => MARKUP_START_PATTERN.test(text.slice(span.start, span.end)));
        const spans = markup ? markupTextSpans(text, literal, true, excluded) : literal;
        escapesSafe &&= escapesPreserveMarkup(text, literal);
        if (!scan.script.has(literal)) for (const span of spans) consider(span, markup, true);
      }
      const flat = scan.literals.flat().sort(byStart);
      const candidates =
        escapesSafe && text.includes('\\') && !flat.some((span) => MARKUP_TAG_OPEN_AT_END_PATTERN.test(text.slice(span.start, span.end)))
          ? markupTextSpans(text, flat, false)
          : [];
      if (countCodeEscapes(text, flat) === countCodeEscapes(text, candidates)) unescaped = candidates;
    }
    excluded.sort(byStart);
    let excludedAt = 0;
    let excludedEnd = -1;
    let unescapedAt = 0;
    for (const site of found.sort(byStart)) {
      while (excludedAt < excluded.length && excluded[excludedAt]!.start <= site.start) excludedEnd = Math.max(excludedEnd, excluded[excludedAt++]!.end);
      while (unescapedAt < unescaped.length && unescaped[unescapedAt]!.end < site.end) unescapedAt++;
      const escaped = site.inScript && site.was.includes('\\');
      if (site.end > excludedEnd && (!escaped || (unescapedAt < unescaped.length && unescaped[unescapedAt]!.start <= site.start))) sites.push(site);
    }
  });
  return { sites, unread };
}

/** What a site shows: its JS escapes and character references decoded, spaces collapsed; `null` when they do not decode. */
export function textSiteWords(site: Pick<TextSite, 'was' | 'inScript'>): string | null {
  const text = (site.inScript ? readScriptText(site.was) : null) ?? site.was;
  const decoded = decodeHtmlEntities(text);
  return decoded === null ? null : collapseWhitespace(decoded);
}

/** The record lines the code still says somewhere, one for each `was`. */
export function matchRetypedLines(sites: readonly TextSite[], lines: readonly RetypedLine[]): RetypedLine[] {
  const said = new Set(sites.map((site) => site.was));
  return [...new Map(lines.filter((line) => said.has(line.was)).map((line) => [line.was, line] as const)).values()];
}

/**
 * True when nothing the film runs says `was` any more, so a change to it cannot show: no site, and no unread
 * script holds it. A scan that failed (`null`) counts every line as gone.
 */
export function isLineGone(scan: TextScan | null, was: string): boolean {
  return scan === null || (!scan.sites.some((site) => site.was === was) && !scan.unread.some((text) => text.includes(was)));
}

/** The lines the film's code shows, in the order they are first written, with where each is. */
export function scanFilmWords(film: Pick<Film, 'script' | 'modules'>): FilmWord[] {
  const sources = filmTextSources(film);
  const words = new Map<string, FilmWord>();
  for (const site of scanTextSites(sources).sites) {
    const name = sources[site.source]!.name;
    const known = words.get(site.was);
    if (known !== undefined) {
      known.places++;
      if (!known.sources.includes(name)) known.sources.push(name);
      continue;
    }
    const shown = textSiteWords(site);
    if (shown !== null) words.set(site.was, { was: site.was, words: shown, places: 1, sources: [name] });
  }
  return [...words.values()];
}
