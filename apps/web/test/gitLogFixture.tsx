import type {
  BotDto,
  GitBranch,
  GitCommit,
  GitRefsDto,
  GitStatus,
  GitTag,
  GroupBotStateDto,
  GroupDto,
  UserDto,
} from '@gonggong/protocol'
import { act, render, within } from '@testing-library/react'
import { vi } from 'vitest'
import { useSession } from '../src/app/session'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { useGitDialogs } from '../src/features/git/commands'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'

/** A full hash made of one character. */
export const hash = (c: string) => c.repeat(40)
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export const commit = (c: string, o: Partial<GitCommit> = {}): GitCommit => ({
  hash: hash(c),
  shortHash: c.repeat(7),
  author: '小王',
  email: 'w@corp',
  at: '2026-10-20T00:00:00.000Z',
  subject: `提交 ${c}`,
  parents: [],
  refs: [],
  ...o,
})

export const branch = (name: string, o: Partial<GitBranch> = {}): GitBranch => ({
  name,
  kind: 'local',
  current: false,
  upstream: null,
  ahead: null,
  behind: null,
  commit: 'a',
  subject: '',
  at: '',
  ...o,
})

export const tag = (name: string, o: Partial<GitTag> = {}): GitTag => ({
  name,
  commit: hash('1'),
  annotated: false,
  subject: '',
  at: '',
  ...o,
})

export const REFS: GitRefsDto = {
  branches: [
    branch('feat/x', { current: true, upstream: 'origin/feat/x', ahead: 2, behind: 0 }),
    branch('main', { upstream: 'origin/main', ahead: 0, behind: 3 }),
    branch('fix/a'),
    branch('origin/main', { kind: 'remote' }),
    branch('origin/feat/x', { kind: 'remote' }),
    branch('origin/HEAD', { kind: 'remote' }),
  ],
  remotes: [{ name: 'origin', url: 'git@x:r.git' }],
  tags: [tag('v1.0')],
  recent: [],
}

/** Five commits, newest first: 1 (HEAD) ← 2 ← 3, a merge of 4 (main) and 5 (origin/fix/a), both off 6. */
export const LOG: GitCommit[] = [
  commit('1', { parents: [hash('2')], refs: ['HEAD -> feat/x', 'origin/feat/x'] }),
  commit('2', { parents: [hash('3')], author: '老李', email: 'li@corp' }),
  commit('3', { parents: [hash('4'), hash('5')], subject: 'Merge branch fix/a', refs: ['tag: v1.0'] }),
  commit('4', { parents: [hash('6')], refs: ['main', 'origin/main'] }),
  commit('5', { parents: [hash('6')], refs: ['origin/fix/a'] }),
]

type Route = (q: URLSearchParams, body: unknown) => unknown

/**
 * Stubs fetch for bot b1 of group g1: `routes` are keyed `METHOD git/<route>` (the part after `…/bots/b1/`); GETs are
 * recorded in full (`/api/…?…`), other requests with their body.
 */
export function serve(routes: Record<string, Route>) {
  const calls: string[] = []
  const posts: { path: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x')
      const method = init?.method ?? 'GET'
      const rel = u.pathname.replace('/api/groups/g1/bots/b1/', '')
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (method === 'GET') calls.push(`${u.pathname}${u.search}`)
      else posts.push({ path: rel, body })
      const route = routes[`${method} ${rel}`]
      if (!route) {
        if (method === 'POST' && rel === 'git/refresh') return new Response(null, { status: 204 })
        return new Response(JSON.stringify({ error: 'not_found', message: rel }), { status: 404 })
      }
      const out = route(u.searchParams, body)
      if (out instanceof Response) return out
      return out === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(out))
    }),
  )
  return { calls, posts }
}

export const conflict = (message: string) =>
  new Response(JSON.stringify({ error: 'conflict', message }), { status: 409 })

/** The diff of one file between two versions, its lines naming them: `-from:path` / `+to:path`. */
export const fakeDiff = (q: URLSearchParams) => {
  const path = q.get('path') ?? ''
  return {
    patch: [
      `diff --git a/${path} b/${path}`,
      '@@ -1 +1 @@',
      `-${q.get('from')}:${path}`,
      `+${q.get('to') ?? 'ws'}:${path}`,
      '',
    ].join('\n'),
    truncated: false,
  }
}

const git = (o: Partial<GitStatus> = {}): GitStatus => ({
  branch: 'feat/x',
  ahead: 2,
  behind: 0,
  dirty: false,
  workspace: 'managed',
  repos: [],
  checkedAt: '2026-10-23T00:00:00.000Z',
  ...o,
})

/** Group g1 with bot b1 (owned by u1), its git status, and the signed-in user (u2 by default: not the owner). */
export function seed(o: { owner?: boolean; git?: Partial<GitStatus> } = {}) {
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '小王的 Claude', ownerId: 'u1', ownerName: '小王' } as BotDto],
    botStates: { g1: { b1: { botId: 'b1', git: git(o.git) } as GroupBotStateDto } },
    groups: [{ id: 'g1', mode: 'partition', repo: { url: 'git@x:r.git', branch: 'main' } } as GroupDto],
  })
  useSession.setState({ user: { id: o.owner ? 'u1' : 'u2' } as UserDto })
  useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
  useGitDialogs.setState({ open: null })
  localStorage.removeItem('gg.git.log.branch')
  localStorage.removeItem('gg.git.log.view')
}

function Bench() {
  const tabs = useWorkbench((s) => s.benches.g1?.tabs ?? [])
  return (
    <>
      {tabs.map((t) => (
        <section key={tabKey(t)} data-testid={tabKey(t)}>
          <TabLabel tab={t}>{(m) => <h2 data-icon={m.icon}>{m.title}</h2>}</TabLabel>
          <TabContent tab={t} active />
        </section>
      ))}
    </>
  )
}

/** Opens `tab` in the workbench and renders every open tab; returns the queries inside the tab. */
export function open(tab: WorkbenchTab) {
  act(() => {
    useWorkbench.getState().show(tab)
  })
  render(<Bench />)
  return within(document.querySelector<HTMLElement>(`[data-testid="${tabKey(tab)}"]`) as HTMLElement)
}

export const tabs = () => useWorkbench.getState().benches.g1?.tabs ?? []
export const logTab = () =>
  tabs().find((t) => t.kind === 'git-log') as Extract<WorkbenchTab, { kind: 'git-log' }>
export const dialog = () => useGitDialogs.getState().open?.dialog

/** The shown diff's lines (syntax highlighting splits them into tokens). */
export const diffText = (scope: ReturnType<typeof within>) =>
  Array.from(
    scope.queryByTestId('git-diff')?.querySelectorAll('.diff__line') ?? [],
    (l: Element) => l.textContent,
  ).join('\n')

/** Lays every measured element out `px` wide. */
export function width(px: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  return vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px)
}

/** The log calls made, without the `/api/groups/g1/bots/b1/git/log?` prefix. */
export const logCalls = (calls: string[]) =>
  calls.filter((c) => c.includes('/git/log?')).map((c) => c.replace('/api/groups/g1/bots/b1/git/log?', ''))
