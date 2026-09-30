import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Tunnels } from '../src/ipc'
import { LivePage } from '../src/pages/Live'
import { usePermissions } from '../src/permissions'

const m = vi.mocked(ipc)

type P = Tunnels['previews'][number]
const preview = (o: Partial<P>): P => ({
  id: 'p1',
  kind: 'gui',
  title: '桌面客户端',
  groupName: '支付重构',
  botName: '小王的 Claude',
  port: null,
  path: '/',
  serviceId: 'sv1',
  serviceName: 'app',
  status: 'online',
  live: null,
  control: null,
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.setState({ list: [], guide: false })
  m.castComponent.mockResolvedValue({
    source: 'bundled',
    path: '/Applications/共工空间.app/Contents/MacOS/gg-cast',
  })
  m.closeTunnel.mockResolvedValue()
  m.tunnels.mockResolvedValue({
    services: [],
    previews: [
      preview({
        live: { state: 'live', error: null, missing: [] },
        control: { controller: { name: '李建国' } },
      }),
      preview({
        id: 'p2',
        kind: 'miniprogram',
        title: '会员小程序',
        serviceId: null,
        live: { state: 'failed', error: '机器未授权屏幕录制', missing: ['screen_recording'] },
      }),
      preview({ id: 'p3', kind: 'http', title: '登录页' }),
    ],
  })
})

const row = async (text: string) =>
  within(((await screen.findAllByText(text))[0] as HTMLElement).closest('.dk-row') as HTMLElement)

it('shows the bundled gg-cast and the live previews with their state, controller and failure', async () => {
  render(<LivePage go={() => {}} />)
  const cast = await row('gg-cast')
  expect(cast.getByText('已内置')).toBeTruthy()
  expect(cast.getByText('随共工空间一起安装与升级，无需单独下载')).toBeTruthy()
  const app = await row('桌面客户端')
  expect(app.getByText('推流中')).toBeTruthy()
  expect(app.getByText('支付重构 · 小王的 Claude · 桌面应用 · 李建国 正在远程操作')).toBeTruthy()
  const mini = await row('会员小程序')
  expect(mini.getByText('推流失败')).toBeTruthy()
  expect(mini.getByText('机器未授权屏幕录制')).toBeTruthy()
  expect(screen.queryByText('登录页')).toBeNull()
})

it('explains a dev build without gg-cast, and hides permissions where none are needed', async () => {
  m.castComponent.mockResolvedValue({ source: 'download' })
  render(<LivePage go={() => {}} />)
  expect((await row('gg-cast')).getByText('未内置')).toBeTruthy()
  expect(screen.queryByText('系统权限')).toBeNull()
})

it('fixes missing permissions and closes a live preview from here', async () => {
  usePermissions.setState({
    list: [
      { kind: 'screen_recording', granted: false },
      { kind: 'accessibility', granted: true },
    ],
  })
  render(<LivePage go={() => {}} />)
  const screenRecording = await row('屏幕录制')
  expect(screenRecording.getByText('未授权')).toBeTruthy()
  expect((await row('辅助功能')).queryByRole('button', { name: '去授权' })).toBeNull()
  fireEvent.click((await row('会员小程序')).getByRole('button', { name: '去授权' }))
  expect(usePermissions.getState().guide).toBe(true)
  fireEvent.click((await row('桌面客户端')).getByRole('button', { name: '关闭并停止应用' }))
  await waitFor(() => expect(m.closeTunnel).toHaveBeenCalledWith('p1', true))
})

it('guides the owner through the WeChat devtools while a mini program waits on them', async () => {
  m.tunnels.mockResolvedValue({
    services: [],
    previews: [
      preview({
        id: 'p2',
        kind: 'miniprogram',
        title: '会员小程序',
        serviceId: null,
        live: { state: 'failed', error: '微信开发者工具未开启服务端口', missing: [], devtools: 'port' },
      }),
    ],
  })
  render(<LivePage go={() => {}} />)
  const mini = await row('会员小程序')
  expect(mini.getByText('等待操作')).toBeTruthy()
  expect(screen.getByText('请开启微信开发者工具的服务端口')).toBeTruthy()
  expect(screen.getByText('完成后自动继续')).toBeTruthy()
  expect(screen.queryByText('微信开发者工具未开启服务端口')).toBeNull()
})

it('retries a failed live preview at once, and says when it retries by itself', async () => {
  m.retryCast.mockResolvedValue()
  m.tunnels.mockResolvedValue({
    services: [],
    previews: [
      preview({
        live: {
          state: 'failed',
          error: '应用还没有可见窗口（或窗口已最小化）',
          missing: [],
          retryAt: new Date(Date.now() + 30_000).toISOString(),
        },
      }),
    ],
  })
  render(<LivePage go={() => {}} />)
  const app = await row('桌面客户端')
  expect(app.getByText(/^(30|29) 秒后自动重试$/)).toBeTruthy()
  fireEvent.click(app.getByRole('button', { name: '立即重试' }))
  await waitFor(() => expect(m.retryCast).toHaveBeenCalledWith('p1'))
})
