import { clipVisibleText } from '../json.ts';
import { MAX_RETYPED_LINE_CHARS, decodeHtmlEntities } from '../records/retyped.ts';
import { MARKUP_START_PATTERN } from './markup.ts';
import type { TextSpan } from './sources.ts';

/** A backslash escape of a JS string: `\uXXXX`, `\u{…}`, `\xXX`, an escaped quote, `\n` `\t` `\r` `\/`, or a lone backslash. */
const ESCAPE_SEQUENCE_PATTERN = /\\(?:u([0-9a-fA-F]{4})|u\{([0-9a-fA-F]+)\}|x([0-9a-fA-F]{2})|(['"])|([ntr/])|)/g;
const ESCAPE_CHARACTERS: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r' };
/** The escapes a fold reads as what they stand for. */
const FOLDED_ESCAPE_PATTERN = /\\(?:u([0-9a-fA-F]{4})|u\{([0-9a-fA-F]{1,6})\}|x([0-9a-fA-F]{2})|(['"]))/g;
/** What two spellings of the same words may differ in. */
const TYPOGRAPHY_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u2018\u2019\u201a\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  [/[\u00a0\u2000-\u200a\u202f]/g, ' '],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/ ?-+ ?/g, '-'],
  [/\u2026/g, '...'],
];

/**
 * A JS string's text with its escapes decoded, or `null` when one stands for nothing a line may show: a markup or
 * quote character, a lone backslash, or (unless `controls`) `\n`, `\t`, `\r`, `\/`.
 */
export function decodeScriptEscapes(input: string, controls = false): string | null {
  if (!input.includes('\\')) return input;
  let valid = true;
  const decoded = input.replace(
    ESCAPE_SEQUENCE_PATTERN,
    (_match: string, hex4: string | undefined, hexBraced: string | undefined, hex2: string | undefined, quote: string | undefined, control: string | undefined) => {
      const code = parseInt(hex4 ?? hexBraced ?? hex2 ?? '', 16);
      const character =
        quote ?? (control !== undefined ? (ESCAPE_CHARACTERS[control] ?? control) : code <= 0x10ffff ? String.fromCodePoint(code) : '');
      valid &&= quote !== undefined || (control !== undefined ? controls : character !== '' && !`<>'"\\\``.includes(character));
      return character;
    },
  );
  return valid ? decoded : null;
}

/** The words a JS string shows: escapes decoded and blanks as spaces; `null` when they do not decode or are too long. */
export function readScriptText(input: string): string | null {
  if (!input.includes('\\')) return input;
  const decoded = decodeScriptEscapes(input.replace(/\s/g, ' '));
  return decoded !== null && clipVisibleText(decoded, MAX_RETYPED_LINE_CHARS) === decoded ? decoded : null;
}

const countMatches = (input: string, pattern: RegExp): number => input.split(pattern).length - 1;

/** How many code escapes (`\u`, `\x`, a lone backslash) the spans hold. */
export function countCodeEscapes(source: string, spans: readonly TextSpan[]): number {
  return spans.reduce(
    (count, span) =>
      count + [...source.slice(span.start, span.end).matchAll(ESCAPE_SEQUENCE_PATTERN)].filter((match) => match[4] === undefined && match[5] === undefined).length,
    0,
  );
}

/** True when a literal holds no escape, or its escapes add or take away no tag (and it is no tagged template). */
export function escapesPreserveMarkup(source: string, literal: readonly TextSpan[]): boolean {
  const texts = literal.map((span) => source.slice(span.start, span.end));
  const keepsTags = (text: string): boolean => {
    const decoded = decodeScriptEscapes(text, true);
    return decoded !== null && countMatches(decoded, MARKUP_START_PATTERN) === countMatches(text, MARKUP_START_PATTERN);
  };
  return !texts.some((text) => text.includes('\\')) || (literal[0]?.tagged !== true && texts.every(keepsTags));
}

/** A text with its escapes and character references decoded and its typography folded, to find words in it. */
export function foldRetypedText(input: string): string {
  const decoded = input
    .replace(
      FOLDED_ESCAPE_PATTERN,
      (match: string, hex4: string | undefined, hexBraced: string | undefined, hex2: string | undefined, quote: string | undefined) => {
        const code = parseInt(hex4 ?? hexBraced ?? hex2 ?? '', 16);
        return quote ?? (code <= 0x10ffff ? String.fromCodePoint(code) : match);
      },
    )
    .replace(/&[#a-z0-9]{2,8};/gi, (entity: string) => decodeHtmlEntities(entity) ?? entity);
  return TYPOGRAPHY_FOLDS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), decoded);
}

export const removeWhitespace = (text: string): string => text.replace(/\s+/g, '');
export const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();
