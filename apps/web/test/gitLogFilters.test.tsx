import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from '../src/ui'
import {
  commit,
  dialog,
  diffText,
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
  width,
} from './gitLogFixture'

let server: ReturnType<typeof serve>
beforeEach(() => {
  seed()
  server = serve({
    'GET git/refs': () => REFS,
    'GET git/log': () => ({ commits: LOG, hasMore: false }),
    'GET git/show': (q) => {
      const rev = q.get('commit') ?? '-'
      const c = rev === 'HEAD' ? LOG[0] : LOG.find((x) => x.hash.startsWith(rev))
      return c
        ? {
            commit: c,
            body: c.subject,
            committer: c.author,
            committerEmail: c.email,
            committedAt: c.at,
            branches: [],
          }
        : new Response(JSON.stringify({ error: 'not_found', message: '提交不存在' }), { status: 404 })
    },
    'GET git/compare': () => ({
      changes: [
        { path: 'README.md', change: 'modified', oldPath: null },
        { path: 'src/a.ts', change: 'modified', oldPath: null },
      ],
    }),
    'GET git/diff': fakeDiff,
  })
})
afterEach(() => vi.unstubAllGlobals())

const isoDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const openLog = async (o: { path?: string } = {}) => {
  const tab = open({ kind: 'git-log', botId: 'b1', ref: null, commit: null, path: o.path ?? null })
  await tab.findAllByRole('option')
  return tab
}
const lastLog = () => logCalls(server.calls).at(-1)
const pick = async (trigger: HTMLElement, panel: string) => {
  fireEvent.click(trigger)
  return within(await screen.findByRole('dialog', { name: panel }))
}

