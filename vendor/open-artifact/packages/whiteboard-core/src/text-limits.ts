/**
 * Character-safe text truncation. Limits count user-perceived characters
 * (code points), not UTF-16 units, so an emoji is never cut in half.
 */

/** The first `maxChars` code points of `text` (the text itself when shorter). */
export function truncateChars(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : text;
}

/** Breaks `](` so a cut Markdown link does not swallow what follows. */
export function breakMarkdownLinkSyntax(text: string): string {
  return text.replace(/\](`*)\(/g, ']$1 (');
}

/** Truncates Markdown text; a link cut by the limit is defused. */
export function truncateMarkdownText(text: string, maxChars: number): string {
  const truncated = truncateChars(text, maxChars);
  return truncated === text ? text : truncateChars(breakMarkdownLinkSyntax(truncated), maxChars);
}

/** The first `maxChars` code points of a string, or `''` for anything else. */
export function sliceChars(text: unknown, maxChars: number): string {
  return typeof text === 'string' ? [...text].slice(0, maxChars).join('') : '';
}

/** Shortens a display name to 80 characters with an ellipsis. */
export function truncateAuthorName(name: string): string {
  const chars = [...name];
  return chars.length > 80 ? `${chars.slice(0, 79).join('').trimEnd()}…` : name;
}
