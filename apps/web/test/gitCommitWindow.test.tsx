import type { GitChangesDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GitDialogHost } from '../src/features/git/dialogs/GitDialogHost'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import { Toaster } from '../src/ui'
import {
  actionsCalled,
  BASE,
  benchTabs,
  CHANGES,
  done,
  HEAD_COMMIT,
  REFS,
  resetStores,
  routes,
  setMe,
  state,
  status,
  toasts,
} from './gitFixtures'
import { mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The bot's Git tab as the workbench shows it, with the git dialogs and the toasts. */
function Bench() {
  const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git'))
  return (
    <>
      {tab?.kind === 'git' ? <GitTab tab={tab} tabKey={`git:${tab.botId}`} active /> : null}
      <GitDialogHost />
      <Toaster />
    </>
  )
}

async function openGit(git = status(), repo: string | null = null) {
  useWorkspace.setState({ botStates: { g1: { b1: state({ git }) } } })
  useWorkbench.getState().show({ kind: 'git', botId: 'b1', ...(repo && { repo }) })
  render(<Bench />)
  return within(await screen.findByTestId('git-tab'))
}
type Scope = ReturnType<typeof within>
const treeOf = async (tab: Scope) => within(await tab.findByRole('region', { name: '要提交的文件' }))
const box = (tab: Scope) => tab.getByRole('textbox', { name: '提交说明' }) as HTMLTextAreaElement
const pick = (scope: Scope, name: string) =>
  scope.getByRole('checkbox', { name: `选择 ${name}` }) as HTMLInputElement
const dialog = async (name: string | RegExp) => within(await screen.findByRole('dialog', { name }))
const selectedRows = () =>
  [...document.querySelectorAll('.gt-file[data-selected]')].map((b) => b.getAttribute('aria-label'))
const menuLabels = async () =>
  (await screen.findAllByRole('menuitem')).map((m) => m.querySelector('.ui-menu__label')?.textContent)
const focused = () => document.activeElement as HTMLElement
const press = (key: string, o: Record<string, unknown> = {}) => fireEvent.keyDown(focused(), { key, ...o })
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

const [A, B, NEW] = CHANGES.changes as [
  GitChangesDto['changes'][number],
  GitChangesDto['changes'][number],
  GitChangesDto['changes'][number],
]
const STAGED = {
  path: 'src/fee.ts',
  change: 'added' as const,
  oldPath: null,
  untracked: false,
  add: 3,
  del: 0,
}
const MERGING: GitChangesDto = {
  ...CHANGES,
  changes: [A],
  conflicts: [
    { path: 'src/order.ts', ours: 'modified', theirs: 'modified' },
    { path: 'src/legacy.ts', ours: 'modified', theirs: 'deleted' },
  ],
  ongoing: {
    kind: 'merge',
    subject: 'feat/fee',
    step: null,
    total: null,
    message: "Merge branch 'feat/fee'",
  },
}

describe('commit message draft', () => {
  it('outlives the view and the tab, kept in this browser until a commit takes it', async () => {
    const calls = mockApi(
      routes({ [`GET ${BASE}/stashes`]: { stashes: [] }, [`POST ${BASE}/actions`]: done }),
    )
    let tab = await openGit()
    await treeOf(tab)
    fireEvent.change(box(tab), { target: { value: '修复退款' } })
    fireEvent.click(tab.getByRole('checkbox', { name: '修改上一次提交' }))
    fireEvent.click(tab.getByRole('tab', { name: '贮藏' }))
    expect(tab.queryByRole('textbox', { name: '提交说明' })).toBeNull()
    fireEvent.click(tab.getByRole('tab', { name: /^提交/ }))
    expect(box(tab).value).toBe('修复退款')
    expect((tab.getByRole('checkbox', { name: '修改上一次提交' }) as HTMLInputElement).checked).toBe(true)
    expect(JSON.parse(localStorage.getItem('gg.git.drafts') ?? '{}')).toEqual({
      'g1:b1:': { message: '修复退款', amend: true, checks: {} },
    })

    // The tab closed and opened again.
    cleanup()
    tab = await openGit()
    await treeOf(tab)
    expect(box(tab).value).toBe('修复退款')
    fireEvent.click(tab.getByRole('button', { name: '修改提交' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        {
          action: 'commit',
          message: '修复退款',
          paths: ['src/a.ts', 'old.ts', 'b.ts'],
          amend: true,
          expectHead: HEAD_COMMIT.hash,
        },
      ]),
    )
    await waitFor(() => expect(box(tab).value).toBe(''))
    expect((tab.getByRole('checkbox', { name: '修改上一次提交' }) as HTMLInputElement).checked).toBe(false)
    expect(localStorage.getItem('gg.git.drafts')).toBe('{}')
  })

  it('keeps the commit box while the changes load', async () => {
    let release: (v: unknown) => void = () => {}
    mockApi(
      routes({
        [`GET ${BASE}/changes`]: new Promise((r) => {
          release = r
        }),
      }),
    )
    const tab = await openGit()
    fireEvent.change(box(tab), { target: { value: 'wip' } })
    release(CHANGES)
    await treeOf(tab)
    expect(box(tab).value).toBe('wip')
  })
})

describe('commit checkboxes', () => {
  it('leave untracked files out, keep what was picked across refreshes and pick new tracked changes', async () => {
    let current: GitChangesDto = CHANGES
    mockApi(routes({ [`GET ${BASE}/changes`]: () => current }))
    const tab = await openGit()
    const tree = await treeOf(tab)
    expect(pick(tree, 'src/a.ts').checked).toBe(true)
    expect(pick(tree, 'b.ts').checked).toBe(true)
    expect(pick(tree, 'src/new.ts').checked).toBe(false)
    expect(pick(tree, '未跟踪的文件').checked).toBe(false)
    expect(tab.getByText('已选 2 / 3 个文件')).toBeTruthy()

    fireEvent.click(pick(tree, 'src/new.ts'))
    fireEvent.click(pick(tree, 'src/a.ts'))
    current = {
      ...CHANGES,
      changes: [
        ...CHANGES.changes,
        { path: 'src/c.ts', change: 'modified', oldPath: null, untracked: false, add: 1, del: 0 },
        { path: 'later.md', change: 'added', oldPath: null, untracked: true, add: 1, del: 0 },
      ],
    }
    fireEvent.click(tab.getByRole('button', { name: '刷新' }))
    await tree.findByRole('button', { name: '修改：src/c.ts' })
    expect(
      ['src/a.ts', 'b.ts', 'src/new.ts', 'src/c.ts', 'later.md'].map((p) => pick(tree, p).checked),
    ).toEqual([false, true, true, true, false])
    expect(tab.getByText('已选 3 / 5 个文件')).toBeTruthy()
  })

  it('Space checks the selected row, wherever the focus was', async () => {
    mockApi(routes())
    const tab = await openGit()
    const tree = await treeOf(tab)
    const a = pick(tree, 'src/a.ts')
    a.focus()
    fireEvent.click(a)
    expect(a.checked).toBe(false)
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(benchTabs()[0]).toMatchObject({ file: 'b.ts' })
    press(' ')
    expect(pick(tree, 'b.ts').checked).toBe(false)
    expect(pick(tree, 'src/a.ts').checked).toBe(false)
  })
})

describe('a merge, pick or revert in progress', () => {
  it('finishes the merge from the commit box with git’s message, once no conflict is left', async () => {
    let current: GitChangesDto = MERGING
    const calls = mockApi(routes({ [`GET ${BASE}/changes`]: () => current, [`POST ${BASE}/actions`]: done }))
    const tab = await openGit(status({ ongoing: 'merge', conflicts: 2 }))
    await treeOf(tab)
    expect(box(tab).value).toBe("Merge branch 'feat/fee'")
    expect((tab.getByRole('button', { name: '提交合并' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector('.gc-box__hint')?.textContent).toBe('2 个文件有冲突，解决后才能继续')
    expect((tab.getByRole('checkbox', { name: '修改上一次提交' }) as HTMLInputElement).disabled).toBe(true)

    current = { ...MERGING, conflicts: [] }
    fireEvent.click(tab.getByRole('button', { name: '刷新' }))
    await waitFor(() =>
      expect((tab.getByRole('button', { name: '提交合并' }) as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.change(box(tab), { target: { value: "Merge branch 'feat/fee' into main" } })
    fireEvent.click(tab.getByRole('button', { name: '提交合并' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'continue', message: "Merge branch 'feat/fee' into main" },
      ]),
    )
  })

  it('continues a cherry-pick from the commit box', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/changes`]: {
          ...CHANGES,
          ongoing: {
            kind: 'cherry-pick',
            subject: 'c0ffee1',
            step: null,
            total: null,
            message: '修复手续费',
          },
        },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    const tab = await openGit(status({ ongoing: 'cherry-pick' }))
    await treeOf(tab)
    expect(box(tab).value).toBe('修复手续费')
    // The banner offers it too.
    fireEvent.click(
      within(box(tab).closest('.gc-box') as HTMLElement).getByRole('button', { name: '继续优选' }),
    )
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'continue', message: '修复手续费' }]))
  })
})

describe('selecting and opening', () => {
  it('selects with a click or the arrows, opens with a double click or Enter; a conflict waits for Enter', async () => {
    const width = narrow(600)
    mockApi(routes({ [`GET ${BASE}/changes`]: MERGING }))
    const tab = await openGit(status({ ongoing: 'merge', conflicts: 2 }))
    const tree = await treeOf(tab)
    const a = tree.getByRole('button', { name: '修改：src/a.ts' })
    fireEvent.click(a)
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', file: 'src/a.ts' }])
    // a.ts → its folder → the 更改 group → order.ts → legacy.ts
    for (const _ of [1, 2, 3, 4]) press('ArrowUp')
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', file: 'src/legacy.ts' }])
    press('Enter')
    expect(benchTabs().at(-1)).toEqual({ kind: 'git-merge', botId: 'b1', repo: null, path: 'src/legacy.ts' })

    fireEvent.doubleClick(a)
    expect(benchTabs().at(-1)).toEqual({
      kind: 'diff',
      botId: 'b1',
      scope: 'uncommitted',
      file: 'src/a.ts',
      repo: null,
    })
    width.mockRestore()
  })

  it('opens a sub-repo’s change and file by their path from the workspace root', async () => {
    mockApi(
      routes({
        [`GET ${BASE}/changes?repo=libs%2Fcore`]: CHANGES,
        [`GET ${BASE}/refs?repo=libs%2Fcore`]: REFS,
      }),
    )
    const git = status({
      repos: [{ path: 'libs/core', kind: 'submodule', branch: 'dev', ahead: 0, behind: 0, dirty: true }],
    })
    const tab = await openGit(git, 'libs/core')
    const tree = await treeOf(tab)
    const a = tree.getByRole('button', { name: '修改：src/a.ts' })
    fireEvent.click(a)
    fireEvent.doubleClick(a)
    expect(benchTabs().at(-1)).toEqual({
      kind: 'diff',
      botId: 'b1',
      scope: 'uncommitted',
      file: 'libs/core/src/a.ts',
      repo: 'libs/core',
    })
    fireEvent.click(tab.getByRole('button', { name: '显示差异' }))
    expect(benchTabs().filter((t) => t.kind === 'diff')).toHaveLength(1)
    press('F4')
    expect(benchTabs().at(-1)).toEqual({ kind: 'file', source: { botId: 'b1', path: 'libs/core/src/a.ts' } })
  })

  it('picks several files with ⌘ and ⇧, ⇧↑↓ and ⌘A; Space checks them all, ⌘⌥Z rolls back the tracked ones', async () => {
    mockApi(routes())
    const tab = await openGit()
    const tree = await treeOf(tab)
    const row = (name: string) => tree.getByRole('button', { name })
    fireEvent.click(row('修改：src/a.ts'))
    fireEvent.click(row('未跟踪：src/new.ts'), { metaKey: true })
    expect(selectedRows()).toEqual(['修改：src/a.ts', '未跟踪：src/new.ts'])
    fireEvent.click(row('修改：src/a.ts'), { metaKey: true })
    expect(selectedRows()).toEqual(['未跟踪：src/new.ts'])

    fireEvent.click(row('修改：src/a.ts'))
    fireEvent.click(row('未跟踪：src/new.ts'), { shiftKey: true })
    expect(selectedRows()).toEqual(['修改：src/a.ts', '重命名：b.ts', '未跟踪：src/new.ts'])

    fireEvent.click(row('修改：src/a.ts'))
    press('ArrowDown', { shiftKey: true })
    expect(selectedRows()).toEqual(['修改：src/a.ts', '重命名：b.ts'])

    fireEvent.click(row('重命名：b.ts'))
    press('a', { metaKey: true })
    expect(selectedRows()).toEqual(['修改：src/a.ts', '重命名：b.ts', '未跟踪：src/new.ts'])
    press(' ')
    expect(tab.getByText('已选 3 / 3 个文件')).toBeTruthy()
    press(' ')
    expect(tab.getByText('勾选要提交的文件')).toBeTruthy()

    press('Ω', { code: 'KeyZ', metaKey: true, altKey: true })
    const d = await dialog('回滚改动')
    expect(d.getByText('将 2 个文件恢复到上次提交的状态')).toBeTruthy()
    expect(
      within(d.getByRole('region', { name: '要回滚的文件' })).queryByRole('button', { name: /new\.ts/ }),
    ).toBeNull()
  })

  it('folds a folder with ←, unfolds it with →, and ⌘D shows the diff', async () => {
    mockApi(routes())
    const tab = await openGit()
    const tree = await treeOf(tab)
    fireEvent.click(tree.getByRole('button', { name: '修改：src/a.ts' }))
    press('ArrowLeft')
    expect(focused().textContent).toBe('src1')
    expect(focused().getAttribute('aria-expanded')).toBe('true')
    press('ArrowLeft')
    expect(tree.queryByRole('button', { name: '修改：src/a.ts' })).toBeNull()
    press('ArrowDown')
    expect(benchTabs()[0]).toMatchObject({ file: 'b.ts' })
    press('ArrowUp')
    press('ArrowRight')
    press('ArrowDown')
    expect(benchTabs()[0]).toMatchObject({ file: 'src/a.ts' })
    press('d', { metaKey: true })
    expect(benchTabs().at(-1)).toEqual({
      kind: 'diff',
      botId: 'b1',
      scope: 'uncommitted',
      file: 'src/a.ts',
      repo: null,
    })
  })
})

describe('file context menu', () => {
  it('annotates tracked files; adds untracked ones to git or .gitignore, or deletes them', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    const tab = await openGit()
    const tree = await treeOf(tab)
    fireEvent.contextMenu(tree.getByRole('button', { name: '修改：src/a.ts' }))
    expect(await menuLabels()).toEqual([
      '显示差异',
      '打开文件',
      '注解',
      '回滚…',
      '贮藏所选文件…',
      '复制为补丁',
      '显示历史',
      '复制路径',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: '注解' }))
    expect(benchTabs().at(-1)).toMatchObject({
      kind: 'file',
      source: { botId: 'b1', path: 'src/a.ts', annotate: expect.any(Number) },
    })

    const untracked = tree.getByRole('button', { name: '未跟踪：src/new.ts' })
    fireEvent.contextMenu(untracked)
    expect(await menuLabels()).toEqual([
      '显示差异',
      '打开文件',
      '注解',
      '回滚…',
      '删除…',
      '加入版本控制',
      '加入 .gitignore…',
      '贮藏所选文件…',
      '复制为补丁',
      '显示历史',
      '复制路径',
    ])
    for (const name of ['注解', /^回滚…/, '显示历史'])
      expect(screen.getByRole('menuitem', { name }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: '加入版本控制' }))
    await waitFor(() => expect(actionsCalled(calls).at(-1)).toEqual({ action: 'add', paths: ['src/new.ts'] }))

    fireEvent.contextMenu(untracked)
    fireEvent.click(await screen.findByRole('menuitem', { name: '加入 .gitignore…' }))
    const ignore = await dialog('加入 .gitignore')
    expect(ignore.getByText('/src/new.ts')).toBeTruthy()
    fireEvent.click(ignore.getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'ignore', paths: ['src/new.ts'] }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.contextMenu(untracked)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除…' }))
    const del = await dialog('删除未跟踪的文件')
    expect(del.getByText('src/new.ts')).toBeTruthy()
    fireEvent.click(del.getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'discard', paths: ['src/new.ts'] }),
    )
  })

  it('acts on every selected file: copies them as a patch or their paths, stashes them', async () => {
    const writeText = vi.fn(async (_: string) => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const patchA = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n'
    const patchNew =
      'diff --git a/src/new.ts b/src/new.ts\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+n\n'
    mockApi(
      routes({
        [`GET ${BASE}/diff?from=HEAD&path=src%2Fa.ts`]: { patch: patchA, truncated: false },
        [`GET ${BASE}/diff?from=HEAD&path=src%2Fnew.ts`]: { patch: patchNew, truncated: false },
      }),
    )
    const tab = await openGit()
    const tree = await treeOf(tab)
    const row = (name: string) => tree.getByRole('button', { name })
    fireEvent.click(row('修改：src/a.ts'))
    fireEvent.click(row('未跟踪：src/new.ts'), { metaKey: true })
    fireEvent.contextMenu(row('修改：src/a.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制为补丁' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(patchA + patchNew))
    await waitFor(() => expect(toasts()).toContain('已复制补丁'))

    fireEvent.contextMenu(row('未跟踪：src/new.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制路径' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('src/a.ts\nsrc/new.ts'))

    fireEvent.contextMenu(row('修改：src/a.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '贮藏所选文件…' }))
    const s = await dialog('贮藏改动')
    expect(s.getByText('只贮藏选中的 2 个文件')).toBeTruthy()
    fireEvent.click(s.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Right-clicking a file outside the selection selects it alone, as in IDEA.
    fireEvent.contextMenu(row('重命名：b.ts'))
    expect(selectedRows()).toEqual(['重命名：b.ts'])
  })
})

describe('rollback dialog', () => {
  it('lists the files to roll back, all ticked, and keeps added files on disk when asked', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/changes`]: { ...CHANGES, changes: [A, B, NEW, STAGED] },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    const tab = await openGit()
    const tree = await treeOf(tab)
    fireEvent.contextMenu(tree.getByRole('button', { name: /^更改/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^回滚…/ }))
    const d = await dialog('回滚改动')
    const files = within(d.getByRole('region', { name: '要回滚的文件' }))
    expect(files.getByRole('button', { name: '新增：src/fee.ts' })).toBeTruthy()
    expect(files.queryByRole('button', { name: '未跟踪：src/new.ts' })).toBeNull()
    expect(d.getByText('将 3 个文件恢复到上次提交的状态')).toBeTruthy()
    fireEvent.click(files.getByRole('checkbox', { name: '选择 b.ts' }))
    expect(d.getByText('将 2 个文件恢复到上次提交的状态')).toBeTruthy()
    const deleteAdded = d.getByRole('checkbox', { name: '删除新增文件的本地副本' }) as HTMLInputElement
    expect(deleteAdded.checked).toBe(true)
    fireEvent.click(deleteAdded)
    fireEvent.click(d.getByRole('button', { name: '回滚' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'discard', paths: ['src/a.ts', 'src/fee.ts'], keepAdded: true },
      ]),
    )
  })

  it('rolls back the selected file from the toolbar; others request it', async () => {
    setMe('u2')
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    const tab = await openGit()
    const tree = await treeOf(tab)
    fireEvent.click(tree.getByRole('button', { name: '重命名：b.ts' }))
    fireEvent.click(tab.getByRole('button', { name: '回滚所选文件…' }))
    const d = await dialog('回滚改动')
    expect(d.getByText('将 1 个文件恢复到上次提交的状态')).toBeTruthy()
    expect(d.queryByRole('checkbox', { name: '删除新增文件的本地副本' })).toBeNull()
    expect(d.getByText('需要 Bot 主人 小王 批准后才会执行')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '提交申请' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['old.ts', 'b.ts'] }]),
    )
  })
})

