import type {
  AdminGroupDto,
  AdminMachineDto,
  AdminUserDto,
  AuditDto,
  SystemParams,
  UserDto,
} from '@aiws/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { apiError, mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
}
const user = (o: Partial<AdminUserDto>): AdminUserDto => ({ ...admin, machineCount: 0, online: false, ...o })

const PARAMS: SystemParams = {
  approvalTimeoutMin: 30,
  chainMaxHops: 3,
  offlineWaitMin: 30,
  writerDisconnectReleaseSec: null,
  forceSyncMaxLatencyMs: 120,
  forceSyncMinBandwidthMbps: 10,
  sessionReplayCount: 50,
  runRetentionDays: 30,
  attachmentMaxMb: 50,
  attachmentsPerMessage: 10,
  questionsPerCard: 4,
  heartbeatSec: 15,
  offlineMisses: 3,
  botConcurrencyDefault: 2,
  backupRetentionDays: 7,
  archiveRetentionDays: 30,
}

class NoopSocket {
  close() {}
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const rowOf = (text: string) => screen.getByRole('cell', { name: text }).closest('tr') as HTMLElement

describe('账号与角色 · 停用 / 启用', () => {
  it('disables an account after confirming the consequences', async () => {
    let list = [
      user({}),
      user({ id: 'u1', account: 'wanglei', name: '王磊', role: 'member', machineCount: 1 }),
    ]
    const calls = mockApi({
      'GET /admin/users': () => list,
      'POST /admin/users/u1/disable': () => {
        list = list.map((u) => (u.id === 'u1' ? { ...u, disabled: true } : u))
        return { ...list[1] }
      },
    })
    renderAt('/admin/users')
    await screen.findByRole('cell', { name: 'wanglei' })
    expect(within(rowOf('chenchen')).queryByRole('button', { name: '停用' })).toBeNull()
    fireEvent.click(within(rowOf('wanglei')).getByRole('button', { name: '停用' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('停用账号 王磊')).toBeTruthy()
    for (const line of [
      '立即吊销其所有 daemon token 和 Web 会话',
      'daemon 下次连接失败后清除团队密钥和托管工作区（尽力而非保证）',
      '其 bot 从所有群移除；持锁中的 bot 按非主动中断处理',
      '群消息与审计记录保留',
    ])
      expect(within(dialog).getByText(new RegExp(line.replace(/[()（）]/g, '.')))).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '停用' }))
    await waitFor(() => expect(within(rowOf('wanglei')).getByText('已停用')).toBeTruthy())
    expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/users/u1/disable')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf('wanglei')).getByRole('button', { name: '启用' })).toBeTruthy()
  })

  it('closing the dialog changes nothing; 启用 re-enables at once', async () => {
    let list = [user({ id: 'u3', account: 'liuyang', name: '刘洋', role: 'member', disabled: true })]
    const calls = mockApi({
      'GET /admin/users': () => list,
      'POST /admin/users/u3/enable': () => {
        list = [{ ...list[0]!, disabled: false }]
        return list[0]
      },
    })
    renderAt('/admin/users')
    await screen.findByRole('cell', { name: 'liuyang' })
    fireEvent.click(within(rowOf('liuyang')).getByRole('button', { name: '启用' }))
    await waitFor(() => expect(within(rowOf('liuyang')).getByRole('button', { name: '停用' })).toBeTruthy())
    fireEvent.click(within(rowOf('liuyang')).getByRole('button', { name: '停用' }))
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' }).at(-1)!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/admin/users/u3/enable'])
  })
})

