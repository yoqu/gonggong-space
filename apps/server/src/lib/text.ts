import { findUiBlocks, type HtmlRenderRef, summarizeUiBlock, unplacedHtmlPages } from '@gonggong/protocol'

export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/** One line around the first match, so long messages still show why they matched. */
export function snippet(body: string, q: string) {
  const line = body.replace(/\s+/g, ' ').trim()
  const at = line.toLowerCase().indexOf(q.toLowerCase())
  return at > 40 ? `…${line.slice(at - 20, at + 100)}` : line.slice(0, 120)
}

export const patchPaths = (patch: string) =>
  [...patch.matchAll(/^diff --git a\/.+? b\/(?<path>.+)$/gm)].map((m) => m.groups?.path ?? '')

/**
 * `markdown` with each rich UI block (plan 富交互消息) replaced by its one-line summary, for places that can't render
 * it; `pages` (the reply's html_render pages) name their blocks, and those it does not place follow by title.
 */
export function summarizeBlocks(markdown: string, pages: HtmlRenderRef[] = []) {
  let out = ''
  let at = 0
  for (const b of findUiBlocks(markdown)) {
    out += markdown.slice(at, b.start) + summarizeUiBlock(b.block, pages)
    at = b.end
  }
  out += markdown.slice(at)
  const rest = unplacedHtmlPages(markdown, pages)
    .map((p) => `📄 ${p.title}`)
    .join('\n')
  return [out, rest].filter(Boolean).join('\n\n')
}
