import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Tunnels } from '../src/ipc'
import { TunnelsPage } from '../src/pages/Tunnels'

const m = vi.mocked(ipc)

const LIST: Tunnels = {
  previews: [
    {
      id: 'p1',
      title: '登录页',
      groupName: '支付重构',
      botName: '小王的 Claude',
      port: 5173,
      path: '/login',
      serviceId: 'sv1',
      serviceName: 'web',
      status: 'online',
    },
    {
      id: 'p2',
      title: '静态报告',
      groupName: '数据看板',
      botName: '小王的 Claude',
      port: 8080,
      path: '/',
      serviceId: null,
      serviceName: null,
      status: 'online',
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
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  m.tunnels.mockResolvedValue(LIST)
  m.closeTunnel.mockResolvedValue()
  m.stopService.mockResolvedValue()
  m.openLocal.mockResolvedValue()
})
afterEach(() => vi.useRealTimers())

const row = async (text: string | RegExp) =>
  within((await screen.findByText(text)).closest('.dk-row') as HTMLElement)

it('lists the tunnels and hosted services of this machine', async () => {
  render(<TunnelsPage go={() => {}} />)
  const login = await row('登录页')
  expect(login.getByText('支付重构 · 小王的 Claude · 端口 5173 · 服务 web')).toBeTruthy()
  fireEvent.click(login.getByRole('button', { name: '本机打开' }))
  expect(m.openLocal).toHaveBeenCalledWith(5173, '/login')
  const web = await row(/pnpm dev/)
  expect(web.getByText('运行中')).toBeTruthy()
})

it('stops a tunnel with its service, or a service alone, and reloads', async () => {
  render(<TunnelsPage go={() => {}} />)
  fireEvent.click((await row('登录页')).getByRole('button', { name: '停止穿透和服务' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p1', true))
  fireEvent.click((await row('静态报告')).getByRole('button', { name: '停止穿透' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p2', true))
  fireEvent.click((await row(/pnpm dev/)).getByRole('button', { name: '停止' }))
  await waitFor(() => expect(m.stopService).toHaveBeenCalledWith('sv1'))
  expect(m.tunnels.mock.calls.length).toBeGreaterThanOrEqual(4)
})

it('keeps in step with the Web by reloading every few seconds', async () => {
  vi.useFakeTimers()
  render(<TunnelsPage go={() => {}} />)
  await act(async () => {})
  m.tunnels.mockResolvedValue({ previews: [], services: [] })
  await act(async () => vi.advanceTimersByTime(5000))
  expect(screen.getByText('本机没有开放的穿透')).toBeTruthy()
  expect(screen.getByText('本机没有托管服务')).toBeTruthy()
})
