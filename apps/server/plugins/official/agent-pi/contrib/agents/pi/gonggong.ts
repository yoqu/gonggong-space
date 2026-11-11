// Gonggong's pi extension, loaded by the wrapper agent-pi's launch script writes. pi-acp passes neither the session's
// MCP servers nor instructions to pi, and pi runs every tool without asking: the run's servers and the bot's
// instructions come from the env, and each tool call that may change something asks the ACP client first (the
// gonggong approval request: confirm(title, { gonggong: { toolCallId, title, input } })), which answers by the bot's
// tier and the owner's rules.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const READ_ONLY = new Set(['read', 'grep', 'find', 'ls'])

export default function (pi: ExtensionAPI) {
  const servers = JSON.parse(process.env.GG_PI_MCP || '{}')
  for (const [name, config] of Object.entries(servers)) pi.registerMcpServer(name, config as never)
  const instructions = process.env.GG_PI_SYSTEM_PROMPT
  if (instructions) {
    pi.on('before_agent_start', (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${instructions}` }))
  }
  pi.on('tool_call', async (event, ctx) => {
    if (READ_ONLY.has(event.toolName)) return
    const title = event.toolName.startsWith('mcp__') ? event.toolName : undefined
    const request = { gonggong: { toolCallId: event.toolCallId, title, input: event.input } }
    if (await ctx.ui.confirm(event.toolName, JSON.stringify(request))) return
    return { block: true, reason: 'The bot owner did not allow this call.' }
  })
}
