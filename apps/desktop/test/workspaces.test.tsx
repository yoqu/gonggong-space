import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type WorkspaceRow, type Workspaces } from '../src/ipc'
import { WorkspacesPage } from '../src/pages/Workspaces'
import { useDaemon } from '../src/store'
import { INFO } from './ipc-mock'

const m = vi.mocked(ipc)

const row = (o: Partial<WorkspaceRow>): WorkspaceRow => ({
  groupId: 'g1',
  botId: 'b1',
  group: '支付服务重构',
  bot: '小王的 Claude',
  kind: 'managed',
  kindLabel: '托管',
  path: '/Users/wl/.gonggong/workspaces/g1/b1/r1',
  state: 'running',
  stateLabel: '运行中',
  deletable: false,
  ...o,
})

const DATA: Workspaces = {
  rows: [
    row({}),
    row({
      groupId: 'g2',
      group: '数据平台',
      kind: 'cd',
      kindLabel: '/cd 绑定',
      path: '/Users/wl/code/data-etl',
      state: 'idle',
      stateLabel: '空闲',
    }),
    row({
      groupId: 'g3',
      group: '旧版后台',
      path: '/Users/wl/.gonggong/workspaces/g3/b1/r3',
      state: 'removed',
      stateLabel: '已移出 · 412 MB',
      deletable: true,
    }),
  ],
  backups: [
    {
      name: 'web-site/0923-1002',
      path: '/Users/wl/.gonggong/backups/web-site/0923-1002',
      size: '6 KB',
      modifiedMs: 0,
    },
  ],
  offline: false,
}

const rowOf = (text: string) => screen.getByText(text).closest('[data-testid="ws-row"]') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: INFO })
  m.workspaces.mockResolvedValue(DATA)
  m.reveal.mockResolvedValue()
  m.resetCd.mockResolvedValue()
  m.deleteWorkspace.mockResolvedValue()
})

describe('工作区', () => {
  it('lists group × bot, kind, path and state with one action each, plus local backups', async () => {
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('支付服务重构')
    for (const h of ['群 × Bot', '类型', '路径', '状态']) expect(screen.getByText(h)).toBeTruthy()
    const pay = rowOf('支付服务重构')
    expect(within(pay).getByText('托管')).toBeTruthy()
    expect(within(pay).getByText('~/.gonggong/workspaces/g1/b1/r1')).toBeTruthy()
    expect(within(pay).getByText('运行中')).toBeTruthy()
    fireEvent.click(within(pay).getByRole('button', { name: '打开' }))
    expect(m.reveal).toHaveBeenCalledWith('/Users/wl/.gonggong/workspaces/g1/b1/r1')

    const cd = rowOf('数据平台')
    expect(within(cd).getByText('/cd 绑定')).toBeTruthy()
    fireEvent.click(within(cd).getByRole('button', { name: '改回托管' }))
    await waitFor(() => expect(m.resetCd).toHaveBeenCalledWith('g2', 'b1'))

    expect(within(rowOf('旧版后台')).getByText('已移出 · 412 MB')).toBeTruthy()

    expect(screen.getByText('本机备份 · 不上传')).toBeTruthy()
    expect(screen.getByText('~/.gonggong/backups/web-site/0923-1002')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '在 Finder 中显示' }))
    expect(m.reveal).toHaveBeenCalledWith('/Users/wl/.gonggong/backups/web-site/0923-1002')
  })

  it('deletes a removed workspace only after confirmation, then reloads', async () => {
    render(<WorkspacesPage go={() => {}} />)
    const old = await screen.findByText('旧版后台')
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除' }))
    expect(m.deleteWorkspace).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('~/.gonggong/workspaces/g3/b1/r3')
    m.workspaces.mockResolvedValue({ ...DATA, rows: DATA.rows.slice(0, 2) })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(m.deleteWorkspace).toHaveBeenCalledWith('g3', 'b1', '/Users/wl/.gonggong/workspaces/g3/b1/r3'),
    )
    await waitFor(() => expect(old.isConnected).toBe(false))
  })

  it('shows empty states and warns when the server was unreachable', async () => {
    m.workspaces.mockResolvedValue({ rows: [], backups: [], offline: true })
    render(<WorkspacesPage go={() => {}} />)
    expect(await screen.findByText('本机还没有工作区')).toBeTruthy()
    expect(screen.getByText('暂无本机备份')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('无法连接服务器')
  })
})
