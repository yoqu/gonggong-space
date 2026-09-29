import type { GroupPreviewsDto, PreviewDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    RoomEvent: { TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed' },
    Track: { Kind: { Video: 'video' } },
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
afterEach(() => vi.unstubAllGlobals())

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
    await screen.findByText('本机没有授予「屏幕录制」权限')
  })

  it("names the machine's missing screen recording permission", async () => {
    routes(
      preview({
        live: {
          state: 'failed',
          error: '机器未授权屏幕录制，请在桌面端完成授权',
          missing: ['screen_recording', 'accessibility'],
        },
      }),
    )
    render(<LiveTab tab={tab} tabKey="live:p3" active />)
    await screen.findByText('机器未授权屏幕录制')
    screen.getByText('请 Bot 主人在共工桌面端完成授权')
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
    await screen.findByText('机器未授权辅助功能，远程操作不会生效，请在桌面端完成授权')
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
  it('switches the workbench tab from the last screenshot to the live simulator', async () => {
    const mp = preview({ kind: 'miniprogram', title: '商城', serviceId: null, serviceName: null, live: null })
    mockApi({
      'GET /groups/g1/previews': list([mp]),
      'POST /previews/p3/watch': undefined,
      'POST /previews/p3/live': { url: null, token: 'tok-li', identity: 'u:u-li:ab' },
    })
    render(<MiniprogramTab tab={{ kind: 'miniprogram', previewId: 'p3' }} tabKey="mp:p3" active />)
    await screen.findByRole('radio', { name: '截图' })
    expect(lk.rooms).toHaveLength(0)
    fireEvent.click(screen.getByRole('radio', { name: '实时画面' }))
    await waitFor(() => expect(lk.rooms[0]?.token).toBe('tok-li'))
    expect(await screen.findByRole('button', { name: '请求控制' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '截图' }))
    await waitFor(() => expect(lk.rooms[0]?.disconnected).toBe(true))
  })
})
