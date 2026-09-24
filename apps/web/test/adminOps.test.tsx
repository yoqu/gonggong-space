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
  contextInlineMax: 20,
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
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/admin/users/u3/enable'])
  })
})

describe('群', () => {
  it('lists every group with mode, repo, members, bots and the archive state', async () => {
    const g = (o: Partial<AdminGroupDto>): AdminGroupDto => ({
      id: 'g1',
      name: '支付服务重构',
      ownerName: '王磊',
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
        g({ id: 'g2', name: '1', ownerName: '王磊', kind: 'dm', repo: null, members: 1, bots: 1 }),
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
    for (const h of ['群', '模式', '仓库', '成员', 'Bot', '存档'])
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
    expect(cells('王磊 的私聊')).toEqual(['王磊 的私聊', '分区模式', '未绑定', '1', '1', '—'])
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
      latencyMs: null,
      bandwidthMbps: null,
      netMeasuredAt: null,
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
        m({ latencyMs: 38, bandwidthMbps: 87.46, netMeasuredAt: '2026-09-23T09:00:00Z' }),
        m({
          id: 'm2',
          ownerName: '周婷',
          name: 'zt-desktop',
          os: 'windows',
          online: false,
          daemonVersion: '0.8.7',
          protocol: 0,
          lastSeenAt: '2026-09-23T09:18:00Z',
          latencyMs: 180,
          bandwidthMbps: 4.2,
          netMeasuredAt: '2026-09-22T09:00:00Z',
        }),
        m({ id: 'm3', name: 'never-measured', online: false, lastSeenAt: null }),
      ],
      'GET /admin/params': PARAMS,
    })
    renderAt('/admin/net')
    expect(await screen.findByRole('heading', { name: '机器与网络' })).toBeTruthy()
    for (const h of ['主人', '机器', '系统', 'daemon', '延迟', '带宽', '状态', '最后心跳'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const cells = (name: string) =>
      within(rowOf(name))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    await screen.findByRole('cell', { name: 'zt-desktop' })
    expect(cells('wanglei-mbp')).toEqual([
      '王磊',
      'wanglei-mbp',
      'macOS',
      'v0.9.3',
      '38 ms',
      '87.5 Mbps',
      '在线',
      '刚刚',
    ])
    expect(cells('zt-desktop')).toEqual([
      '周婷',
      'zt-desktop',
      'Windows',
      'v0.8.7',
      '180 ms',
      '4.2 Mbps',
      '离线',
      '42 分钟前',
    ])
    expect(cells('never-measured')).toEqual([
      '王磊',
      'never-measured',
      'macOS',
      'v0.9.3',
      '—',
      '—',
      '离线',
      '从未连接',
    ])
    await waitFor(() =>
      expect(screen.getByRole('cell', { name: '180 ms' }).className).toContain('admin-table__bad'),
    )
    expect(screen.getByRole('cell', { name: '4.2 Mbps' }).className).toContain('admin-table__bad')
    expect(screen.getByRole('cell', { name: '38 ms' }).className).not.toContain('admin-table__bad')
    expect(screen.getByRole('cell', { name: '38 ms' }).title).toMatch(/^测量于 /)
    expect(screen.getByText('1 台 daemon 协议版本过旧')).toBeTruthy()
    expect(screen.getByText(/zt-desktop 运行 v0\.8\.7（协议 v0），服务器已拒绝连接并提示升级/)).toBeTruthy()
    expect(
      await screen.findByText(
        '网络质量由成员在 daemon 中测量上报（aiws net 或桌面端「测量延迟与带宽」），不在群里展示。强制同步开启阈值：延迟 ≤ 120 ms，带宽 ≥ 10 Mbps。',
      ),
    ).toBeTruthy()
  })
})

describe('机器与网络 · 实时', () => {
  it('refetches when a machine goes online and polls while open', async () => {
    const sockets: { onmessage: ((e: { data: string }) => void) | null }[] = []
    vi.stubGlobal(
      'WebSocket',
      class {
        onmessage: ((e: { data: string }) => void) | null = null
        constructor() {
          sockets.push(this)
        }
        close() {}
      },
    )
    const machine = {
      latencyMs: null,
      bandwidthMbps: null,
      netMeasuredAt: null,
      id: 'm1',
      ownerId: 'u0',
      ownerName: '陈晨',
      name: 'cc-mbp',
      os: 'macos' as const,
      arch: 'aarch64',
      online: false,
      agents: [],
      daemonVersion: '0.9.3',
      protocol: 1,
      lastSeenAt: null,
    }
    let online = false
    const calls = mockApi({
      'GET /admin/machines': () => [{ ...machine, online }],
      'GET /admin/params': PARAMS,
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications': [],
    })
    renderAt('/admin/net')
    await screen.findByRole('cell', { name: 'cc-mbp' })
    expect(within(rowOf('cc-mbp')).getByText('离线')).toBeTruthy()
    online = true
    const {
      ownerName: _,
      protocol: __,
      latencyMs: ___,
      bandwidthMbps: ____,
      netMeasuredAt: _____,
      ...dto
    } = machine
    sockets.at(-1)?.onmessage?.({
      data: JSON.stringify({ t: 'machine.updated', machine: { ...dto, online: true } }),
    })
    await waitFor(() => expect(within(rowOf('cc-mbp')).getByText('在线')).toBeTruthy())
    expect(calls.filter((c) => c.path === '/admin/machines').length).toBe(2)
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

  it('filters loaded rows by keyword and actor, and clamps long summaries', async () => {
    const long = `批准 小王的 Claude 执行 ${'npm run build && '.repeat(10)}echo ok · 支付服务重构`
    mockApi({
      'GET /admin/audit?limit=50': [
        a(3, { summary: long }),
        a(2, { actorName: '李建国', summary: '拒绝 老李的 Codex 执行 rm -rf dist' }),
        a(1, { category: 'admin', actorName: null, summary: '停用账号 wanglei' }),
      ],
    })
    renderAt('/admin/audit')
    const list = await screen.findByTestId('audit-list')
    await within(list).findByText('停用账号 wanglei')
    const summary = within(list).getByText(long)
    expect(summary.className).toContain('is-clamped')
    fireEvent.click(within(list).getByRole('button', { name: '展开' }))
    expect(summary.className).not.toContain('is-clamped')
    expect(within(list).getByRole('button', { name: '收起' })).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索审计记录' }), { target: { value: 'rm -rf' } })
    expect(within(list).getAllByTestId('audit-row')).toHaveLength(1)
    expect(within(list).getByText('拒绝 老李的 Codex 执行 rm -rf dist')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索审计记录' }), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: '操作人' }))
    fireEvent.click(screen.getByRole('option', { name: '系统' }))
    expect(within(list).getAllByTestId('audit-row')).toHaveLength(1)
    expect(within(list).getByText('停用账号 wanglei')).toBeTruthy()
  })
})

describe('系统参数', () => {
  it('groups params into sections, marks edits and saves only what changed from the save bar', async () => {
    const calls = mockApi({
      'GET /admin/params': { ...PARAMS, writerDisconnectReleaseSec: 60 },
      'PUT /admin/params': (body: unknown) => ({
        ...PARAMS,
        writerDisconnectReleaseSec: 60,
        ...(body as object),
      }),
    })
    renderAt('/admin/params')
    const retention = (await screen.findByLabelText('完整运行过程保留')) as HTMLInputElement
    expect(retention.value).toBe('30')
    for (const h of ['同步与锁', '运行与会话', '附件', 'daemon', '数据保留', '群与 Bot 默认值'])
      expect(screen.getByRole('heading', { name: h })).toBeTruthy()
    expect((screen.getByLabelText('写入方断线后释放锁') as HTMLInputElement).value).toBe('60')
    expect(screen.queryByText('需实测')).toBeNull()
    expect(screen.queryByPlaceholderText('待定')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()

    fireEvent.change(retention, { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('接力链长上限 · 群默认'), { target: { value: '5' } })
    expect(retention.closest('.admin-param')?.className).toContain('is-dirty')
    const bar = screen.getByRole('region', { name: '未保存的修改' })
    expect(bar.textContent).toContain('已修改 2 项')

    fireEvent.change(screen.getByLabelText('接力链长上限 · 群默认'), { target: { value: '3' } })
    expect(bar.textContent).toContain('已修改 1 项')
    fireEvent.click(within(bar).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ runRetentionDays: 14 })
    await waitFor(() => expect(screen.queryByRole('region', { name: '未保存的修改' })).toBeNull())
  })

  it('discards edits and warns before unloading with unsaved changes', async () => {
    mockApi({ 'GET /admin/params': PARAMS })
    renderAt('/admin/params')
    const retention = (await screen.findByLabelText('完整运行过程保留')) as HTMLInputElement
    fireEvent.change(retention, { target: { value: '14' } })
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    expect(retention.value).toBe('30')
    expect(screen.queryByRole('region', { name: '未保存的修改' })).toBeNull()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
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

describe('admin shell', () => {
  it('fills the width and shows the user pill without repeating the role', async () => {
    useSession.setState({ user: { ...admin, name: '系统管理员' }, status: 'ready' })
    mockApi({ 'GET /admin/users': [] })
    renderAt('/admin/users')
    const pill = await screen.findByTestId('admin-role')
    expect(pill.textContent).toBe('系统管理员')
  })

  it('shows name and role when they differ', async () => {
    mockApi({ 'GET /admin/users': [] })
    renderAt('/admin/users')
    const pill = await screen.findByTestId('admin-role')
    expect(pill.textContent).toBe('陈晨系统管理员')
  })
})
