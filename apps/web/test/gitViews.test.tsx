import type { BotDto, FileTreeEntry, GitCommit, GitRefsDto, GroupDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'

const entry = (name: string, o: Partial<FileTreeEntry> = {}): FileTreeEntry => ({
  name,
  dir: false,
  size: 10,
  mtime: 0,
  uncommitted: false,
  ignored: false,
  ...o,
})

const commit = (n: number, o: Partial<GitCommit> = {}): GitCommit => ({
  hash: `${n}`.repeat(40),
  shortHash: `${n}`.repeat(7),
  author: '小王',
  email: 'w@corp',
  at: '2026-10-20T00:00:00.000Z',
  subject: `提交 ${n}`,
  parents: [`${n + 1}`.repeat(40)],
  refs: [],
  ...o,
})

const REFS: GitRefsDto = {
  branches: [
    {
      name: 'feat/x',
      kind: 'local',
      current: true,
      upstream: null,
      ahead: null,
      behind: null,
      commit: 'a',
      subject: '',
      at: '',
    },
    {
      name: 'main',
      kind: 'local',
      current: false,
      upstream: null,
      ahead: null,
      behind: null,
      commit: 'b',
      subject: '',
      at: '',
    },
  ],
  remotes: [{ name: 'origin', url: 'git@x:r.git' }],
  tags: [],
  recent: [],
}

let calls: string[]
beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const u = new URL(url, 'http://x')
      const q = (k: string) => u.searchParams.get(k)
      const json = (v: unknown) => new Response(JSON.stringify(v))
      const base = '/api/groups/g1/bots/b1'
      switch (u.pathname) {
        case `${base}/git/refs`:
          return json(REFS)
        case `${base}/git/log`:
          if (q('ref') === 'main') return json({ commits: [commit(7)], hasMore: false })
          return q('skip') === '2'
            ? json({ commits: [commit(3, { parents: [] })], hasMore: false })
            : json({
                commits: [commit(1, { refs: ['HEAD -> feat/x', 'origin/feat/x'] }), commit(2)],
                hasMore: true,
              })
        case `${base}/git/compare`:
          return json({
            changes:
              q('from') === 'main'
                ? [
                    { path: 'README.md', change: 'modified', oldPath: null },
                    { path: 'src/new.ts', change: 'added', oldPath: null },
                    { path: 'old.ts', change: 'deleted', oldPath: null },
                  ]
                : [
                    { path: 'src/a.ts', change: 'modified', oldPath: null },
                    { path: 'b.ts', change: 'renamed', oldPath: 'a.ts' },
                    { path: 'gone.ts', change: 'deleted', oldPath: null },
                  ],
          })
        case `${base}/git/diff`: {
          const path = q('path') ?? ''
          const patch = [
            `diff --git a/${path} b/${path}`,
            '@@ -1 +1 @@',
            `-${q('from')}:${path}`,
            `+${q('to') ?? 'ws'}:${path}`,
            '',
          ].join('\n')
          return json({ patch, truncated: false })
        }
        case `${base}/git/tree`:
        case `${base}/files/tree`: {
          const path = q('path') ?? ''
          const entries =
            path === ''
              ? [entry('src', { dir: true }), entry('README.md'), entry('LICENSE')]
              : [entry('new.ts')]
          return json({ path, entries, truncated: false })
        }
        case `${base}/git/text`:
        case `${base}/files/text`:
          return json({
            path: q('path'),
            size: 3,
            binary: false,
            mime: 'text/plain',
            text: `${q('ref') ?? 'ws'}:${q('path')}`,
          })
      }
      return new Response('{}', { status: 404 })
    }),
  )
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto],
    botStates: {},
    groups: [{ id: 'g1', mode: 'partition', repo: { url: 'git@x:r.git', branch: 'main' } } as GroupDto],
  })
  useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
})
afterEach(() => vi.unstubAllGlobals())

const current = () => useWorkbench.getState().benches.g1?.tabs ?? []
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** The shown diff's lines, one per line (syntax highlighting splits them into tokens). */
const diffText = (scope: ReturnType<typeof within>) =>
  Array.from(
    scope.queryByTestId('git-diff')?.querySelectorAll('.diff__line') ?? [],
    (l: Element) => l.textContent,
  ).join('\n')
