import type { BotDto, GitCommit, UserDto } from '@gonggong/protocol'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { useToasts } from '../src/ui'
import {
  commit,
  conflict,
  dialog,
  fakeDiff,
  hash,
  LOG,
  logCalls,
  logTab,
  open,
  REFS,
  seed,
  serve,
  tabs,
} from './gitLogFixture'

let log: GitCommit[]
/** Commits per page; Infinity = one page. */
let pageSize: number
let server: ReturnType<typeof serve>
let scrolled: [string | undefined, unknown][]
const showOf = (c: GitCommit) => ({
  commit: c,
  body: c.subject,
  committer: c.author,
  committerEmail: c.email,
  committedAt: c.at,
  branches: [],
})
beforeEach(() => {
  seed()
  log = LOG
  pageSize = Number.POSITIVE_INFINITY
  scrolled = []
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, o?: unknown) {
    scrolled.push([this.dataset.hash, o])
  }
  server = serve({
    'GET git/refs': () => REFS,
    'GET git/log': (q) => {
      const skip = Number(q.get('skip'))
      return { commits: log.slice(skip, skip + pageSize), hasMore: skip + pageSize < log.length }
    },
    'GET git/show': (q) => {
      const rev = q.get('commit') ?? '-'
      if (rev === 'gone') return showOf(commit('9'))
      const c = rev === 'v1.0' ? log[2] : log.find((x) => x.hash.startsWith(rev))
      return c ? showOf(c) : conflict('提交不存在')
    },
    'GET git/compare': () => ({
      changes: [
        { path: 'src/a.ts', change: 'modified', oldPath: null },
        { path: 'README.md', change: 'added', oldPath: null },
      ],
    }),
    'GET git/diff': fakeDiff,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Scope = ReturnType<typeof open>
const row = (tab: Scope, c: string) => {
  const found = tab.getAllByRole('option').find((o) => o.textContent?.includes(c.repeat(7)))
  if (!found) throw new Error(`no row ${c}`)
  return found
}
const picked = (tab: Scope) =>
  tab.getAllByRole('option', { selected: true }).map((o) => o.textContent?.match(/(\d)\1{6}/)?.[1])
const openLog = async (o: { commit?: string | null; repo?: string | null } = {}) => {
  const tab = open({
    kind: 'git-log',
    botId: 'b1',
    ref: null,
    commit: o.commit ?? null,
    repo: o.repo ?? null,
  })
  await tab.findByRole('option', { name: /提交 1/ })
  return tab
}
const list = (tab: Scope) => tab.getByRole('listbox', { name: '提交' })
const lastLog = () => logCalls(server.calls).at(-1)
const lastToast = () => useToasts.getState().items.at(-1)?.message

describe('branch filter', () => {
  it('lists every branch by default and remembers the last one picked per bot and repo', async () => {
    let tab = await openLog()
    expect(lastLog()).toBe('skip=0&all=1')
    expect(tab.getByRole('button', { name: '分支' })).toBeTruthy()
    fireEvent.click(tab.getByRole('button', { name: '分支' }))
    const panel = within(await screen.findByRole('dialog', { name: '按分支筛选' }))
    fireEvent.click(panel.getByRole('button', { name: 'main' }))
    await waitFor(() => expect(lastLog()).toBe('ref=main&skip=0'))

    // Opened again without a ref, the log filters as last picked; another repo keeps its own.
    cleanup()
    act(() => useWorkbench.setState({ benches: {} }))
    tab = await openLog()
    expect(logTab()).toMatchObject({ ref: null })
    expect(lastLog()).toBe('ref=main&skip=0')
    expect(tab.getByRole('button', { name: '分支：main' })).toBeTruthy()
    // Clearing the filters goes back to all branches, and is remembered too.
    fireEvent.click(tab.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(lastLog()).toBe('skip=0&all=1'))
    cleanup()
    act(() => useWorkbench.setState({ benches: {} }))
    await openLog()
    expect(lastLog()).toBe('skip=0&all=1')
  })
})

describe('several commits', () => {
  it('shows commits in a row as one change, and only a note for scattered ones', async () => {
    const tab = await openLog({ commit: hash('1') })
    fireEvent.keyDown(list(tab), { key: 'ArrowDown', shiftKey: true })
    expect(picked(tab)).toEqual(['1', '2'])
    const range = within(await tab.findByTestId('range-details'))
    // oldest^..newest
    await waitFor(() =>
      expect(server.calls).toContain(`/api/groups/g1/bots/b1/git/compare?from=${hash('3')}&to=${hash('1')}`),
    )
    expect(await range.findByText('2 个提交')).toBeTruthy()
    await waitFor(() =>
      expect(server.calls).toContain(
        `/api/groups/g1/bots/b1/git/diff?from=${hash('3')}&to=${hash('1')}&path=src%2Fa.ts&context=100000`,
      ),
    )
    fireEvent.keyDown(list(tab), { key: 'ArrowDown', shiftKey: true })
    expect(picked(tab)).toEqual(['1', '2', '3'])

    fireEvent.click(row(tab, '5'), { metaKey: true })
    expect(await tab.findByText('选中的 4 个提交不相连')).toBeTruthy()
    expect(tab.queryByTestId('range-details')).toBeNull()
  })

  it('compares exactly two picked commits, older to newer', async () => {
    const tab = await openLog()
    fireEvent.click(row(tab, '1'))
    fireEvent.click(row(tab, '4'), { metaKey: true })
    fireEvent.contextMenu(row(tab, '4'))
    fireEvent.click(screen.getByRole('menuitem', { name: '比较版本' }))
    expect(tabs().find((t) => t.kind === 'git-compare')).toMatchObject({ from: hash('4'), to: hash('1') })
    fireEvent.click(row(tab, '5'), { metaKey: true })
    fireEvent.contextMenu(row(tab, '5'))
    expect(screen.queryByRole('menuitem', { name: '比较版本' })).toBeNull()
  })
})

describe('go to', () => {
  const goTo = async (tab: Scope, text: string) => {
    fireEvent.keyDown(list(tab), { key: 'f', metaKey: true })
    const box = within(await screen.findByRole('dialog', { name: '转到哈希、分支或标签' }))
    const input = box.getByRole('combobox', { name: '转到哈希、分支或标签' })
    fireEvent.change(input, { target: { value: text } })
    return { box, input }
  }

  it('opens on ⌘F, completes branches and tags, and loads pages until the commit is listed', async () => {
    pageSize = 2
    const tab = await openLog()
    let { box, input } = await goTo(tab, 'ma')
    expect(box.getAllByRole('option').map((o) => o.textContent)).toEqual(['main', 'origin/main'])
    fireEvent.change(input, { target: { value: '5555555' } })
    expect(box.getAllByRole('option')[0]?.textContent).toBe('提交 5555555')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(logTab().commit).toBe(hash('5')))
    expect(logCalls(server.calls)).toEqual(['skip=0&all=1', 'skip=2&all=1', 'skip=4&all=1'])
    await waitFor(() => expect(scrolled).toContainEqual([hash('5'), { block: 'center' }]))
    expect(tab.getByRole('button', { name: '转到哈希、分支或标签' }).getAttribute('aria-expanded')).toBe(
      'false',
    )

    // A tag picked from the list.
    ;({ box, input } = await goTo(tab, 'v1'))
    fireEvent.mouseDown(box.getByRole('option', { name: 'v1.0' }))
    await waitFor(() => expect(logTab().commit).toBe(hash('3')))
  })

  it('says when nothing has that name, or the log does not list it', async () => {
    const tab = await openLog()
    let { input } = await goTo(tab, 'abcdef1')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(lastToast()).toBe('提交不存在'))
    expect(screen.getByRole('dialog', { name: '转到哈希、分支或标签' })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    ;({ input } = await goTo(tab, 'gone'))
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(lastToast()).toBe('提交历史里没有 gone'))
  })

  it('locates a commit gone to from the text filter', async () => {
    pageSize = 2
    const tab = await openLog()
    fireEvent.change(tab.getByRole('searchbox', { name: '文本或哈希' }), { target: { value: '4444444' } })
    fireEvent.click(tab.getByRole('button', { name: '转到提交 4444444' }))
    await waitFor(() => expect(logTab().commit).toBe(hash('4')))
    await waitFor(() => expect(scrolled).toContainEqual([hash('4'), { block: 'center' }]))
  })
})

describe('refresh', () => {
  it('reads as many commits as are listed again and keeps the pick; an amended HEAD picks the new one', async () => {
    pageSize = 2
    const tab = await openLog()
    fireEvent.click(tab.getByRole('button', { name: '加载更多' }))
    await tab.findByRole('option', { name: /提交 4/ })
    fireEvent.click(row(tab, '2'))
    server.calls.length = 0
    fireEvent.click(tab.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(logCalls(server.calls)).toEqual(['skip=0&all=1', 'skip=2&all=1']))
    expect(logTab().commit).toBe(hash('2'))
    expect(row(tab, '4')).toBeTruthy()

    // HEAD amended: its old hash is gone, the new HEAD is picked.
    fireEvent.click(row(tab, '1'))
    log = [commit('7', { parents: [hash('2')], refs: ['HEAD -> feat/x'] }), ...LOG.slice(1)]
    fireEvent.click(tab.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(logTab().commit).toBe(hash('7')))
    expect(row(tab, '4')).toBeTruthy()
  })
})

describe('keyboard', () => {
  it('opens the first file’s diff on Enter and copies the hash on ⌘C', async () => {
    const writeText = vi.fn(async (_: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const tab = await openLog({ commit: hash('2') })
    fireEvent.keyDown(list(tab), { key: 'Enter' })
    await waitFor(() =>
      expect(tabs().find((t) => t.kind === 'git-compare')).toMatchObject({
        from: hash('3'),
        to: hash('2'),
        file: 'src/a.ts',
      }),
    )
    fireEvent.keyDown(list(tab), { key: 'c', metaKey: true })
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(hash('2')))
  })

  it('only moves the selection in a reused table: the compare tab keeps its commits to itself', async () => {
    log = [commit('1', { parents: [hash('2')] }), commit('2', { parents: [hash('4')] })]
    const tab = open({ kind: 'git-compare', botId: 'b1', from: 'main', to: 'feat/x', file: null })
    const side = within(await tab.findByRole('region', { name: '仅在 feat/x 中' }))
    await side.findByRole('option', { name: /提交 1/ })
    const table = side.getByRole('listbox', { name: '提交' })
    fireEvent.keyDown(table, { key: 'ArrowDown' })
    fireEvent.keyDown(table, { key: 'ArrowDown' })
    expect(tabs().some((t) => t.kind === 'git-log')).toBe(false)
    expect(side.getByRole('option', { selected: true }).textContent).toContain('2222222')
    fireEvent.keyDown(table, { key: 'Enter' })
    expect(tabs().some((t) => t.kind === 'git-log')).toBe(false)
  })
})

describe('push up to here', () => {
  it('is offered for the current branch’s commits not pushed yet', async () => {
    seed({ owner: true })
    log = [
      commit('1', { parents: [hash('2')], refs: ['HEAD -> feat/x'] }),
      commit('2', { parents: [hash('3')] }),
      commit('3', { parents: [hash('4')], refs: ['origin/feat/x'] }),
      commit('4', { parents: [] }),
    ]
    const tab = await openLog()
    fireEvent.contextMenu(row(tab, '2'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '推送到此处为止…' }))
    expect(dialog()).toEqual({
      kind: 'push',
      branch: 'feat/x',
      upTo: { hash: hash('2'), shortHash: '2222222', subject: '提交 2' },
    })
    fireEvent.contextMenu(row(tab, '3'))
    expect(screen.queryByRole('menuitem', { name: '推送到此处为止…' })).toBeNull()
  })

  it('is not offered once pushed', async () => {
    const tab = await openLog()
    fireEvent.contextMenu(row(tab, '1'))
    expect(screen.getByRole('menuitem', { name: '复制提交哈希' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '推送到此处为止…' })).toBeNull()
  })
})

describe('view options', () => {
  beforeEach(() => {
    useWorkspace.setState({
      bots: [{ id: 'b1', name: '小王的 Claude', ownerId: 'u1', gitEmail: 'w@corp' } as BotDto],
    })
    useSession.setState({ user: { id: 'u2', email: 'LI@corp' } as UserDto })
  })
  const option = (tab: Scope, name: string) => {
    fireEvent.click(tab.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))
  }

  it('highlights my commits and hides columns, remembered per bot', async () => {
    let tab = await openLog()
    expect(row(tab, '1').hasAttribute('data-mine')).toBe(false)
    option(tab, '我的提交')
    // The bot's git identity and the signed-in user's both count.
    expect(row(tab, '1').hasAttribute('data-mine')).toBe(true)
    expect(row(tab, '2').hasAttribute('data-mine')).toBe(true)
    option(tab, '作者')
    expect(row(tab, '1').querySelector('.glog-row__author')).toBeNull()
    expect(row(tab, '1').querySelector('.glog-row__hash')).toBeTruthy()

    cleanup()
    tab = await openLog()
    expect(row(tab, '1').hasAttribute('data-mine')).toBe(true)
    expect(row(tab, '1').querySelector('.glog-row__author')).toBeNull()
  })

  it('filters by 我: either identity', async () => {
    const tab = await openLog()
    fireEvent.click(tab.getByRole('button', { name: '用户' }))
    const panel = within(await screen.findByRole('dialog', { name: '按用户筛选' }))
    fireEvent.click(panel.getByRole('button', { name: '我' }))
    expect(logTab().filter).toMatchObject({ author: '<w@corp>\n<li@corp>' })
    expect(tab.getByRole('button', { name: '用户：我' })).toBeTruthy()
    await waitFor(() => expect(lastLog()).toBe('skip=0&all=1&author=%3Cw%40corp%3E%0A%3Cli%40corp%3E'))
  })
})
