import type { GitCommit } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { gitCommands, useGitDialogs } from '../src/features/git/commands'
import { GitDialogHost } from '../src/features/git/dialogs/GitDialogHost'
import { Toaster } from '../src/ui'
import { actionsCalled, BASE, CHANGES, done, resetStores, routes, setMe, state } from './gitFixtures'
import { apiError, mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => useWorkspace.setState({ botStates: { g1: { b1: state() } } }))

const TARGET = { groupId: 'g1', botId: 'b1', repo: null }
const BASE_COMMIT = '4444444444444444444444444444444444444444'
const commit = (n: string, parents = 1): GitCommit => ({
  hash: `${n.repeat(40)}`,
  shortHash: n.repeat(7),
  author: '小王',
  email: 'w@corp',
  at: '2026-10-20T00:00:00.000Z',
  subject: `提交 ${n}`,
  parents: Array.from({ length: parents }, (_, i) => `${i + 1}`.repeat(40)),
  refs: [],
})
const LOG = [commit('1'), commit('2'), commit('3'), commit('4')]
const logRoute = {
  [`GET ${BASE}/log?ref=${encodeURIComponent(`${BASE_COMMIT}..HEAD`)}&skip=0`]: { commits: LOG, hasMore: false },
}
const open = (pushed = false) => {
  render(
    <>
      <GitDialogHost />
      <Toaster />
    </>,
  )
  act(() => gitCommands(TARGET).rebaseInteractive(commit('4'), pushed))
}
const dialog = () => within(screen.getByRole('dialog', { name: '交互式变基 feat/refund-v2' }))
const row = (n: string) => dialog().getByRole('option', { name: new RegExp(`提交 ${n}`) })
const pickAction = async (n: string, action: string) => {
  fireEvent.click(within(row(n)).getByRole('button', { name: `提交 提交 ${n} 的动作` }))
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: action }))
}