/** Lays every measured element out `px` wide. */
function narrow(px: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  return vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px)
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
const open = (t: WorkbenchTab) => {
  act(() => {
    useWorkbench.getState().show(t)
  })
  return render(<Bench />)
}

describe('commit history tab', () => {
  it('pages the log, switches the ref and shows a commit’s changed files', async () => {
    open({ kind: 'git-log', botId: 'b1', ref: null, commit: null })
    const tab = within(screen.getByTestId('git-log:b1'))
    expect(tab.getByRole('heading', { level: 2 }).textContent).toBe('提交历史 · 小王的 Claude')
    const first = await tab.findByRole('option', { name: /提交 1/ })
    expect(calls).toContain('/api/groups/g1/bots/b1/git/log?skip=0')
    expect(first.textContent).toContain('1111111')
    expect(first.textContent).toContain('小王')
    // HEAD's branch and its remote twin share one label.
    const label = await within(first).findByText('origin & feat/x')
    expect(label.closest('[data-ref]')?.getAttribute('data-ref')).toBe('current')

    fireEvent.click(tab.getByRole('button', { name: '加载更多' }))
    expect(await tab.findByRole('option', { name: /提交 3/ })).toBeTruthy()
    expect(calls).toContain('/api/groups/g1/bots/b1/git/log?skip=2')
    expect(tab.queryByRole('button', { name: '加载更多' })).toBeNull()

    fireEvent.click(tab.getByRole('option', { name: /提交 2/ }))
    expect(current()[0]).toMatchObject({ commit: '2'.repeat(40) })
    const files = within(await tab.findByRole('region', { name: '变更文件' }))
    expect(calls).toContain(`/api/groups/g1/bots/b1/git/compare?from=${'3'.repeat(40)}&to=${'2'.repeat(40)}`)
    expect(files.getByRole('button', { name: '修改：src/a.ts' }).textContent).toContain('M')
    expect(files.getByRole('button', { name: '重命名：b.ts' }).getAttribute('title')).toBe('a.ts → b.ts')

    // The first file's diff against the first parent shows right away.
    expect(files.getByRole('button', { name: '修改：src/a.ts' }).getAttribute('aria-current')).toBe('true')
    await waitFor(() => expect(diffText(tab)).toContain(`+${'2'.repeat(40)}:src/a.ts`))
    expect(diffText(tab)).toContain(`-${'3'.repeat(40)}:src/a.ts`)
    expect(calls).toContain(
      `/api/groups/g1/bots/b1/git/diff?from=${'3'.repeat(40)}&to=${'2'.repeat(40)}&path=src%2Fa.ts&context=100000`,
    )

    fireEvent.click(files.getByRole('button', { name: '删除：gone.ts' }))
    expect(current()[0]).toMatchObject({ file: 'gone.ts' })
    await waitFor(() => expect(diffText(tab)).toContain(`-${'3'.repeat(40)}:gone.ts`))

    // 打开此版本 opens the file as of the commit; a deleted file as of the parent.
    fireEvent.click(tab.getByRole('button', { name: '打开此版本' }))
    expect(current().at(-1)).toEqual({
      kind: 'file',
      source: { botId: 'b1', path: 'gone.ts', rev: '3'.repeat(40) },
    })
    fireEvent.click(files.getByRole('button', { name: '修改：src/a.ts' }))
    fireEvent.click(tab.getByRole('button', { name: '打开此版本' }))
    expect(current().at(-1)).toEqual({
      kind: 'file',
      source: { botId: 'b1', path: 'src/a.ts', rev: '2'.repeat(40) },
    })
    expect(await screen.findByText(`${'2'.repeat(40)}:src/a.ts`)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'a.ts @ 2222222' })).toBeTruthy()

    // Another commit starts on its own first file.
    fireEvent.click(tab.getByRole('option', { name: /提交 1/ }))
    expect(current()[0]).toMatchObject({ commit: '1'.repeat(40), file: null })

    fireEvent.click(within(tab.getByRole('region', { name: '分支' })).getByRole('button', { name: 'main' }))
    expect(await tab.findByRole('option', { name: /提交 7/ })).toBeTruthy()
    expect(calls).toContain('/api/groups/g1/bots/b1/git/log?ref=main&skip=0')
  })

  it('compares a root commit against the empty tree', async () => {
    open({ kind: 'git-log', botId: 'b1', ref: null, commit: null })
    const tab = within(screen.getByTestId('git-log:b1'))
    await tab.findByRole('option', { name: /提交 1/ })
    fireEvent.click(tab.getByRole('button', { name: '加载更多' }))
    fireEvent.click(await tab.findByRole('option', { name: /提交 3/ }))
    await waitFor(() => expect(diffText(tab)).toContain(`-${EMPTY_TREE}:src/a.ts`))
    expect(calls).toContain(`/api/groups/g1/bots/b1/git/compare?from=${EMPTY_TREE}&to=${'3'.repeat(40)}`)
  })

  it('keeps the picked file in the tab and walks list → commit → file when narrow', async () => {
    const width = narrow(600)
    open({ kind: 'git-log', botId: 'b1', ref: null, commit: '2'.repeat(40), file: 'b.ts' })
    const tab = within(screen.getByTestId('git-log:b1'))
    await waitFor(() => expect(diffText(tab)).toContain(`+${'2'.repeat(40)}:b.ts`))
    // A rename is read as one file from its old path.
    expect(calls).toContain(
      `/api/groups/g1/bots/b1/git/diff?from=${'3'.repeat(40)}&to=${'2'.repeat(40)}&path=b.ts&oldPath=a.ts&context=100000`,
    )
    expect(tab.queryByRole('option', { name: /提交 1/ })).toBeNull()
    expect(tab.queryByRole('region', { name: '变更文件' })).toBeNull()

    fireEvent.click(tab.getByRole('button', { name: '返回提交详情' }))
    expect(current()[0]).toMatchObject({ commit: '2'.repeat(40), file: null })
    const files = within(await tab.findByRole('region', { name: '变更文件' }))
    expect(tab.queryByTestId('git-diff')).toBeNull()
    fireEvent.click(files.getByRole('button', { name: '修改：src/a.ts' }))
    expect(current()[0]).toMatchObject({ file: 'src/a.ts' })
    await waitFor(() => expect(diffText(tab)).toContain(`+${'2'.repeat(40)}:src/a.ts`))

    fireEvent.click(tab.getByRole('button', { name: '返回提交详情' }))
    fireEvent.click(await tab.findByRole('button', { name: '全部提交' }))
    expect(current()[0]).toMatchObject({ commit: null, file: null })
    expect(await tab.findByRole('option', { name: /提交 1/ })).toBeTruthy()
    width.mockRestore()
  })
})

