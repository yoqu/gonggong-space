import type {
  BotDto,
  GitChangesDto,
  GitOperationDto,
  GitRefsDto,
  GroupBotStateDto,
  GroupDto,
  UserDto,
} from '@gonggong/protocol'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { useChangeLayout } from '../src/features/git/ChangeTree'
import { useGitDialogs } from '../src/features/git/commands'
import { useCommitDrafts } from '../src/features/git/draft'
import { useToasts } from '../src/ui'
import type { Call } from './mockApi'

/** Shared fixtures of the Git tab tests: a partition group, its bot 小王的 Claude (owner 小王 = u1), refs, changes. */
export const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: true,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

export type Git = NonNullable<GroupBotStateDto['git']>
export const status = (o: Partial<Git> = {}): Git => ({
  branch: 'feat/refund-v2',
  ahead: 3,
  behind: 0,
  dirty: true,
  dirtyCount: 3,
  workspace: 'managed',
  repos: [],
  head: 'a1b2c3d',
  ...o,
})

export const state = (o: Partial<GroupBotStateDto> = {}): GroupBotStateDto => ({
  botId: 'b1',
  workspace: 'managed',
  path: '/w/b1',
  state: 'ready',
  git: status(),
  error: null,
  reason: null,
  tier: null,
  model: null,
  effort: null,
  context: null,
  extraDirs: [],
  ...o,
})

export const branch = (name: string, o: Partial<GitRefsDto['branches'][number]> = {}) => ({
  name,
  kind: 'local' as const,
  current: false,
  upstream: null,
  ahead: null,
  behind: null,
  commit: 'abc',
  subject: 's',
  at: '2026-10-20T00:00:00.000Z',
  ...o,
})

export const REFS: GitRefsDto = {
  branches: [
    branch('main', { upstream: 'origin/main', ahead: 0, behind: 2, subject: '发布 v0.3.6' }),
    branch('feat/refund-v2', { current: true, upstream: 'origin/feat/refund-v2', ahead: 3, behind: 0 }),
    branch('feat/fee', { subject: '手续费' }),
    branch('origin/HEAD', { kind: 'remote' }),
    branch('origin/main', { kind: 'remote' }),
    branch('origin/feat/pay', { kind: 'remote' }),
  ],
  remotes: [{ name: 'origin', url: 'git@git.corp:pay/refund.git' }],
  tags: [
    {
      name: 'v1.2',
      commit: '9f8e7d6',
      annotated: true,
      subject: '发布 v1.2',
      at: '2026-10-19T00:00:00.000Z',
    },
  ],
  recent: ['feat/fee'],
}

export const HEAD_COMMIT = {
  hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  shortHash: 'a1b2c3d',
  message: '修复退款金额\n\n按原路退回。',
  pushed: false,
}

export const CHANGES: GitChangesDto = {
  changes: [
    { path: 'src/a.ts', change: 'modified', oldPath: null, untracked: false, add: 12, del: 3 },
    { path: 'b.ts', change: 'renamed', oldPath: 'old.ts', untracked: false, add: 0, del: 0 },
    { path: 'src/new.ts', change: 'added', oldPath: null, untracked: true, add: 4, del: 0 },
  ],
  conflicts: [],
  ongoing: null,
  head: HEAD_COMMIT,
  limited: false,
}

export const op = (o: Partial<GitOperationDto> = {}): GitOperationDto => ({
  id: 'op1',
  groupId: 'g1',
  botId: 'b1',
  repo: null,
  action: 'push',
  branch: 'main',
  remote: 'origin',
  message: null,
  paths: null,
  args: null,
  pushesBase: true,
  status: 'pending_approval',
  requestedBy: { id: 'u2', name: '老李' },
  decidedBy: null,
  output: null,
  error: null,
  createdAt: '2026-10-21T00:00:00.000Z',
  expiresAt: '2026-10-22T00:00:00.000Z',
  finishedAt: null,
  ...o,
})

let seq = 0
/** What the owner's action answers: done at once, as the action asked (a new operation each time). */
export const done = (b: unknown) =>
  op({
    id: `done-${++seq}`,
    action: (b as { action: GitOperationDto['action'] }).action,
    status: 'succeeded',
    requestedBy: { id: 'u1', name: '小王' },
  })

export const BASE = '/groups/g1/bots/b1/git'

export const setMe = (id: string) => useSession.setState({ user: { id, name: id } as UserDto })

export function resetStores() {
  setMe('u1')
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '小王的 Claude', ownerId: 'u1', ownerName: '小王' } as BotDto],
    groups: [group()],
    botStates: {},
    gitOps: {},
  })
  useWorkbench.setState({ groupId: 'g1', benches: {} })
  useToasts.setState({ items: [] })
  useGitDialogs.setState({ open: null })
  useChangeLayout.setState({ layout: 'tree' })
  useCommitDrafts.setState({ drafts: {} })
  localStorage.clear()
}

export const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /groups/g1/bot-states': [state()],
  'GET /groups/g1/git/operations': { operations: [] },
  [`GET ${BASE}/refs`]: REFS,
  [`GET ${BASE}/changes`]: CHANGES,
  [`GET ${BASE}/diff?from=HEAD&path=src%2Fa.ts`]: { patch: '', truncated: false },
  [`POST ${BASE}/refresh`]: undefined,
  ...extra,
})

export const toasts = () => useToasts.getState().items.map((t) => t.message)
export const actionsCalled = (calls: Call[]) =>
  calls.filter((c) => c.path === `${BASE}/actions`).map((c) => c.body)
export const refreshes = (calls: Call[]) =>
  calls.filter((c) => c.path === `${BASE}/refresh`).map((c) => c.body)
export const benchTabs = () => useWorkbench.getState().benches.g1?.tabs ?? []
