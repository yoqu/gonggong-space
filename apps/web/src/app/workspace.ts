import {
  type BotDto,
  type GitOperationDto,
  type GitOperationsDto,
  type GroupBotStateDto,
  type GroupDto,
  type GroupPinsDto,
  LIVE_RUN_STATUSES,
  liveRunOf,
  type MachineDto,
  type MessageDto,
  type NotificationUnreadDto,
  type PinnedMessageDto,
  type RunDto,
  type WebEvent,
} from '@gonggong/protocol'
import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { gitOperationSettled } from '../features/git/notify'
import { otherTeam, refreshTeamsSoon } from '../features/teams/store'
import { t } from '../i18n'
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
  /** Per-group manual git operations, newest first: pending ones and the latest settled. */
  gitOps: Record<string, GitOperationDto[]>
  /** Per-group pinned messages (消息置顶), newest pin first. */
  pins: Record<string, PinnedMessageDto[]>
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
  const me = useSession.getState().user?.id
  const counts = m.kind !== 'event' && m.authorId !== me && g.id !== activeGroupId
  const lastI18n = m.kind === 'event' ? m.i18n : undefined
  const mentioned = counts && !!me && !!m.userMentions?.includes(me)
  return {
    ...g,
    lastSeq: m.seq,
    last: previewOf(m),
    lastI18n,
    lastAt: m.createdAt,
    unread: g.unread + (counts ? 1 : 0),
    mentionCount: Math.min(99, (g.mentionCount ?? 0) + (mentioned ? 1 : 0)),
  }
}

/** A row's number: a group's unread @ of me, a DM's unread messages (plan 未读与通知). */
export const rowCount = (g: Pick<GroupDto, 'kind' | 'unread' | 'mentionCount'>) =>
  g.kind === 'dm' ? g.unread : (g.mentionCount ?? 0)

/** What adds to the totals: rows whose 通知 is off only show theirs, greyed. */
export const alertCount = (g: Pick<GroupDto, 'kind' | 'unread' | 'mentionCount' | 'notifyLevel'>) =>
  g.notifyLevel === 'off' ? 0 : rowCount(g)

export const lastText = (g: Pick<GroupDto, 'last' | 'lastI18n'>) => (g.lastI18n ? t.text(g.lastI18n) : g.last)

const LIVE: RunDto['status'][] = ['running', 'awaiting_approval', 'awaiting_answer']

/** Unchanged groups keep their identity, and the list its own when none changed, so rows don't re-render. */
const mapGroups = (groups: GroupDto[], f: (g: GroupDto) => GroupDto) => {
  const next = groups.map(f)
  return next.some((g, i) => g !== groups[i]) ? next : groups
}

