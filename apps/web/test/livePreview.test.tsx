import type { GroupPreviewsDto, PreviewDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { PreviewCard } from '../src/features/previews/PreviewCard'
import { resetPreviews } from '../src/features/previews/store'
import { LiveTab } from '../src/features/workbench/tabs/LiveTab'
import { MiniprogramTab } from '../src/features/workbench/tabs/MiniprogramTab'
import { mockApi } from './mockApi'

/** livekit-client stand-in: records the connection and what was published, and lets the test fire room events. */
const lk = vi.hoisted(() => {
  const rooms: {
    url?: string
    token?: string
    disconnected: boolean
    sent: { input: unknown; opts: unknown }[]
    emit: (event: string, ...args: unknown[]) => void
  }[] = []
  return { rooms }
})
vi.mock('livekit-client', () => {
  class Room {
    private handlers = new Map<string, (...args: unknown[]) => void>()
    url?: string
    token?: string
    disconnected = false
    sent: { input: unknown; opts: unknown }[] = []
    localParticipant = {
      identity: 'u:u-li:ab',
      publishData: async (data: Uint8Array, opts: unknown) => {
        this.sent.push({ input: JSON.parse(new TextDecoder().decode(data)), opts })
      },
    }
    constructor() {
      lk.rooms.push(this)
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, fn)
      return this
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args)
    }
    async connect(url: string, token: string) {
      this.url = url
      this.token = token
    }
    async disconnect() {
      this.disconnected = true
    }
  }
  return {
    Room,
    RoomEvent: {
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      ConnectionQualityChanged: 'connectionQualityChanged',
    },
    Track: { Kind: { Video: 'video' } },
    VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 },
    ConnectionQuality: {
      Excellent: 'excellent',
      Good: 'good',
      Poor: 'poor',
      Lost: 'lost',
      Unknown: 'unknown',
    },
  }
})

const WANG = { id: 'u-wang', name: '王磊' }
const LI = { id: 'u-li', name: '李建国' }

const preview = (o: Partial<PreviewDto> = {}): PreviewDto => ({
  id: 'p3',
  groupId: 'g1',
  groupName: '支付重构',
  botId: 'b1',
  botName: '小王的 Claude',
  kind: 'gui',
  title: '计算器',
  path: '/',
  serviceId: 'sv1',
  serviceName: 'calc',
  port: null,
  snapshotAt: null,
  status: 'online',
  awaiting: null,
  snapshotError: null,
  live: { state: 'live', error: null, missing: [] },
  control: { controller: null, requests: [] },
  canManage: false,
  createdAt: '2026-09-29T10:00:00Z',
  ...o,
})
const list = (previews: PreviewDto[]): GroupPreviewsDto => ({ previews, services: [], manageableBotIds: [] })
const tab: Extract<WorkbenchTab, { kind: 'live' }> = { kind: 'live', previewId: 'p3' }

function login(who: { id: string; name: string }) {
  useSession.setState({
    user: {
      ...who,
      account: who.id,
      role: 'member',
      mustChangePassword: false,
      disabled: false,
      gitProtocol: 'auto',
    },
    status: 'ready',
  })
}

function routes(p: PreviewDto) {
  return mockApi({
    'GET /groups/g1/previews': list([p]),
    'POST /previews/p3/watch': undefined,
    'POST /previews/p3/live': { url: null, token: 'tok-li', identity: 'u:u-li:ab' },
    'POST /previews/p3/control': undefined,
  })
}

class NoopSocket {
  close() {}
}

