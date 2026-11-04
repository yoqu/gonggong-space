import type { GroupDto, NotificationDto, SearchResultDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRail } from '../src/app/AppRail'
import { AppShell, ShellBar } from '../src/app/AppShell'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useSettings } from '../src/features/settings/store'
import { realtime } from '../src/lib/realtime'
import { listTime } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const note = (o: Partial<NotificationDto>): NotificationDto => ({
  id: 'n1',
  teamId: 't1',
  type: 'approval',
  payload: {
    groupId: 'g1',
    groupName: '支付服务重构',
    runId: 'r2',
    botName: '小王的 Claude',
    title: 'go build ./...',
  },
  readAt: null,
  resolvedAt: null,
  createdAt: new Date().toISOString(),
  ...o,
})

class FakeSocket {
  static last: FakeSocket | undefined
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
}
const push = (e: WebEvent) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify(e) }))

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="*"
            element={
              <>
                <AppRail />
                <ShellBar />
                <Where />
              </>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ notifCount: 2, groups: [] })
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
    const bell = screen.getByRole('button', { name: '通知（2 条未读）' })
    expect(bell.textContent).toContain('2')
    fireEvent.click(bell)
    const list = await screen.findByTestId('notification-list')
    await within(list).findByText('待审批')
    expect(list.textContent).toContain('小王的 Claude 请求执行 go build ./...')
    expect(list.textContent).toContain('支付服务重构')
    expect(list.textContent).toContain('Bot 离线作废')
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
    // 全部标为已读 already read it.
    expect(calls.some((c) => c.path === '/notifications/n1/read')).toBe(false)
    await waitFor(() => expect(screen.queryByTestId('notification-list')).toBeNull())
  })

  it('decides right there an approval from a chat the owner is not in, e.g. a shared bot’s DM', async () => {
    const options = [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ]
    const payload = { ...note({}).payload, approvalId: 'a1', options }
    useWorkspace.setState({ groups: [{ id: 'g2' } as never] })
    const calls = mockApi({
      'GET /notifications': [
        note({ payload }),
        note({ id: 'n2', payload: { ...payload, groupId: 'g2', approvalId: 'a2' } }),
      ],
      'POST /runs/r2/approvals/a1': { status: 'approved' },
    })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = await screen.findByTestId('notification-list')
    await within(list).findAllByText('待审批')
    // In a chat of mine the card in the chat is where to decide.
    expect(within(list).getAllByRole('button', { name: '批准' })).toHaveLength(1)
    fireEvent.click(within(list).getByRole('button', { name: '批准' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/runs/r2/approvals/a1')?.body).toEqual({ optionId: 'allow' }),
    )
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('opens a bot shared with me from its notification, reading it', async () => {
    const calls = mockApi({
      'GET /notifications': [
        note({ type: 'bot_shared', payload: { botId: 'b1', botName: '小王的 Claude', byName: '王磊' } }),
      ],
      'POST /notifications/n1/read': undefined,
    })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = await screen.findByTestId('notification-list')
    fireEvent.click(await within(list).findByText('王磊 将 小王的 Claude 共享给你，可以和它私聊'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/bot/b1'))
    expect(calls.some((c) => c.path === '/notifications/n1/read')).toBe(true)
  })

  it('shows market notifications with their icons and opens the market tab they point to', async () => {
    mockApi({
      'GET /notifications': [
        note({
          type: 'install_request',
          payload: {
            requestId: 'q1',
            requesterName: '陈晨',
            listingName: 'review-pr',
            targetLabel: '闲聊群',
          },
        }),
        note({
          id: 'n2',
          type: 'install_request_decided',
          payload: { listingName: 'review-pr', targetLabel: '闲聊群', approved: false, note: '已有同类' },
        }),
        note({
          id: 'n3',
          type: 'listing_reviewed',
          payload: { listingId: 'l1', listingName: 'review-pr', revision: 4, approved: true, note: '' },
        }),
      ],
      'POST /notifications/n1/read': undefined,
      'POST /notifications/n3/read': undefined,
    })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = await screen.findByTestId('notification-list')
    const request = (await within(list).findByText('陈晨 申请把 review-pr 引入到 闲聊群')).closest(
      'button',
    ) as HTMLElement
    const decided = within(list)
      .getByText('引入 review-pr 到 闲聊群 的申请被拒绝：已有同类')
      .closest('button') as HTMLElement
    const reviewed = within(list).getByText('review-pr r4 审核通过').closest('button') as HTMLElement
    const color = (el: HTMLElement) => (el.querySelector('.notif__icon') as HTMLElement).style.color
    expect(color(request)).toBe('var(--system-orange)')
    expect(color(decided)).toBe('var(--system-blue)')
    expect(color(reviewed)).toBe('var(--system-green)')
    fireEvent.click(request)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/market?tab=requests'))
  })

  it('shows handled items as 已处理, follows live resolutions and clamps long text', async () => {
    const done = new Date().toISOString()
    const long = `rm -rf ${'x'.repeat(400)}`
    mockApi({
      'GET /notifications': [
        note({ id: 'n1', readAt: done, resolvedAt: done }),
        note({ id: 'n2', payload: { groupId: 'g1', runId: 'r3', botName: 'B', title: long } }),
      ],
    })
    vi.stubGlobal('WebSocket', FakeSocket)
    realtime.start()
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = await screen.findByTestId('notification-list')
    await within(list).findByText('已处理')
    const [first, second] = [...list.querySelectorAll<HTMLElement>('.notif__item')] as [
      HTMLElement,
      HTMLElement,
    ]
    expect(first.className).toContain('notif__item--resolved')
    expect(within(first).getByText('已处理')).toBeTruthy()
    expect(within(second).queryByText('已处理')).toBeNull()
    expect(within(second).getByText(`B 请求执行 ${long}`).getAttribute('title')).toBe(`B 请求执行 ${long}`)

    const resolved = { ...note({ id: 'n2' }), readAt: done, resolvedAt: done }
    push({ t: 'notification.resolved', notifications: [resolved], unread: 0 })
    await waitFor(() => expect(within(second).getByText('已处理')).toBeTruthy())
    realtime.stop()
  })

  it('puts a new notification on top of the open list without reloading it', async () => {
    const calls = mockApi({ 'GET /notifications': [note({ id: 'n1' })] })
    vi.stubGlobal('WebSocket', FakeSocket)
    realtime.start()
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = await screen.findByTestId('notification-list')
    await within(list).findByText('待审批')
    push({
      t: 'notification.new',
      notification: note({ id: 'n9', type: 'offline_expired', payload: { groupId: 'g1', botName: 'B' } }),
    })
    await waitFor(() => expect(list.querySelectorAll('.notif__item')).toHaveLength(2))
    expect(within(list.querySelector('.notif__item') as HTMLElement).getByText('Bot 离线作废')).toBeTruthy()
    expect(calls.filter((c) => c.path === '/notifications')).toHaveLength(1)
    realtime.stop()
  })

  it('deletes one notification and clears the read ones', async () => {
    const done = new Date().toISOString()
    useWorkspace.setState({ notifCount: 1 })
    let items = [
      note({ id: 'n1', readAt: done }),
      note({ id: 'n2', type: 'offline_expired', payload: { groupId: 'g1', botName: '小周的 Codex' } }),
      note({ id: 'n3', readAt: done, type: 'chain_done', payload: { groupId: 'g1', hops: 2 } }),
    ]
    const calls = mockApi({
      'GET /notifications': () => items,
      'DELETE /notifications/n2': () => {
        items = items.filter((n) => n.id !== 'n2')
      },
      'DELETE /notifications/read': () => {
        items = items.filter((n) => !n.readAt)
      },
    })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = await screen.findByTestId('notification-list')
    await within(list).findByText('Bot 离线作废')
    const deletes = within(list).getAllByRole('button', { name: '删除通知' })
    expect(deletes).toHaveLength(3)

    fireEvent.click(deletes[1]!)
    await waitFor(() => expect(within(list).queryByText('Bot 离线作废')).toBeNull())
    expect(useWorkspace.getState().notifCount).toBe(0)
    expect(screen.getByTestId('where').textContent).toBe('/')

    fireEvent.click(screen.getByRole('button', { name: '清除已读' }))
    expect(await screen.findByText('暂无通知')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
      '/notifications/n2',
      '/notifications/read',
    ])
  })

  it('disables the bulk actions when there is nothing to act on', async () => {
    mockApi({ 'GET /notifications': [] })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    await screen.findByText('暂无通知')
    expect(screen.getByRole('button', { name: '全部标为已读' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '清除已读' }).hasAttribute('disabled')).toBe(true)
  })

  it('offers a shortcut to the 飞书通知 setting once Feishu is linked', async () => {
    const identity = {
      name: '王磊',
      avatar: null,
      email: null,
      boundAt: '2026-10-01T00:00:00Z',
      notify: false,
    }
    mockApi({ 'GET /notifications': [], 'GET /me/feishu': { identity } })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    await screen.findByText('飞书通知未开启')
    fireEvent.click(screen.getByRole('button', { name: '飞书通知设置' }))
    expect(useSettings.getState().page).toBe('notifications')
    act(() => useSettings.getState().close())
  })

  it('has no 飞书通知 shortcut without a linked Feishu account', async () => {
    mockApi({ 'GET /notifications': [], 'GET /me/feishu': { identity: null } })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    await screen.findByText('暂无通知')
    expect(screen.queryByRole('button', { name: '飞书通知设置' })).toBeNull()
  })

  it('closes on Escape unless an IME is composing', async () => {
    mockApi({ 'GET /notifications': [] })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const empty = (await screen.findByText('暂无通知')).closest('.ui-empty--compact')
    expect(empty?.querySelector('.ui-empty__art svg[aria-hidden="true"]')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('dialog', { name: '通知' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '通知' })).toBeNull())
  })

  it('shows loading, then a retryable error instead of 暂无通知', async () => {
    let fail = true
    mockApi({ 'GET /notifications': () => (fail ? apiError(500, 'internal') : [note({})]) })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    const list = screen.getByTestId('notification-list')
    expect(within(list).getByRole('status')).toBeTruthy()
    expect(await within(list).findByText('加载失败')).toBeTruthy()
    expect(within(list).queryByText('暂无通知')).toBeNull()
    fail = false
    fireEvent.click(within(list).getByRole('button', { name: '重试' }))
    expect(await within(list).findByText('待审批')).toBeTruthy()
  })

  it('toasts when marking all read fails and keeps the count', async () => {
    mockApi({
      'GET /notifications': [note({})],
      'POST /notifications/read-all': apiError(500, 'internal', '服务异常'),
    })
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
    await screen.findByText('待审批')
    fireEvent.click(screen.getByRole('button', { name: '全部标为已读' }))
    expect(await screen.findByText('服务异常')).toBeTruthy()
    expect(useWorkspace.getState().notifCount).toBe(2)
  })

  it('counts new notifications live', () => {
    mockApi({})
    renderShell()
    act(() => useWorkspace.getState().applyEvent({ t: 'notification.new', notification: note({ id: 'n9' }) }))
    expect(screen.getByRole('button', { name: /^通知/ }).textContent).toContain('3')
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
    fireEvent.click(screen.getByRole('button', { name: /^通知/ }))
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
    at: '2026-09-23T02:21:00.000Z',
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
    const input = await screen.findByPlaceholderText('搜索会话、消息、文件、运行')
    expect(screen.getByText('esc 关闭')).toBeTruthy()
    fireEvent.change(input, { target: { value: '退款' } })
    const results = screen.getByTestId('search-results')
    await waitFor(() => expect(results.textContent).toContain('退款 v1 下周一下线'))
    expect(results.textContent).toContain('陈晨 · 支付服务重构')

    fireEvent.click(screen.getByRole('tab', { name: '文件' }))
    await within(results).findByText('server/refund/v2/handler.go')
    fireEvent.click(screen.getByRole('tab', { name: '运行' }))
    fireEvent.click(await within(results).findByText('小王的 Claude · 迁移'))
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?run=r7')
    expect(screen.queryByPlaceholderText('搜索会话、消息、文件、运行')).toBeNull()
    expect(calls.filter((c) => c.path.startsWith('/search')).length).toBe(3)

    fireEvent.keyDown(document, { key: 'K', ctrlKey: true })
    await screen.findByPlaceholderText('搜索会话、消息、文件、运行')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('搜索会话、消息、文件、运行')).toBeNull()
  })

  const q = '/search?q=%E9%80%80%E6%AC%BE&tab=msg'
  const typeQuery = async () => {
    renderShell()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const input = await screen.findByPlaceholderText('搜索会话、消息、文件、运行')
    fireEvent.change(input, { target: { value: '退款' } })
    return input
  }

  it('highlights the query in markdown-free snippets with time and group, and opens the message', async () => {
    mockApi({ [`GET ${q}`]: [hit({ title: '> **退款** v1 下周 `一` [下线](http://x)' })] })
    await typeQuery()
    const results = screen.getByTestId('search-results')
    const row = await within(results).findByRole('option')
    expect(row.textContent).toContain('退款 v1 下周 一 下线')
    expect(row.textContent).not.toMatch(/[*`>[\]]/)
    expect(row.querySelector('mark')?.textContent).toBe('退款')
    expect(row.textContent).toContain('支付服务重构')
    expect(row.textContent).toContain(listTime('2026-09-23T02:21:00.000Z'))
    fireEvent.click(row)
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?msg=m1')
  })

  it('moves through results with arrow keys and opens the active one with Enter', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    mockApi({ [`GET ${q}`]: [hit({}), hit({ title: '退款二', messageId: 'm2' })] })
    const input = await typeQuery()
    const rows = await within(screen.getByTestId('search-results')).findAllByRole('option')
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0]!.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[1]!.id)
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?msg=m2')
  })

  it('separates loading and failure from no results, and ignores Escape while composing', async () => {
    let fail = true
    mockApi({ [`GET ${q}`]: () => (fail ? apiError(500, 'internal') : []) })
    const input = await typeQuery()
    const results = screen.getByTestId('search-results')
    expect(within(results).getByRole('status')).toBeTruthy()
    expect(await within(results).findByText('搜索失败')).toBeTruthy()
    expect(within(results).queryByText('没有匹配的结果')).toBeNull()
    fail = false
    fireEvent.click(within(results).getByRole('button', { name: '重试' }))
    const none = await within(results).findByText('没有匹配的结果')
    expect(none.closest('.ui-empty')?.querySelector('.ui-empty__art svg[aria-hidden="true"]')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(screen.getByPlaceholderText('搜索会话、消息、文件、运行')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('搜索会话、消息、文件、运行')).toBeNull()
  })

  it('lists matching conversations above the results, by group name or DM bot name, and opens one', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const conv = (id: string, name: string, kind: GroupDto['kind']) =>
      ({ id, name, kind, avatar: null, members: [], botIds: [] }) as unknown as GroupDto
    useWorkspace.setState({
      groups: [
        conv('g1', '退款 v2 迁移', 'group'),
        conv('g2', '订单服务', 'group'),
        conv('d1', '退款助手', 'dm'),
      ],
    })
    mockApi({ [`GET ${q}`]: [hit({})] })
    const input = await typeQuery()
    const results = screen.getByTestId('search-results')
    expect(within(results).getByText('会话')).toBeTruthy()
    const rows = within(results).getAllByRole('option')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('退款 v2 迁移'),
      expect.stringContaining('退款助手'),
    ])
    expect(rows[1]!.textContent).toContain('私聊')
    await waitFor(() => expect(within(results).getAllByRole('option')).toHaveLength(3))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/g/d1')
    expect(screen.queryByPlaceholderText('搜索会话、消息、文件、运行')).toBeNull()
  })

  it('shows matching conversations instead of "no results" when the server finds nothing', async () => {
    useWorkspace.setState({
      groups: [
        {
          id: 'g2',
          name: '退款群',
          kind: 'group',
          avatar: null,
          members: [],
          botIds: [],
        } as unknown as GroupDto,
      ],
    })
    mockApi({ [`GET ${q}`]: [] })
    await typeQuery()
    const results = screen.getByTestId('search-results')
    await waitFor(() => expect(within(results).queryByRole('status')).toBeNull())
    expect(within(results).queryByText('没有匹配的结果')).toBeNull()
    fireEvent.click(within(results).getByRole('option'))
    expect(screen.getByTestId('where').textContent).toBe('/g/g2')
  })

  it('opens from the sidebar search field', async () => {
    mockApi({})
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /搜索会话、消息、文件、运行/ }))
    expect(await screen.findByRole('dialog', { name: '搜索' })).toBeTruthy()
  })
})
