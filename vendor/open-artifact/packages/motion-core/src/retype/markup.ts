import type { TextSpan } from './sources.ts';

/** `<` that opens a tag, a closing tag, a comment or a declaration. */
export const MARKUP_START_PATTERN = /<[A-Za-z/!?]/;
/** Text that ends inside an opening tag (`<div`, `</`, `<!-`). */
export const MARKUP_TAG_OPEN_AT_END_PATTERN = /<(?:!-?|\/?(?:[A-Za-z][^\s/<>]*)?)$/;

type MarkupMode = 'text' | 'tag' | 'comment' | 'raw' | "'" | '"';

/**
 * The stretches of text between tags in markup that may be cut into parts (a template's static parts): tags,
 * comments and the insides of `<style>` and `<script>` are left out. With `skipOpeningTag`, what comes before the
 * first `>` of the first part is taken for the rest of a tag. A gap between two parts that falls inside a tag is
 * added to `excluded`.
 */
export function markupTextSpans(source: string, spans: readonly TextSpan[], skipOpeningTag: boolean, excluded: TextSpan[] = []): TextSpan[] {
  const result: TextSpan[] = [];
  let mode: MarkupMode = 'text';
  let rawElement = '';
  spans.forEach(({ start, end }, index) => {
    let textStart = start;
    if (index === 0 && skipOpeningTag) {
      const part = source.slice(start, end);
      const close = part.indexOf('>');
      const open = part.indexOf('<');
      if (close >= 0 && (open < 0 || close < open)) textStart = start + close + 1;
    }
    for (let at = textStart; at < end; at++) {
      const character = source[at];
      if (mode === 'text') {
        if (character !== '<' || (at + 1 < end && !MARKUP_START_PATTERN.test(source.slice(at, at + 2)))) continue;
        result.push({ start: textStart, end: at });
        mode = source.startsWith('<!--', at) ? 'comment' : 'tag';
        rawElement = /^<(style|script)\b/i.exec(source.slice(at, Math.min(end, at + 8)))?.[1]?.toLowerCase() ?? '';
      } else if (mode === 'tag') {
        if (character === "'" || character === '"') mode = character;
        else if (character === '>') {
          mode = rawElement === '' ? 'text' : 'raw';
          textStart = at + 1;
        }
      } else if (mode === 'comment') {
        if (character === '>' && source.slice(at - 2, at) === '--') {
          mode = 'text';
          textStart = at + 1;
        }
      } else if (mode === 'raw') {
        if (
          character === '<' &&
          source.slice(at + 1, at + 2 + rawElement.length).toLowerCase() === '/' + rawElement &&
          !/[\w-]/.test(source[at + 2 + rawElement.length] ?? '')
        ) {
          mode = 'tag';
          rawElement = '';
        }
      } else if (character === mode) mode = 'tag';
    }
    if (mode === 'text') result.push({ start: textStart, end });
    else if (index + 1 < spans.length) excluded.push({ start: end, end: spans[index + 1]!.start });
  });
  return result;
}
