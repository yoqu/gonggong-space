/**
 * Formatted text on the clipboard. Text copied from an editor with links
 * or bold and italic goes out three ways: plain text, the stored Markdown
 * under the board's own type (so pasting into another text keeps the
 * formatting), and HTML that other apps read, whose links carry only
 * their `href`.
 */

import { tokenizeInlineMarkdown, type InlineToken } from '@open-artifact/whiteboard-core';

/** The clipboard type that carries a text's stored Markdown. */
export const RICH_TEXT_CLIPBOARD_TYPE = 'application/x-whiteboard-text+markdown';

const INLINE = { escapes: true } as const;

/** Whether stored text has any link or mark (otherwise plain text says it all). */
export function hasInlineFormat(markdown: string): boolean {
  return markdown.split('\n').some((line) => tokenizeInlineMarkdown(line, INLINE).some((token) => token.kind !== 'text'));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;'));
}

function tokenHtml(token: InlineToken): string {
  const text = escapeHtml(token.text);
  switch (token.kind) {
    case 'text':
      return text;
    case 'bold':
      return `<strong>${text}</strong>`;
    case 'italic':
      return `<em>${text}</em>`;
    case 'bolditalic':
      return `<strong><em>${text}</em></strong>`;
    case 'code':
      return `<code>${text}</code>`;
    case 'link':
      return `<a href="${escapeHtml(token.href)}">${text}</a>`;
  }
}

/** The HTML other apps get for stored text: lines joined with `<br>`, marks as tags, links with only `href`. */
export function richClipboardHtml(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => tokenizeInlineMarkdown(line, INLINE).map(tokenHtml).join(''))
    .join('<br>');
}
