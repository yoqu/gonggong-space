import type { GroupPreviewsDto, PreviewDto, PreviewShareDto, ServiceDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { tabKey, useWorkbench } from '../src/app/workbench'
import { PreviewCard } from '../src/features/previews/PreviewCard'
import { PreviewsView } from '../src/features/previews/PreviewsView'
import { PreviewTags } from '../src/features/previews/PreviewTags'
import { resetPreviews } from '../src/features/previews/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const preview = (o: Partial<PreviewDto> = {}): PreviewDto => ({
  id: 'p1',
  groupId: 'g1',
  groupName: '支付重构',
  botId: 'b1',
  botName: '小王的 Claude',
  kind: 'http',
  title: '登录页',
  path: '/login',
  serviceId: 'sv1',
  serviceName: 'web',
  port: 5173,
  snapshotAt: null,
  status: 'online',
  awaiting: null,
  snapshotError: null,
  live: null,
  control: null,
  canManage: false,
  createdAt: '2026-09-27T10:00:00Z',
  ...o,
})
const service = (o: Partial<ServiceDto> = {}): ServiceDto => ({
  id: 'sv1',
  groupId: 'g1',
  groupName: '支付重构',
  botId: 'b1',
  botName: '小王的 Claude',
  name: 'web',
  command: 'pnpm dev',
  cwd: 'apps/web',
  port: 5173,
  status: 'running',
  canManage: false,
  createdAt: '2026-09-27T10:00:00Z',
  ...o,
})
const share = (o: Partial<PreviewShareDto> = {}): PreviewShareDto => ({
  id: 's1',
  previewId: 'p1',
  previewTitle: '登录页',
  groupId: 'g1',
  groupName: '支付重构',
  botName: '小王的 Claude',
  createdByName: '王磊',
  expiresAt: '2026-10-04T10:00:00Z',
  revokedAt: null,
  visitCount: 3,
  lastVisitAt: '2026-09-28T09:00:00Z',
  createdAt: '2026-09-27T10:00:00Z',
  active: true,
  ...o,
})
const list = (
  previews: PreviewDto[],
  services: ServiceDto[] = [],
  manageableBotIds: string[] = [],
): GroupPreviewsDto => ({
  previews,
  services,
  manageableBotIds,
})

class NoopSocket {
  close() {}
}
const benchTabs = () => useWorkbench.getState().benches.g1?.tabs ?? []

