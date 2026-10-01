import {
  type AgentKind,
  type BotAvatar,
  type BotDto,
  compareVersions,
  type MachineDto,
  type TriggerScope,
} from '@gonggong/protocol'
import { refreshNotifCount, useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { toast } from '../../ui'

export const AGENTS: AgentKind[] = ['claude', 'codex']
export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }
const AGENT_CLI: Record<AgentKind, string> = { claude: 'claude-code', codex: 'codex' }

export const BINDING_LABEL: Record<BotDto['binding'], string> = {
  bound: t('已绑定'),
  pending_confirm: t('待确认'),
  pending_bind: t('待绑定'),
}

export const PRESENCE: Record<BotDto['presence'], { label: string; color: string }> = {
  online: { label: t('在线空闲'), color: 'var(--system-green)' },
  running: { label: t('运行中'), color: 'var(--system-blue)' },
  offline: { label: t('离线'), color: 'var(--system-gray)' },
  agent_missing: { label: t('agent 缺失'), color: 'var(--system-orange)' },
  pending_bind: { label: t('不可触发'), color: 'var(--system-gray)' },
  pending_confirm: { label: t('不可触发'), color: 'var(--system-gray)' },
}

const SHORT_STATE: Partial<Record<BotDto['presence'], string>> = {
  online: t('在线'),
  running: t('运行中'),
  offline: t('离线'),
  agent_missing: t('agent 缺失'),
}

/** Sidebar line, e.g. `wanglei-mbp · 在线`, or the binding state while not bound; missing parts are left out. */
export const botStateText = (b: BotDto) =>
  b.binding === 'bound'
    ? [b.machineName, SHORT_STATE[b.presence]].filter(Boolean).join(' · ')
    : BINDING_LABEL[b.binding]

export const agentLine = (b: BotDto) => [AGENT_LABEL[b.agentKind], b.agentVersion].filter(Boolean).join(' ')
export const agentCliVersion = (b: BotDto) =>
  b.agentVersion ? `${AGENT_CLI[b.agentKind]} ${b.agentVersion}` : '--'

/** The reported CLI is older than the bundled ACP adapter supports. */
export const agentOutdated = (b: BotDto) =>
  !!b.agentVersion && !!b.agentMinVersion && compareVersions(b.agentVersion, b.agentMinVersion) < 0

export const reportedAgent = (m: MachineDto, kind: AgentKind) =>
  m.agents.find((a) => a.kind === kind && a.available)

const saveBot = (bot: BotDto) => {
  useWorkspace.getState().applyEvent({ t: 'bot.updated', bot })
  return bot
}

export const botsApi = {
  create: (body: {
    name: string
    ownerId: string
    agentKind: AgentKind
    machineId: string | null
    systemPrompt: string
    avatar: BotAvatar
    model: string | null
    effort: string | null
  }) => api.post<BotDto>('/bots', body).then(saveBot),
  update: (
    id: string,
    body: Partial<
      Pick<
        BotDto,
        | 'avatar'
        | 'systemPrompt'
        | 'tier'
        | 'triggerScope'
        | 'triggerList'
        | 'model'
        | 'effort'
        | 'concurrency'
        | 'approval'
        | 'allowlist'
      >
    >,
  ) => api.patch<BotDto>(`/bots/${id}`, body).then(saveBot),
  setDefaultWorkspace: (id: string, path: string | null) =>
    api.put<BotDto>(`/bots/${id}/default-workspace`, { path }).then(saveBot),
  remove: async (id: string) => {
    await api.del(`/bots/${id}`)
    useWorkspace.getState().applyEvent({ t: 'bot.removed', botId: id })
  },
  confirm: async (id: string) => {
    const bot = saveBot(await api.post<BotDto>(`/bots/${id}/confirm`))
    await refreshNotifCount()
    return bot
  },
}

export const confirmBot = (id: string) =>
  botsApi
    .confirm(id)
    .then((b) => toast({ type: 'success', message: t('{name} 已确认', { name: b.name }) }))
    .catch(toastError)

export const TRIGGER_SCOPE_LABEL: Record<TriggerScope, string> = {
  all: t('任何群成员'),
  list: t('指定名单'),
  self: t('仅本人'),
}
