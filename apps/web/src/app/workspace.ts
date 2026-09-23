import type { BotDto, GroupDto, MachineDto, WebEvent } from '@aiws/protocol'
import { create } from 'zustand'

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
    else if (e.t === 'machine.updated') set((s) => ({ machines: upsert(s.machines, e.machine) }))
  },
}))