beforeEach(() => {
  resetPreviews()
  localStorage.clear()
  useToasts.setState({ items: [] })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => vi.unstubAllGlobals())

describe('preview card', () => {
  it('shows the live preview, opens it through the main site or in the workbench', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    await screen.findByText('登录页')
    expect(screen.getByRole('img', { name: '在线' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开' }).getAttribute('href')).toBe(
      '/api/previews/p1/open?path=%2Flogin',
    )
    expect(screen.queryByRole('button', { name: '公开链接' })).toBeNull()
    expect(screen.queryByRole('button', { name: /停止/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '在工作台打开' }))
    expect(benchTabs()).toEqual([{ kind: 'web', previewId: 'p1', path: '/login' }])
    expect(useWorkbench.getState()).toMatchObject({ open: true, mode: 'focus' })
  })

  it('says so when the workbench is full', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    for (let i = 0; i < 12; i++) useWorkbench.getState().show({ kind: 'web', previewId: `x${i}`, path: '/' })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    fireEvent.click(await screen.findByRole('button', { name: '在工作台打开' }))
    expect(benchTabs().map(tabKey)).not.toContain('web:p1')
    expect(useToasts.getState().items).toMatchObject([
      { type: 'error', message: '标签页已满（最多 12 个），请先关闭一些' },
    ])
  })

  it('follows realtime updates and reads 已关闭 once the preview is gone', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview({ status: 'offline' })]) })
    let push: ((e: never) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h as never
      return () => {}
    })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    await screen.findByRole('img', { name: '离线' })
    act(() =>
      push!({
        t: 'group.previews',
        groupId: 'g1',
        previews: [],
        services: [],
        manageableBotIds: [],
      } as never),
    )
    expect(screen.getByRole('img', { name: '已关闭' })).toBeTruthy()
    expect(screen.getByText('预览：登录页')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '打开' })).toBeNull()
  })

  it('shows the first screen once taken, and lets managers retake it', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list([preview({ canManage: true, snapshotAt: '2026-09-27T10:01:00Z' })]),
      'POST /previews/p1/snapshot': undefined,
    })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    const shot = await screen.findByRole('img', { name: '登录页 首屏' })
    expect(shot.getAttribute('src')).toBe('/api/previews/p1/snapshot?v=2026-09-27T10%3A01%3A00Z')
    fireEvent.click(screen.getByRole('button', { name: '重新截图' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/previews/p1/snapshot')).toBe(true),
    )
  })

  it('reads 服务已停止 while the service is down; managers start it again from the card', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list([preview({ status: 'stopped', canManage: true })]),
      'POST /previews/p1/start': undefined,
    })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    await screen.findByRole('img', { name: '服务已停止' })
    expect(screen.queryByRole('button', { name: '在工作台打开' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '启动服务' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/previews/p1/start')).toBe(true),
    )
  })

  it('offers 重新开放 on a closed card only to whoever may manage its bot', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list([], [], ['b1']),
      'POST /previews/p1/start': apiError(
        409,
        'conflict',
        '本机没有这个服务的启动记录（机器重启过），请让 Bot 重新启动',
      ),
    })
    const { unmount } = render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    fireEvent.click(await screen.findByRole('button', { name: '重新开放' }))
    await waitFor(() =>
      expect(useToasts.getState().items).toMatchObject([
        { type: 'error', message: '本机没有这个服务的启动记录（机器重启过），请让 Bot 重新启动' },
      ]),
    )
    expect(calls.some((c) => c.path === '/previews/p1/start')).toBe(true)
    unmount()
    render(<PreviewCard previewId="p1" groupId="g1" botId="b2" fallback="预览：登录页" />)
    await screen.findByRole('img', { name: '已关闭' })
    expect(screen.queryByRole('button', { name: '重新开放' })).toBeNull()
  })

  it('hands out no public links in demo mode', async () => {
    useSession.setState({
      tenancy: { teams: [], singleTeamMode: true, canCreateTeam: false, demoMode: true },
    })
    mockApi({ 'GET /groups/g1/previews': list([preview({ canManage: true })]) })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    await screen.findByRole('button', { name: '重新截图' })
    expect(screen.queryByRole('button', { name: '公开链接' })).toBeNull()
    useSession.setState({ tenancy: null })
  })

  it('lets the bot owner or a group admin hand out an expiring public link', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list([preview({ canManage: true })]),
      'GET /previews/p1/shares': [share()],
      'POST /previews/p1/shares': {
        share: share({ id: 's2' }),
        url: 'https://k3.preview.example/__gg/share/ps_x',
      },
      'POST /preview-shares/s1/revoke': undefined,
    })
    render(<PreviewCard previewId="p1" groupId="g1" botId="b1" fallback="预览：登录页" />)
    fireEvent.click(await screen.findByRole('button', { name: '公开链接' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText(/访问 3 次/)
    fireEvent.click(within(dialog).getByRole('button', { name: '收回' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/preview-shares/s1/revoke')).toBe(true))
    fireEvent.click(within(dialog).getByRole('button', { name: '生成链接' }))
    expect(await within(dialog).findByDisplayValue('https://k3.preview.example/__gg/share/ps_x')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/previews/p1/shares')?.body).toEqual({
      days: 7,
    })
  })
})

describe('输入框上方的穿透标记', () => {
  it('pins every open preview for all members; its popover opens it', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()], [service()]) })
    render(<PreviewTags groupId="g1" />)
    const tag = await screen.findByRole('button', { name: /登录页.*:5173/ })
    fireEvent.click(tag)
    const pop = screen.getByRole('dialog', { name: '登录页' })
    expect(within(pop).getByText(/小王的 Claude/)).toBeTruthy()
    expect(within(pop).getByText(/pnpm dev/)).toBeTruthy()
    expect(within(pop).getByRole('link', { name: '打开' }).getAttribute('href')).toBe(
      '/api/previews/p1/open?path=%2Flogin',
    )
    expect(within(pop).queryByRole('button', { name: /停止/ })).toBeNull()
    fireEvent.click(within(pop).getByRole('button', { name: '在工作台打开' }))
    expect(benchTabs()).toEqual([{ kind: 'web', previewId: 'p1', path: '/login' }])
  })

  it('lets the bot owner or a group admin stop the tunnel and its service', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list([preview({ canManage: true })], [service()]),
      'POST /previews/p1/close': undefined,
    })
    render(<PreviewTags groupId="g1" />)
    fireEvent.click(await screen.findByRole('button', { name: /登录页/ }))
    fireEvent.click(screen.getByRole('button', { name: '停止穿透和服务' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/previews/p1/close',
        body: { stopService: true },
      }),
    )
  })

  it('renders nothing without open previews', async () => {
    mockApi({ 'GET /groups/g1/previews': list([]) })
    const { container } = render(<PreviewTags groupId="g1" />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})

describe('群设置 · 预览与服务', () => {
  it('opens an online preview in the workbench and leaves the settings', async () => {
    mockApi({
      'GET /groups/g1/previews': list([
        preview(),
        preview({ id: 'p2', title: '接口文档', status: 'offline' }),
      ]),
    })
    const onOpen = vi.fn()
    render(<PreviewsView groupId="g1" onOpen={onOpen} />)
    await screen.findByText('接口文档')
    const buttons = screen.getAllByRole('button', { name: '在工作台打开' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(benchTabs()).toEqual([{ kind: 'web', previewId: 'p1', path: '/login' }])
    expect(onOpen).toHaveBeenCalled()
  })

  it('lists previews and services; managers close and stop them', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list(
        [preview({ canManage: true }), preview({ id: 'p2', title: '接口文档', canManage: false })],
        [service({ canManage: true })],
      ),
      'POST /previews/p1/close': undefined,
      'POST /services/sv1/stop': undefined,
    })
    render(<PreviewsView groupId="g1" />)
    await screen.findByText('接口文档')
    expect(screen.getByText(/pnpm dev/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '关闭' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() =>
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
        expect.arrayContaining(['POST /previews/p1/close', 'POST /services/sv1/stop']),
      ),
    )
  })
})

