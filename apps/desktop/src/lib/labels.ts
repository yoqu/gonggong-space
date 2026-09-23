import type { AgentKind, RunStatus } from '@aiws/protocol'
import type { BadgeVariant } from '@web/ui'
import type { Snapshot } from '../ipc'

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

/** 在 Finder 中显示, in the platform's words. */
export function revealLabel(os: string | undefined) {
  if (os === 'windows') return '在资源管理器中显示'
  if (os === 'linux') return '在文件管理器中显示'
  return '在 Finder 中显示'
}

/** `/Users/wl/.aiws/workspaces` → `~/.aiws/workspaces` */
export function tildify(path: string) {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}
