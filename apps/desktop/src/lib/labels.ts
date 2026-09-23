import type { AgentKind, RunStatus } from '@aiws/protocol'
import type { BadgeVariant } from '@web/ui'
import type { AgentCard, Approval, Snapshot } from '../ipc'

export const AGENTS: Record<AgentKind, { name: string; install: string }> = {
  claude: { name: 'Claude Code', install: 'npm install -g @anthropic-ai/claude-code' },
  codex: { name: 'Codex', install: 'npm install -g @openai/codex' },
}

export type ConnKind = 'ok' | 'connecting' | 'offline' | 'proto' | 'revoked' | 'blocked' | 'unbound'

export function connKind(s: Snapshot): ConnKind {
  if (s.phase !== 'running') return s.phase
  const c = s.status.conn
  if (c.state === 'online') return 'ok'
  if (c.state === 'rejected') return c.reason === 'protocol' ? 'proto' : 'revoked'
  return c.state
}

const GREEN = '#32D74B'
const ORANGE = '#FF9F0A'
const RED = '#FF453A'
const GRAY = '#98989D'

export const PILL: Record<ConnKind, { text: string; color: string }> = {
  ok: { text: '已连接', color: GREEN },
  connecting: { text: '连接中', color: ORANGE },
  offline: { text: '重连中', color: ORANGE },
  proto: { text: '协议不兼容', color: RED },
  revoked: { text: 'token 已吊销', color: RED },
  blocked: { text: '未运行', color: RED },
  unbound: { text: '未绑定', color: GRAY },
}

export const CONN_STAT: Record<ConnKind, string> = {
  ok: '在线',
  connecting: '连接中',
  offline: '重连中',
  proto: '已拒绝',
  revoked: '已吊销',
  blocked: '未运行',
  unbound: '未绑定',
}

export function host(server: string | null | undefined) {
  if (!server) return ''
  try {
    return new URL(server).host
  } catch {
    return server
  }
}

export function runBadge(status: RunStatus | null): { text: string; variant: BadgeVariant } {
  switch (status) {
    case null:
      return { text: '准备中', variant: 'secondary' }
    case 'awaiting_approval':
      return { text: '等待审批', variant: 'warning' }
    case 'awaiting_answer':
      return { text: '等待回答', variant: 'warning' }
    default:
      return { text: '运行中', variant: 'info' }
  }
}

export const VENDOR: Record<AgentKind, string> = { claude: 'Anthropic · CLI', codex: 'OpenAI · CLI' }

export const APPROVAL: Record<Approval, string> = {
  ask: '每次询问',
  allowlist: '白名单自动',
  all: '全部自动',
}

const EFFORT: Record<string, string> = {
  default: '默认',
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
}

export const effortLabel = (value: string) => EFFORT[value] ?? value

/** The adapter's name for a model id, else the id itself. */
export function modelName(agent: AgentCard | undefined, value: string) {
  return agent?.catalog?.models.find((m) => m.value === value)?.name ?? value
}

/** What a bot following the agent default runs: the owner's default, else the adapter's own. */
export function agentDefault(agent: AgentCard | undefined) {
  if (agent?.defaultModel) return modelName(agent, agent.defaultModel)
  const current = agent?.catalog?.current
  return current ? `适配器默认（${modelName(agent, current)}）` : '适配器默认'
}

/** `/Users/wl/.aiws/workspaces` → `~/.aiws/workspaces` */
export function tildify(path: string) {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}
