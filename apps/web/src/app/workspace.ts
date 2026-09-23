import type { BotDto, GroupDto, MachineDto, NotificationDto, WebEvent } from '@aiws/protocol'
import { create } from 'zustand'
import { api } from '../lib/api'

/** Shared lists shown by the shell; feature slices load them and realtime keeps them fresh. */
interface WorkspaceState {
  groups: GroupDto[]
  bots: BotDto[]
  machines: MachineDto[]
  notifCount: number
  applyEvent: (e: WebEvent) => void
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

export const useWorkspace = create<WorkspaceState>()((set) => ({
  groups: [],
  bots: [],
  machines: [],
  notifCount: 0,
  applyEvent(e) {
    if (e.t === 'group.updated') set((s) => ({ groups: upsert(s.groups, e.group) }))
    else if (e.t === 'bot.updated') set((s) => ({ bots: upsert(s.bots, e.bot) }))
    else if (e.t === 'bot.removed') set((s) => ({ bots: s.bots.filter((b) => b.id !== e.botId) }))
    else if (e.t === 'notification.new') set((s) => ({ notifCount: s.notifCount + 1 }))
    else if (e.t === 'machine.updated') set((s) => ({ machines: upsert(s.machines, e.machine) }))
  },
}))

const unread = async () =>
  (await api.get<NotificationDto[]>('/notifications')).filter((n) => !n.readAt).length

/** Initial snapshot after login; realtime events keep it fresh afterwards. */
export async function loadWorkspace() {
  const [bots, machines, notifCount] = await Promise.all([
    api.get<BotDto[]>('/bots'),
    api.get<MachineDto[]>('/machines'),
    unread(),
  ])
  useWorkspace.setState({ bots, machines, notifCount })
}

/** Re-counts unread notifications after an action that resolves some of them server-side. */
export async function refreshNotifCount() {
  useWorkspace.setState({ notifCount: await unread() })
}