describe('commit message checks and the committed notice', () => {
  it('flags a long first line and a missing blank line, without stopping the commit', async () => {
    mockApi(routes())
    const tab = await openGit()
    await treeOf(tab)
    fireEvent.change(box(tab), { target: { value: 'x'.repeat(73) } })
    expect(tab.getByText('首行超过 72 个字符')).toBeTruthy()
    fireEvent.change(box(tab), { target: { value: '修复退款\n按原路退回' } })
    expect(tab.queryByText('首行超过 72 个字符')).toBeNull()
    expect(tab.getByText('首行与正文之间应空一行')).toBeTruthy()
    expect((tab.getByRole('button', { name: '提交' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(box(tab), { target: { value: '修复退款\n\n按原路退回' } })
    expect(tab.queryByText('首行与正文之间应空一行')).toBeNull()
  })

  it('says what was committed, offering to edit the message', async () => {
    mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    const tab = await openGit()
    await treeOf(tab)
    fireEvent.change(box(tab), { target: { value: '修复退款\n\n按原路退回' } })
    fireEvent.click(tab.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('已提交 2 个文件：修复退款')).toBeTruthy()
    expect(toasts()).not.toContain('小王的 Claude：提交完成')
    fireEvent.click(screen.getByRole('button', { name: '编辑说明' }))
    const d = await dialog('编辑提交说明')
    expect((d.getByRole('textbox', { name: '提交说明' }) as HTMLTextAreaElement).value).toBe(
      '修复退款金额\n\n按原路退回。',
    )
    expect(toasts()).not.toContain('已提交 2 个文件：修复退款')
  })
})
