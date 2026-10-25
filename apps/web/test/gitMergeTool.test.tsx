import type { GitChangesDto, GitConflictDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GitMergeTab } from '../src/features/workbench/tabs/GitMergeTab'
import {
  actionsCalled,
  BASE,
  benchTabs,
  CHANGES,
  done,
  resetStores,
  routes,
  state,
  status,
} from './gitFixtures'
import { mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => vi.unstubAllGlobals())

const MERGING: GitChangesDto = {
  ...CHANGES,
  changes: [],
  conflicts: [
    { path: 'src/order.ts', ours: 'modified', theirs: 'modified' },
    { path: 'src/legacy.ts', ours: 'modified', theirs: 'deleted' },
  ],
  ongoing: { kind: 'merge', subject: 'feat/fee', step: null, total: null, message: null },
}

/** Yours changed the first line, theirs the last, and both the fee: one conflict between two changes. */
const CONFLICT: GitConflictDto = {
  base: 'a\nx\nfee = 1\nb\nc\n',
  ours: 'A\nx\nfee = 2\nb\nc\n',
  theirs: 'a\nx\nfee = 3\nb\nC\n',
  merged: 'A\nx\n<<<<<<< ours\nfee = 2\n=======\nfee = 3\n>>>>>>> theirs\nb\nC\n',
  binary: false,
}

function Merge() {
  const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git-merge'))
  return tab?.kind === 'git-merge' ? (
    <GitMergeTab tab={tab} tabKey={`git-merge:b1::${tab.path}`} active />
  ) : null
}

function open() {
  useWorkspace.setState({
    botStates: { g1: { b1: state({ git: status({ ongoing: 'merge', conflicts: 2 }) }) } },
  })
  useWorkbench.getState().show({ kind: 'git-merge', botId: 'b1', repo: null, path: 'src/order.ts' })
  return render(<Merge />)
}

const conflictApi = (conflict: GitConflictDto = CONFLICT, changes: GitChangesDto = MERGING) =>
  mockApi(
    routes({
      [`GET ${BASE}/changes`]: changes,
      [`GET ${BASE}/conflict?path=src%2Forder.ts`]: conflict,
      [`GET ${BASE}/conflict?path=src%2Flegacy.ts`]: { ...CONFLICT, merged: null, theirs: null },
      [`POST ${BASE}/actions`]: done,
    }),
  )
const row = (name: string) => within(screen.getByRole('group', { name }))
const result = (name: string) => (screen.getByRole('textbox', { name }) as HTMLTextAreaElement).value