describe('files tab versions', () => {
  it('offers versions only in partition groups with a repo', async () => {
    useWorkspace.setState({ groups: [{ id: 'g1', mode: 'force', repo: null } as unknown as GroupDto] })
    open({ kind: 'files', botId: 'b1', dir: '', selected: null })
    const files = within(screen.getByTestId('files:b1'))
    await files.findByRole('treeitem', { name: /README/ })
    expect(files.queryByRole('button', { name: '版本' })).toBeNull()
    expect(files.queryByRole('button', { name: '对比' })).toBeNull()
  })

  it('browses a branch through the git routes', async () => {
    open({ kind: 'files', botId: 'b1', dir: '', selected: null })
    const files = within(screen.getByTestId('files:b1'))
    await files.findByRole('treeitem', { name: /README/ })
    fireEvent.click(files.getByRole('button', { name: '版本' }))
    const pop = within(await screen.findByRole('dialog', { name: '版本' }))
    fireEvent.click(await pop.findByRole('button', { name: /^main/ }))
    expect(current()[0]).toMatchObject({ rev: 'main' })
    fireEvent.click(await files.findByRole('treeitem', { name: /README/ }))
    expect(calls).toContain('/api/groups/g1/bots/b1/git/tree?ref=main&path=')
    expect(await files.findByText('main:README.md')).toBeTruthy()
    expect(calls).toContain('/api/groups/g1/bots/b1/git/text?ref=main&path=README.md')
    expect(files.queryByRole('searchbox', { name: '搜索文件' })).toBeNull()

    fireEvent.click(files.getByRole('button', { name: '版本' }))
    fireEvent.click(
      await within(await screen.findByRole('dialog', { name: '版本' })).findByRole('button', {
        name: '工作区',
      }),
    )
    expect(current()[0]).toMatchObject({ rev: null })
    expect(await files.findByText('ws:README.md')).toBeTruthy()
  })

  it('compares against a base: marks changes in the tree and lists only changed files', async () => {
    open({ kind: 'files', botId: 'b1', dir: '', selected: null })
    const files = within(screen.getByTestId('files:b1'))
    await files.findByRole('treeitem', { name: /README/ })
    fireEvent.click(files.getByRole('button', { name: '对比' }))
    fireEvent.click(
      await within(await screen.findByRole('dialog', { name: '对比' })).findByRole('button', {
        name: /^main/,
      }),
    )
    await waitFor(() => expect(calls).toContain('/api/groups/g1/bots/b1/git/compare?from=main'))
    const tree = within(files.getByRole('tree', { name: '文件' }))
    expect(await tree.findByTitle('修改')).toBeTruthy()
    expect(within(tree.getByRole('treeitem', { name: /README/ })).getByTitle('修改').textContent).toBe('M')
    expect(within(tree.getByRole('treeitem', { name: /^src/ })).getByTitle('有变化')).toBeTruthy()

    fireEvent.click(files.getByRole('checkbox', { name: '只看有变化的' }))
    const list = within(files.getByRole('list', { name: '变更文件' }))
    expect(list.getAllByRole('button').map((b) => b.title)).toEqual(['README.md', 'src/new.ts', 'old.ts'])
    expect(within(list.getByRole('button', { name: /old\.ts/ })).getByTitle('删除').textContent).toBe('D')
    fireEvent.click(list.getByRole('button', { name: /old\.ts/ }))
    await waitFor(() => expect(diffText(files)).toContain('-main:old.ts'))
    expect(calls).toContain('/api/groups/g1/bots/b1/git/diff?from=main&path=old.ts&context=100000')
    fireEvent.click(files.getByRole('radio', { name: '文件' }))
    expect(await files.findByText('main:old.ts')).toBeTruthy()
  })

  it('labels the version and base buttons with what they hold', async () => {
    open({ kind: 'files', botId: 'b1', dir: '', selected: null })
    const files = within(screen.getByTestId('files:b1'))
    await files.findByRole('treeitem', { name: /README/ })
    expect(files.getByRole('button', { name: '版本' }).textContent).toBe('版本：工作区')
    expect(files.getByRole('button', { name: '对比' }).textContent).toBe('对比')
    act(() => useWorkbench.getState().patch('files:b1', { rev: 'feat/x', base: 'main' }))
    expect(files.getByRole('button', { name: '版本' }).textContent).toBe('版本：feat/x')
    expect(files.getByRole('button', { name: '对比' }).textContent).toBe('对比 main')
  })

  it('shows a changed file as its diff against the base, with the whole file a switch away', async () => {
    open({ kind: 'files', botId: 'b1', dir: '', selected: 'README.md', rev: 'feat/x', base: 'main' })
    const files = within(screen.getByTestId('files:b1'))
    await waitFor(() => expect(diffText(files)).toContain('+feat/x:README.md'))
    expect(diffText(files)).toContain('-main:README.md')
    expect(calls).toContain(
      '/api/groups/g1/bots/b1/git/diff?from=main&to=feat%2Fx&path=README.md&context=100000',
    )
    expect(files.getByRole('radio', { name: '差异' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(files.getByRole('radio', { name: '文件' }))
    expect(await files.findByText('feat/x:README.md')).toBeTruthy()
    expect(files.queryByTestId('git-diff')).toBeNull()
    fireEvent.click(files.getByRole('radio', { name: '差异' }))
    await waitFor(() => expect(diffText(files)).toContain('+feat/x:README.md'))

    // A file the base doesn't differ in is shown as it is.
    fireEvent.click(await files.findByRole('treeitem', { name: /LICENSE/ }))
    expect(await files.findByText('feat/x:LICENSE')).toBeTruthy()
    expect(files.queryByRole('radio', { name: '差异' })).toBeNull()
    expect(files.queryByTestId('git-diff')).toBeNull()
  })
})
