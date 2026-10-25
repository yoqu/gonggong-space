import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { GitBar } from '../src/features/chat/GitBar'
import { useGitDialogs } from '../src/features/git/commands'
import { GitDialogHost } from '../src/features/git/dialogs/GitDialogHost'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import {
  actionsCalled,
  BASE,
  benchTabs,
  branch,
  done,
  group,
  op,
  REFS,
  resetStores,
  routes,
  setMe,
  state,
  status,
  toasts,
} from './gitFixtures'
import { mockApi } from './mockApi'

const WIDTH = window.innerWidth

beforeEach(resetStores)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: WIDTH })
})

function Page() {
  const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git'))
  return (
    <>
      <GitBar group={group()} />
      {tab?.kind === 'git' ? <GitTab tab={tab} tabKey={`git:${tab.botId}`} active /> : null}
      <GitDialogHost />
    </>
  )
}

const NAME = '小王的 Claude 的分支'
const dialog = async (name: string | RegExp) => within(await screen.findByRole('dialog', { name }))
/** Opens the Git tab's branch popup. */
async function popup() {
  fireEvent.click(await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' }))
  const tab = within(await screen.findByTestId('git-tab'))
  fireEvent.click(await tab.findByRole('button', { name: '切换 小王的 Claude 的分支' }))
  return dialog(NAME)
}
const searchbox = (pop: ReturnType<typeof within>) => pop.getByRole('searchbox', { name: '搜索分支和标签' })
/** The row the arrow keys are on, as the search field points at it. */
const currentRow = (search: HTMLElement) =>
  document.getElementById(search.getAttribute('aria-activedescendant') ?? '')
const key = (el: Element | null, k: string) => fireEvent.keyDown(el as Element, { key: k })
const heads = () => [...document.querySelectorAll('.gb__head')].map((h) => h.textContent)

describe('branch popup keyboard', () => {
  it('focuses the search; ↑↓ move the current row, Enter runs it or opens a branch’s actions beside the list', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    const search = searchbox(pop)
    expect(document.activeElement).toBe(search)
    expect(currentRow(search)?.textContent).toBe('更新…')
    key(search, 'ArrowUp')
    expect(currentRow(search)?.getAttribute('title')).toBe('v1.2')
    key(search, 'ArrowDown')
    key(search, 'ArrowDown')
    expect(currentRow(search)?.textContent).toBe('推送…')

    fireEvent.change(search, { target: { value: 'pay' } })
    expect(currentRow(search)?.getAttribute('title')).toBe('origin/feat/pay')
    key(search, 'Enter')
    const menu = within(await pop.findByRole('menu', { name: 'origin/feat/pay' }))
    expect(document.activeElement).toBe(menu.getByRole('menuitem', { name: '检出' }))
    // The list stays beside it.
    expect(searchbox(pop)).toBe(search)
    key(document.activeElement, 'ArrowDown')
    key(document.activeElement, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('与 feat/refund-v2 比较')
    // Enter on a focused item is its click.
    fireEvent.click(document.activeElement as HTMLElement)
    expect(benchTabs().at(-1)).toMatchObject({
      kind: 'git-compare',
      from: 'feat/refund-v2',
      to: 'origin/feat/pay',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: NAME })).toBeNull())
  })

  it('Enter runs a top action, toggles a folder', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    const search = searchbox(pop)
    // 更新… 推送… 新建分支… 检出标签或修订… 获取远程更新, 最近 feat/fee, 本地 main feat/refund-v2, the feat folder.
    for (let i = 0; i < 8; i++) key(search, 'ArrowDown')
    const folder = currentRow(search)
    expect(folder?.textContent).toBe('feat')
    expect(folder?.getAttribute('aria-expanded')).toBe('true')
    key(search, 'Enter')
    expect(currentRow(search)?.getAttribute('aria-expanded')).toBe('false')
    key(search, 'ArrowRight')
    expect(currentRow(search)?.getAttribute('aria-expanded')).toBe('true')
    key(search, 'ArrowLeft')
    expect(currentRow(search)?.getAttribute('aria-expanded')).toBe('false')

    for (let i = 0; i < 8; i++) key(search, 'ArrowUp')
    expect(currentRow(search)?.textContent).toBe('更新…')
    key(search, 'Enter')
    expect(useGitDialogs.getState().open?.dialog).toEqual({ kind: 'pull' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: NAME })).toBeNull())
  })

  it('opens a branch’s actions with →; ← and Esc go back to the search, Esc on top closes the popup', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    const search = searchbox(pop)
    fireEvent.change(search, { target: { value: 'fee' } })
    expect(currentRow(search)?.getAttribute('title')).toBe('feat/fee')
    key(search, 'ArrowRight')
    let item = await pop.findByRole('menuitem', { name: '检出' })
    expect(document.activeElement).toBe(item)
    key(item, 'ArrowLeft')
    expect(pop.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(search)
    expect(currentRow(search)?.getAttribute('title')).toBe('feat/fee')

    key(search, 'Enter')
    item = await pop.findByRole('menuitem', { name: '检出' })
    key(item, 'Escape')
    expect(pop.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('dialog', { name: NAME })).toBeTruthy()
    expect(document.activeElement).toBe(search)
    key(search, 'Escape')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: NAME })).toBeNull())
  })

  it('flies a branch’s actions out on hover, keeping the focus in the search, and closes them on another row', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    fireEvent.mouseEnter(pop.getByTitle('origin/feat/pay'))
    const menu = within(await pop.findByRole('menu', { name: 'origin/feat/pay' }))
    expect(menu.getByRole('menuitem', { name: '使用合并拉取到 feat/refund-v2' })).toBeTruthy()
    expect(document.activeElement).toBe(searchbox(pop))
    expect(currentRow(searchbox(pop))?.getAttribute('title')).toBe('origin/feat/pay')
    fireEvent.mouseEnter(pop.getByRole('button', { name: '推送…' }))
    await waitFor(() => expect(pop.queryByRole('menu')).toBeNull())
  })

  it('drills into a branch’s actions without room beside the popup, and back with ← or 返回', async () => {
    const rect = { top: 0, left: 0, right: 400, bottom: 26, width: 400, height: 26, x: 0, y: 0 }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...rect, toJSON: () => rect })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420 })
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    fireEvent.change(searchbox(pop), { target: { value: 'pay' } })
    key(searchbox(pop), 'Enter')
    const item = await pop.findByRole('menuitem', { name: '检出' })
    expect(document.activeElement).toBe(item)
    expect(pop.queryByRole('searchbox')).toBeNull()
    expect(pop.getByText('origin/feat/pay', { selector: '.gb__drill-name' })).toBeTruthy()
    key(item, 'ArrowLeft')
    const search = await pop.findByRole('searchbox', { name: '搜索分支和标签' })
    await waitFor(() => expect(document.activeElement).toBe(search))
    expect((search as HTMLInputElement).value).toBe('pay')
    expect(currentRow(search)?.getAttribute('title')).toBe('origin/feat/pay')

    fireEvent.click(pop.getByTitle('origin/feat/pay'))
    expect(await pop.findByRole('menuitem', { name: '检出' })).toBeTruthy()
    fireEvent.click(pop.getByRole('button', { name: '返回' }))
    expect(await pop.findByRole('searchbox', { name: '搜索分支和标签' })).toBeTruthy()
  })

  it('lets Tab reach the current row’s star', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    const search = searchbox(pop)
    for (let i = 0; i < 6; i++) key(search, 'ArrowDown')
    expect(currentRow(search)?.getAttribute('title')).toBe('main')
    const star = pop.getByRole('button', { name: '取消收藏 main' })
    expect(star.tabIndex).toBe(0)
    expect(pop.getByRole('button', { name: '取消收藏 origin/main' }).tabIndex).toBe(-1)
    fireEvent.click(star)
    expect(JSON.parse(localStorage.getItem('gg.git.favorites') ?? '{}')).toEqual({ b1: ['origin/main'] })
  })
})

