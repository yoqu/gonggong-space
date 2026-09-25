import type {
  BotDto,
  GroupBotStateDto,
  GroupDto,
  MachineDto,
  MessageDto,
  NotificationDto,
  WebEvent,
} from '@gonggong/protocol'
import { create } from 'zustand'
import { api } from '../lib/api'
import { useSession } from './session'

/** Shared lists shown by the shell; feature slices load them and realtime keeps them fresh. */
interface WorkspaceState {
  groups: GroupDto[]
  bots: BotDto[]
  machines: MachineDto[]
  notifCount: number
  /** The initial bots/machines snapshot has arrived, so empty lists mean "none" rather than "not yet". */
  loaded: boolean
  /** Per-group workspace state of each bot (groupId → botId → state), loaded when a group is opened. */
  botStates: Record<string, Record<string, GroupBotStateDto>>
  /** The group open in the chat view; its new messages don't count as unread. */
  activeGroupId: string | null
  setActiveGroup: (id: string | null) => void
  applyEvent: (e: WebEvent) => void
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

/** Same one-line preview the server computes for GroupDto.last. */
export const previewOf = (m: Pick<MessageDto, 'kind' | 'authorName' | 'body'>) => {
  const line = m.body.replace(/\n[\s\S]*$/, '').slice(0, 80)
  return m.kind === 'event' ? line : `${m.authorName}：${line}`
}

function withMessage(g: GroupDto, m: MessageDto, activeGroupId: string | null): GroupDto {
  if (m.seq <= g.lastSeq) return g
  const counts = m.kind !== 'event' && m.authorId !== useSession.getState().user?.id && g.id !== activeGroupId
  return { ...g, lastSeq: m.seq, last: previewOf(m), unread: g.unread + (counts ? 1 : 0) }
}

export const useWorkspace = create<WorkspaceState>()((set) => ({
  groups: [],
  bots: [],
  machines: [],
  notifCount: 0,
  loaded: false,
  botStates: {},
  activeGroupId: null,
  setActiveGroup: (activeGroupId) => set({ activeGroupId }),
  applyEvent(e) {
    if (e.t === 'group.updated') set((s) => ({ groups: upsert(s.groups, e.group) }))
    else if (e.t === 'group.removed') set((s) => ({ groups: s.groups.filter((g) => g.id !== e.groupId) }))
    else if (e.t === 'message.new')
      set((s) => ({
        groups: s.groups.map((g) =>
          g.id === e.message.groupId ? withMessage(g, e.message, s.activeGroupId) : g,
        ),
      }))
    else if (e.t === 'bot.updated') set((s) => ({ bots: upsert(s.bots, e.bot) }))
    else if (e.t === 'bot.removed') set((s) => ({ bots: s.bots.filter((b) => b.id !== e.botId) }))
    else if (e.t === 'notification.new') set((s) => ({ notifCount: s.notifCount + 1 }))
    else if (e.t === 'notification.resolved') set({ notifCount: e.unread })
    else if (e.t === 'machine.updated') set((s) => ({ machines: upsert(s.machines, e.machine) }))
    else if (e.t === 'machine.removed')
      set((s) => ({ machines: s.machines.filter((m) => m.id !== e.machineId) }))
    else if (e.t === 'group.botState')
      set((s) => ({
        botStates: {
          ...s.botStates,
          [e.groupId]: { ...s.botStates[e.groupId], [e.state.botId]: e.state },
        },
      }))
  },
}))

export async function loadBotStates(groupId: string) {
  const list = await api.get<GroupBotStateDto[]>(`/groups/${groupId}/bot-states`)
  useWorkspace.setState((s) => ({
    botStates: { ...s.botStates, [groupId]: Object.fromEntries(list.map((b) => [b.botId, b])) },
  }))
}

const unread = async () =>
  (await api.get<NotificationDto[]>('/notifications')).filter((n) => !n.readAt).length

/** Initial snapshot after login; realtime events keep it fresh afterwards. */
export async function loadWorkspace() {
  const [bots, machines, notifCount] = await Promise.all([
    api.get<BotDto[]>('/bots'),
    api.get<MachineDto[]>('/machines'),
    unread(),
  ])
  useWorkspace.setState({ bots, machines, notifCount, loaded: true })
}

/** Re-counts unread notifications after an action that resolves some of them server-side. */
export async function refreshNotifCount() {
  useWorkspace.setState({ notifCount: await unread() })
}
