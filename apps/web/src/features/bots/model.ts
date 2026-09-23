import type { AgentKind, BotDto, MachineDto } from '@aiws/protocol'
import { refreshNotifCount, useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'

export const AGENTS: AgentKind[] = ['claude', 'codex']
export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }
const AGENT_CLI: Record<AgentKind, string> = { claude: 'claude-code', codex: 'codex' }

export const BINDING_LABEL: Record<BotDto['binding'], string> = {
  bound: '已绑定',
  pending_confirm: '待确认',
  pending_bind: '待绑定',
}

export const PRESENCE: Record<BotDto['presence'], { label: string; color: string }> = {
  online: { label: '在线空闲', color: '#32D74B' },
  running: { label: '运行中', color: '#0A84FF' },
  offline: { label: '离线', color: '#636366' },
  agent_missing: { label: 'agent 缺失', color: '#FF9F0A' },
  pending_bind: { label: '不可触发', color: '#636366' },
  pending_confirm: { label: '不可触发', color: '#636366' },
}

const SHORT_STATE: Partial<Record<BotDto['presence'], string>> = {
  online: '在线',
  running: '运行中',
  offline: '离线',
  agent_missing: 'agent 缺失',
}

/** Sidebar line, e.g. `wanglei-mbp · 在线`, or the binding state while not bound. */
export const botStateText = (b: BotDto) =>
  b.binding === 'bound' ? `${b.machineName} · ${SHORT_STATE[b.presence]}` : BINDING_LABEL[b.binding]

export const agentLine = (b: BotDto) => [AGENT_LABEL[b.agentKind], b.agentVersion].filter(Boolean).join(' ')
export const agentCliVersion = (b: BotDto) =>
  b.agentVersion ? `${AGENT_CLI[b.agentKind]} ${b.agentVersion}` : '—'

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
  }) => api.post<BotDto>('/bots', body).then(saveBot),
  update: (
    id: string,
    body: Partial<Pick<BotDto, 'systemPrompt' | 'tier' | 'triggerScope' | 'triggerList'>>,
  ) => api.patch<BotDto>(`/bots/${id}`, body).then(saveBot),
  confirm: async (id: string) => {
    const bot = saveBot(await api.post<BotDto>(`/bots/${id}/confirm`))
    await refreshNotifCount()
    return bot
  },
}