describe('branch popup rows', () => {
  it('shows a local branch’s upstream and how far it is ahead and behind; the current one is checked', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    const row = (title: string) => pop.getAllByTitle(title)[0] as HTMLElement
    expect(row('main').querySelector('.gb__upstream')?.textContent).toBe('origin/main')
    expect(within(row('main')).getByRole('img', { name: '落后 2 个提交' }).textContent).toBe('↓2')
    const current = row('feat/refund-v2')
    expect(current.querySelector('.gb__upstream')?.textContent).toBe('origin/feat/refund-v2')
    expect(within(current).getByRole('img', { name: '领先 3 个提交' }).textContent).toBe('↑3')
    expect(current.closest('.gb__item')?.hasAttribute('data-current')).toBe(true)
    expect(row('feat/fee').querySelector('.gb__upstream')).toBeNull()
    expect(row('origin/feat/pay').querySelector('.gb__upstream')).toBeNull()
  })
})

describe('branch actions', () => {
  const actionsOf = async (pop: ReturnType<typeof within>, title: string) => {
    fireEvent.click(pop.getAllByTitle(title)[0] as HTMLElement)
    const menu = await pop.findByRole('menu', { name: title })
    return within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
  }

  it('lists a remote branch’s actions, pulling into the current one by merge or rebase', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    expect(await actionsOf(pop, 'origin/feat/pay')).toEqual([
      '检出',
      '从 origin/feat/pay 新建分支…',
      '与 feat/refund-v2 比较',
      '显示与工作区的差异',
      '显示提交历史',
      '将 feat/refund-v2 变基到 origin/feat/pay',
      '将 origin/feat/pay 合并到 feat/refund-v2',
      '使用合并拉取到 feat/refund-v2',
      '使用变基拉取到 feat/refund-v2',
      '在远程删除…',
      '复制名称',
    ])
  })

  it('checks out and rebases the local branch a remote one is tracked by', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    expect(await actionsOf(pop, 'origin/main')).toContain('检出并变基到 feat/refund-v2')
    fireEvent.click(pop.getByRole('menuitem', { name: '检出并变基到 feat/refund-v2' }))
    expect(useGitDialogs.getState().open?.dialog).toEqual({
      kind: 'rebase',
      onto: 'feat/refund-v2',
      branch: 'main',
    })
  })

  it('lists the current branch’s own actions', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    expect(await actionsOf(pop, 'feat/refund-v2')).toEqual([
      '从 feat/refund-v2 新建分支…',
      '显示与工作区的差异',
      '显示提交历史',
      '更新…',
      '推送…',
      '重命名…',
      '复制名称',
    ])
  })

  it('pulls, merges and rebases into the current branch at once for the owner', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    let pop = await popup()
    await actionsOf(pop, 'origin/feat/pay')
    fireEvent.click(pop.getByRole('menuitem', { name: '使用合并拉取到 feat/refund-v2' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'pull', from: 'origin/feat/pay', mode: 'merge' }]),
    )
    await waitFor(() => expect(toasts()).toContain('小王的 Claude：拉取完成'))
    expect(useGitDialogs.getState().open).toBeNull()

    const reopen = async () => {
      fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
      return dialog(NAME)
    }
    pop = await reopen()
    await actionsOf(pop, 'origin/feat/pay')
    fireEvent.click(pop.getByRole('menuitem', { name: '使用变基拉取到 feat/refund-v2' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'pull',
        from: 'origin/feat/pay',
        mode: 'rebase',
      }),
    )
    pop = await reopen()
    await actionsOf(pop, 'main')
    fireEvent.click(pop.getByRole('menuitem', { name: '将 main 合并到 feat/refund-v2' }))
    await waitFor(() => expect(actionsCalled(calls).at(-1)).toEqual({ action: 'merge', branch: 'main' }))
    pop = await reopen()
    await actionsOf(pop, 'main')
    fireEvent.click(pop.getByRole('menuitem', { name: '将 feat/refund-v2 变基到 main' }))
    await waitFor(() => expect(actionsCalled(calls).at(-1)).toEqual({ action: 'rebase', onto: 'main' }))
    expect(useGitDialogs.getState().open).toBeNull()
  })

  it('asks a non-owner to request a merge, rebase or pull', async () => {
    setMe('u2')
    const calls = mockApi(
      routes({ [`POST ${BASE}/actions`]: op({ action: 'pull', status: 'pending_approval' }) }),
    )
    render(<Page />)
    let pop = await popup()
    await actionsOf(pop, 'main')
    fireEvent.click(pop.getByRole('menuitem', { name: '将 main 合并到 feat/refund-v2' }))
    expect(useGitDialogs.getState().open?.dialog).toEqual({ kind: 'merge', branch: 'main' })
    act(() => useGitDialogs.getState().close())
    fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
    pop = await dialog(NAME)
    await actionsOf(pop, 'main')
    fireEvent.click(pop.getByRole('menuitem', { name: '将 feat/refund-v2 变基到 main' }))
    expect(useGitDialogs.getState().open?.dialog).toEqual({ kind: 'rebase', onto: 'main', branch: null })
    act(() => useGitDialogs.getState().close())

    fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
    pop = await dialog(NAME)
    await actionsOf(pop, 'origin/feat/pay')
    fireEvent.click(pop.getByRole('menuitem', { name: '使用合并拉取到 feat/refund-v2' }))
    const d = await dialog('使用合并拉取到 feat/refund-v2')
    expect(d.getByText('获取 origin/feat/pay，合并到 feat/refund-v2')).toBeTruthy()
    expect(d.getByText('需要 Bot 主人 小王 批准后才会执行')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '提交申请' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'pull', from: 'origin/feat/pay', mode: 'merge' }]),
    )
  })
})

