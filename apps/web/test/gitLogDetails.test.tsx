import type { GitCommit, GitShowDto } from '@gonggong/protocol'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench } from '../src/app/workbench'
import { gitCommands } from '../src/features/git/commands'
import { dialog, diffText, fakeDiff, hash, LOG, open, REFS, seed, serve, tabs, width } from './gitLogFixture'

const show = (c: GitCommit, body = `${c.subject}\n`): GitShowDto => ({
  commit: c,
  body,
  committer: c.author,
  committerEmail: c.email,
  committedAt: c.at,
  branches: [],
})

let bodies: Record<string, string>
let server: ReturnType<typeof serve>
beforeEach(() => {
  seed()
  bodies = {}
  server = serve({
    'GET git/refs': () => REFS,
    'GET git/log': () => ({ commits: LOG, hasMore: false }),
    'GET git/show': (q) => {
      const c = LOG.find((x) => x.hash.startsWith(q.get('commit') ?? '-'))
      return c
        ? show(c, bodies[c.hash])
        : new Response(JSON.stringify({ error: 'not_found', message: '提交不存在' }), { status: 404 })
    },
    'GET git/compare': () => ({
      changes: [
        { path: 'src/a.ts', change: 'modified', oldPath: null },
        { path: 'src/new.ts', change: 'renamed', oldPath: 'src/old.ts' },
        { path: 'gone.ts', change: 'deleted', oldPath: null },
      ],
    }),
    'GET git/diff': fakeDiff,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const target = (repo: string | null = null) => gitCommands({ groupId: 'g1', botId: 'b1', repo })
const keys = () => tabs().map(tabKey)
const active = () => useWorkbench.getState().benches.g1?.active

describe('log tabs', () => {
  it('opens the repo’s log once, and each path’s or sub-repo’s history in a tab of its own', () => {
    act(() => {
      target().openLog({})
      target().openLog({ path: 'src/a.ts' })
      target().openLog({ path: 'src' })
      target('libs/core').openLog({})
      target('libs/core').openLog({ path: 'x.ts' })
    })
    expect(keys()).toEqual([
      'git-log:b1',
      'git-log:b1::src/a.ts',
      'git-log:b1::src',
      'git-log:b1:libs/core:',
      'git-log:b1:libs/core:x.ts',
    ])
    act(() => target().openLog({ path: 'src/a.ts', commit: hash('2') }))
    expect(tabs()).toHaveLength(5)
    expect(active()).toBe('git-log:b1::src/a.ts')
    expect(tabs()[1]).toMatchObject({ path: 'src/a.ts', commit: hash('2') })
  })

  it('brings the log forward as it is when nothing in particular is asked for', () => {
    act(() => target().openLog({ ref: 'main', commit: hash('2') }))
    act(() => useWorkbench.getState().patch('git-log:b1', { filter: { author: '小王' } }))
    act(() => target().openLog({ path: 'src/a.ts' }))
    act(() => target().openLog({}))
    expect(active()).toBe('git-log:b1')
    expect(tabs()[0]).toMatchObject({ ref: 'main', commit: hash('2'), filter: { author: '小王' } })
  })

  it('keeps a history tab its own while its path filter changes, titled by what it shows', async () => {
    act(() => target().openLog({ path: 'src/a.ts' }))
    const tab = open({ kind: 'git-log', botId: 'b1', ref: null, commit: null })
    expect(tab.getByRole('heading', { level: 2 }).textContent).toBe('提交历史 · 小王的 Claude')
    act(() => useWorkbench.getState().patch('git-log:b1::src/a.ts', { path: 'src/b.ts' }))
    expect(keys()).toEqual(['git-log:b1::src/a.ts', 'git-log:b1'])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '历史 · b.ts',
      '提交历史 · 小王的 Claude',
    ])
  })
})

/** The log at commit 2, its file list and the menu of the file named `name`. */
async function details() {
  const tab = open({ kind: 'git-log', botId: 'b1', ref: null, commit: hash('2') })
  const files = within(await tab.findByRole('region', { name: '变更文件' }))
  const menu = (name: string, item: string) => {
    fireEvent.contextMenu(files.getByRole('button', { name }))
    fireEvent.click(screen.getByRole('menuitem', { name: item }))
  }
  return { tab, files, menu }
}

describe('commit details', () => {
  it('offers IDEA’s file actions, each opening its own tab', async () => {
    const { files, menu } = await details()
    fireEvent.contextMenu(files.getByRole('button', { name: '修改：src/a.ts' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      '显示差异',
      '与本地比较',
      '修订前版本与本地比较',
      '打开此版本',
      '注解此修订',
      '优选所选改动',
      '还原所选改动',
      '从该版本取回文件…',
      '显示到此为止的历史',
      '复制路径',
    ])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    menu('修改：src/a.ts', '与本地比较')
    expect(tabs().at(-1)).toMatchObject({ kind: 'git-compare', from: hash('2'), to: null, file: 'src/a.ts' })
    menu('修改：src/a.ts', '修订前版本与本地比较')
    expect(tabs().at(-1)).toMatchObject({ kind: 'git-compare', from: hash('3'), to: null, file: 'src/a.ts' })
    // Before a rename the file had its old name.
    menu('重命名：src/new.ts', '修订前版本与本地比较')
    expect(tabs().at(-1)).toMatchObject({ from: hash('3'), to: null, file: 'src/old.ts' })
    menu('修改：src/a.ts', '显示到此为止的历史')
    expect(tabs().at(-1)).toMatchObject({ kind: 'git-log', path: 'src/a.ts', ref: hash('2'), commit: null })
    // The log the details belong to keeps its commit.
    expect(keys()[0]).toBe('git-log:b1')
    expect(tabs()[0]).toMatchObject({ commit: hash('2') })
    menu('修改：src/a.ts', '注解此修订')
    expect(tabs().at(-1)).toMatchObject({
      kind: 'file',
      source: { botId: 'b1', path: 'src/a.ts', rev: hash('2'), annotate: expect.any(Number) },
    })
    const compares = tabs().filter((t) => t.kind === 'git-compare')
    expect(compares).toHaveLength(2)
  })

  it('leaves out what a deleted or added file lacks', async () => {
    const { files } = await details()
    fireEvent.contextMenu(files.getByRole('button', { name: '删除：gone.ts' }))
    const item = (name: string) => screen.getByRole('menuitem', { name }) as HTMLButtonElement
    expect(item('与本地比较').disabled).toBe(true)
    expect(item('注解此修订').disabled).toBe(true)
    expect(item('修订前版本与本地比较').disabled).toBe(false)
    fireEvent.click(item('打开此版本'))
    expect(tabs().at(-1)).toEqual({ kind: 'file', source: { botId: 'b1', path: 'gone.ts', rev: hash('3') } })
  })

  it('opens a sub-repo’s versions from the workspace root', async () => {
    seed({
      git: {
        repos: [{ path: 'libs/core', kind: 'submodule', branch: 'dev', ahead: 0, behind: 0, dirty: false }],
      },
    })
    const tab = open({ kind: 'git-log', botId: 'b1', repo: 'libs/core', ref: null, commit: hash('2') })
    const files = within(await tab.findByRole('region', { name: '变更文件' }))
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/a.ts`))
    fireEvent.click(tab.getByRole('button', { name: '打开此版本' }))
    expect(tabs().at(-1)).toEqual({
      kind: 'file',
      source: { botId: 'b1', path: 'libs/core/src/a.ts', rev: hash('2') },
    })
    fireEvent.contextMenu(files.getByRole('button', { name: '修改：src/a.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '注解此修订' }))
    expect(tabs().at(-1)).toMatchObject({ source: { path: 'libs/core/src/a.ts', rev: hash('2') } })
  })

  it('applies or reverts only the selected files, and gets their current paths from this revision', async () => {
    const { files } = await details()
    fireEvent.click(files.getByRole('button', { name: '修改：src/a.ts' }))
    fireEvent.click(files.getByRole('button', { name: '重命名：src/new.ts' }), { metaKey: true })
    const action = (name: string) => {
      fireEvent.contextMenu(files.getByRole('button', { name: '修改：src/a.ts' }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    action('优选所选改动')
    expect(dialog()).toMatchObject({
      kind: 'confirm',
      confirm: {
        req: {
          action: 'apply',
          commit: hash('2'),
          paths: ['src/a.ts', 'src/old.ts', 'src/new.ts'],
          reverse: false,
        },
      },
    })
    action('还原所选改动')
    expect(dialog()).toMatchObject({
      kind: 'confirm',
      confirm: {
        req: {
          action: 'apply',
          commit: hash('2'),
          paths: ['src/a.ts', 'src/old.ts', 'src/new.ts'],
          reverse: true,
        },
      },
    })
    action('从该版本取回文件…')
    expect(dialog()).toMatchObject({
      kind: 'confirm',
      confirm: {
        destructive: true,
        req: { action: 'restore', commit: hash('2'), paths: ['src/a.ts', 'src/new.ts'] },
      },
    })
  })

  it('targets the focused file when its context menu opens from the keyboard', async () => {
    const { files } = await details()
    const file = files.getByRole('button', { name: '修改：src/a.ts' })
    file.focus()
    fireEvent.keyDown(file, { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menuitem', { name: '从该版本取回文件…' }))
    expect(dialog()).toMatchObject({
      kind: 'confirm',
      confirm: { req: { action: 'restore', commit: hash('2'), paths: ['src/a.ts'] } },
    })
  })

  it('applies only the newly clicked file after several files were selected', async () => {
    const { files } = await details()
    fireEvent.click(files.getByRole('button', { name: '修改：src/a.ts' }))
    fireEvent.click(files.getByRole('button', { name: '重命名：src/new.ts' }), { metaKey: true })
    fireEvent.contextMenu(files.getByRole('button', { name: '删除：gone.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '优选所选改动' }))
    expect(dialog()).toMatchObject({
      kind: 'confirm',
      confirm: { req: { action: 'apply', commit: hash('2'), paths: ['gone.ts'], reverse: false } },
    })
  })

  it('links the hashes of the repo’s commits and the URLs in the message', async () => {
    bodies[hash('2')] =
      `提交 2\n\nReverts ${'3'.repeat(9)}, see https://example.com/issues/7. Not 1234567 nor ${'2'.repeat(7)}.`
    const tab = open({ kind: 'git-log', botId: 'b1', ref: null, commit: hash('2') })
    const info = within(await tab.findByRole('region', { name: '提交详情' }))
    const ref = await info.findByRole('button', { name: '3'.repeat(9) })
    expect(info.queryByRole('button', { name: '1234567' })).toBeNull()
    // The commit itself is not a way anywhere.
    expect(info.queryByRole('button', { name: '2'.repeat(7) })).toBeNull()
    expect(server.calls).toContain('/api/groups/g1/bots/b1/git/show?commit=1234567')
    const link = info.getByRole('link', { name: 'https://example.com/issues/7' })
    expect(link.getAttribute('href')).toBe('https://example.com/issues/7')
    expect(link.getAttribute('target')).toBe('_blank')

    fireEvent.click(ref)
    expect(tabs()[0]).toMatchObject({ commit: hash('3') })
  })

  it('steps through the files with F7 and ⌥⇧→, and opens the work tree file at the change with F4', async () => {
    const { tab } = await details()
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/a.ts`))
    const key = (k: string, o: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key: k, ...o })
    key('F4')
    expect(tabs().at(-1)).toEqual({
      kind: 'file',
      source: { botId: 'b1', path: 'src/a.ts', line: { from: 1, to: 1 } },
    })
    key('F7')
    key('F7')
    key('F7')
    expect(tabs()[0]).toMatchObject({ file: 'src/new.ts' })
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/new.ts`))
    key('ArrowRight', { altKey: true, shiftKey: true })
    expect(tabs()[0]).toMatchObject({ file: 'gone.ts' })
    await waitFor(() => expect(diffText(tab)).toContain(`-${hash('3')}:gone.ts`))
    // A deleted file has nothing in the work tree to go to.
    const opened = tabs().length
    key('F4')
    expect(tabs()).toHaveLength(opened)
    key('ArrowLeft', { altKey: true, shiftKey: true })
    expect(tabs()[0]).toMatchObject({ file: 'src/new.ts' })
  })
})

describe('diff toolbar width', () => {
  it('folds its settings into one menu when narrow', async () => {
    const w = width(700)
    const { tab } = await details()
    await waitFor(() => expect(diffText(tab)).toContain(`+${hash('2')}:src/a.ts`))
    expect(tab.queryByRole('button', { name: '空白处理' })).toBeNull()
    expect(tab.queryByRole('checkbox', { name: '显示完整文件' })).toBeNull()
    expect(tab.getByRole('radio', { name: '统一' })).toBeTruthy()
    expect(tab.getByRole('button', { name: '下一处改动' })).toBeTruthy()
    expect(tab.getByRole('button', { name: '下一个文件' })).toBeTruthy()

    fireEvent.click(tab.getByRole('button', { name: '差异选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '空白处理' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '忽略空白' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.includes('/git/diff?') && c.includes('whitespace=ignore'))).toBe(
        true,
      ),
    )
    fireEvent.click(tab.getByRole('button', { name: '差异选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '高亮方式' }))
    expect(screen.getByRole('menuitemcheckbox', { name: '按词高亮' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '只高亮行' }))
    fireEvent.click(tab.getByRole('button', { name: '差异选项' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示完整文件' }))
    const { useDiffSettings } = await import('../src/features/diff/store')
    expect(useDiffSettings.getState()).toMatchObject({
      whitespace: 'ignore',
      highlight: 'lines',
      fullContext: true,
    })
    useDiffSettings.getState().set({ whitespace: 'none', highlight: 'words', fullContext: false })
    w.mockRestore()
  })
})