beforeEach(() => {
  lk.rooms.length = 0
  resetPreviews()
  login(LI)
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

describe('桌面应用预览 · 观看', () => {
  it("joins the preview's room through the server, keeps watching, and shows the window", async () => {
    const calls = routes(preview())
    const { unmount } = render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    expect(lk.rooms[0]?.url).toBe(`ws://${location.host}/livekit`)
    expect(calls.some((c) => c.method === 'POST' && c.path === '/previews/p3/watch')).toBe(true)

    const attach = vi.fn()
    lk.rooms[0]?.emit('trackSubscribed', { kind: 'video', attach, detach: vi.fn() })
    await waitFor(() => expect(attach).toHaveBeenCalledWith(screen.getByLabelText('计算器 实时画面')))

    unmount()
    expect(lk.rooms[0]?.disconnected).toBe(true)
  })

  it('says why there is no picture', async () => {
    routes(preview({ live: { state: 'failed', error: '本机没有授予「屏幕录制」权限', missing: [] } }))
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await screen.findByText('本机没有授予「屏幕录制」权限。Bot 主人可在共工桌面端「实时画面」页查看')
  })

  it("names the machine's missing screen recording permission", async () => {
    routes(
      preview({
        live: {
          state: 'failed',
          error: '机器未授权屏幕录制，请在共工桌面端「实时画面」页完成授权',
          missing: ['screen_recording', 'accessibility'],
        },
      }),
    )
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await screen.findByText('机器未授权屏幕录制')
    screen.getByText('请 Bot 主人在共工桌面端「实时画面」页完成授权')
  })

  it('opens from its card in the workbench', async () => {
    routes(preview())
    render(<PreviewCard previewId="p3" groupId="g1" botId="b1" fallback="预览：计算器" />)
    await screen.findByText('桌面应用 · calc')
    fireEvent.click(screen.getByRole('button', { name: '在工作台打开' }))
    expect(useWorkbench.getState().benches.g1?.tabs).toEqual([tab])
    expect(screen.queryByRole('button', { name: '公开链接' })).toBeNull()
  })
})

describe('桌面应用预览 · 控制', () => {
  it('members ask for control, and see who has it', async () => {
    const calls = routes(preview())
    const first = render(<LiveTab tab={tab} tabKey="live:p3" active />)
    fireEvent.click(await screen.findByRole('button', { name: '请求控制' }))
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({ path: '/previews/p3/control', body: { action: 'request' } }),
    )
    first.unmount()
    resetPreviews()
    routes(preview({ control: { controller: WANG, requests: [] } }))
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await screen.findByText('王磊 正在控制')
  })

  it('the bot owner approves or turns down requests, on the card too', async () => {
    login(WANG)
    const calls = routes(preview({ canManage: true, control: { controller: null, requests: [LI] } }))
    render(<PreviewCard previewId="p3" groupId="g1" botId="b1" fallback="预览：计算器" />)
    await screen.findByText('李建国 请求控制')
    fireEvent.click(screen.getByRole('button', { name: '同意' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ action: 'grant', userId: 'u-li' }))
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ action: 'deny', userId: 'u-li' }))
  })

  it('the controller sends pointer, wheel, keys and text to the machine', async () => {
    const calls = routes(preview({ control: { controller: LI, requests: [] } }))
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    lk.rooms[0]?.emit('trackSubscribed', { kind: 'video', attach: vi.fn(), detach: vi.fn() })
    const video = (await screen.findByLabelText('计算器 实时画面')) as HTMLVideoElement
    // A 400×800 window shown letterboxed in a 600×800 box: 100 px bars left and right.
    Object.defineProperties(video, { videoWidth: { value: 400 }, videoHeight: { value: 800 } })
    video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 800 }) as DOMRect
    video.setPointerCapture = () => {}

    fireEvent.pointerDown(video, { clientX: 300, clientY: 400, button: 0 })
    fireEvent.pointerMove(video, { clientX: 400, clientY: 600 })
    fireEvent.pointerUp(video, { clientX: 400, clientY: 600 })
    fireEvent.pointerDown(video, { clientX: 50, clientY: 400, button: 0 })
    fireEvent.wheel(video, { clientX: 300, clientY: 400, deltaY: 100 })
    fireEvent.wheel(video, { clientX: 300, clientY: 400, deltaY: 20 })
    // Wheel deltas arrive summed a moment later.
    await waitFor(() => expect(lk.rooms[0]?.sent.length).toBe(4))
    const keys = screen.getByLabelText('键盘输入')
    fireEvent.keyDown(keys, { key: 'Enter' })
    fireEvent.keyDown(keys, { key: 'z', metaKey: true })
    fireEvent.input(keys, { target: { value: '你好' } })

    await waitFor(() => expect(lk.rooms[0]?.sent.length).toBe(7))
    expect(lk.rooms[0]?.sent.map((s) => s.input)).toEqual([
      { t: 'down', x: 0.5, y: 0.5 },
      { t: 'move', x: 0.75, y: 0.75 },
      { t: 'up', x: 0.75, y: 0.75 },
      { t: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 120 },
      { t: 'key', key: 'Enter', mods: [] },
      { t: 'key', key: 'z', mods: ['meta'] },
      { t: 'text', text: '你好' },
    ])
    expect(lk.rooms[0]?.sent[0]?.opts).toEqual({
      reliable: true,
      destinationIdentities: ['cast'],
      topic: 'input',
    })

    fireEvent.click(screen.getByRole('button', { name: '交还控制' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ action: 'release' }))
  })

  it('warns the controller that the machine cannot take input without accessibility', async () => {
    routes(
      preview({
        control: { controller: LI, requests: [] },
        live: { state: 'live', error: null, missing: ['accessibility'] },
      }),
    )
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await screen.findByText('机器未授权辅助功能，远程操作不会生效，请在共工桌面端「实时画面」页完成授权')
  })

  it('viewers only watch: no input leaves the page', async () => {
    routes(preview())
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    lk.rooms[0]?.emit('trackSubscribed', { kind: 'video', attach: vi.fn(), detach: vi.fn() })
    const video = await screen.findByLabelText('计算器 实时画面')
    fireEvent.pointerDown(video, { clientX: 10, clientY: 10, button: 0 })
    expect(screen.queryByLabelText('键盘输入')).toBeNull()
    expect(lk.rooms[0]?.sent).toEqual([])
  })
})

