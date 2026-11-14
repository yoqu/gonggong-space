import type { FeishuAppDto, FeishuOverviewDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { mockApi } from './mockApi'

class NoopSocket {
  close() {}
}
beforeAll(() => import('../src/features/admin/AdminRoutes'))
beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: { id: 'u0', role: 'sysadmin', name: '陈晨' } as never, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

const page = {
  'GET /admin/params': { feishuAutoSignup: true, publicUrl: 'https://gg.example.com' },
  'GET /admin/feishu': { app: null },
}

const app = (o: Partial<FeishuAppDto> = {}): FeishuAppDto => ({
  appId: 'cli_x',
  status: 'connected',
  error: null,
  configError: null,
  review: 'approved',
  updatedAt: '2026-11-14T00:00:00Z',
  ...o,
})

const overview = (o: Partial<FeishuOverviewDto> = {}): FeishuOverviewDto => ({
  publicUrl: 'https://gg.example.com',
  main: app({ appId: 'cli_main' }),
  linkedUsers: 1,
  othersLinked: false,
  bots: [
    { botId: 'b1', name: 'codex', teamName: '研发', ownerName: '王磊', app: app({ appId: 'cli_b1' }) },
    {
      botId: 'b2',
      name: 'gemini',
      teamName: '研发',
      ownerName: '李娜',
      app: app({ appId: 'cli_b2', review: 'pending', configError: '自动配置失败：scope' }),
    },
    { botId: 'b3', name: 'claude', teamName: '研发', ownerName: '王磊', app: null },
  ],
  chats: [
    {
      groupId: 'g1',
      groupName: '研发群',
      teamName: '研发',
      chatName: '飞书研发群',
      boundAt: '2026-11-01T00:00:00Z',
      botsInChat: null,
      botsTotal: 3,
      issue: { code: 232017, message: 'no permission' },
      member: true,
    },
  ],
  ...o,
})

const renderIt = () =>
  render(
    <MemoryRouter initialEntries={['/admin/feishu']}>
      <App />
    </MemoryRouter>,
  )

describe('管理后台 · 飞书总览', () => {
  it('shows the four setup steps and what the last one still needs', async () => {
    mockApi({ ...page, 'GET /admin/feishu/overview': overview() })
    renderIt()
    const steps = await screen.findByRole('list', { name: '飞书接入进度' })
    const items = within(steps).getAllByRole('listitem')
    const titles = items.map((li) =>
      li.querySelector('.feishu-progress__title')?.textContent?.replace(/^\d/, ''),
    )
    expect(titles).toEqual(['对外地址', '接入主应用', '审核通过', '成员可用'])
    expect(within(steps).getByRole('button', { name: '复制登录地址，发给同事验证' })).toBeTruthy()
  })

  it('folds the steps into one line once every step is done', async () => {
    mockApi({ ...page, 'GET /admin/feishu/overview': overview({ othersLinked: true, linkedUsers: 5 }) })
    renderIt()
    expect(await screen.findByText('飞书已接通 · 5 人已绑定飞书账号')).toBeTruthy()
    expect(screen.queryByRole('list', { name: '飞书接入进度' })).toBeNull()
  })

  it('lists bots with an app by default, all on demand, and each linked chat', async () => {
    const calls = mockApi({
      ...page,
      'GET /admin/feishu/overview': overview(),
      'POST /bots/b2/feishu/configure': { app: app({ appId: 'cli_b2' }) },
    })
    renderIt()
    const bots = await screen.findByRole('grid', { name: 'Bot 的飞书应用' })
    expect(within(bots).getByText('codex')).toBeTruthy()
    expect(within(bots).getByText('等待审核')).toBeTruthy()
    expect(within(bots).queryByText('claude')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示全部（3）' }))
    expect(within(bots).getByText('claude')).toBeTruthy()
    expect(within(bots).getByText('未接入')).toBeTruthy()

    const gemini = within(bots).getByRole('row', { name: /gemini/ })
    fireEvent.click(within(gemini).getByRole('button', { name: '操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '重试' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/bots/b2/feishu/configure')).toBe(true))

    const chats = screen.getByRole('grid', { name: '已关联的飞书群' })
    expect(within(chats).getByText('飞书研发群')).toBeTruthy()
    expect(within(chats).getByText('— / 3')).toBeTruthy()
    expect(within(chats).getByText(/飞书群设置了仅群主和管理员可添加成员/)).toBeTruthy()
    expect(within(chats).getByRole('link', { name: '打开群' }).getAttribute('href')).toBe('/g/g1')
  })
})