function withRun(g: GroupDto, run: RunDto, bots: BotDto[]): GroupDto {
  if (g.id !== run.groupId) return g
  const had = g.liveRunIds.includes(run.id)
  const liveRunIds =
    LIVE.includes(run.status) === had
      ? g.liveRunIds
      : had
        ? g.liveRunIds.filter((id) => id !== run.id)
        : [...g.liveRunIds, run.id]
  const current = g.liveRuns.find((r) => r.id === run.id)
  const me = useSession.getState().user?.id ?? ''
  const owner = bots.find((b) => b.id === run.botId)?.ownerId ?? null
  const next = LIVE_RUN_STATUSES.includes(run.status) ? liveRunOf(run, me, owner) : null
  // Most updates only move the step or usage, which the list doesn't show.
  const liveRuns = !next
    ? current
      ? g.liveRuns.filter((r) => r !== current)
      : g.liveRuns
    : !current
      ? [...g.liveRuns, next]
      : shallow(current, next)
        ? g.liveRuns
        : g.liveRuns.map((r) => (r === current ? next : r))
  return liveRunIds === g.liveRunIds && liveRuns === g.liveRuns ? g : { ...g, liveRunIds, liveRuns }
}

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  groups: [],
  bots: [],
  machines: [],
  notifCount: 0,
  loaded: false,
  botStates: {},
  gitOps: {},
  pins: {},
  activeGroupId: null,
  setActiveGroup: (activeGroupId) => set({ activeGroupId }),
  applyEvent(e) {
    // Events of the user's other teams only move those teams' unread counts.
    if (e.t === 'group.updated') {
      if (otherTeam(e.group.teamId)) refreshTeamsSoon()
      else set((s) => ({ groups: upsert(s.groups, e.group) }))
    } else if (e.t === 'group.removed') set((s) => ({ groups: s.groups.filter((g) => g.id !== e.groupId) }))
    else if (e.t === 'message.new') {
      const s = get()
      // A thread reply lives in its thread: neither the last line nor unread (plan 话题).
      if (e.message.threadRootId && !e.message.alsoSent) return
      if (!s.groups.some((g) => g.id === e.message.groupId)) refreshTeamsSoon()
      else {
        const groups = mapGroups(s.groups, (g) =>
          g.id === e.message.groupId ? withMessage(g, e.message, s.activeGroupId) : g,
        )
        if (groups !== s.groups) set({ groups })
      }
    } else if (e.t === 'run.updated') {
      const s = get()
      const groups = mapGroups(s.groups, (g) => withRun(g, e.run, s.bots))
      if (groups !== s.groups) set({ groups })
    } else if (e.t === 'bot.updated') {
      if (!otherTeam(e.bot.teamId)) set((s) => ({ bots: upsert(s.bots, e.bot) }))
    } else if (e.t === 'bot.removed') set((s) => ({ bots: s.bots.filter((b) => b.id !== e.botId) }))
    else if (e.t === 'notification.new') {
      if (otherTeam(e.notification.teamId)) refreshTeamsSoon()
      else set((s) => ({ notifCount: s.notifCount + 1 }))
    }
    // `unread` counts every team, the badge only the open one and platform notices.
    else if (e.t === 'notification.resolved') {
      if ((useSession.getState().tenancy?.teams.length ?? 0) > 1)
        refreshNotifCount().catch((err: Error) => console.warn('notification count refresh failed:', err))
      else set({ notifCount: e.unread })
    } else if (e.t === 'machine.updated') set((s) => ({ machines: upsert(s.machines, e.machine) }))
    else if (e.t === 'machine.removed')
      set((s) => ({ machines: s.machines.filter((m) => m.id !== e.machineId) }))
    else if (e.t === 'group.botState')
      set((s) => ({
        botStates: {
          ...s.botStates,
          [e.groupId]: { ...s.botStates[e.groupId], [e.state.botId]: e.state },
        },
        groups: mapGroups(s.groups, (g) =>
          g.id === e.groupId &&
          g.kind === 'dm' &&
          g.botIds[0] === e.state.botId &&
          g.workspacePath !== e.state.path
            ? { ...g, workspacePath: e.state.path }
            : g,
        ),
      }))
    else if (e.t === 'group.pins') set((s) => ({ pins: { ...s.pins, [e.groupId]: e.pins } }))
    else if (e.t === 'group.gitOperation') {
      set((s) => ({ gitOps: { ...s.gitOps, [e.groupId]: upsertOp(s.gitOps[e.groupId], e.operation) } }))
      gitOperationSettled(e.operation, get().bots)
    }
  },
}))

/** Keeps the list newest first; a known operation is replaced in place. */
export const upsertOp = (list: GitOperationDto[] | undefined, op: GitOperationDto) =>
  list?.some((o) => o.id === op.id) ? list.map((o) => (o.id === op.id ? op : o)) : [op, ...(list ?? [])]

export function putGitOperation(op: GitOperationDto) {
  useWorkspace.setState((s) => ({
    gitOps: { ...s.gitOps, [op.groupId]: upsertOp(s.gitOps[op.groupId], op) },
  }))
}

export async function loadGitOperations(groupId: string) {
  const { operations } = await api.get<GitOperationsDto>(`/groups/${groupId}/git/operations`)
  useWorkspace.setState((s) => ({ gitOps: { ...s.gitOps, [groupId]: operations } }))
}

export const setPins = (groupId: string, pins: PinnedMessageDto[]) =>
  useWorkspace.setState((s) => ({ pins: { ...s.pins, [groupId]: pins } }))

export async function loadPins(groupId: string) {
  setPins(groupId, (await api.get<GroupPinsDto>(`/groups/${groupId}/pins`)).pins)
}

export async function loadBotStates(groupId: string) {
  const list = await api.get<GroupBotStateDto[]>(`/groups/${groupId}/bot-states`)
  useWorkspace.setState((s) => ({
    botStates: { ...s.botStates, [groupId]: Object.fromEntries(list.map((b) => [b.botId, b])) },
  }))
}

const unread = async () => (await api.get<NotificationUnreadDto>('/notifications/unread')).n

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
