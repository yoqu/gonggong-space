import { z } from 'zod'
import type { HtmlRenderRef } from './html-render.js'

// ── Rich UI blocks (plan 富交互消息): fenced code blocks in a bot reply, rendered as components ─────────────────────
// A block whose content fails its schema stays a plain code block: never an error, never blank.

const label = z.string().min(1).max(80)

/**
 * ```actions — JSON. Buttons under the reply: a click posts `@<bot> 选择了「<label>」` (quoting the reply) as the
 * clicker, which starts the bot's next turn. `id` names the block within the reply; it can be answered once.
 */
export const ActionsBlock = z.object({
  id: z
    .string()
    .regex(/^[\w-]{1,40}$/)
    .default('actions'),
  prompt: z.string().max(200).optional(),
  options: z
    .array(
      z.object({
        label,
        /** Sent instead of the label when given. */
        value: z.string().max(200).optional(),
        style: z.enum(['primary', 'default', 'danger']).optional(),
      }),
    )
    .min(1)
    .max(8),
  /** Pick several, then 提交. */
  multiple: z.boolean().optional(),
})
export type ActionsBlock = z.infer<typeof ActionsBlock>

export const MERMAID_MAX = 20_000

/**
 * ```html-page — JSON {"id"}: where a page the run published with html_render sits in its final reply (the page's
 * attachment id). The reply carries its run's pages (MessageDto.htmlRenders); an id not among them shows nothing.
 */
export const HtmlPageBlock = z.object({ id: z.string().min(1).max(100) })

export type UiBlock =
  | { lang: 'actions'; data: ActionsBlock }
  | { lang: 'mermaid'; source: string }
  | { lang: 'html-page'; id: string }

const json = <T>(schema: z.ZodType<T>, raw: string): T | null => {
  try {
    const r = schema.safeParse(JSON.parse(raw))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

/** The block a fenced code block of language `lang` holds; null = not a UI block, or invalid (render as code). */
export function parseUiBlock(lang: string, raw: string): UiBlock | null {
  switch (lang) {
    case 'actions': {
      const data = json(ActionsBlock, raw)
      return data && { lang, data }
    }
    case 'mermaid':
      return raw.trim() && raw.length <= MERMAID_MAX ? { lang, source: raw } : null
    case 'html-page': {
      const data = json(HtmlPageBlock, raw)
      return data && { lang, id: data.id }
    }
    default:
      return null
  }
}

const FENCE = /^(`{3,}|~{3,})[ \t]*([\w-]+)[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm

/** Every closed UI block of a Markdown text, with where it sits (for replacing it with a summary). */
export function findUiBlocks(markdown: string) {
  const out: { start: number; end: number; block: UiBlock }[] = []
  for (const m of markdown.matchAll(FENCE)) {
    const block = parseUiBlock(m[2] ?? '', m[3] ?? '')
    if (block) out.push({ start: m.index, end: m.index + m[0].length, block })
  }
  return out
}

/**
 * One line standing in for a block where it can't render (Feishu, notifications, search snippets). Chinese. An
 * html-page block names its page from `pages` (the reply's), or is dropped.
 */
export function summarizeUiBlock(b: UiBlock, pages: HtmlRenderRef[] = []): string {
  switch (b.lang) {
    case 'actions':
      return `${b.data.prompt ?? '请选择'}：${b.data.options.map((o) => o.label).join(' / ')}`
    case 'mermaid':
      return '🔀 流程图'
    case 'html-page': {
      const page = pages.find((p) => p.attachmentId === b.id)
      return page ? `📄 ${page.title}` : ''
    }
  }
}

/** The reply's pages its body does not place with an html-page block: they follow the body, in order. */
export function unplacedHtmlPages(markdown: string, pages: HtmlRenderRef[]) {
  const placed = new Set(
    findUiBlocks(markdown).flatMap((b) => (b.block.lang === 'html-page' ? [b.block.id] : [])),
  )
  return pages.filter((p) => !placed.has(p.attachmentId))
}

/** Who answered an actions block of a reply (MessageDto.actions, keyed by block id). */
export const ActionAnswer = z.object({
  userId: z.string(),
  name: z.string(),
  labels: z.array(z.string()),
  at: z.string(),
})
export type ActionAnswer = z.infer<typeof ActionAnswer>
/** POST /api/messages/:id/actions — answers the reply's block `blockId` with the chosen option indexes. */
export const AnswerActionsReq = z.object({
  blockId: z.string().regex(/^[\w-]{1,40}$/),
  options: z.array(z.number().int().min(0).max(7)).min(1).max(8),
})
export type AnswerActionsReq = z.infer<typeof AnswerActionsReq>

/** Agent-facing guide to the blocks and inline pages (not translated), added to every bot's system prompt. */
export const UI_BLOCKS_GUIDE = `Replies are chat Markdown. These fenced blocks render as components (not for ordinary code; invalid JSON shows as code):
- \`\`\`mermaid: flowchart, sequence, architecture or gantt diagrams.
- \`\`\`actions: JSON {"id"?,"prompt"?,"options":[{"label","value"?,"style"?:"primary|default|danger"}],"multiple"?} — buttons for a choice you need; a click returns as "@you 选择了「label」". End your turn after it.
- \`\`\`html-page: JSON {"id"} — places a page you published with html_render this turn at that point of your reply; pages you do not place follow your reply.
Visuals (a chart for data with a trend or comparison; any diagram, dashboard, mockup or report asked for): one self-contained HTML page (a file: pass its HTML), \`html_preview\`, then \`html_render\`. Not a screenshot, text description or server.`