describe('interactive rebase', () => {
  it('opens from the selected commit and lists onto..HEAD oldest first', async () => {
    mockApi(routes(logRoute))
    open()
    expect(useGitDialogs.getState().open?.dialog).toEqual({
      kind: 'rebase-todo',
      commit: commit('4'),
      pushed: false,
    })
    expect(await dialog().findByText('变基到 4444444')).toBeTruthy()
    await waitFor(() => expect(dialog().getAllByRole('option')).toHaveLength(4))
    expect(dialog().getAllByRole('option').map((r) => r.textContent?.match(/提交 \d/)?.[0])).toEqual([
      '提交 4',
      '提交 3',
      '提交 2',
      '提交 1',
    ])
  })

  it('reorders, rewords, squashes, fixups and drops, sending the complete plan', async () => {
    const calls = mockApi(routes({ ...logRoute, [`POST ${BASE}/actions`]: done }))
    open()
    await dialog().findAllByRole('option')
    await waitFor(() => expect(dialog().getAllByRole('option')).toHaveLength(4))
    fireEvent.click(within(row('4')).getByRole('button', { name: '下移 提交 4' }))
    await pickAction('4', 'Reword')
    fireEvent.change(dialog().getByRole('textbox', { name: '提交 提交 4 的提交说明' }), { target: { value: '' } })
    const message = dialog().getByRole('textbox', { name: '提交 提交 4 的提交说明' })
    fireEvent.change(message, { target: { value: '重写的说明\n\n正文' } })
    await pickAction('2', 'Squash')
    fireEvent.change(dialog().getByRole('textbox', { name: '提交 提交 2 的提交说明' }), {
      target: { value: '合并后的说明' },
    })
    await pickAction('1', 'Drop')
    fireEvent.click(dialog().getByRole('button', { name: '开始变基' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        {
          action: 'rebase',
          branch: 'feat/refund-v2',
          onto: BASE_COMMIT,
          todo: [
            { action: 'pick', commit: commit('3').hash },
            { action: 'reword', commit: commit('4').hash, message: '重写的说明\n\n正文' },
            { action: 'squash', commit: commit('2').hash, message: '合并后的说明' },
            { action: 'drop', commit: commit('1').hash },
          ],
        },
      ]),
    )
  })

  it('requires reword and squash messages and refuses a first squash', async () => {
    const calls = mockApi(routes({ ...logRoute, [`POST ${BASE}/actions`]: done }))
    open()
    await dialog().findAllByRole('option')
    await pickAction('4', 'Squash')
    expect(dialog().getByText('第一个保留的提交不能 Squash 或 Fixup')).toBeTruthy()
    expect((dialog().getByRole('button', { name: '开始变基' }) as HTMLButtonElement).disabled).toBe(true)
    await pickAction('4', 'Reword')
    fireEvent.change(dialog().getByRole('textbox', { name: '提交 提交 4 的提交说明' }), { target: { value: '' } })
    expect((dialog().getByRole('button', { name: '开始变基' }) as HTMLButtonElement).disabled).toBe(true)
    expect(dialog().getByText('Reword 和 Squash 必须填写非空说明')).toBeTruthy()
    expect(actionsCalled(calls)).toEqual([])
  })

  it('uses fixup without asking for another message', async () => {
    const calls = mockApi(routes({ ...logRoute, [`POST ${BASE}/actions`]: done }))
    open()
    await dialog().findAllByRole('option')
    await pickAction('3', 'Fixup')
    expect(dialog().queryByRole('textbox', { name: '提交 提交 3 的提交说明' })).toBeNull()
    fireEvent.click(dialog().getByRole('button', { name: '开始变基' }))
    await waitFor(() =>
      expect((actionsCalled(calls)[0] as { todo: unknown[] }).todo[1]).toEqual({
        action: 'fixup',
        commit: commit('3').hash,
      }),
    )
  })

  it('warns about published history and asks for confirmation before rewriting', async () => {
    mockApi(routes(logRoute))
    open(true)
    await dialog().findAllByRole('option')
    expect(dialog().getByText('这些提交已经推送，变基会改写公开历史，之后需要强制推送。')).toBeTruthy()
    expect((dialog().getByRole('button', { name: '开始变基' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(dialog().getByRole('checkbox', { name: '我确认改写已推送的历史' }))
    expect((dialog().getByRole('button', { name: '开始变基' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows merge and loading errors without enabling an invalid run', async () => {
    mockApi(
      routes({
        [`GET ${BASE}/log?ref=${encodeURIComponent(`${BASE_COMMIT}..HEAD`)}&skip=0`]: {
          commits: [commit('1', 2)],
          hasMore: false,
        },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    open()
    expect(await dialog().findByText('范围内有合并提交，不能在这里重排；请使用普通变基。')).toBeTruthy()
    expect((dialog().getByRole('button', { name: '开始变基' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('loads every page before enabling the run', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/log?ref=${encodeURIComponent(`${BASE_COMMIT}..HEAD`)}&skip=0`]: {
          commits: LOG.slice(0, 2),
          hasMore: true,
        },
        [`GET ${BASE}/log?ref=${encodeURIComponent(`${BASE_COMMIT}..HEAD`)}&skip=2`]: {
          commits: LOG.slice(2),
          hasMore: false,
        },
      }),
    )
    open()
    await waitFor(() => expect(dialog().getAllByRole('option')).toHaveLength(4))
    expect(calls.map((c) => c.path)).toContain(`${BASE}/log?ref=${encodeURIComponent(`${BASE_COMMIT}..HEAD`)}&skip=2`)
    expect((dialog().getByRole('button', { name: '开始变基' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('hands conflicts back to the existing ongoing flow', async () => {
    mockApi(
      routes({
        ...logRoute,
        [`POST ${BASE}/actions`]: (b: unknown) => ({
          ...done(b),
          status: 'failed',
          error: 'CONFLICT: content conflict',
        }),
        [`GET ${BASE}/changes`]: {
          ...CHANGES,
          conflicts: [{ path: 'src/a.ts', change: 'modified', oldPath: null }],
          ongoing: { kind: 'rebase', subject: 'feat/refund-v2', step: 2, total: 4, message: null },
        },
      }),
    )
    open()
    await dialog().findAllByRole('option')
    fireEvent.click(dialog().getByRole('button', { name: '开始变基' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps a git validation error in the dialog', async () => {
    mockApi(
      routes({
        ...logRoute,
        [`POST ${BASE}/actions`]: apiError(409, 'conflict', '提交不在要变基的提交中'),
      }),
    )
    open()
    await dialog().findAllByRole('option')
    fireEvent.click(dialog().getByRole('button', { name: '开始变基' }))
    await waitFor(() => expect(dialog().getByRole('button', { name: '开始变基' })).toBeTruthy())
    expect(screen.getByRole('dialog', { name: '交互式变基 feat/refund-v2' })).toBeTruthy()
  })

  it('words a non-owner run as an approval request', async () => {
    setMe('u2')
    const calls = mockApi(routes(logRoute))
    open()
    await dialog().findAllByRole('option')
    expect(dialog().getByText('需要 Bot 主人 小王 批准后才会执行')).toBeTruthy()
    expect(dialog().getByRole('button', { name: '提交申请' })).toBeTruthy()
    expect(actionsCalled(calls)).toEqual([])
  })
})
