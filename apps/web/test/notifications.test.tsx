import type { NotificationDto, SearchResultDto, UserDto } from '@aiws/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app/AppShell'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
}

const note = (o: Partial<NotificationDto>): NotificationDto => ({
  id: 'n1',
  type: 'approval',
  payload: {
    groupId: 'g1',
    groupName: '支付服务重构',
    runId: 'r2',
    botName: '小王的 Claude',
    title: 'go build ./...',
  },
  readAt: null,
  createdAt: new Date().toISOString(),
  ...o,
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ notifCount: 2 })
})
afterEach(() => vi.unstubAllGlobals())

describe('notification center', () => {
  it('shows the unread count on the bell and lists actionable items with the prototype copy', async () => {
    const calls = mockApi({
      'GET /notifications': [
        note({}),
        note({
          id: 'n2',
          type: 'offline_expired',
          payload: {
            groupId: 'g1',
            groupName: '支付服务重构',
            runId: 'r3',
            botName: '小周的 Codex',
            waitMin: 30,
          },
          readAt: new Date().toISOString(),
        }),
      ],
      'POST /notifications/read-all': undefined,
      'POST /notifications/n1/read': undefined,
    })
    renderShell()
    const bell = screen.getByRole('button', { name: '通知' })
    expect(bell.textContent).toContain('2')
    fireEvent.click(bell)
    const list = await screen.findByTestId('notification-list')
    await within(list).findByText('待审批')
    expect(list.textContent).toContain('小王的 Claude 请求执行 go build ./...')
    expect(list.textContent).toContain('支付服务重构')
    expect(list.textContent).toContain('bot 离线作废')
    expect(list.textContent).toContain('你 @小周的 Codex 的请求等待 30 分钟未上线，已作废')
    expect(
      screen.getByText('只推送需要你操作的事项；模式切换、机器落后等群级事件只在群内显示。'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '全部标为已读' }))
    await waitFor(() => expect(useWorkspace.getState().notifCount).toBe(0))
    expect(calls.some((c) => c.method === 'POST' && c.path === '/notifications/read-all')).toBe(true)
    expect(bell.textContent).not.toContain('2')

    fireEvent.click(within(list).getByText('小王的 Claude 请求执行 go build ./...'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g1?run=r2'))
    expect(calls.some((c) => c.path === '/notifications/n1/read')).toBe(true)
    expect(screen.queryByTestId('notification-list')).toBeNull()
  })

  it('counts new notifications live', () => {
    mockApi({})
    renderShell()
    act(() => useWorkspace.getState().applyEvent({ t: 'notification.new', notification: note({ id: 'n9' }) }))
    expect(screen.getByRole('button', { name: '通知' }).textContent).toContain('3')
  })

  it('turns on browser push: asks permission, subscribes through the service worker and registers it', async () => {
    const calls = mockApi({
      'GET /notifications': [],
      'GET /push/key': { publicKey: 'BAAA' },
      'POST /push/subscriptions': undefined,
    })
    const requestPermission = vi.fn(async () => {
      Object.assign(globalThis.Notification, { permission: 'granted' })
      return 'granted'
    })
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('PushManager', class {})
    const subscription = {
      endpoint: 'https://push.test/1',
      toJSON: () => ({ endpoint: 'https://push.test/1', keys: { p256dh: 'p', auth: 'a' } }),
    }
    const subscribe = vi.fn(async () => subscription)
    const reg = { pushManager: { getSubscription: async () => null, subscribe } }
    const register = vi.fn(async () => reg)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve(reg), getRegistration: async () => reg },
    })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    fireEvent.click(await screen.findByRole('button', { name: '开启浏览器通知' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/push/subscriptions')).toBe(true),
    )
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    })
    expect(calls.find((c) => c.path === '/push/subscriptions')?.body).toEqual({
      endpoint: 'https://push.test/1',
      keys: { p256dh: 'p', auth: 'a' },
    })
    expect(await screen.findByText('浏览器通知已开启')).toBeTruthy()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })
})

describe('⌘K search', () => {
  const hit = (o: Partial<SearchResultDto>): SearchResultDto => ({
    kind: 'msg',
    title: '退款 v1 下周一下线',
    sub: '陈晨 · 支付服务重构',
    groupId: 'g1',
    messageId: 'm1',
    runId: null,
    ...o,
  })

  it('opens with ⌘K or Ctrl+K, searches the selected tab, navigates to a hit and closes on Escape', async () => {
    const calls = mockApi({
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=msg': [hit({})],
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=file': [
        hit({ kind: 'file', title: 'server/refund/v2/handler.go', sub: '小王的 Claude 工作区', runId: 'r1' }),
      ],
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=run': [
        hit({ kind: 'run', title: '小王的 Claude · 迁移', runId: 'r7' }),
      ],
    })
    renderShell()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const input = await screen.findByPlaceholderText('搜索消息、文件、运行')
    expect(screen.getByText('esc 关闭')).toBeTruthy()
    fireEvent.change(input, { target: { value: '退款' } })
    const results = screen.getByTestId('search-results')
    await within(results).findByText('退款 v1 下周一下线')
    expect(results.textContent).toContain('陈晨 · 支付服务重构')

    fireEvent.click(screen.getByRole('tab', { name: '文件' }))
    await within(results).findByText('server/refund/v2/handler.go')
    fireEvent.click(screen.getByRole('tab', { name: '运行' }))
    fireEvent.click(await within(results).findByText('小王的 Claude · 迁移'))
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?run=r7')
    expect(screen.queryByPlaceholderText('搜索消息、文件、运行')).toBeNull()
    expect(calls.filter((c) => c.path.startsWith('/search')).length).toBe(3)

    fireEvent.keyDown(document, { key: 'K', ctrlKey: true })
    await screen.findByPlaceholderText('搜索消息、文件、运行')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('搜索消息、文件、运行')).toBeNull()
  })

  it('opens from the top bar search button', async () => {
    mockApi({})
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /搜索消息、文件、运行/ }))
    expect(await screen.findByRole('dialog', { name: '搜索' })).toBeTruthy()
  })
})