describe('小程序 · 实时画面', () => {
  it('shows the live simulator in the workbench tab, never a screenshot', async () => {
    const mp = preview({ kind: 'miniprogram', title: '商城', serviceId: null, serviceName: null, live: null })
    mockApi({
      'GET /groups/g1/previews': list([mp]),
      'POST /previews/p3/watch': undefined,
      'POST /previews/p3/live': { url: null, token: 'tok-li', identity: 'u:u-li:ab' },
    })
    render(<MiniprogramTab tab={{ kind: 'miniprogram', previewId: 'p3' }} tabKey="mp:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    expect(await screen.findByRole('button', { name: '请求控制' })).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

/** A video track whose receiver reports `lossPerSecond` of its packets lost, and its publication's quality layers. */
function stream(
  lossPerSecond: number,
  layers: { quality: number; width: number; height: number; bitrate: number }[],
) {
  let second = 0
  const track = {
    kind: 'video',
    attach: vi.fn(),
    detach: vi.fn(),
    getRTCStatsReport: async () => {
      second++
      return new Map<string, unknown>([
        [
          'in',
          {
            type: 'inbound-rtp',
            kind: 'video',
            packetsLost: second * lossPerSecond,
            packetsReceived: second * (100 - lossPerSecond),
            bytesReceived: second * 250_000,
            framesPerSecond: 30,
            frameWidth: 1920,
            frameHeight: 1080,
            jitter: 0.004,
            freezeCount: 0,
          },
        ],
        ['cp', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 }],
      ])
    },
  }
  const publication = { trackInfo: { codecs: [], layers }, setVideoQuality: vi.fn() }
  return { track, publication }
}

describe('实时画面 · 网络、帧率与画质', () => {
  it("shows the picture's figures over its top right corner, red when poor and naming whose network it is", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    routes(preview())
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    const { track, publication } = stream(10, [
      { quality: 2, width: 1920, height: 1080, bitrate: 11_197_440 },
    ])
    act(() => lk.rooms[0]?.emit('trackSubscribed', track, publication, { identity: 'cast' }))

    await act(() => vi.advanceTimersByTimeAsync(5000))
    const figures = await screen.findByRole('status', { name: '画面数据' })
    expect(figures.textContent).toContain('30 fps · 1920×1080 · 2.0 Mbps')
    expect(figures.textContent).toContain('丢包 10.0% · 延迟 50 ms · 抖动 4 ms')
    screen.getByText('网络差')
    // One layer only: nothing to pick.
    expect(screen.queryByRole('button', { name: '画质' })).toBeNull()

    act(() => lk.rooms[0]?.emit('connectionQualityChanged', 'poor', { identity: 'cast' }))
    await waitFor(() => expect(figures.textContent).toContain('机器网络差'))

    fireEvent.click(screen.getByRole('button', { name: '隐藏画面数据' }))
    expect(screen.queryByRole('status', { name: '画面数据' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示画面数据' }))
    screen.getByRole('status', { name: '画面数据' })
  })

  it('stays quiet on a good network', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    routes(preview())
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    const { track, publication } = stream(0, [])
    act(() => lk.rooms[0]?.emit('trackSubscribed', track, publication, { identity: 'cast' }))
    await act(() => vi.advanceTimersByTimeAsync(5000))
    const figures = await screen.findByRole('status', { name: '画面数据' })
    expect(figures.textContent).toContain('丢包 0.0% · 延迟 50 ms')
    expect(screen.queryByText('网络差')).toBeNull()
    expect(screen.queryByText('网络一般')).toBeNull()
  })

  it('asks the machine for a frame rate: automatic by the network, or picked, and remembered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = routes(preview())
    const watched = () => calls.filter((c) => c.path === '/previews/p3/watch').at(-1)?.body
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    const { track, publication } = stream(10, [])
    act(() => lk.rooms[0]?.emit('trackSubscribed', track, publication, { identity: 'cast' }))
    await waitFor(() => expect(watched()).toEqual({ fps: 60 }))
    screen.getByRole('button', { name: '帧率' })

    await act(() => vi.advanceTimersByTimeAsync(5000))
    await waitFor(() => expect(watched()).toEqual({ fps: 30 }))
    expect(screen.getByRole('button', { name: '帧率' }).textContent).toContain('自动（30 fps）')

    fireEvent.click(screen.getByRole('button', { name: '帧率' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '90 fps' }))
    await waitFor(() => expect(watched()).toEqual({ fps: 90 }))
    expect(localStorage.getItem('gonggong.live.fps')).toBe('90')
  })

  it('lets each viewer pick the quality with the bandwidth it needs, automatic by default, and remembers it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const layers = [
      { quality: 0, width: 960, height: 540, bitrate: 2_799_360 },
      { quality: 1, width: 1280, height: 720, bitrate: 4_976_640 },
      { quality: 2, width: 1920, height: 1080, bitrate: 11_197_440 },
    ]
    routes(preview())
    const first = render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    const a = stream(0, layers)
    act(() => lk.rooms[0]?.emit('trackSubscribed', a.track, a.publication, { identity: 'cast' }))
    await waitFor(() => expect(a.publication.setVideoQuality).toHaveBeenLastCalledWith(2))
    // The frame arriving is the top layer's.
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByRole('button', { name: '画质' }).textContent).toContain('自动（原画）')

    fireEvent.click(screen.getByRole('button', { name: '画质' }))
    screen.getByRole('menuitemcheckbox', { name: '原画 · 约 7.5 Mbps' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '高清 · 约 1.9 Mbps' }))
    await waitFor(() => expect(a.publication.setVideoQuality).toHaveBeenLastCalledWith(0))
    first.unmount()

    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await waitFor(() => expect(lk.rooms[1]?.token).toBe('tok-li'))
    const b = stream(0, layers)
    act(() => lk.rooms[1]?.emit('trackSubscribed', b.track, b.publication, { identity: 'cast' }))
    await waitFor(() => expect(b.publication.setVideoQuality).toHaveBeenLastCalledWith(0))
    expect(screen.getByRole('button', { name: '画质' }).textContent).toContain('高清')
  })
})
