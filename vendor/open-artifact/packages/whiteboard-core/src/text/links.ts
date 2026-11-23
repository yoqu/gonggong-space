/**
 * Links inside note text: which targets may be linked and how much a link
 * edit costs against the text limit. The editor owns the DOM side (finding
 * the selected text, wrapping it in link elements).
 */

import { HTTP_LINK_PATTERN } from './inline-markdown.ts';

/** Whether text may link to a target: `http(s)` and nothing that would break its Markdown. */
export function isLinkableHref(href: string): boolean {
  return HTTP_LINK_PATTERN.test(href) && !/[`*[\]]/.test(href);
}

/**
 * The spans a link over some text would cover (`[start, end)` offsets):
 * one per line, trimmed of whitespace and brackets, which links cannot hold.
 */
export function linkableTextSpans(text: string): [start: number, end: number][] {
  return [...text.matchAll(/[^\s[\]](?:[^\n[\]]*[^\s[\]])?/g)].map((match) => [match.index, match.index + match[0].length]);
}

/**
 * A bound on how many characters linking some spans (count them with
 * {@link linkableTextSpans}) to `href` adds to the source: the `[…](href)`
 * syntax plus slack for escapes per span, or, with no spans, the link
 * written out as `[href](href)`.
 */
export function linkEditCost(spanCount: number, href: string): number {
  return spanCount === 0 ? 2 * href.length + 4 : spanCount * (href.length + 4 + 12);
}
