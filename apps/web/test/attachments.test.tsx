import type { Attachment, BotDto, GroupDto, MessageDto, RunDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { uploadFile } from '../src/features/attachments/api'
import { useQuote } from '../src/features/attachments/quote'
import { useToasts } from '../src/ui'

vi.mock('../src/features/attachments/api', async (orig) => ({
  ...(await orig<typeof import('../src/features/attachments/api')>()),
  uploadFile: vi.fn(),
}))

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
const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 4,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}
const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 0,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  reviewModel: null,
  model: null,
  effort: null,
  catalog: null,
}

const at = '2026-09-23T02:21:00.000Z'
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u2',
  authorName: '李建国',
  body: '',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})
const att = (o: Partial<Attachment>): Attachment => ({
  id: 'a1',
  name: 'shot.png',
  size: 486 * 1024,
  mime: 'image/png',
  messageId: 'm2',
  ...o,
})
const run: RunDto = {
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm2',
  triggerUserId: 'u2',
  hop: 1,
  status: 'completed',
  step: '改完了 refund.go',
  filesChanged: 1,
  usage: null,
  newSessionReason: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u2',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  queuedAt: at,
  startedAt: at,
  endedAt: at,
  lastActivityAt: at,
}

const timeline = {
  messages: [
    msg({
      seq: 2,
      body: 'CI 挂了，见附件',
      attachments: [
        att({}),
        att({ id: 'a2', name: 'ci.log', mime: 'text/plain', size: 84 * 1024 }),
        att({ id: 'a3', name: 'spec.md', mime: 'text/markdown', size: 2048 }),
        att({ id: 'a4', name: 'dump.bin', mime: 'application/octet-stream', size: 1024 }),
        att({ id: 'v1', name: 'demo.mp4', mime: 'video/mp4', size: 2048 }),
        att({ id: 'au1', name: 'song.mp3', mime: 'audio/mpeg', size: 2048 }),
        att({ id: 'p1', name: 'spec.pdf', mime: 'application/pdf', size: 2048 }),
        att({ id: 'z1', name: 'logs.zip', mime: 'application/zip', size: 1024 }),
        att({
          id: 'x1',
          name: 'plan.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 4096,
        }),
      ],
      quote: { kind: 'message', id: 'm0', who: '小王的 Claude', text: '上次的结论' },
    }),
    msg({
      seq: 3,
      kind: 'bot',
      authorId: 'b1',
      authorName: '小王的 Claude',
      body: '已修复\n细节见 diff',
      runId: 'r1',
    }),
  ],
  runs: [run],
}

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close() {}
}

type Call = { method: string; path: string; body: Record<string, unknown> | undefined }
function mockApi(extra: Record<string, (body: unknown) => unknown> = {}) {
  const calls: Call[] = []
  const routes: Record<string, (body: unknown) => unknown> = {
    'GET /groups': () => [group],
    'GET /users': () => [],
    'GET /bots': () => [bot],
    'GET /machines': () => [],
    'GET /notifications/unread': () => ({ n: 0 }),
    'GET /groups/g1/timeline': () => timeline,
    'POST /groups/g1/read': () => group,
    ...extra,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      const handler = routes[`${method} ${path.split('?')[0]}`]
      if (!handler) return new Response(JSON.stringify({ error: 'not_found', message: '' }), { status: 404 })
      const out = await handler(body)
      return out instanceof Response ? out : new Response(JSON.stringify(out))
    }),
  )
  return calls
}

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
    </MemoryRouter>,
  )

const box = () =>
  screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement
const file = (name: string, size: number, type: string) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const composer = () => within(document.querySelector('.composer') as HTMLElement)
const pick = (input: HTMLInputElement, files: File[]) => fireEvent.change(input, { target: { files } })

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useQuote.setState({ quote: null })
  useWorkbench.setState({ groupId: null, open: false, benches: {} })
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`)
  URL.revokeObjectURL = vi.fn()
  useToasts.setState({ items: [] })
  sessionStorage.clear()
  let n = 0
  vi.mocked(uploadFile).mockClear()
  vi.mocked(uploadFile).mockImplementation((_g, f, onProgress) => {
    onProgress(50)
    return {
      done: Promise.resolve({ id: `up${++n}`, name: f.name, size: f.size, mime: f.type }),
      abort: vi.fn(),
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('composer attachments', () => {
  it('inserts an emoji from the 表情 picker at the caret', async () => {
    mockApi({})
    renderChat()
    await screen.findByTestId('bot-reply')
    const input = composer().getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '收到' } })
    fireEvent.click(composer().getByRole('button', { name: '表情' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '选择表情' })).getByRole('option', { name: '赞' }),
    )
    expect(input.value).toBe('收到👍')
    expect(screen.queryByRole('dialog', { name: '选择表情' })).toBeNull()
  })

  it('uploads picked files as chips, enforces the limits and sends the ids', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => msg({ seq: 10, authorId: 'u1', authorName: '王磊' }),
    })
    renderChat()
    await screen.findByTestId('bot-reply')
    const [images, files] = [...document.querySelectorAll('input[type=file]')] as HTMLInputElement[]
    expect(images!.accept).toBe('image/*')
    const click = vi.spyOn(images!, 'click')
    fireEvent.click(composer().getByRole('button', { name: '图片' }))
    expect(click).toHaveBeenCalled()

    pick(images!, [file('screen.png', 486 * 1024, 'image/png')])
    expect(await screen.findByText('screen.png')).toBeTruthy()
    expect(composer().getByText('486 KB')).toBeTruthy()
    expect(screen.getByText(/1 \/ 10 · 写入工作区 \.gonggong\/attachments\/，不进 git · 图片：/)).toBeTruthy()

    pick(files!, [file('huge.zip', 51 * 1024 * 1024, 'application/zip')])
    expect(await screen.findByText('huge.zip 超过 50 MB，未添加')).toBeTruthy()
    pick(
      files!,
      Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`, 10, 'text/plain')),
    )
    expect(await screen.findByText('每条消息最多 10 个附件')).toBeTruthy()
    expect(screen.getByText(/10 \/ 10/)).toBeTruthy()
    expect(uploadFile).toHaveBeenCalledTimes(10)

    fireEvent.click(composer().getByRole('button', { name: '移除 f8.txt' }))
    expect(screen.queryByText('f8.txt')).toBeNull()

    fireEvent.click(composer().getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/messages')).toBe(true))
    const post = calls.find((c) => c.path === '/groups/g1/messages')!
    expect(post.body).toMatchObject({
      body: '',
      attachmentIds: ['up1', 'up2', 'up3', 'up4', 'up5', 'up6', 'up7', 'up8', 'up9'],
    })
    await waitFor(() => expect(screen.queryByText('screen.png')).toBeNull())
  })

  it('gives the uploaded files back to the composer when the server refuses the message', async () => {
    let refuse = true
    const calls = mockApi({
      'POST /groups/g1/messages': () =>
        refuse
          ? new Response(JSON.stringify({ error: 'invalid', message: '附件不可用' }), { status: 400 })
          : msg({ seq: 10, authorId: 'u1', authorName: '王磊' }),
    })
    renderChat()
    await screen.findByTestId('bot-reply')
    const [images] = [...document.querySelectorAll('input[type=file]')] as HTMLInputElement[]
    pick(images!, [file('screen.png', 486 * 1024, 'image/png')])
    expect(await composer().findByText('screen.png')).toBeTruthy()
    fireEvent.change(box(), { target: { value: '看图' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(await screen.findByText('附件不可用')).toBeTruthy()
    await waitFor(() => expect(box().value).toBe('看图'))
    expect(composer().getByText('screen.png')).toBeTruthy()
    expect(uploadFile).toHaveBeenCalledTimes(1)

    refuse = false
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(calls.filter((c) => c.path === '/groups/g1/messages')).toHaveLength(2))
    const [first, again] = calls.filter((c) => c.path === '/groups/g1/messages')
    expect(first!.body).toMatchObject({ body: '看图', attachmentIds: ['up1'] })
    expect(again!.body).toMatchObject({ body: '看图', attachmentIds: ['up1'] })
  })

  it('shows pasted images as thumbnails that open a lightbox', async () => {
    mockApi()
    renderChat()
    await screen.findByTestId('bot-reply')
    fireEvent.paste(box(), { clipboardData: { files: [file('image.png', 2048, 'image/png')] } })
    const thumb = (await composer().findByRole('img', { name: 'image.png' })) as HTMLImageElement
    expect(thumb.src).toBe('blob:image.png')
    fireEvent.click(composer().getByRole('button', { name: '预览 image.png' }))
    const box2 = screen.getByRole('dialog', { name: 'image.png' })
    expect((within(box2).getByRole('img', { name: 'image.png' }) as HTMLImageElement).src).toBe(
      'blob:image.png',
    )
    fireEvent.click(within(box2).getByRole('button', { name: '放大' }))
    expect(within(box2).getByRole('button', { name: '缩小' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'image.png' })).toBeNull()

    fireEvent.click(composer().getByRole('button', { name: '移除 image.png' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image.png')
  })

  it('previews other files before sending from the local copy, freeing it on closing', async () => {
    mockApi()
    renderChat()
    await screen.findByTestId('bot-reply')
    const files = document.querySelectorAll('input[type=file]')[1] as HTMLInputElement
    pick(files, [
      new File(['# 标题\n\n正文段落'], 'notes.md', { type: 'text/markdown' }),
      new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }),
      new File(['PK'], 'bundle.zip', { type: 'application/zip' }),
    ])
    await composer().findByText('bundle.zip')
    expect(composer().queryByRole('button', { name: '预览 bundle.zip' })).toBeNull()

    fireEvent.click(composer().getByRole('button', { name: '预览 notes.md' }))
    const sheet = screen.getByRole('dialog', { name: '发送前预览' })
    expect(await within(sheet).findByText('正文段落')).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: '复制路径' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '发送前预览' })).toBeNull())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:notes.md')

    // A local PDF has no server to ask with HEAD: it is framed straight away.
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fireEvent.click(composer().getByRole('button', { name: '预览 report.pdf' }))
    const pdf = screen.getByRole('dialog', { name: '发送前预览' })
    expect(pdf.querySelector('iframe')?.getAttribute('src')).toBe('blob:report.pdf')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('waits for uploads before sending, filling a progress bar along the chip', async () => {
    mockApi()
    let finish: () => void = () => {}
    let progress: (p: number) => void = () => {}
    vi.mocked(uploadFile).mockImplementation((_g, f, onProgress) => {
      progress = onProgress
      return {
        done: new Promise((r) => {
          finish = () => r({ id: 'up1', name: f.name, size: f.size, mime: f.type })
        }),
        abort: vi.fn(),
      }
    })
    renderChat()
    await screen.findByTestId('bot-reply')
    pick(document.querySelector('input[type=file]') as HTMLInputElement, [file('a.png', 10, 'image/png')])
    fireEvent.change(box(), { target: { value: 'hi' } })
    const send = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    act(() => progress(40))
    expect(composer().getByText('40%')).toBeTruthy()
    expect((document.querySelector('.att-chip__bar') as HTMLElement).style.scale).toBe('0.4 1')
    await act(async () => finish())
    expect(send.disabled).toBe(false)
    expect(document.querySelector('.att-chip__bar')).toBeNull()
  })
})

