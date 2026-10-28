import { z } from 'zod'

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

export type UiBlock = { lang: 'actions'; data: ActionsBlock } | { lang: 'mermaid'; source: string }

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

/** One line standing in for a block where it can't render (Feishu, notifications, search snippets). Chinese. */
export function summarizeUiBlock(b: UiBlock): string {
  switch (b.lang) {
    case 'actions':
      return `${b.data.prompt ?? '请选择'}：${b.data.options.map((o) => o.label).join(' / ')}`
    case 'mermaid':
      return '🔀 流程图'
  }
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
export const UI_BLOCKS_GUIDE = `Your replies are Markdown rendered in a chat. Besides text, tables and code, these fenced code blocks render as components:
- \`\`\`mermaid: Mermaid source for flowcharts, sequence, architecture and gantt diagrams.
- \`\`\`actions: JSON {"id"?,"prompt"?,"options":[{"label","value"?,"style"?:"primary|default|danger"}],"multiple"?} — buttons; a member's click comes back to you as a new message "@you 选择了「label」". Use for a choice you need from them; end your turn after it.
Invalid JSON shows as a plain code block. Do not use these for ordinary code samples.

Visuals: answer data with a trend or comparison with a chart, and show any visual a member asks for (diagram, dashboard, mockup, report) in the chat: write one self-contained HTML page, check it with \`html_preview\`, then publish it with \`html_render\`. It appears as its own message above your reply; do not restate it. If the visual is a file, pass that file's HTML. A screenshot or a text description does not show it. Never start a server for it; \`preview_static\` / \`preview_expose\` are for whole sites and running apps.`