describe('merge tool', () => {
  it('shows yours | result | theirs with the changes of one side taken and the conflict open', async () => {
    conflictApi()
    open()
    expect(await screen.findByText('你的 · feat/refund-v2')).toBeTruthy()
    expect(screen.getByText('他们的 · feat/fee')).toBeTruthy()
    expect(screen.getByText('结果')).toBeTruthy()
    expect(screen.getByText('1 处冲突，已解决 0 处')).toBeTruthy()
    // The two changes no other is in the way of are in the result already.
    expect(screen.getByRole('group', { name: '改动 1' }).dataset.done).toBe('true')
    expect(result('第 1 行起的合并结果')).toBe('A')
    expect(result('第 5 行起的合并结果')).toBe('C')
    expect(result('冲突 1 的合并结果')).toBe('fee = 1')
    const c = row('冲突 1')
    expect(c.getByText('fee = 2')).toBeTruthy()
    expect(c.getByText('fee = 3')).toBeTruthy()
  })

  it('accepts a side, then the other after it; ignores and undoes', async () => {
    conflictApi()
    open()
    await screen.findByText('1 处冲突，已解决 0 处')
    fireEvent.click(row('冲突 1').getByRole('button', { name: '接受你的' }))
    expect(result('冲突 1 的合并结果')).toBe('fee = 2')
    expect(screen.getByText('1 处冲突，已解决 0 处')).toBeTruthy()
    fireEvent.click(row('冲突 1').getByRole('button', { name: '接受他们的' }))
    expect(result('冲突 1 的合并结果')).toBe('fee = 2\nfee = 3')
    expect(screen.getByText('1 处冲突，已解决 1 处')).toBeTruthy()
    fireEvent.click(row('冲突 1').getByRole('button', { name: '撤销此处' }))
    expect(result('冲突 1 的合并结果')).toBe('fee = 1')
    fireEvent.click(row('冲突 1').getByRole('button', { name: '忽略你的' }))
    fireEvent.click(row('冲突 1').getByRole('button', { name: '忽略他们的' }))
    expect(screen.getByText('1 处冲突，已解决 1 处')).toBeTruthy()
    // A non-conflicting change undone, then taken again from the toolbar.
    fireEvent.click(row('改动 1').getByRole('button', { name: '撤销此处' }))
    expect(result('第 1 行起的合并结果')).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: '应用非冲突改动' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '应用左侧的非冲突改动' }))
    expect(result('第 1 行起的合并结果')).toBe('A')
  })

  it('takes typing into a conflict as resolving it, and writes the result, then opens the next file', async () => {
    const calls = conflictApi()
    open()
    await screen.findByText('1 处冲突，已解决 0 处')
    fireEvent.change(screen.getByRole('textbox', { name: '冲突 1 的合并结果' }), {
      target: { value: 'fee = 4' },
    })
    expect(screen.getByText('1 处冲突，已解决 1 处')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'resolve', path: 'src/order.ts', content: 'A\nx\nfee = 4\nb\nC\n' },
      ]),
    )
    // The next conflicted file: theirs deleted it, so only a whole side can be kept.
    expect(await screen.findByText('两边对这个文件的处理不同，请选择保留哪一方')).toBeTruthy()
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'git-merge', path: 'src/legacy.ts' })
    expect(screen.getByText('删除了文件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保留你的版本' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'resolve', path: 'src/legacy.ts', side: 'ours' }),
    )
  })

  it('asks before applying with conflicts left, marking them resolved as the result has them', async () => {
    const calls = conflictApi()
    open()
    await screen.findByText('1 处冲突，已解决 0 处')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    const d = within(await screen.findByRole('alertdialog'))
    expect(d.getByText('还有 1 处冲突未解决，仍然应用并标记为已解决？')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '取消' }))
    expect(actionsCalled(calls)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '仍然应用' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'resolve', path: 'src/order.ts', content: 'A\nx\nfee = 1\nb\nC\n' },
      ]),
    )
  })

  it('takes a whole side from the bottom bar', async () => {
    const calls = conflictApi()
    open()
    fireEvent.click(await screen.findByRole('button', { name: '全部接受他们的' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'resolve', path: 'src/order.ts', side: 'theirs' }]),
    )
  })

  it('resolves simple conflicts with the magic wand', async () => {
    const calls = conflictApi({ base: '1\n2\n', ours: 'X\n2\n', theirs: '1\nY\n', merged: '', binary: false })
    open()
    await screen.findByText('1 处冲突，已解决 0 处')
    fireEvent.click(screen.getByRole('button', { name: '解决简单冲突' }))
    expect(screen.getByText('1 处冲突，已解决 1 处')).toBeTruthy()
    expect((screen.getByRole('button', { name: '解决简单冲突' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'resolve', path: 'src/order.ts', content: 'X\nY\n' }]),
    )
  })

  it('steps through the conflicts with F7 and ⇧F7, starting on the first', async () => {
    conflictApi({
      base: 'a\n1\nb\nc\nd\n2\ne\n',
      ours: 'a\nO1\nb\nc\nd\nO2\ne\n',
      theirs: 'a\nT1\nb\nc\nd\nT2\ne\n',
      merged: '',
      binary: false,
    })
    open()
    await screen.findByText('2 处冲突，已解决 0 处')
    const current = () =>
      screen
        .getAllByRole('group')
        .find((g) => g.dataset.current)
        ?.getAttribute('aria-label')
    expect(current()).toBe('冲突 1')
    fireEvent.keyDown(screen.getByRole('textbox', { name: '冲突 1 的合并结果' }), { key: 'F7' })
    expect(current()).toBe('冲突 2')
    fireEvent.keyDown(screen.getByRole('textbox', { name: '冲突 2 的合并结果' }), {
      key: 'F7',
      shiftKey: true,
    })
    expect(current()).toBe('冲突 1')
    fireEvent.click(screen.getByRole('button', { name: '下一处冲突' }))
    expect(current()).toBe('冲突 2')
  })

  it('keeps the merge in progress when the tab is left and come back to', async () => {
    conflictApi()
    const view = open()
    await screen.findByText('1 处冲突，已解决 0 处')
    fireEvent.click(row('冲突 1').getByRole('button', { name: '接受他们的' }))
    view.unmount()
    open()
    expect(await screen.findByText('1 处冲突，已解决 0 处')).toBeTruthy()
    expect(result('冲突 1 的合并结果')).toBe('fee = 3')
  })

  it('merges a CRLF file line by line and writes it back with CRLF', async () => {
    const crlf = (s: string) => s.replaceAll('\n', '\r\n')
    const calls = conflictApi({
      base: crlf(CONFLICT.base ?? ''),
      ours: crlf(CONFLICT.ours ?? ''),
      theirs: crlf(CONFLICT.theirs ?? ''),
      merged: crlf(CONFLICT.merged ?? ''),
      binary: false,
    })
    open()
    await screen.findByText('1 处冲突，已解决 0 处')
    fireEvent.click(row('冲突 1').getByRole('button', { name: '忽略你的' }))
    fireEvent.click(row('冲突 1').getByRole('button', { name: '接受他们的' }))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'resolve', path: 'src/order.ts', content: 'A\r\nx\r\nfee = 3\r\nb\r\nC\r\n' },
      ]),
    )
  })

  it('names the sides of a rebase as IDEA does: the rebased commits and the commit being replayed', async () => {
    conflictApi(CONFLICT, {
      ...MERGING,
      ongoing: { kind: 'rebase', subject: 'feat/fee', step: 1, total: 2, message: null },
    })
    open()
    expect(await screen.findByText('已变基的提交 · a1b2c3d')).toBeTruthy()
    expect(screen.getByText('正在重放的提交 · feat/fee')).toBeTruthy()
  })

  it('shows the base on demand and can ignore whitespace', async () => {
    conflictApi({ base: 'a\nb\n', ours: 'a\n  b\n', theirs: 'a\nb\n', merged: '', binary: false })
    open()
    await screen.findByText('0 处冲突，已解决 0 处')
    expect(screen.getByRole('group', { name: '改动 1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '忽略空白' }))
    expect(screen.queryByRole('group', { name: '改动 1' })).toBeNull()
    expect(screen.queryByText('基准')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示基准' }))
    expect(screen.getByText('基准')).toBeTruthy()
  })
})
