import type { BotDto, GroupDto, MachineDto, MessageDto, WebEvent } from '@aiws/protocol'
import { create } from 'zustand'
import { useSession } from './session'

/** Shared lists shown by the shell; feature slices load them and realtime keeps them fresh. */
interface WorkspaceState {
  groups: GroupDto[]
  bots: BotDto[]
  machines: MachineDto[]
  notifCount: number
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
    else if (e.t === 'machine.updated') set((s) => ({ machines: upsert(s.machines, e.machine) }))
  },
}))
