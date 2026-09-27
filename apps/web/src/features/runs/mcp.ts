import { GONGGONG_TOOLS, type RunEvent } from '@gonggong/protocol'

export type McpCall = NonNullable<Extract<RunEvent, { kind: 'tool' }>['mcp']>

const GONGGONG: Record<string, string> = {
  ask_group_members: '向群成员提问',
  ...Object.fromEntries(Object.entries(GONGGONG_TOOLS).map(([name, t]) => [name, t.title])),
}
const VALUE_MAX = 60

/** Built-in gonggong tools by their Chinese title; others as `Server · tool` (claude.ai connectors lose their prefix). */
export function mcpLabel(server: string, tool: string) {
  if (server === 'gonggong' && GONGGONG[tool]) return GONGGONG[tool]
  return `${server.replace(/^claude_ai_/, '')} · ${tool}`
}

/** A tool title made readable when it names an MCP call (Claude `mcp__s__t`, Codex `mcp.s.t`), else as is. */
export function toolTitle(title: string) {
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

export const argSummary = (call: McpCall) =>
  mcpArgs(call.input)
    ?.map(([k, v]) => `${k}=${v}`)
    .join(' · ') || undefined
