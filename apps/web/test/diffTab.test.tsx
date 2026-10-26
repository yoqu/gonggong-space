import type { BotDto, DiffScope, GitStatus, GroupBotStateDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { useDiffLayout, useDiffSettings } from '../src/features/diff/store'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'
import { realtime } from '../src/lib/realtime'

const PATCHES: Record<string, string> = {
  uncommitted: [
    'diff --git a/src/app/a.ts b/src/app/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/README.md b/README.md',
    '@@ -0,0 +1 @@',
    '+# readme',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '@@ -1 +0,0 @@',
    '-bye',
    '',
  ].join('\n'),
  base: ['diff --git a/lib/c.ts b/lib/c.ts', '@@ -0,0 +1 @@', '+c', ''].join('\n'),
}

/** Unchanged lines `from`..`to` of a patch. */
const same = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => ` line ${from + k}`)
/** 未提交 files as git reads them again: against HEAD, the whole file as context. */
const WHOLE: Record<string, string[]> = {
  'src/app/a.ts': ['@@ -1,20 +1,20 @@', '-old', '+new', ...same(2, 10), '-x', '+X', ...same(12, 20)],
  'README.md': ['@@ -0,0 +1 @@', '+# readme'],
  'gone.ts': ['@@ -1 +0,0 @@', '-bye'],
}
const WORKSPACE = '/api/groups/g1/bots/b1/diff?scope=uncommitted'
const gitDiff = (path: string) =>
  `/api/groups/g1/bots/b1/git/diff?from=HEAD&path=${encodeURIComponent(path)}&context=100000`

const tab = (o: Partial<Extract<WorkbenchTab, { kind: 'diff' }>> = {}): WorkbenchTab => ({
  kind: 'diff',
  botId: 'b1',
  scope: 'uncommitted',
  file: null,
  ...o,
})
const current = () => useWorkbench.getState().benches.g1?.tabs ?? []

/** Renders the group's tabs as the workbench would: labels and mounted bodies. */
function Bench() {
  const tabs = useWorkbench((s) => s.benches.g1?.tabs ?? [])
  return (
    <>
      {tabs.map((t) => (
        <section key={tabKey(t)}>
          <TabLabel tab={t}>{(m) => <h2 data-icon={m.icon}>{m.title}</h2>}</TabLabel>
          <TabContent tab={t} active />
        </section>
      ))}
    </>
  )
}

