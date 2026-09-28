import type { GroupPreviewsDto, PreviewDto, PreviewShareDto, ServiceDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { PreviewCard } from '../src/features/previews/PreviewCard'
import { PreviewsView } from '../src/features/previews/PreviewsView'
import { resetPreviews } from '../src/features/previews/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const preview = (o: Partial<PreviewDto> = {}): PreviewDto => ({
  id: 'p1',
  groupId: 'g1',
  botId: 'b1',
  botName: '小王的 Claude',
  kind: 'http',
  title: '登录页',
  path: '/login',
  serviceId: 'sv1',
  serviceName: 'web',
  status: 'online',
  canManage: false,
  createdAt: '2026-09-27T10:00:00Z',
  ...o,
})
const service = (o: Partial<ServiceDto> = {}): ServiceDto => ({
  id: 'sv1',
  groupId: 'g1',
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
const list = (previews: PreviewDto[], services: ServiceDto[] = []): GroupPreviewsDto => ({
  previews,
  services,
})

class NoopSocket {
  close() {}
}
beforeEach(() => {
  resetPreviews()
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => vi.unstubAllGlobals())

describe('preview card', () => {
  it('shows the live preview, opens it through the main site and embeds it', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    render(<PreviewCard previewId="p1" groupId="g1" fallback="预览：登录页" />)
    await screen.findByText('登录页')
    expect(screen.getByText('在线')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开' }).getAttribute('href')).toBe(
      '/api/previews/p1/open?path=%2Flogin',
    )
    expect(screen.queryByRole('button', { name: '公开链接…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '内嵌预览' }))
    const frame = screen.getByTitle('登录页') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('/api/previews/p1/open?path=%2Flogin')
  })

  it('follows realtime updates and reads 已关闭 once the preview is gone', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview({ status: 'offline' })]) })
    let push: ((e: never) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h as never
      return () => {}
    })
    render(<PreviewCard previewId="p1" groupId="g1" fallback="预览：登录页" />)
    await screen.findByText('离线')
    act(() => push!({ t: 'group.previews', groupId: 'g1', previews: [], services: [] } as never))
    expect(screen.getByText('已关闭')).toBeTruthy()
    expect(screen.getByText('预览：登录页')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '打开' })).toBeNull()
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
    render(<PreviewCard previewId="p1" groupId="g1" fallback="预览：登录页" />)
    fireEvent.click(await screen.findByRole('button', { name: '公开链接…' }))
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

describe('群设置 · 预览与服务', () => {
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