describe('quotes', () => {
  it('quotes a bot reply with the bot @-ed (removable) and sends the quote along', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => msg({ seq: 10, authorId: 'u1', authorName: '王磊', body: '再总结' }),
    })
    renderChat()
    const reply = await screen.findByTestId('bot-reply')
    fireEvent.click(within(reply).getByRole('button', { name: '引用回复' }))
    expect(composer().getByText('引用 小王的 Claude')).toBeTruthy()
    expect(composer().getByText('已修复')).toBeTruthy()
    // Quoting a bot @s it right away; the chip's @ does not add a second one.
    await waitFor(() => expect(box().value).toBe('@小王的 Claude '))
    expect(composer().getByText('已自动 @ Bot，删掉 @ 就只引用、不触发')).toBeTruthy()
    fireEvent.click(composer().getByRole('button', { name: '@ 小王的 Claude' }))
    expect(box().value).toBe('@小王的 Claude ')
    fireEvent.click(screen.getByRole('button', { name: '关闭引用' }))
    expect(composer().queryByText('引用 小王的 Claude')).toBeNull()

    // The reply is merged into its run card, which then offers only the reply quote.
    expect(within(screen.getByTestId('run-card')).queryByRole('button', { name: '引用' })).toBeNull()
    fireEvent.click(within(reply).getByRole('button', { name: '引用回复' }))
    await waitFor(() => expect(box().value).toBe('@小王的 Claude '))
    // Deleting the @ leaves a plain quote that triggers nobody.
    fireEvent.change(box(), { target: { value: '再总结' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/messages')).toBe(true))
    expect(calls.find((c) => c.path === '/groups/g1/messages')!.body).toMatchObject({
      body: '再总结',
      quote: { kind: 'message', id: 'm3' },
    })
    expect(calls.find((c) => c.path === '/groups/g1/messages')!.body?.mentions ?? []).toEqual([])
    await waitFor(() => expect(screen.queryByText('已自动 @ Bot，删掉 @ 就只引用、不触发')).toBeNull())
  })

  it('quotes a member message without any @', async () => {
    mockApi()
    renderChat()
    await screen.findByText('CI 挂了，见附件')
    const bar = document.querySelector('[data-message-id="m2"]') as HTMLElement
    fireEvent.click(within(bar).getByRole('button', { name: '引用回复' }))
    expect(composer().getByText('引用内容一起发送')).toBeTruthy()
    expect(box().value).toBe('')
  })
})

