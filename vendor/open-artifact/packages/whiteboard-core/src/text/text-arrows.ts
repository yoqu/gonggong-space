/**
 * Typed arrows in text: `->` becomes `→`, `<-` becomes `←` and `<->`
 * becomes `←→`, except inside code spans, link targets, URLs, HTML
 * comments, and in right-to-left text. A zero-width non-joiner between the
 * characters (`-\u200C>`) keeps them apart, which is how an undone arrow
 * stays undone.
 *
 * Only the string transforms live here; the editor's as-you-type
 * autoformat (caret handling, `beforeinput`) builds on them.
 */

/** A text transform rule. */
export interface TextTransform {
  /** Regular expression source matching the raw token. */
  find: string;
  /** The drawn replacement of a token (empty to leave it). */
  draw(token: string): string;
  /** The token with joiners inserted so it no longer matches. */
  apart(token: string): string;
  /** Text this rule never applies to. */
  never?: RegExp;
}

/** Separates the runs of a rich-text block when the caret context is flattened. */
export const TEXT_RUN_SEPARATOR = '\uFDD5';

/** Zero-width non-joiner: keeps an undone arrow's characters apart. */
export const ARROW_JOINER = '\u200C';

/** `->`, `<-`, `<->`, also with en and em dashes and longer runs. */
export const ARROW_TEXT_TRANSFORM: TextTransform = {
  find: '(?<!<)<?(?<![-\\u2013\\u2014])[-\\u2013\\u2014]+(?:>(?!>)|(?![-\\u2013\\u2014\\d>]))',
  draw: (token) => (token.startsWith('<') ? '←' : '') + (token.endsWith('>') ? '→' : ''),
  apart: (token) => token.replace(/^</, `<${ARROW_JOINER}`).replace(/>$/, `${ARROW_JOINER}>`),
  never: /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/,
};

/** Every text transform, in priority order. */
export const TEXT_TRANSFORMS: readonly TextTransform[] = [ARROW_TEXT_TRANSFORM];

/** Skips code spans, link targets, URLs and comments, then matches each transform as its own group. */
export const MARKDOWN_ARROW_PATTERN = new RegExp(
  '(?<!`)(`+)(?!`)[^]*?(?<!`)\\1(?!`)|`[^]*|\\]\\([^)\\s]*\\)?|https?:\\/\\/\\S+|<!--[^]*?(?:-->|$)' + TEXT_TRANSFORMS.map((transform) => `|(${transform.find})`).join(''),
  'g',
);

/**
 * Draws the arrows in a line of text. `onDraw` hears each drawn token with
 * its replacement and where it ends; `context` (default: the text) decides
 * which rules apply (right-to-left context disables arrows).
 */
export function drawTextArrows(text: string, onDraw?: (token: string, drawn: string, end: number, rule: TextTransform) => void, context: string = text): string {
  const allowed = TEXT_TRANSFORMS.map((transform) => transform.never?.test(context) !== true);
  return text.replace(MARKDOWN_ARROW_PATTERN, (token: string, ...groups: unknown[]) => {
    const ruleIndex = TEXT_TRANSFORMS.findIndex((_, index) => groups[index + 1] !== undefined);
    const rule = allowed[ruleIndex] === true ? TEXT_TRANSFORMS[ruleIndex] : undefined;
    const drawn = rule?.draw(token) ?? '';
    const offset = groups[TEXT_TRANSFORMS.length + 1];
    if (rule === undefined || drawn === '' || typeof offset !== 'number') return token;
    onDraw?.(token, drawn, offset + token.length, rule);
    return drawn;
  });
}

/** {@link drawTextArrows} line by line. */
export function drawArrowsInLines(text: string, context?: string): string {
  return text
    .split('\n')
    .map((line) => drawTextArrows(line, undefined, context ?? line))
    .join('\n');
}

/**
 * Removes the joiners that keep undone arrows apart (for text leaving the
 * board, where nothing draws arrows), keeping every other zero-width
 * non-joiner, which may be meaningful (as in Persian).
 */
export function dropArrowJoiners(text: string): string {
  return text.replace(/(.)\u200C(?=(.))/gu, (whole: string, before: string, after: string) => (drawTextArrows(before + after) === before + after ? whole : before));
}