describe('branch popup of a multi-repo workspace', () => {
  const CORE = 'libs/core'
  const CORE_REFS = {
    branches: [
      branch('dev', { current: true, upstream: 'origin/dev', ahead: 0, behind: 1 }),
      branch('origin/dev', { kind: 'remote' }),
      branch('origin/feat/x', { kind: 'remote' }),
    ],
    remotes: [{ name: 'origin', url: 'git@git.corp:pay/core.git' }],
    tags: [],
    recent: [],
  }
  const multi = (extra: Record<string, unknown> = {}) =>
    routes({
      'GET /groups/g1/bot-states': [
        state({
          git: status({
            repos: [{ path: CORE, kind: 'submodule', branch: 'dev', ahead: 0, behind: 1, dirty: true }],
          }),
        }),
      ],
      [`GET ${BASE}/refs?repo=libs%2Fcore`]: CORE_REFS,
      ...extra,
    })

  it('lists the repos first, each opening its own branches with every action on that repo', async () => {
    const calls = mockApi(multi({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    const pop = await popup()
    expect(heads()).toEqual(['仓库', '最近', '本地', '远程 · origin', '标签'])
    expect([...document.querySelectorAll('.gb__repo-path')].map((e) => e.textContent)).toEqual([
      '主仓库',
      CORE,
    ])
    const root = pop.getByRole('button', { name: /^主仓库/ })
    expect(root.textContent).toContain('feat/refund-v2')
    expect(root.textContent).toContain('3 个改动')
    const core = pop.getByRole('button', { name: /^libs\/core/ })
    expect(core.textContent).toContain('dev')
    expect(core.textContent).toContain('未提交')
    expect(within(core).getByRole('img', { name: '落后 1 个提交' })).toBeTruthy()

    fireEvent.click(core)
    expect(pop.getByText(CORE, { selector: '.gb__drill-name' })).toBeTruthy()
    fireEvent.click(await pop.findByTitle('origin/feat/x'))
    fireEvent.click(await pop.findByRole('menuitem', { name: '使用变基拉取到 dev' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'pull', from: 'origin/feat/x', mode: 'rebase', repo: CORE },
      ]),
    )
    expect(calls.some((c) => c.path === `${BASE}/refs?repo=libs%2Fcore`)).toBe(true)
  })

  it('opens a repo’s changes in the diff tab', async () => {
    mockApi(multi())
    render(<Page />)
    const pop = await popup()
    fireEvent.click(pop.getByRole('button', { name: /^libs\/core/ }))
    fireEvent.click(await pop.findByRole('button', { name: '查看 libs/core 的改动' }))
    expect(benchTabs().at(-1)).toEqual({
      kind: 'diff',
      botId: 'b1',
      scope: 'uncommitted',
      file: null,
      repo: CORE,
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: NAME })).toBeNull())
  })

  it('enters a repo with → and leaves it with ←, Esc or 返回, back on its row', async () => {
    mockApi(multi())
    render(<Page />)
    const pop = await popup()
    let search = searchbox(pop)
    // 更新… 推送… 新建分支… 检出标签或修订… 获取远程更新 主仓库 libs/core
    for (let i = 0; i < 6; i++) key(search, 'ArrowDown')
    expect(currentRow(search)?.getAttribute('data-repo')).toBe(CORE)
    key(search, 'ArrowRight')
    expect(await pop.findByTitle('origin/feat/x')).toBeTruthy()
    search = searchbox(pop)
    await waitFor(() => expect(document.activeElement).toBe(search))
    expect(currentRow(search)?.getAttribute('aria-label')).toBe('查看 libs/core 的改动')
    key(search, 'ArrowLeft')
    search = await pop.findByRole('searchbox', { name: '搜索分支和标签' })
    await waitFor(() => expect(document.activeElement).toBe(search))
    expect(currentRow(search)?.getAttribute('data-repo')).toBe(CORE)

    key(search, 'Enter')
    expect(await pop.findByTitle('origin/feat/x')).toBeTruthy()
    key(searchbox(pop), 'Escape')
    expect(await pop.findByRole('button', { name: /^主仓库/ })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: NAME })).toBeTruthy()

    fireEvent.click(pop.getByRole('button', { name: /^libs\/core/ }))
    fireEvent.click(await pop.findByRole('button', { name: '返回' }))
    expect(await pop.findByRole('button', { name: /^主仓库/ })).toBeTruthy()
  })

  it('leaves out a root that is no repo, its first repo being the one listed', async () => {
    const app = {
      path: 'app',
      kind: 'nested' as const,
      branch: 'feat/a',
      ahead: null,
      behind: null,
      dirty: true,
    }
    mockApi(
      routes({
        'GET /groups/g1/bot-states': [
          state({
            git: status({
              branch: null,
              head: undefined,
              ahead: null,
              behind: null,
              dirty: false,
              repos: [app, { ...app, path: CORE, branch: 'main', dirty: false }],
            }),
          }),
        ],
        [`GET ${BASE}/changes?repo=app`]: {
          changes: [],
          conflicts: [],
          ongoing: null,
          head: null,
          limited: false,
        },
        [`GET ${BASE}/refs?repo=app`]: { ...REFS, branches: [branch('feat/a', { current: true })] },
      }),
    )
    render(<Page />)
    const pop = await popup()
    expect([...document.querySelectorAll('.gb__repo-path')].map((e) => e.textContent)).toEqual(['app', CORE])
    expect(pop.getByRole('button', { name: /^app/ }).hasAttribute('data-current')).toBe(true)
    expect(await pop.findByTitle('feat/a')).toBeTruthy()
  })
})
