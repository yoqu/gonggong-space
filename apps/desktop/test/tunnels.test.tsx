import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Tunnels } from '../src/ipc'
import { SECTIONS } from '../src/pages'
import { TunnelsPage } from '../src/pages/Tunnels'

const m = vi.mocked(ipc)

const LIST: Tunnels = {
  previews: [
    {
      id: 'p1',
      kind: 'http',
      title: '登录页',
      groupName: '支付重构',
      botName: '小王的 Claude',
      port: 5173,
      path: '/login',
      serviceId: 'sv1',
      serviceName: 'web',
      status: 'online',
      live: null,
      control: null,
    },
    {
      id: 'p2',
      kind: 'static',
      title: '静态报告',
      groupName: '数据看板',
      botName: '小王的 Claude',
      port: 8080,
      path: '/',
      serviceId: 'sv2',
      serviceName: 'static-site',
      status: 'online',
      live: null,
      control: null,
    },
    {
      id: 'p3',
      kind: 'gui',
      title: '桌面客户端',
      groupName: '支付重构',
      botName: '小王的 Claude',
      port: null,
      path: '/',
      serviceId: 'sv1',
      serviceName: 'web',
      status: 'online',
      live: null,
      control: null,
    },
  ],
  services: [
    {
      id: 'sv1',
      name: 'web',
      groupName: '支付重构',
      botName: '小王的 Claude',
      command: 'pnpm dev',
      cwd: 'apps/web',
      port: 5173,
      status: 'running',
    },
    {
      id: 'sv2',
      name: 'static-site',
      groupName: '数据看板',
      botName: '小王的 Claude',
      command: '静态站点 site',
      cwd: '.',
      port: 8080,
      status: 'running',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  m.tunnels.mockResolvedValue(LIST)
  m.closeTunnel.mockResolvedValue()
  m.startPreview.mockResolvedValue()
  m.stopService.mockResolvedValue()
  m.openLocal.mockResolvedValue()
})
afterEach(() => vi.useRealTimers())

const row = async (text: string | RegExp) =>
  within((await screen.findByText(text)).closest('.dk-row-item') as HTMLElement)

it('merges bound previews and services and hides background section when none are orphaned', async () => {
  render(<TunnelsPage go={() => {}} />)
  const login = await row('登录页')
  expect(login.getByText('支付重构 · 小王的 Claude · 网页应用')).toBeTruthy()
  expect(screen.queryByText(/pnpm dev/)).toBeNull()
  expect(screen.queryByText(/静态站点 site/)).toBeNull()
  expect(screen.queryByText(/仅后台运行/)).toBeNull()
  expect(screen.queryByText('桌面客户端')).toBeNull()

  const report = await row('静态报告')
  expect(report.getByText('数据看板 · 小王的 Claude · 静态页面')).toBeTruthy()

  fireEvent.click(login.getByRole('button', { name: '本机打开' }))
  expect(m.openLocal).toHaveBeenCalledWith(5173, '/login')

  fireEvent.click(login.getByRole('button', { name: '登录页 的更多操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '查看技术详情' }))
  expect(login.getByText(/127\.0\.0\.1:5173/)).toBeTruthy()
  expect(login.getByText(/\$ pnpm dev/)).toBeTruthy()
})

it('stops both by default, pauses via menu, restarts paused previews, and shows orphan background services', async () => {
  m.tunnels.mockResolvedValue({
    previews: [
      LIST.previews[0]!,
      {
        ...LIST.previews[1]!,
        id: 'p_ext',
        kind: 'http',
        title: '外部服务',
        serviceId: null,
        serviceName: null,
      },
      {
        ...LIST.previews[0]!,
        id: 'p_paused',
        title: '调试台',
        status: 'stopped',
        serviceId: 'sv_gone',
        serviceName: 'swagger',
      },
    ],
    services: [
      LIST.services[0]!,
      {
        id: 'sv_bg',
        name: 'data-worker',
        groupName: '数据分析',
        botName: '数据助手',
        command: 'python worker.py',
        cwd: 'jobs',
        port: null,
        status: 'running',
      },
    ],
  })
  render(<TunnelsPage go={() => {}} />)
  fireEvent.click((await row('登录页')).getByRole('button', { name: '停止' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p1', true))

  fireEvent.click((await row('外部服务')).getByRole('button', { name: '停止穿透' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p_ext', false))

  fireEvent.click((await row('登录页')).getByRole('button', { name: '登录页 的更多操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '仅暂停后台进程（保留卡片）' }))
  await waitFor(() => expect(m.stopService).toHaveBeenCalledWith('sv1'))

  const paused = await row('调试台')
  expect(paused.getByText('服务已停止')).toBeTruthy()
  fireEvent.click(paused.getByRole('button', { name: '重新启动' }))
  await waitFor(() => expect(m.startPreview).toHaveBeenCalledWith('p_paused'))
  fireEvent.click(paused.getByRole('button', { name: '彻底关闭' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p_paused', false))

  expect(screen.getByText('仅后台运行（未开放预览）')).toBeTruthy()
  fireEvent.click((await row(/python worker\.py/)).getByRole('button', { name: '停止' }))
  await waitFor(() => expect(m.stopService).toHaveBeenCalledWith('sv_bg'))
})

it('keeps in step with the Web by reloading every few seconds and shows one empty state', async () => {
  vi.useFakeTimers()
  render(<TunnelsPage go={() => {}} />)
  await act(async () => {})
  m.tunnels.mockResolvedValue({ previews: [], services: [] })
  await act(async () => vi.advanceTimersByTime(5000))
  expect(screen.getByText('本机没有在线预览')).toBeTruthy()
  expect(screen.queryByText(/仅后台运行/)).toBeNull()
})

it('uses 在线预览 in sidebar and explains without internal tool names', async () => {
  const nav = SECTIONS.flatMap((s) => s.pages).find((p) => p.key === 'tunnels')
  expect(nav?.label).toBe('在线预览')
  render(<TunnelsPage go={() => {}} />)
  const note = await screen.findByText(/由这台电脑运行/)
  expect(note.textContent).toBe(
    'Bot 开放的网页与后台服务由这台电脑运行。在这里操作与在 Web 群里效果相同，群成员会立即看到变化。',
  )
})
