import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  context: null,
  ...o,
})

const DATA: Workspaces = {
  rows: [
    row({ context: { used: 124_000, size: 200_000, compactAt: 167_000 } }),
    row({
      groupId: 'g2',
      group: '数据平台',
      kind: 'cd',
      kindLabel: '本机目录',
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
      name: 'g1/0923-100233-b1-2',
      path: '/Users/wl/.gonggong/backups/g1/0923-100233-b1-2',
      size: '2 KB',
      modifiedMs: 0,
    },
    {
      name: 'web-site/0923-1002',
      path: '/Users/wl/.gonggong/backups/web-site/0923-1002',
      size: '6 KB',
      modifiedMs: 0,
    },
  ],
  offline: false,
}

const NONE = { uncommitted: 0, unpushed: 0, unknown: false }

const rowOf = (text: string) => screen.getByText(text).closest('[role="row"]') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: INFO })
  m.workspaces.mockResolvedValue(DATA)
  m.reveal.mockResolvedValue()
  m.resetCd.mockResolvedValue()
  m.deleteWorkspace.mockResolvedValue()
  m.workspaceChanges.mockResolvedValue(NONE)
})

describe('工作区', () => {
  it('lists group × bot, kind, path and state with one action each, plus local backups', async () => {
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('支付服务重构')
    for (const h of ['群', 'Bot', '类型', '路径', '状态'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const pay = rowOf('支付服务重构')
    expect(within(pay).getByText('托管')).toBeTruthy()
    expect(within(pay).getByText('~/.gonggong/workspaces/g1/b1/r1')).toBeTruthy()
    expect(within(pay).getByText('运行中')).toBeTruthy()
    fireEvent.click(within(pay).getByRole('button', { name: '打开' }))
    expect(m.reveal).toHaveBeenCalledWith('/Users/wl/.gonggong/workspaces/g1/b1/r1')

    const cd = rowOf('数据平台')
    expect(within(cd).getByText('本机目录')).toBeTruthy()
    fireEvent.click(within(cd).getByRole('button', { name: '打开' }))
    expect(m.reveal).toHaveBeenCalledWith('/Users/wl/code/data-etl')
    fireEvent.click(within(cd).getByRole('button', { name: '改回托管' }))
    await waitFor(() => expect(m.resetCd).toHaveBeenCalledWith('g2', 'b1'))

    expect(within(rowOf('旧版后台')).getByText('已移出 · 412 MB')).toBeTruthy()

    expect(screen.getByText('本机备份 · 不上传')).toBeTruthy()
    expect(screen.getByText('支付服务重构 · 小王的 Claude · 09-23 10:02:33 · 2 KB')).toBeTruthy()
    expect(screen.getByText('web-site/0923-1002 · 6 KB')).toBeTruthy()
    expect(screen.getByText('~/.gonggong/backups/web-site/0923-1002')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '在 Finder 中显示' })[1]!)
    expect(m.reveal).toHaveBeenCalledWith('/Users/wl/.gonggong/backups/web-site/0923-1002')
  })

  it("shows each conversation's context occupancy, read only", async () => {
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('支付服务重构')
    expect(screen.getByRole('columnheader', { name: '上下文' })).toBeTruthy()
    const ring = within(rowOf('支付服务重构')).getByRole('button', {
      name: '小王的 Claude 上下文 124k / 200k',
    })
    expect(ring.dataset.level).toBe('normal')
    expect(ring.textContent).toBe('62%')
    expect(ring.title).toBe('上下文 124k / 200k · 还剩 43k 自动压缩')
    expect(within(rowOf('数据平台')).queryByRole('button', { name: /上下文/ })).toBeNull()
    fireEvent.click(ring)
    const pop = await screen.findByRole('dialog', { name: '小王的 Claude 的上下文' })
    expect(within(pop).getByText('124k / 200k')).toBeTruthy()
    expect(pop.textContent).toContain('在群里发 /compact @小王的 Claude 压缩上下文，发 /new 开新会话。')
    expect(within(pop).queryByRole('button', { name: '压缩上下文' })).toBeNull()
  })

  it('deletes a removed workspace only after confirmation with a loading lock, then reloads', async () => {
    let resolveDelete: () => void = () => {}
    m.deleteWorkspace.mockImplementationOnce(() => new Promise<void>((r) => (resolveDelete = r)))
    render(<WorkspacesPage go={() => {}} />)
    const old = await screen.findByText('旧版后台')
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除…' }))
    expect(m.deleteWorkspace).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('~/.gonggong/workspaces/g3/b1/r3')
    m.workspaces.mockResolvedValue({ ...DATA, rows: DATA.rows.slice(0, 2) })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(within(dialog).getByRole('button', { name: '删除' }).getAttribute('aria-busy')).toBe('true')
    expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await act(async () => resolveDelete())
    await waitFor(() =>
      expect(m.deleteWorkspace).toHaveBeenCalledWith(
        'g3',
        'b1',
        '/Users/wl/.gonggong/workspaces/g3/b1/r3',
        NONE,
      ),
    )
    await waitFor(() => expect(old.isConnected).toBe(false))
  })

  it('counts unsaved work afresh before the delete confirmation, naming only what is there', async () => {
    m.workspaceChanges.mockResolvedValueOnce({ ...NONE, uncommitted: 3, unpushed: 2 })
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('旧版后台')
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除…' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(m.workspaceChanges).toHaveBeenCalledWith('/Users/wl/.gonggong/workspaces/g3/b1/r3')
    expect(dialog.textContent).toContain('要从本机删除「旧版后台 × 小王的 Claude」的工作区吗？')
    expect(within(dialog).getByRole('alert').textContent).toContain(
      '还有 3 处未提交的改动、2 个未推送的提交，删除后会丢失',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    m.workspaceChanges.mockResolvedValueOnce({ ...NONE, unpushed: 4 })
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除…' }))
    await waitFor(() => expect(m.workspaceChanges).toHaveBeenCalledTimes(2))
    const alert = await within(screen.getByRole('alertdialog')).findByText(/未推送/)
    expect(alert.textContent).toBe('还有 4 个未推送的提交，删除后会丢失')
  })

  it('shows no work warning when the workspace has nothing unsaved', async () => {
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('旧版后台')
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除…' }))
    expect(within(await screen.findByRole('alertdialog')).queryByRole('alert')).toBeNull()
  })

  it('warns when it cannot tell, and deletes only with that acknowledged', async () => {
    const unknown = { ...NONE, unknown: true }
    m.workspaceChanges.mockResolvedValueOnce(unknown)
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('旧版后台')
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除…' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('alert').textContent).toContain('无法确认是否有未保存的改动')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(m.deleteWorkspace).toHaveBeenCalledWith(
        'g3',
        'b1',
        '/Users/wl/.gonggong/workspaces/g3/b1/r3',
        unknown,
      ),
    )
  })

  it('keeps the confirmation open with the fresh warning when work landed while it was open', async () => {
    m.deleteWorkspace.mockRejectedValueOnce('工作区有新的改动，请重新确认')
    render(<WorkspacesPage go={() => {}} />)
    await screen.findByText('旧版后台')
    fireEvent.click(within(rowOf('旧版后台')).getByRole('button', { name: '删除…' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    const fresh = { ...NONE, uncommitted: 2 }
    m.workspaceChanges.mockResolvedValueOnce(fresh)
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    const alert = await within(dialog).findByText('还有 2 处未提交的改动，删除后会丢失')
    expect(alert.isConnected).toBe(true)
    expect(screen.getByRole('alertdialog')).toBe(dialog)
    expect(m.workspaces).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(m.deleteWorkspace).toHaveBeenLastCalledWith('g3', 'b1', expect.any(String), fresh),
    )
  })

  it('shows empty states and plain-language offline warning when the server was unreachable', async () => {
    m.workspaces.mockResolvedValue({ rows: [], backups: [], offline: true })
    render(<WorkspacesPage go={() => {}} />)
    expect(await screen.findByText('本机还没有工作区')).toBeTruthy()
    expect(screen.getByText('暂无本机备份')).toBeTruthy()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('无法连接服务器')
    expect(alert.textContent).toContain('暂时连不上服务器，以下仅列出本机目录，群和 Bot 名称恢复连接后显示。')
    expect(alert.textContent).not.toContain('/cd')
  })
})