describe('群', () => {
  it('lists every group with mode, repo, members, bots and the authoritative copy', async () => {
    const g = (o: Partial<AdminGroupDto>): AdminGroupDto => ({
      id: 'g1',
      name: '支付服务重构',
      kind: 'group',
      mode: 'partition',
      repo: 'git.corp/pay/pay-server',
      members: 6,
      bots: 4,
      archivedAt: null,
      ...o,
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T10:00:00Z'))
    mockApi({
      'GET /admin/groups': [
        g({}),
        g({ id: 'g2', name: '王磊', kind: 'dm', repo: null, members: 1, bots: 1 }),
        g({
          id: 'g3',
          name: '旧版后台',
          repo: null,
          archivedAt: '2026-09-14T10:00:00Z',
          bots: 0,
          members: 3,
        }),
      ],
      'GET /admin/params': PARAMS,
    })
    renderAt('/admin/groups')
    expect(await screen.findByRole('heading', { name: '群' })).toBeTruthy()
    for (const h of ['群', '模式', '仓库', '成员', 'bot', '权威副本'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const cells = (name: string) =>
      within(rowOf(name))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    await screen.findByRole('cell', { name: '支付服务重构' })
    expect(cells('支付服务重构')).toEqual([
      '支付服务重构',
      '分区模式',
      'git.corp/pay/pay-server',
      '6',
      '4',
      '—',
    ])
    expect(cells('私聊 · 王磊')).toEqual(['私聊 · 王磊', '分区模式', '未绑定', '1', '1', '—'])
    await waitFor(() =>
      expect(cells('旧版后台')).toEqual(['旧版后台', '已归档', '未绑定', '3', '0', '归档 · 21 天后清除']),
    )
  })
})

describe('机器与网络', () => {
  it('shows owner, system, daemon, network and heartbeat, and warns about old protocols', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T10:00:00Z'))
    const m = (o: Partial<AdminMachineDto>): AdminMachineDto => ({
      id: 'm1',
      ownerId: 'u1',
      ownerName: '王磊',
      name: 'wanglei-mbp',
      os: 'macos',
      arch: 'aarch64',
      online: true,
      agents: [],
      daemonVersion: '0.9.3',
      protocol: 1,
      lastSeenAt: '2026-09-23T09:59:57Z',
      ...o,
    })
    mockApi({
      'GET /admin/machines': [
        m({}),
        m({
          id: 'm2',
          ownerName: '周婷',
          name: 'zt-desktop',
          os: 'windows',
          online: false,
          daemonVersion: '0.8.7',
          protocol: 0,
          lastSeenAt: '2026-09-23T09:18:00Z',
        }),
      ],
      'GET /admin/params': PARAMS,
    })
    renderAt('/admin/net')
    expect(await screen.findByRole('heading', { name: '机器与网络' })).toBeTruthy()
    for (const h of ['主人', '机器', '系统', 'daemon', '延迟', '带宽', '心跳'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const cells = (name: string) =>
      within(rowOf(name))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    await screen.findByRole('cell', { name: 'zt-desktop' })
    expect(cells('wanglei-mbp')).toEqual(['王磊', 'wanglei-mbp', 'macOS', 'v0.9.3', '—', '—', '在线'])
    expect(cells('zt-desktop')).toEqual(['周婷', 'zt-desktop', 'Windows', 'v0.8.7', '—', '—', '离线 42 分'])
    expect(screen.getByText('1 台 daemon 协议版本过旧')).toBeTruthy()
    expect(screen.getByText(/zt-desktop 运行 v0\.8\.7（协议 v0），服务器已拒绝连接并提示升级/)).toBeTruthy()
    expect(
      await screen.findByText(
        '网络质量仅在开启强制同步时测量并记录，不在群里展示。强制同步开启阈值：延迟 ≤ 120 ms，带宽 ≥ 10 Mbps。',
      ),
    ).toBeTruthy()
  })
})

describe('审计记录', () => {
  const a = (id: number, o: Partial<AuditDto>): AuditDto => ({
    id,
    at: '2026-09-23T02:23:08Z',
    category: 'approval',
    actorName: '王磊',
    action: 'approved',
    groupName: '支付服务重构',
    summary: '批准 小王的 Claude 执行 go build ./... · 支付服务重构',
    detail: {},
    ...o,
  })

  it('lists records with time, type, who and summary, filters by chip and loads older pages', async () => {
    const page = Array.from({ length: 50 }, (_, i) => a(200 - i, {}))
    const calls = mockApi({
      'GET /admin/audit?limit=50': page,
      'GET /admin/audit?limit=50&before=151': [
        a(9, { category: 'admin', actorName: null, action: 'user.disable', summary: '停用账号 wanglei' }),
      ],
      'GET /admin/audit?category=admin&limit=50': [
        a(9, { category: 'admin', actorName: '陈晨', action: 'user.disable', summary: '停用账号 wanglei' }),
      ],
    })
    renderAt('/admin/audit')
    const list = await screen.findByTestId('audit-list')
    await within(list).findAllByText('批准 小王的 Claude 执行 go build ./... · 支付服务重构')
    const first = within(list).getAllByTestId('audit-row')[0]!
    expect(first.textContent).toContain('审批')
    expect(first.textContent).toContain('王磊')
    expect(first.textContent).toMatch(/09-23 \d\d:23:08/)
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await within(list).findByText('停用账号 wanglei')).toBeTruthy()
    expect(within(list).getAllByTestId('audit-row').at(-1)!.textContent).toContain('系统')
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()

    for (const chip of ['全部', '审批', '提问', '锁与同步', '管理', '运行'])
      expect(screen.getByRole('button', { name: chip })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    await waitFor(() => expect(within(list).getAllByTestId('audit-row')).toHaveLength(1))
    expect(within(list).getByText('停用账号 wanglei')).toBeTruthy()
    expect(screen.getByRole('button', { name: '管理' }).getAttribute('aria-pressed')).toBe('true')
    expect(calls.map((c) => c.path)).toContain('/admin/audit?category=admin&limit=50')
  })
})

describe('系统参数', () => {
  it('edits defaults, marks the ones to be measured and saves only what changed', async () => {
    const calls = mockApi({
      'GET /admin/params': PARAMS,
      'PUT /admin/params': (body: unknown) => ({ ...PARAMS, ...(body as object) }),
    })
    renderAt('/admin/params')
    const retention = (await screen.findByLabelText('完整运行过程保留')) as HTMLInputElement
    expect(retention.value).toBe('30')
    expect((screen.getByLabelText('写入方断线后释放锁') as HTMLInputElement).placeholder).toBe('待定')
    expect(screen.getAllByText('需实测')).toHaveLength(3)
    fireEvent.change(retention, { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('接力链长上限 · 群默认'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ runRetentionDays: 14, chainMaxHops: 5 })
  })

  it('shows the server’s validation message', async () => {
    mockApi({
      'GET /admin/params': PARAMS,
      'PUT /admin/params': () => apiError(400, 'invalid', 'Too small: expected number to be >=1'),
    })
    renderAt('/admin/params')
    fireEvent.change(await screen.findByLabelText('完整运行过程保留'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('Too small: expected number to be >=1')).toBeTruthy()
  })
})