describe('管理后台 · 公开链接', () => {
  const admin: UserDto = {
    id: 'u0',
    account: 'chenchen',
    name: '陈晨',
    role: 'sysadmin',
    mustChangePassword: false,
    disabled: false,
    gitProtocol: 'auto',
    email: null,
    avatar: null,
  }

  it('lists every public link and revokes or extends it', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-28T10:00:00Z') })
    let rows = [
      share(),
      share({ id: 's9', active: false, revokedAt: '2026-09-27T12:00:00Z', previewTitle: '旧页面' }),
    ]
    const calls = mockApi({
      'GET /admin/preview-shares': () => rows,
      'POST /preview-shares/s1/revoke': () => {
        rows = rows.map((r) =>
          r.id === 's1' ? { ...r, active: false, revokedAt: '2026-09-28T10:00:00Z' } : r,
        )
      },
      'PATCH /admin/preview-shares/s1': (body: unknown) => ({ ...rows[0], ...(body as object) }),
    })
    render(
      <MemoryRouter initialEntries={['/admin/previews']}>
        <App />
      </MemoryRouter>,
    )
    const row = (await screen.findByRole('gridcell', { name: '登录页' })).closest(
      '[role="row"]',
    ) as HTMLElement
    expect(within(row).getByText('有效')).toBeTruthy()
    const old = screen.getByRole('gridcell', { name: '旧页面' }).closest('[role="row"]') as HTMLElement
    expect(within(old).getByText('已收回')).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '延长 7 天' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        expiresAt: '2026-10-11T10:00:00.000Z',
      }),
    )
    fireEvent.click(within(row).getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '收回' }))
    await waitFor(() => expect(within(row).getByText('已收回')).toBeTruthy())
    vi.useRealTimers()
  })
})