describe('message attachments and preview', () => {
  it('renders the quote, image and video thumbnails and file rows', async () => {
    mockApi()
    renderChat()
    const main = screen.getByRole('main')
    const img = (await within(main).findByRole('img', { name: 'shot.png' })) as HTMLImageElement
    expect(img.src).toContain('/api/attachments/a1')
    expect(within(main).getByText('引用 小王的 Claude')).toBeTruthy()
    expect(within(main).getByText('上次的结论')).toBeTruthy()
    expect(main.querySelector('video')?.getAttribute('src')).toBe('/api/attachments/v1')
    expect(within(main).getByRole('button', { name: '播放 demo.mp4' })).toBeTruthy()
    expect(within(main).getByRole('button', { name: /ci\.log/ }).textContent).toContain('文本日志 · 84 KB')
    expect(within(main).getByRole('button', { name: /plan\.xlsx/ }).textContent).toContain(
      'Excel 表格 · 4 KB · 点击预览',
    )
    expect(within(main).getByRole('button', { name: /dump\.bin/ }).textContent).not.toContain('点击预览')
    expect(within(main).getByRole('button', { name: /spec\.pdf/ }).textContent).toContain(
      'PDF · 2 KB · 点击预览',
    )
    expect(within(main).getByRole('button', { name: /logs\.zip/ }).textContent).toContain('压缩包 · 1 KB')
    expect(within(main).getByRole('button', { name: /logs\.zip/ }).textContent).not.toContain('点击预览')
  })

  it('opens images, logs, markdown and unsupported files as workbench file tabs', async () => {
    mockApi({
      'GET /attachments/a2': () => new Response('start\nWARN slow\nERROR boom\n'),
      'GET /attachments/a3': () => new Response('# 标题\n\n正文'),
    })
    renderChat()
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '查看大图 shot.png' }))
    const lightbox = screen.getByRole('dialog', { name: 'shot.png' })
    expect((within(lightbox).getByRole('img', { name: 'shot.png' }) as HTMLImageElement).src).toContain(
      '/api/attachments/a1',
    )
    fireEvent.click(within(lightbox).getByRole('button', { name: '在工作台查看' }))
    expect(screen.queryByRole('dialog', { name: 'shot.png' })).toBeNull()
    await screen.findByRole('region', { name: '工作台' })
    const pane = () => within(screen.getByRole('region', { name: '工作台' })).getByRole('tabpanel')
    expect(await within(pane()).findByRole('img', { name: 'shot.png' })).toBeTruthy()
    expect(pane().textContent).toContain('来源李建国')
    expect(pane().textContent).toContain('位置.gonggong/attachments/m2/shot.png')
    expect(pane().textContent).toContain('发送给 Bot')

    fireEvent.click(within(main).getByRole('button', { name: /ci\.log/ }))
    expect(await within(pane()).findByText('ERROR boom')).toBeTruthy()
    expect(within(pane()).getByText('ERROR boom').className).toContain('pv-line--error')
    expect(within(pane()).getByText('WARN slow').className).toContain('pv-line--warn')
    expect(pane().textContent).toContain('工作树已加入 .git/info/exclude，不进 git')

    fireEvent.click(within(main).getByRole('button', { name: /spec\.md/ }))
    expect(await within(pane()).findByRole('heading', { name: '标题' })).toBeTruthy()
    fireEvent.click(within(pane()).getByRole('tab', { name: '源码' }))
    expect(within(pane()).getByText('# 标题')).toBeTruthy()

    fireEvent.click(within(main).getByRole('button', { name: /dump\.bin/ }))
    expect(within(pane()).getByText('该类型暂不支持预览，可下载查看')).toBeTruthy()
    expect(within(pane()).getAllByRole('link', { name: '下载' })[0]?.getAttribute('href')).toBe(
      '/api/attachments/a4',
    )
    expect(useWorkbench.getState().benches.g1?.tabs.map((t) => t.kind)).toEqual([
      'file',
      'file',
      'file',
      'file',
    ])
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
  })

  it('plays audio right in the message, with the workbench and download at hand', async () => {
    mockApi()
    renderChat()
    const main = screen.getByRole('main')
    const card = await within(main).findByRole('group', { name: 'song.mp3' })
    expect(card.textContent).toContain('音频 · 2 KB')
    const audio = card.querySelector('audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toBe('/api/attachments/au1')
    expect(audio.controls).toBe(false)
    expect(within(card).getByRole('button', { name: '播放语音' })).toBeTruthy()
    expect(within(card).getByRole('slider', { name: '播放进度' })).toBeTruthy()
    expect(within(card).getByRole('link', { name: '下载' }).getAttribute('href')).toBe('/api/attachments/au1')
    fireEvent.error(audio)
    expect(card.textContent).toContain('浏览器无法播放此音频，可下载查看')
    fireEvent.click(within(card).getByRole('button', { name: '在工作台查看' }))
    const pane = await screen.findByRole('region', { name: '工作台' })
    await waitFor(() => expect(pane.querySelector('audio')?.getAttribute('src')).toBe('/api/attachments/au1'))
    expect(pane.textContent).toContain('音频不直接发送，agent 按路径读取')
  })

  it('plays a video in its tile, falling back to a download when the browser cannot', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue()
    mockApi()
    renderChat()
    const main = screen.getByRole('main')
    const big = await within(main).findByRole('button', { name: '播放 demo.mp4' })
    const player = within(screen.getByRole('group', { name: 'demo.mp4' }))
    expect(player.queryByRole('slider', { name: '播放进度' })).toBeNull()
    await act(async () => fireEvent.click(big))
    const video = main.querySelector('video[src="/api/attachments/v1"]') as HTMLVideoElement
    expect(play).toHaveBeenCalledOnce()
    expect(video.controls).toBe(false)
    expect(video.muted).toBe(false)
    expect(player.getByRole('slider', { name: '播放进度' })).toBeTruthy()
    expect(player.getByRole('button', { name: '全屏' })).toBeTruthy()
    expect(within(main).queryByRole('button', { name: '播放 demo.mp4' })).toBeNull()
    expect(screen.queryByRole('region', { name: '工作台' })).toBeNull()
    fireEvent.error(video)
    expect(within(main).getByText('浏览器无法播放此视频，可下载查看')).toBeTruthy()
    fireEvent.click(within(main).getByRole('button', { name: '在工作台查看 demo.mp4' }))
    const pane = await screen.findByRole('region', { name: '工作台' })
    await waitFor(() => expect(pane.querySelector('video')?.getAttribute('src')).toBe('/api/attachments/v1'))
    play.mockRestore()
    pause.mockRestore()
  })

  it('gives a playing video its own shape, so a portrait one is not a sliver in a wide tile', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    mockApi()
    renderChat()
    const main = screen.getByRole('main')
    const big = await within(main).findByRole('button', { name: '播放 demo.mp4' })
    await act(async () => fireEvent.click(big))
    const video = main.querySelector('video[src="/api/attachments/v1"]') as HTMLVideoElement
    Object.defineProperty(video, 'videoWidth', { value: 360 })
    Object.defineProperty(video, 'videoHeight', { value: 640 })
    fireEvent.loadedMetadata(video)
    expect((video.closest('.att-tile') as HTMLElement).style.getPropertyValue('--ratio')).toBe('360 / 640')
    play.mockRestore()
  })

  it('previews a PDF attachment in place', async () => {
    mockApi({ 'HEAD /attachments/p1': () => new Response(null) })
    renderChat()
    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /spec\.pdf/ }))
    const pane = await screen.findByRole('region', { name: '工作台' })
    await waitFor(() => expect(pane.querySelector('iframe')?.getAttribute('src')).toBe('/api/attachments/p1'))
    expect(within(pane).getByRole('link', { name: '在浏览器中打开' })).toBeTruthy()
  })
})
