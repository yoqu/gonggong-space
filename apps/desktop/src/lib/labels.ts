import type { AgentKind, Approval, RunStatus } from '@gonggong/protocol'
import type { BadgeVariant } from '@web/ui'
import { t } from '../i18n'
import type { Snapshot } from '../ipc'

export const AGENTS: Record<AgentKind, { name: string }> = {
  claude: { name: 'Claude Code' },
  codex: { name: 'Codex' },
}

export type ConnKind = 'ok' | 'connecting' | 'offline' | 'proto' | 'revoked' | 'blocked' | 'unbound'

export function connKind(s: Snapshot): ConnKind {
  if (s.phase !== 'running') return s.phase
  const c = s.status.conn
  if (c.state === 'online') return 'ok'
  if (c.state === 'rejected') return c.reason === 'protocol' ? 'proto' : 'revoked'
  return c.state
}

const GREEN = 'var(--system-green)'
const ORANGE = 'var(--system-orange)'
const RED = 'var(--system-red)'
const GRAY = 'var(--system-gray)'

export const PILL: Record<ConnKind, { text: string; color: string }> = {
  ok: { text: t('已连接'), color: GREEN },
  connecting: { text: t('连接中'), color: ORANGE },
  offline: { text: t('重连中'), color: ORANGE },
  proto: { text: t('协议不兼容'), color: RED },
  revoked: { text: t('token 已吊销'), color: RED },
  blocked: { text: t('未运行'), color: RED },
  unbound: { text: t('未绑定'), color: GRAY },
}

export const CONN_STAT: Record<ConnKind, string> = {
  ok: t('在线'),
  connecting: t('连接中'),
  offline: t('重连中'),
  proto: t('已拒绝'),
  revoked: t('已吊销'),
  blocked: t('未运行'),
  unbound: t('未绑定'),
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
      return { text: t('准备中'), variant: 'secondary' }
    case 'awaiting_approval':
      return { text: t('等待审批'), variant: 'warning' }
    case 'awaiting_answer':
      return { text: t('等待回答'), variant: 'warning' }
    default:
      return { text: t('运行中'), variant: 'info' }
  }
}

/** 在 Finder 中显示, in the platform's words. */
export function revealLabel(os: string | undefined) {
  if (os === 'windows') return t('在资源管理器中显示')
  if (os === 'linux') return t('在文件管理器中显示')
  return t('在 Finder 中显示')
}

export const VENDOR: Record<AgentKind, string> = { claude: 'Anthropic · CLI', codex: 'OpenAI · CLI' }

export const APPROVAL: Record<Approval, string> = {
  ask: t('每次询问'),
  allowlist: t('白名单自动'),
  all: t('全部自动'),
}

/** `/Users/wl/.gonggong/workspaces` → `~/.gonggong/workspaces` */
export function tildify(path: string) {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}