describe('log filters', () => {
  it('filters by text as it is typed, as a regexp or matching case, and goes to a commit by hash', async () => {
    const tab = await openLog()
    const search = tab.getByRole('searchbox', { name: '文本或哈希' })
    fireEvent.change(search, { target: { value: 'fix' } })
    await waitFor(() => expect(logTab().filter).toEqual({ text: 'fix' }))
    await waitFor(() => expect(lastLog()).toBe('skip=0&all=1&text=fix'))
    fireEvent.click(tab.getByRole('button', { name: '正则表达式' }))
    fireEvent.click(tab.getByRole('button', { name: '区分大小写' }))
    expect(tab.getByRole('button', { name: '正则表达式' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(lastLog()).toBe('skip=0&all=1&text=fix&regexp=1&matchCase=1'))

    // Enter applies at once; a hash-looking text offers to go to that commit.
    fireEvent.change(search, { target: { value: '2222222' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(logTab().filter).toMatchObject({ text: '2222222' })
    fireEvent.click(tab.getByRole('button', { name: '转到提交 2222222' }))
    await waitFor(() => expect(logTab().commit).toBe(hash('2')))
    expect(logTab().filter?.text).toBeUndefined()
    expect((search as HTMLInputElement).value).toBe('')

    // A hash no commit has keeps what was typed and says so.
    fireEvent.change(search, { target: { value: 'abcdef1' } })
    fireEvent.click(tab.getByRole('button', { name: '转到提交 abcdef1' }))
    await waitFor(() => expect(useToasts.getState().items.at(-1)?.message).toBe('提交不存在'))
    expect((search as HTMLInputElement).value).toBe('abcdef1')
    expect(logTab().commit).toBe(hash('2'))
  })

  it('filters by branch, user, date and path, sets the graph options and clears the filters', async () => {
    const tab = await openLog()
    let panel = await pick(tab.getByRole('button', { name: '分支' }), '按分支筛选')
    fireEvent.click(panel.getByRole('button', { name: 'main' }))
    expect(logTab()).toMatchObject({ ref: 'main' })
    await waitFor(() => expect(lastLog()).toBe('ref=main&skip=0'))
    panel = await pick(tab.getByRole('button', { name: '分支：main' }), '按分支筛选')
    fireEvent.click(panel.getByRole('button', { name: '全部分支' }))
    expect(logTab()).toMatchObject({ ref: null, filter: { all: true } })
    await waitFor(() => expect(lastLog()).toBe('skip=0&all=1'))

    // Authors seen so far, or one typed.
    panel = await pick(tab.getByRole('button', { name: '用户' }), '按用户筛选')
    expect(panel.getAllByRole('button', { name: /小王|老李/ }).map((b) => b.textContent)).toEqual([
      '小王',
      '老李',
    ])
    fireEvent.click(panel.getByRole('button', { name: '老李' }))
    expect(logTab().filter).toMatchObject({ author: '老李' })
    panel = await pick(tab.getByRole('button', { name: '用户：老李' }), '按用户筛选')
    const who = panel.getByRole('textbox', { name: '用户名或邮箱' })
    fireEvent.change(who, { target: { value: 'li@corp' } })
    fireEvent.keyDown(who, { key: 'Enter' })
    expect(logTab().filter).toMatchObject({ author: 'li@corp' })

    panel = await pick(tab.getByRole('button', { name: '日期' }), '按日期筛选')
    fireEvent.click(panel.getByRole('button', { name: '最近 7 天' }))
    expect(logTab().filter?.since).toBe(isoDay(Date.now() - 7 * 86_400_000))
    panel = await pick(tab.getByRole('button', { name: /^日期：/ }), '按日期筛选')
    expect(panel.getByRole('button', { name: '最近 7 天' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(panel.getByRole('button', { name: '自定义…' }))
    fireEvent.change(panel.getByLabelText('起始日期'), { target: { value: '2026-01-01' } })
    fireEvent.change(panel.getByLabelText('截止日期'), { target: { value: '2026-02-01' } })
    fireEvent.click(panel.getByRole('button', { name: '应用' }))
    expect(logTab().filter).toMatchObject({ since: '2026-01-01', until: '2026-02-01' })
    expect(tab.getByRole('button', { name: '日期：2026-01-01 ~ 2026-02-01' })).toBeTruthy()
    await waitFor(() =>
      expect(lastLog()).toBe('skip=0&all=1&author=li%40corp&since=2026-01-01&until=2026-02-01'),
    )

    panel = await pick(tab.getByRole('button', { name: '路径' }), '按路径筛选')
    fireEvent.change(panel.getByRole('textbox', { name: '路径' }), { target: { value: 'src/app/' } })
    fireEvent.click(panel.getByRole('button', { name: '应用' }))
    expect(logTab().path).toBe('src/app')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('历史 · app')
    await waitFor(() => expect(lastLog()).toContain('&path=src%2Fapp'))

    fireEvent.click(tab.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '仅第一父提交' }))
    expect(logTab().filter).toMatchObject({ firstParent: true })
    fireEvent.click(tab.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '按拓扑排序' }))
    await waitFor(() => expect(lastLog()).toMatch(/&path=src%2Fapp&firstParent=1&order=topo$/))

    // Clearing keeps the graph options; one filter clears on its own too.
    fireEvent.click(tab.getByRole('button', { name: '清除筛选' }))
    expect(logTab()).toMatchObject({ ref: null, path: null })
    expect(logTab().filter).toEqual({ firstParent: true, order: 'topo' })
    await waitFor(() => expect(lastLog()).toBe('skip=0&all=1&firstParent=1&order=topo'))
    expect(tab.queryByRole('button', { name: '清除筛选' })).toBeNull()
    panel = await pick(tab.getByRole('button', { name: '用户' }), '按用户筛选')
    fireEvent.click(panel.getByRole('button', { name: '小王' }))
    fireEvent.click(tab.getByRole('button', { name: '清除用户筛选' }))
    expect(logTab().filter).toEqual({ firstParent: true, order: 'topo' })
  })

  it('switches the repo of a workspace with sub-repos', async () => {
    seed({
      git: {
        repos: [{ path: 'lib', kind: 'submodule', branch: 'dev', ahead: null, behind: null, dirty: false }],
      },
    })
    const tab = await openLog()
    fireEvent.click(tab.getByRole('button', { name: '仓库' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'lib' }))
    expect(logTab()).toMatchObject({ repo: 'lib' })
    await waitFor(() => expect(lastLog()).toBe('skip=0&repo=lib&all=1'))
    expect(server.calls).toContain('/api/groups/g1/bots/b1/git/refs?repo=lib')
  })
})

describe('branches pane', () => {
  type Scope = ReturnType<typeof open>
  const pane = async (tab: Scope): Promise<Scope> => {
    const el = within(await tab.findByRole('region', { name: '分支' }))
    await el.findByRole('button', { name: 'main' })
    return el
  }
  const rows = (el: Scope) =>
    el
      .getAllByRole('button')
      .filter((b) => b.classList.contains('glb-row'))
      .map((b) => b.textContent)

  it('lists all, HEAD, local favourites first in folders, remotes and tags', async () => {
    const tab = await openLog()
    const el = await pane(tab)
    expect(rows(el)).toEqual([
      '全部分支',
      'HEAD feat/x',
      '本地',
      'feat/x↑2',
      'main↓3',
      'fix',
      '远程',
      'origin',
      'main',
      'feat',
      '标签',
      'v1.0',
    ])
    // All branches by default, as in IDEA.
    expect(el.getByRole('button', { name: '全部分支' }).getAttribute('aria-current')).toBe('true')
    // A row is named by its whole ref; a remote's branches show without the remote.
    expect(el.getByRole('button', { name: 'origin/main' }).textContent).toBe('main')
    fireEvent.click(el.getByRole('button', { name: 'fix' }))
    expect(el.getByRole('button', { name: 'fix/a' }).textContent).toBe('a')

    // Searching lists the matches flat; tags can be hidden.
    fireEvent.change(el.getByRole('searchbox', { name: '搜索分支和标签' }), { target: { value: 'feat' } })
    expect(rows(el)).toEqual(['本地', 'feat/x↑2', '远程', 'origin', 'feat/x'])
    fireEvent.change(el.getByRole('searchbox', { name: '搜索分支和标签' }), { target: { value: '' } })
    fireEvent.click(el.getByRole('button', { name: '显示标签' }))
    expect(rows(el)).not.toContain('v1.0')
    fireEvent.click(el.getByRole('button', { name: '全部折叠' }))
    expect(rows(el)).toEqual(['全部分支', 'HEAD feat/x', '本地', '远程'])
    fireEvent.click(el.getByRole('button', { name: '全部展开' }))
    expect(rows(el)).toEqual(expect.arrayContaining(['a', 'x']))
  })

  it('goes to a branch on a click, filters on a double click, never checks out, and offers each branch’s actions', async () => {
    const scrolled: unknown[] = []
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, o?: unknown) {
      scrolled.push([this.dataset.hash, o])
    }
    const tab = await openLog()
    const el = await pane(tab)
    fireEvent.click(el.getByRole('button', { name: 'main' }))
    await waitFor(() => expect(logTab().commit).toBe(hash('4')))
    expect(logTab().ref).toBeNull()
    await waitFor(() => expect(scrolled).toContainEqual([hash('4'), { block: 'center' }]))
    expect(dialog()).toBeUndefined()

    fireEvent.doubleClick(el.getByRole('button', { name: 'main' }))
    expect(logTab()).toMatchObject({ ref: 'main' })
    await waitFor(() => expect(logCalls(server.calls)).toContain('ref=main&skip=0'))
    expect(el.getByRole('button', { name: 'main' }).getAttribute('aria-current')).toBe('true')
    expect(dialog()).toBeUndefined()
    fireEvent.click(el.getByRole('button', { name: '全部分支' }))
    expect(logTab()).toMatchObject({ ref: null, filter: { all: true } })
    fireEvent.click(el.getByRole('button', { name: 'HEAD feat/x' }))
    await waitFor(() => expect(logTab().commit).toBe(hash('1')))
    fireEvent.doubleClick(el.getByRole('button', { name: 'HEAD feat/x' }))
    expect(logTab()).toMatchObject({ ref: 'HEAD', filter: null })
    await waitFor(() => expect(lastLog()).toBe('skip=0'))
    expect(el.getByRole('button', { name: 'HEAD feat/x' }).getAttribute('aria-current')).toBe('true')

    fireEvent.contextMenu(el.getByRole('button', { name: 'main' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '与 feat/x 比较' }))
    expect(tabs().find((t) => t.kind === 'git-compare')).toMatchObject({ from: 'feat/x', to: 'main' })
    fireEvent.contextMenu(el.getByRole('button', { name: 'v1.0' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除标签…' }))
    expect(dialog()).toEqual({ kind: 'tag-delete', name: 'v1.0' })

    fireEvent.click(el.getByRole('button', { name: '新建分支…' }))
    expect(dialog()).toEqual({ kind: 'branch-create', from: null })
    fireEvent.click(el.getByRole('button', { name: '获取远程更新' }))
    await waitFor(() => expect(server.posts).toContainEqual({ path: 'git/refresh', body: { fetch: true } }))
  })

  it('hides below 960px until toggled, and takes the whole tab on a phone', async () => {
    const w = width(800)
    let tab = await openLog()
    expect(tab.queryByRole('region', { name: '分支' })).toBeNull()
    fireEvent.click(tab.getByRole('button', { name: '分支面板' }))
    await pane(tab)
    w.mockReturnValue(600)
    cleanup()
    tab = await openLog()
    expect(tab.queryByRole('region', { name: '分支' })).toBeNull()
    fireEvent.click(tab.getByRole('button', { name: '分支面板' }))
    const el = await pane(tab)
    expect(tab.queryByRole('listbox', { name: '提交' })).toBeNull()
    fireEvent.doubleClick(el.getByRole('button', { name: 'main' }))
    expect(logTab()).toMatchObject({ ref: 'main' })
    expect(await tab.findByRole('listbox', { name: '提交' })).toBeTruthy()
    w.mockRestore()
  })
})

describe('file history', () => {
  it('is titled by the file, filtered by its path, and shows that file’s diff first', async () => {
    const tab = await openLog({ path: 'src/a.ts' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('历史 · a.ts')
    expect(logCalls(server.calls)).toContain('skip=0&all=1&path=src%2Fa.ts')
    fireEvent.click(tab.getByRole('option', { name: /提交 2/ }))
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/a.ts`))
    const files = within(tab.getByRole('region', { name: '变更文件' }))
    expect(files.getByRole('button', { name: '修改：src/a.ts' }).getAttribute('aria-current')).toBe('true')
    expect(tab.getByRole('button', { name: '路径：a.ts' })).toBeTruthy()
  })

  it('draws a filtered log’s graph from the commits listed', async () => {
    server = serve({
      'GET git/refs': () => REFS,
      'GET git/log': () => ({
        commits: [commit('1', { parents: [hash('9')] }), commit('2', { parents: [hash('8')] })],
        hasMore: false,
      }),
    })
    const tab = await openLog({ path: 'src/a.ts' })
    // Parents left out of the filtered list don't open a lane per commit.
    for (const o of tab.getAllByRole('option'))
      expect(o.querySelector('svg.git-graph')?.getAttribute('width')).toBe('14')
  })
})
