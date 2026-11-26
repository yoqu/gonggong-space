import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Toaster, useToasts } from '@web/ui'
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
  useToasts.setState({ items: [] })
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
  render(
    <>
      <TunnelsPage go={() => {}} />
      <Toaster />
    </>,
  )
  // Stopping an online preview requires confirmation and locks while closing.
  let resolveClose: () => void = () => {}
  m.closeTunnel.mockImplementationOnce(() => new Promise<void>((r) => (resolveClose = r)))
  fireEvent.click((await row('登录页')).getByRole('button', { name: '停止' }))
  expect(m.closeTunnel).not.toHaveBeenCalled()
  const stopDialog = screen.getByRole('alertdialog')
  expect(stopDialog.textContent).toContain('要停止「登录页」的在线预览吗？')
  expect(stopDialog.textContent).toContain(
    '停止后，群成员将无法继续打开这个预览链接，相关后台服务也会一并停止。',
  )
  fireEvent.click(within(stopDialog).getByRole('button', { name: '停止预览和服务' }))
  expect(within(stopDialog).getByRole('button', { name: '停止预览和服务' }).getAttribute('aria-busy')).toBe(
    'true',
  )
  expect((within(stopDialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  await act(async () => resolveClose())
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p1', true))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

  // Stopping an external tunnel also confirms, without claiming a managed background service will stop.
  fireEvent.click((await row('外部服务')).getByRole('button', { name: '停止预览' }))
  const extDialog = screen.getByRole('alertdialog')
  expect(extDialog.textContent).toContain('要停止「外部服务」的在线预览吗？')
  expect(extDialog.textContent).toContain('停止后，群成员将无法继续打开这个预览链接。')
  expect(extDialog.textContent).not.toContain('相关后台服务也会一并停止')
  fireEvent.click(within(extDialog).getByRole('button', { name: '停止预览' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p_ext', false))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

  // Pausing background process runs directly without a confirmation dialog and shows a success toast.
  fireEvent.click((await row('登录页')).getByRole('button', { name: '登录页 的更多操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '仅暂停后台进程（保留卡片）' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(m.stopService).toHaveBeenCalledWith('sv1'))

  // Restarting shows loading spinner and interlocks 彻底关闭 on the same row; permanently closing confirms first.
  const paused = await row('调试台')
  expect(paused.getByText('服务已停止')).toBeTruthy()
  let resolveStart: () => void = () => {}
  m.startPreview.mockImplementationOnce(() => new Promise<void>((r) => (resolveStart = r)))
  fireEvent.click(paused.getByRole('button', { name: '重新启动' }))
  expect(paused.getByRole('button', { name: '重新启动' }).getAttribute('aria-busy')).toBe('true')
  expect((paused.getByRole('button', { name: '彻底关闭' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolveStart())
  await waitFor(() => expect(m.startPreview).toHaveBeenCalledWith('p_paused'))

  fireEvent.click(paused.getByRole('button', { name: '彻底关闭' }))
  expect(m.closeTunnel).not.toHaveBeenCalledWith('p_paused', false)
  const closeDialog = screen.getByRole('alertdialog')
  expect(closeDialog.textContent).toContain('要彻底关闭「调试台」吗？')
  expect(closeDialog.textContent).toContain('关闭后该预览卡片会移除，之后无法再从这里重新启动。')
  fireEvent.click(within(closeDialog).getByRole('button', { name: '彻底关闭' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p_paused', false))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

  expect(screen.getByText('仅后台运行（未开放预览）')).toBeTruthy()
  fireEvent.click((await row(/python worker\.py/)).getByRole('button', { name: '停止' }))
  const bgDialog = screen.getByRole('alertdialog')
  expect(bgDialog.textContent).toContain('要停止后台服务「data-worker」吗？')
  fireEvent.click(within(bgDialog).getByRole('button', { name: '停止服务' }))
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

it('dismisses stale confirmation dialog if polling reports the preview changed status or disappeared', async () => {
  vi.useFakeTimers()
  render(<TunnelsPage go={() => {}} />)
  await act(async () => {})
  fireEvent.click(
    within(screen.getByText('登录页').closest('.dk-row-item') as HTMLElement).getByRole('button', {
      name: '停止',
    }),
  )
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  // Preview was stopped from the Web before the user confirmed.
  m.tunnels.mockResolvedValue({
    previews: [{ ...LIST.previews[0]!, status: 'stopped' }],
    services: LIST.services,
  })
  await act(async () => vi.advanceTimersByTime(5000))
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('uses 在线预览 in sidebar and explains without internal tool names', async () => {
  const nav = SECTIONS.flatMap((s) => s.pages).find((p) => p.key === 'tunnels')
  expect(nav?.label).toBe('在线预览')
  render(<TunnelsPage go={() => {}} />)
  const note = await screen.findByText(/由这台电脑运行/)
  expect(note.textContent).toBe(
    'Bot 开放的网页与后台服务由这台电脑运行。在这里操作与在网页端群里效果相同，群成员会立即看到变化。',
  )
})

it('matches Web on offline bound previews and exited/failed orphan services, and shows error+retry on IPC failure', async () => {
  const payload: Tunnels = {
    previews: [
      {
        ...LIST.previews[0]!,
        id: 'p_off',
        title: '离线页',
        status: 'offline',
        serviceId: 'sv1',
      },
    ],
    services: [
      LIST.services[0]!,
      {
        id: 'sv_exited',
        name: 'old-worker',
        groupName: '数据分析',
        botName: '数据助手',
        command: 'python old.py',
        cwd: 'jobs',
        port: null,
        status: 'exited',
      },
      {
        id: 'sv_failed',
        name: 'broken-worker',
        groupName: '数据分析',
        botName: '数据助手',
        command: 'python bad.py',
        cwd: 'jobs',
        port: null,
        status: 'failed',
      },
      {
        id: 'sv_starting',
        name: 'boot-worker',
        groupName: '数据分析',
        botName: '数据助手',
        command: 'python boot.py',
        cwd: 'jobs',
        port: null,
        status: 'starting',
      },
    ],
  }
  m.tunnels.mockRejectedValueOnce(new Error('IPC 断开')).mockResolvedValue(payload)

  render(<TunnelsPage go={() => {}} />)
  expect(await screen.findByText(/IPC 断开/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))

  const offline = await row('离线页')
  fireEvent.click(offline.getByRole('button', { name: '离线页 的更多操作' }))
  expect(screen.queryByRole('menuitem', { name: '仅暂停后台进程（保留卡片）' })).toBeNull()
  expect(screen.getByRole('menuitem', { name: '查看技术详情' })).toBeTruthy()
  fireEvent.click(offline.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p_off', false))

  expect((await row('old-worker')).queryByRole('button', { name: '停止' })).toBeNull()
  expect((await row('broken-worker')).queryByRole('button', { name: '停止' })).toBeNull()
  expect((await row('boot-worker')).getByRole('button', { name: '停止' })).toBeTruthy()
})