let calls: string[]
beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const q = new URL(url, 'http://x').searchParams
      if (url.includes('/tree?')) return new Response(JSON.stringify({ entries: [], truncated: false }))
      if (url.includes('/git/diff?')) {
        const path = q.get('path') ?? ''
        const patch = [`diff --git a/${path} b/${path}`, ...(WHOLE[path] ?? []), ''].join('\n')
        return new Response(JSON.stringify({ patch, truncated: false }))
      }
      if (url.includes('/diff?')) {
        const scope = q.get('scope') as DiffScope
        return new Response(
          JSON.stringify({ scope, patch: PATCHES[scope] ?? null, base: 'main', branch: 'feat/x', repos: [] }),
        )
      }
      return new Response(JSON.stringify({ error: 'not_found', message: url }), { status: 404 })
    }),
  )
  useWorkspace.setState({ bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto], botStates: {} })
  useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
  useDiffSettings.setState({ view: 'unified', whitespace: 'none', highlight: 'words', fullContext: false })
  useDiffLayout.setState({ layout: 'list' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const open = (t = tab()) => {
  act(() => {
    useWorkbench.getState().show(t)
  })
  return render(<Bench />)
}

describe('diff tab', () => {
  it('shows a bot workspace diff with 未提交 / 对比主分支 only, keeping scope and file in the tab', async () => {
    open()
    expect(screen.getByRole('heading').textContent).toBe('改动 · 小王的 Claude')
    expect(screen.getByRole('heading').dataset.icon).toBe('git-branch')
    expect(await screen.findByText('+new')).toBeTruthy()
    expect(calls[0]).toBe('/api/groups/g1/bots/b1/diff?scope=uncommitted')
    expect(screen.queryByRole('radio', { name: '本轮' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }))
    expect(current()[0]).toMatchObject({ scope: 'uncommitted', file: 'README.md' })
    expect(await screen.findByText('+# readme')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '对比主分支' }))
    expect(current()[0]).toMatchObject({ scope: 'base', file: null })
    expect(await screen.findByText('+c')).toBeTruthy()
    expect(screen.getByText('feat/x → main')).toBeTruthy()
  })

  it('reads nothing while hidden, not even as the bot runs, and catches up once shown', async () => {
    let push: ((e: WebEvent) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h
      return () => {}
    })
    act(() => {
      useWorkbench.getState().show(tab())
    })
    const { rerender } = render(<TabContent tab={tab()} active={false} />)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() =>
        push?.({
          t: 'run.progress',
          runId: 'r1',
          groupId: 'g1',
          botId: 'b1',
          lastActivityAt: new Date().toISOString(),
        }),
      )
      act(() => vi.advanceTimersByTime(2000))
    } finally {
      vi.useRealTimers()
    }
    expect(calls).toEqual([])

    rerender(<TabContent tab={tab()} active />)
    expect(await screen.findByText('+new')).toBeTruthy()
    expect(calls).toEqual([WORKSPACE, gitDiff('src/app/a.ts')])
  })

  it('reads again when the bot’s git status changes (a commit, a branch switch, a refresh)', async () => {
    const git = (o: Partial<GitStatus>): GitStatus => ({
      branch: 'feat/x',
      ahead: null,
      behind: null,
      dirty: true,
      checkedAt: '2026-10-21T00:00:00.000Z',
      workspace: 'managed',
      repos: [],
      ...o,
    })
    const state = (g: GitStatus) =>
      act(() =>
        useWorkspace.setState({ botStates: { g1: { b1: { botId: 'b1', git: g } as GroupBotStateDto } } }),
      )
    const reads = () => calls.filter((c) => c === WORKSPACE)
    state(git({}))
    open()
    await screen.findByText('+new')
    expect(reads()).toHaveLength(1)
    state(git({ dirty: false, checkedAt: '2026-10-21T00:01:00.000Z' }))
    await waitFor(() => expect(reads()).toHaveLength(2))
    state(git({ branch: 'main', dirty: false, checkedAt: '2026-10-21T00:01:00.000Z' }))
    await waitFor(() => expect(reads()).toHaveLength(3))
    // The picked file's changes stayed the same: its diff isn't read again.
    expect(calls.filter((c) => c === gitDiff('src/app/a.ts'))).toHaveLength(1)
  })

  it('locates a changed file in the bot file browser', async () => {
    open()
    const row = (await screen.findByRole('button', { name: /a\.ts/ })).parentElement!
    fireEvent.click(within(row).getByRole('button', { name: '在文件浏览器中定位' }))
    expect(current().at(-1)).toEqual({ kind: 'files', botId: 'b1', dir: 'src/app', selected: 'src/app/a.ts' })
    expect(useWorkbench.getState().benches.g1?.active).toBe('files:b1')
  })

  it('folds the file list into a dropdown above the diff when narrow', async () => {
    const observers: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    open()
    await screen.findByText('+new')
    const pane = screen.getByTestId('diff-pane')
    expect(pane.dataset.layout).toBe('wide')
    expect(screen.getByRole('button', { name: /README\.md/ })).toBeTruthy()

    width.mockReturnValue(600)
    act(() => {
      for (const cb of observers) cb([], {} as ResizeObserver)
    })
    expect(pane.dataset.layout).toBe('narrow')
    expect(screen.queryByRole('button', { name: /README\.md/ })).toBeNull()
    const pick = screen.getByRole('button', { name: /src\/app\/a\.ts/ })
    expect(pick.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(pick)
    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }))
    expect(current()[0]).toMatchObject({ file: 'README.md' })
    expect(await screen.findByText('+# readme')).toBeTruthy()
    expect(screen.getByRole('button', { name: /README\.md/ }).getAttribute('aria-expanded')).toBe('false')
    width.mockRestore()
  })

  it('has the diff toolbar, reading 未提交 files again from git as its settings ask', async () => {
    open()
    expect(await screen.findByText('+new')).toBeTruthy()
    expect(calls).toEqual([WORKSPACE, gitDiff('src/app/a.ts')])
    expect(screen.getByRole('radio', { name: '统一' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '并排' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '上一处改动' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一处改动' })).toBeTruthy()
    // Named in the workspace's terms, like the list.
    expect(document.querySelector('.diff__name')?.textContent).toBe('src/app/a.ts')

    // The work tree's changes roll back one by one.
    expect(screen.getAllByRole('button', { name: '回滚此处改动' })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '空白处理' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '忽略空白' }))
    await waitFor(() =>
      expect(calls.at(-1)).toBe(
        '/api/groups/g1/bots/b1/git/diff?from=HEAD&path=src%2Fapp%2Fa.ts&whitespace=ignore&context=100000',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: '空白处理' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '不忽略' }))

    // 对比主分支 has no git read to redo: the patch at hand, under the toolbar without those settings.
    fireEvent.click(screen.getByRole('radio', { name: '对比主分支' }))
    expect(await screen.findByText('+c')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一处改动' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '空白处理' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: '显示完整文件' })).toBeNull()
    expect(screen.getByRole('button', { name: '高亮方式' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '回滚此处改动' })).toBeNull()
  })

  it('folds unchanged lines, a fold opening on click and all of them with 全部展开 or 显示完整文件', async () => {
    open()
    const fold = await screen.findByRole('button', { name: '展开 3 行未改动的内容' })
    const shown = () => document.querySelectorAll('.diff__line').length
    expect(shown()).toBe(14)
    fireEvent.click(fold)
    expect(shown()).toBe(17)
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
    expect(shown()).toBe(23)
    expect(screen.queryByRole('button', { name: /展开 \d+ 行未改动的内容/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }))
    expect(await screen.findByText('+# readme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /a\.ts/ }))
    expect(await screen.findByRole('button', { name: '展开 6 行未改动的内容' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '显示完整文件' }))
    expect(shown()).toBe(23)
  })

  it('steps through the changes with F7 / ⇧F7, and past either end on to the next or previous file', async () => {
    open()
    await screen.findByText('+new')
    const marked = () =>
      Array.from(document.querySelectorAll('[data-change]'), (b) => b.hasAttribute('data-current'))
    const f7 = (shiftKey = false) => fireEvent.keyDown(document.body, { key: 'F7', shiftKey })
    f7()
    expect(marked()).toEqual([true, false])
    f7()
    expect(marked()).toEqual([false, true])
    f7()
    expect(screen.getByRole('status').textContent).toBe('已是最后一处改动，再按 F7 转到下一个文件')
    f7()
    expect(current()[0]).toMatchObject({ file: 'README.md' })
    expect(await screen.findByText('+# readme')).toBeTruthy()
    await waitFor(() => expect(marked()).toEqual([true]))

    f7(true)
    expect(screen.getByRole('status').textContent).toBe('已是第一处改动，再按 ⇧F7 转到上一个文件')
    f7(true)
    expect(current()[0]).toMatchObject({ file: 'src/app/a.ts' })
    await waitFor(() => expect(marked()).toEqual([false, true]))
  })

  it('goes to the next or previous file with ⌥⇧→ / ⌥⇧← or the toolbar, in the order of the list', async () => {
    open()
    await screen.findByText('+new')
    expect(screen.getByRole('button', { name: '上一个文件' })).toHaveProperty('disabled', true)
    fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(current()[0]).toMatchObject({ file: 'README.md' })
    expect(await screen.findByText('+# readme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一个文件' }))
    expect(current()[0]).toMatchObject({ file: 'gone.ts' })
    expect(await screen.findByText('-bye')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一个文件' })).toHaveProperty('disabled', true)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true, shiftKey: true })
    expect(current()[0]).toMatchObject({ file: 'README.md' })

    // As a tree the list shows folders first, then files by name.
    act(() => useDiffLayout.setState({ layout: 'tree' }))
    expect(screen.getByRole('button', { name: '下一个文件' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '上一个文件' }))
    expect(current()[0]).toMatchObject({ file: 'gone.ts' })
    fireEvent.click(screen.getByRole('button', { name: '上一个文件' }))
    expect(current()[0]).toMatchObject({ file: 'src/app/a.ts' })
  })

  it('opens the file at a line with F4, its button or a new line number; not a deleted file', async () => {
    open()
    await screen.findByText('+new')
    const opened = () => current().find((t) => t.kind === 'file')
    fireEvent.keyDown(document.body, { key: 'F4' })
    expect(opened()).toEqual({
      kind: 'file',
      source: { botId: 'b1', path: 'src/app/a.ts', line: { from: 1, to: 1 } },
    })
    expect(useWorkbench.getState().benches.g1?.active).toBe('file:b1:src/app/a.ts')

    const row = [...document.querySelectorAll('.diff__line')].find((l) => l.textContent === '+X')
    fireEvent.click(row?.querySelectorAll('.diff__num')[1] as Element)
    expect(opened()).toMatchObject({ source: { line: { from: 11, to: 11 } } })

    act(() => useWorkbench.getState().closeTab('file:b1:src/app/a.ts'))
    fireEvent.click(screen.getByRole('button', { name: /gone\.ts/ }))
    expect(await screen.findByText('-bye')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '跳到源文件' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'F4' })
    expect(opened()).toBeUndefined()
  })
})
