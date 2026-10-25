import type { GitCommit, GitShowDto } from '@gonggong/protocol'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { gitCommands } from '../src/features/git/commands'
import { commitMenu, runCommitAction } from '../src/features/git/log/commitMenu'
import { fullTime } from '../src/lib/time'
import {
  commit,
  conflict,
  dialog,
  diffText,
  fakeDiff,
  hash,
  LOG,
  logTab,
  open,
  REFS,
  seed,
  serve,
  tabs,
} from './gitLogFixture'

const show = (c: GitCommit, o: Partial<GitShowDto> = {}): GitShowDto => ({
  commit: c,
  body: `${c.subject}\n`,
  committer: c.author,
  committerEmail: c.email,
  committedAt: c.at,
  branches: [],
  ...o,
})

let shows: Record<string, Partial<GitShowDto>>
let server: ReturnType<typeof serve>
beforeEach(() => {
  seed()
  shows = {}
  server = serve({
    'GET git/refs': () => REFS,
    'GET git/log': () => ({ commits: LOG, hasMore: false }),
    'GET git/show': (q) => {
      const c = LOG.find((x) => x.hash === q.get('commit'))
      return c ? show(c, shows[c.hash]) : conflict('提交不存在')
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
const labels = (tab: Scope, c: string) =>
  [...row(tab, c).querySelectorAll('[data-ref]')].map(
    (el) => `${el.getAttribute('data-ref')}:${el.textContent}`,
  )
const menu = (tab: Scope, c: string, item: string) => {
  fireEvent.contextMenu(row(tab, c))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}
const openLog = async (o: { commit?: string | null } = {}) => {
  const tab = open({ kind: 'git-log', botId: 'b1', ref: null, commit: o.commit ?? null })
  await tab.findByRole('option', { name: /提交 1/ })
  return tab
}

describe('commit table', () => {
  it('labels refs in IDEA’s colours, dims merges and dates each commit', async () => {
    const tab = await openLog()
    // HEAD's branch and its remote twin share one label; a remote branch alone gets its own colour.
    expect(labels(tab, '1')).toEqual(['current:origin & feat/x'])
    expect(labels(tab, '3')).toEqual(['tag:v1.0'])
    expect(labels(tab, '4')).toEqual(['local:origin & main'])
    expect(labels(tab, '5')).toEqual(['remote:origin/fix/a'])
    expect(row(tab, '3').hasAttribute('data-merge')).toBe(true)
    expect(row(tab, '2').hasAttribute('data-merge')).toBe(false)
    expect(row(tab, '1').querySelector('svg.git-graph')).toBeTruthy()
    expect(within(row(tab, '2')).getByText('老李')).toBeTruthy()
    expect(within(row(tab, '1')).getByTitle(fullTime(LOG[0]?.at ?? ''))).toBeTruthy()
  })

  it('picks the first commit once the log arrives, as IDEA does, so its details show', async () => {
    const tab = await openLog()
    await waitFor(() => expect(row(tab, '1').getAttribute('aria-selected')).toBe('true'))
    expect(useWorkbench.getState().benches.g1?.tabs[0]).toMatchObject({ commit: hash('1') })
  })

  it('moves with the keyboard: ↑↓ rows, ← parent, → child', async () => {
    const tab = await openLog({ commit: hash('2') })
    const list = tab.getByRole('listbox', { name: '提交' })
    expect(row(tab, '2').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(logTab().commit).toBe(hash('3'))
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(logTab().commit).toBe(hash('2'))
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(logTab().commit).toBe(hash('3'))
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(logTab().commit).toBe(hash('4'))
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(logTab().commit).toBe(hash('3'))
    expect(row(tab, '3').getAttribute('aria-selected')).toBe('true')
  })

  it('picks several with ⌘ and ⇧: cherry-picks and reverts them oldest first (the daemon reverts the newest first)', async () => {
    const tab = await openLog()
    fireEvent.click(row(tab, '1'))
    fireEvent.click(row(tab, '2'), { metaKey: true })
    fireEvent.click(row(tab, '5'), { metaKey: true })
    expect(tab.getAllByRole('option', { selected: true })).toHaveLength(3)
    expect(logTab().commit).toBe(hash('5'))
    fireEvent.contextMenu(row(tab, '2'))
    expect(screen.getByRole('menuitem', { name: '检出此修订' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: '优选' }))
    expect(dialog()).toMatchObject({
      kind: 'confirm',
      confirm: { req: { action: 'cherry-pick', commits: [hash('5'), hash('2'), hash('1')] } },
    })
    menu(tab, '2', '还原提交')
    expect(dialog()).toMatchObject({
      confirm: { req: { action: 'revert', commits: [hash('5'), hash('2'), hash('1')] } },
    })

    // ⇧ picks the range from the last one clicked; right-clicking another commit picks it alone.
    fireEvent.click(row(tab, '2'))
    fireEvent.click(row(tab, '4'), { shiftKey: true })
    expect(
      tab.getAllByRole('option', { selected: true }).map((o) => o.textContent?.match(/(\d)\1{6}/)?.[1]),
    ).toEqual(['2', '3', '4'])
    fireEvent.contextMenu(row(tab, '5'))
    expect(tab.getAllByRole('option', { selected: true })).toEqual([row(tab, '5')])
    expect(logTab().commit).toBe(hash('5'))
  })

  it('loads the next page from the end of the list', async () => {
    server = serve({
      'GET git/refs': () => REFS,
      'GET git/log': (q) =>
        q.get('skip') === '2'
          ? { commits: LOG.slice(2), hasMore: false }
          : { commits: LOG.slice(0, 2), hasMore: true },
    })
    const tab = await openLog()
    fireEvent.click(tab.getByRole('button', { name: '加载更多' }))
    expect(await tab.findByRole('option', { name: /提交 5/ })).toBeTruthy()
    expect(server.calls).toContain('/api/groups/g1/bots/b1/git/log?skip=2&all=1')
    expect(tab.queryByRole('button', { name: '加载更多' })).toBeNull()
  })
})

describe('commit menu', () => {
  it('opens interactive rebase from an ancestor of HEAD through the single command hook', async () => {
    const tab = await openLog()
    const c = LOG[1]!
    expect(
      commitMenu([c], LOG, {
        remotes: ['origin'],
        rootRepo: true,
        interactiveRebase: true,
      }).some((item) => 'value' in item && item.value === 'rebase-interactive' && !item.disabled),
    ).toBe(true)
    const rebaseInteractive = vi.fn()
    await runCommitAction('rebase-interactive', [c], {
      target: { groupId: 'g1', botId: 'b1', repo: null },
      cmd: { ...gitCommands({ groupId: 'g1', botId: 'b1', repo: null }), rebaseInteractive },
      remotes: ['origin'],
      all: LOG,
      shown: null,
      select: vi.fn(),
      branch: 'feat/x',
    })
    expect(rebaseInteractive).toHaveBeenCalledWith(
      {
        hash: c.hash,
        shortHash: c.shortHash,
        subject: c.subject,
      },
      false,
    )
    const enabled = (commit: GitCommit) =>
      commitMenu([commit], LOG, { remotes: ['origin'], rootRepo: true, interactiveRebase: true }).find(
        (item) => 'value' in item && item.value === 'rebase-interactive',
      )
    expect(enabled(LOG[0]!)).toMatchObject({ disabled: true })
    expect(enabled(LOG[2]!)).toMatchObject({ disabled: true })
    expect(enabled(LOG[4]!)).toMatchObject({ disabled: true })
    expect(tab).toBeTruthy()
  })

  it('targets the focused commit when its context menu opens from the keyboard', async () => {
    const tab = await openLog()
    const target = row(tab, '2')
    target.focus()
    fireEvent.keyDown(target, { key: 'F10', shiftKey: true })
    const action = screen.getByRole('menuitem', { name: '从此提交之后交互式变基…' })
    expect(action.hasAttribute('disabled')).toBe(false)
    fireEvent.click(action)
    await waitFor(() =>
      expect(dialog()).toMatchObject({ kind: 'rebase-todo', commit: { hash: hash('2') } }),
    )
  })

  it('copies, checks out, browses, compares, resets, branches, tags and walks to parent and child', async () => {
    const writeText = vi.fn(async (_: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    shows[hash('2')] = { body: '提交 2\n\n详细说明' }
    const tab = await openLog()
    menu(tab, '2', '复制提交哈希')
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(hash('2')))
    menu(tab, '2', '复制提交说明')
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('提交 2\n\n详细说明'))
    menu(tab, '2', '检出此修订')
    expect(dialog()).toEqual({ kind: 'checkout', ref: hash('2'), detach: true })
    menu(tab, '2', '将当前分支重置到此处…')
    expect(dialog()).toEqual({
      kind: 'reset',
      commit: { hash: hash('2'), shortHash: '2222222', subject: '提交 2' },
    })
    menu(tab, '2', '新建分支…')
    expect(dialog()).toEqual({ kind: 'branch-create', from: hash('2') })
    menu(tab, '2', '新建标签…')
    expect(dialog()).toEqual({
      kind: 'tag-create',
      commit: { hash: hash('2'), shortHash: '2222222', subject: '提交 2' },
    })
    menu(tab, '2', '显示此修订的仓库')
    expect(tabs().at(-1)).toMatchObject({ kind: 'files', botId: 'b1', rev: hash('2') })
    menu(tab, '2', '与本地比较')
    expect(tabs().find((t) => t.kind === 'git-compare')).toMatchObject({ from: hash('2'), to: null })
    menu(tab, '2', '转到父提交')
    expect(logTab().commit).toBe(hash('3'))
    menu(tab, '3', '转到子提交')
    expect(logTab().commit).toBe(hash('2'))
    // The newest commit has no child loaded; only HEAD can be undone or reworded.
    fireEvent.contextMenu(row(tab, '1'))
    expect(screen.getByRole('menuitem', { name: '转到子提交' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.contextMenu(row(tab, '2'))
    expect(screen.queryByRole('menuitem', { name: '撤销提交…' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '编辑提交说明…' })).toBeNull()
  })

  it('undoes and rewords HEAD, telling whether a remote branch has it', async () => {
    shows[hash('1')] = { body: '提交 1\n\n正文', branches: ['feat/x', 'origin/feat/x'] }
    const tab = await openLog()
    menu(tab, '1', '撤销提交…')
    await waitFor(() =>
      expect(dialog()).toMatchObject({
        kind: 'confirm',
        confirm: {
          req: { action: 'reset', commit: 'HEAD~1', mode: 'soft' },
          consequences: ['该提交已推送，撤销后需要强制推送才能更新远程'],
        },
      }),
    )
    menu(tab, '1', '编辑提交说明…')
    await waitFor(() =>
      expect(dialog()).toEqual({
        kind: 'reword',
        head: { hash: hash('1'), shortHash: '1111111', message: '提交 1\n\n正文', pushed: true },
      }),
    )
  })

  it('creates a patch of the commit against its first parent', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob)
      return 'blob:patch'
    })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    const tab = await openLog()
    menu(tab, '2', '创建补丁')
    await waitFor(() => expect(names).toEqual(['2222222.patch']))
    expect(server.calls).toContain(`/api/groups/g1/bots/b1/git/diff?from=${hash('3')}&to=${hash('2')}`)
    expect(await blobs[0]?.text()).toContain(`+${hash('2')}:`)
  })
})

describe('commit details', () => {
  it('shows the whole message, hash, parents, author and committer, branches and tags', async () => {
    shows[hash('3')] = {
      body: 'Merge branch fix/a\n\n合并说明第一行\n第二行',
      committer: 'CI',
      committerEmail: 'ci@corp',
      committedAt: '2026-10-21T00:00:00.000Z',
      branches: ['feat/x', 'main', 'b1', 'b2', 'b3', 'b4', 'origin/feat/x', 'origin/main'],
    }
    const tab = await openLog({ commit: hash('3') })
    const info = within(await tab.findByRole('region', { name: '提交详情' }))
    expect(info.getByRole('heading', { name: 'Merge branch fix/a' })).toBeTruthy()
    expect((await info.findByText(/合并说明第一行/)).textContent).toBe('合并说明第一行\n第二行')
    expect(info.getByText(hash('3'))).toBeTruthy()
    expect(info.getByText('小王 <w@corp>')).toBeTruthy()
    expect(info.getByText('CI <ci@corp>')).toBeTruthy()
    expect(info.getByText(fullTime('2026-10-21T00:00:00.000Z'))).toBeTruthy()
    expect(info.getByText('v1.0')).toBeTruthy()
    expect(info.getByText('包含于 8 个分支')).toBeTruthy()
    expect(info.getAllByTestId('commit-branch')).toHaveLength(6)
    fireEvent.click(info.getByRole('button', { name: '显示全部' }))
    expect(info.getAllByTestId('commit-branch').map((b) => b.textContent)).toContain('origin/main')
    // Each parent jumps to it.
    fireEvent.click(info.getByRole('button', { name: '转到父提交 5555555' }))
    expect(logTab().commit).toBe(hash('5'))
  })

  it('compares a merge commit with the parent picked', async () => {
    const tab = await openLog({ commit: hash('3') })
    const compare = (p: string) => `/api/groups/g1/bots/b1/git/compare?from=${hash(p)}&to=${hash('3')}`
    await waitFor(() => expect(server.calls).toContain(compare('4')))
    fireEvent.click(tab.getByRole('button', { name: '比较的父提交' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /5555555/ }))
    await waitFor(() => expect(server.calls).toContain(compare('5')))
    await waitFor(() => expect(diffText(tab)).toContain(`-${hash('5')}:src/a.ts`))
  })

  it('offers a changed file’s diff, its version, a compare with local, its history and its path', async () => {
    const writeText = vi.fn(async (_: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const tab = await openLog({ commit: hash('2') })
    const files = within(await tab.findByRole('region', { name: '变更文件' }))
    const fileMenu = (item: string) => {
      fireEvent.contextMenu(files.getByRole('button', { name: '新增：README.md' }))
      fireEvent.click(screen.getByRole('menuitem', { name: item }))
    }
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/a.ts`))
    fileMenu('复制路径')
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('README.md'))
    fileMenu('打开此版本')
    expect(tabs().at(-1)).toEqual({
      kind: 'file',
      source: { botId: 'b1', path: 'README.md', rev: hash('2') },
    })
    fileMenu('与本地比较')
    expect(tabs().find((t) => t.kind === 'git-compare')).toMatchObject({
      from: hash('2'),
      to: null,
      file: 'README.md',
    })
    fileMenu('显示差异')
    expect(tabs().at(-1)).toMatchObject({
      from: hash('3'),
      to: hash('2'),
      file: 'README.md',
    })
    fileMenu('显示到此为止的历史')
    expect(tabs().at(-1)).toMatchObject({ kind: 'git-log', path: 'README.md', commit: null, ref: hash('2') })
  })

  it('shows what an old daemon says: the log’s refusal, and the details from the list', async () => {
    server = serve({
      'GET git/refs': () => REFS,
      'GET git/log': (q) =>
        q.get('text')
          ? conflict('Bot 所在机器的客户端版本过旧，请升级后使用')
          : { commits: [commit('1', { parents: [hash('2')] })], hasMore: false },
      'GET git/show': () => conflict('Bot 所在机器的客户端版本过旧，请升级后使用'),
      'GET git/compare': () => ({ changes: [] }),
    })
    const tab = open({ kind: 'git-log', botId: 'b1', ref: null, commit: null, filter: { text: 'x' } })
    expect(await tab.findByText('Bot 所在机器的客户端版本过旧，请升级后使用')).toBeTruthy()
    fireEvent.click(tab.getByRole('button', { name: '清除筛选' }))
    fireEvent.click(await tab.findByRole('option', { name: /提交 1/ }))
    const info = within(await tab.findByRole('region', { name: '提交详情' }))
    expect(info.getByRole('heading', { name: '提交 1' })).toBeTruthy()
    expect(await info.findByText('Bot 所在机器的客户端版本过旧，请升级后使用')).toBeTruthy()
    expect(info.getByText(hash('1'))).toBeTruthy()
  })
})
