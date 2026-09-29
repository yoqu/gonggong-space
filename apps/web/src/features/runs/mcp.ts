import { GONGGONG_TOOLS, type Question, type RunEvent } from '@gonggong/protocol'

export type McpCall = NonNullable<Extract<RunEvent, { kind: 'tool' }>['mcp']>

const GONGGONG: Record<string, string> = {
  ask_group_members: '向群成员提问',
  ...Object.fromEntries(Object.entries(GONGGONG_TOOLS).map(([name, t]) => [name, t.title])),
}
const VALUE_MAX = 60

export const QUESTION_TYPE: Record<Question['type'], string> = {
  single: '单选',
  multi: '多选',
  yesno: '是/否',
  text: '自由文本',
}

/** Built-in gonggong tools by their Chinese title; others as `Server · tool` (claude.ai connectors lose their prefix). */
export function mcpLabel(server: string, tool: string) {
  if (server === 'gonggong' && GONGGONG[tool]) return GONGGONG[tool]
  return `${server.replace(/^claude_ai_/, '')} · ${tool}`
}

/** The daemon's echo of the session's model / effort (`已切换推理强度：High`): setup, not progress. */
export const CONFIG_ECHO = /^已切换[^：]+：/

/** A tool title made readable when it names an MCP call (Claude `mcp__s__t`, Codex `mcp.s.t`); config echoes
 * are blank so the run card shows its working label instead. */
export function toolTitle(title: string) {
  if (CONFIG_ECHO.test(title)) return ''
  const [, server, tool] = /^mcp__(.+?)__(.+)$/.exec(title) ?? /^mcp\.([^.]+)\.(.+)$/.exec(title) ?? []
  return server && tool ? mcpLabel(server, tool) : title
}

const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : Array.isArray(v) ? `${v.length} 项` : JSON.stringify(v)
  return s.length > VALUE_MAX ? `${s.slice(0, VALUE_MAX - 1)}…` : s
}

/** The call's top-level arguments; null when they are not a whole JSON object (the daemon clips long input). */
export function mcpArgs(input: string | undefined): [string, string][] | null {
  if (!input) return null
  try {
    const v: unknown = JSON.parse(input)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    return Object.entries(v).map(([k, x]) => [k, short(x)])
  } catch {
    return null
  }
}

export type AskedQuestion = Pick<Question, 'type' | 'title'> & {
  options?: string[]
  recommended?: number | null
}

/** The questions of a 「向群成员提问」 call as the agent sent them; null for other calls or clipped input. */
export function askedQuestions(call: McpCall): AskedQuestion[] | null {
  if (call.server !== 'gonggong' || call.tool !== 'ask_group_members' || !call.input) return null
  try {
    const qs = (JSON.parse(call.input) as { questions?: unknown }).questions
    const valid =
      Array.isArray(qs) && qs.every((q) => typeof q?.title === 'string' && q.type in QUESTION_TYPE)
    return valid ? (qs as AskedQuestion[]) : null
  } catch {
    return null
  }
}

export const argSummary = (call: McpCall) =>
  askedQuestions(call)
    ?.map((q) => q.title)
    .join(' / ') ||
  mcpArgs(call.input)
    ?.map(([k, v]) => `${k}=${v}`)
    .join(' · ') ||
  undefined
