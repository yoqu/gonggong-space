import type { Attachment, BotDto, GroupDto, MessageDto, RunDto, UserDto } from '@aiws/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { uploadFile } from '../src/features/attachments/api'
import { usePreview } from '../src/features/attachments/preview'
import { useQuote } from '../src/features/attachments/quote'

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
}
const group: GroupDto = {
  id: 'g1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '',
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', isAdmin: true },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 4,
  last: '',
}
const bot: BotDto = {
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
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
  groupCount: 0,
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
  queuedAt: at,
  startedAt: at,
  endedAt: at,
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
    'GET /notifications': () => [],
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
  screen.getByPlaceholderText('输入消息，@ 触发 bot 或引用文件，/ 查看命令') as HTMLTextAreaElement
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
  usePreview.setState({ open: null })
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
  it('uploads picked files as chips, enforces the limits and sends the ids', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => msg({ seq: 10, authorId: 'u1', authorName: '王磊' }),
    })
    renderChat()
    await screen.findByText('最终回复')
    const [images, files] = [...document.querySelectorAll('input[type=file]')] as HTMLInputElement[]
    expect(images!.accept).toBe('image/*')
    const click = vi.spyOn(images!, 'click')
    fireEvent.click(screen.getByRole('button', { name: '图片' }))
    expect(click).toHaveBeenCalled()

    pick(images!, [file('screen.png', 486 * 1024, 'image/png')])
    expect(await screen.findByText('screen.png')).toBeTruthy()
    expect(composer().getByText('486 KB')).toBeTruthy()
    expect(screen.getByText(/1 \/ 10 · 写入工作区 \.aiws\/attachments\/，不进 git · 图片：/)).toBeTruthy()

    pick(files!, [file('huge.zip', 51 * 1024 * 1024, 'application/zip')])
    expect(await screen.findByText('huge.zip 超过 50 MB，未添加')).toBeTruthy()
    pick(
      files!,
      Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`, 10, 'text/plain')),
    )
    expect(await screen.findByText('每条消息最多 10 个附件')).toBeTruthy()
    expect(screen.getByText(/10 \/ 10/)).toBeTruthy()
    expect(uploadFile).toHaveBeenCalledTimes(10)

    fireEvent.click(screen.getByRole('button', { name: '移除 f8.txt' }))
    expect(screen.queryByText('f8.txt')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/messages')).toBe(true))
    const post = calls.find((c) => c.path === '/groups/g1/messages')!
    expect(post.body).toMatchObject({
      body: '',
      attachmentIds: ['up1', 'up2', 'up3', 'up4', 'up5', 'up6', 'up7', 'up8', 'up9'],
    })
    await waitFor(() => expect(screen.queryByText('screen.png')).toBeNull())
  })

  it('waits for uploads before sending', async () => {
    mockApi()
    let finish: () => void = () => {}
    vi.mocked(uploadFile).mockImplementation((_g, f) => ({
      done: new Promise((r) => {
        finish = () => r({ id: 'up1', name: f.name, size: f.size, mime: f.type })
      }),
      abort: vi.fn(),
    }))
    renderChat()
    await screen.findByText('最终回复')
    pick(document.querySelector('input[type=file]') as HTMLInputElement, [file('a.png', 10, 'image/png')])
    fireEvent.change(box(), { target: { value: 'hi' } })
    const send = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    await act(async () => finish())
    expect(send.disabled).toBe(false)
  })
})

describe('quotes', () => {
  it('quotes a bot reply or a run card and sends the quote along', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => msg({ seq: 10, authorId: 'u1', authorName: '王磊', body: '再总结' }),
    })
    renderChat()
    const reply = await screen.findByTestId('bot-reply')
    fireEvent.click(within(reply).getByRole('button', { name: '引用回复' }))
    expect(composer().getByText('引用 小王的 Claude')).toBeTruthy()
    expect(composer().getByText('已修复')).toBeTruthy()
    expect(composer().getByText('等同 @，引用内容一起发送')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭引用' }))
    expect(composer().queryByText('引用 小王的 Claude')).toBeNull()

    fireEvent.click(within(screen.getByTestId('run-card')).getByRole('button', { name: '引用' }))
    expect(composer().getByText('引用 小王的 Claude 的运行卡片')).toBeTruthy()
    expect(composer().getByText('改完了 refund.go')).toBeTruthy()
    fireEvent.click(within(reply).getByRole('button', { name: '引用回复' }))
    fireEvent.change(box(), { target: { value: '再总结' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/messages')).toBe(true))
    expect(calls.find((c) => c.path === '/groups/g1/messages')!.body).toMatchObject({
      body: '再总结',
      quote: { kind: 'message', id: 'm3' },
    })
    await waitFor(() => expect(screen.queryByText('等同 @，引用内容一起发送')).toBeNull())
  })
})

describe('message attachments and preview', () => {
  it('renders the quote, image thumbnails and file rows', async () => {
    mockApi()
    renderChat()
    const main = screen.getByRole('main')
    const img = (await within(main).findByRole('img', { name: 'shot.png' })) as HTMLImageElement
    expect(img.src).toContain('/api/attachments/a1')
    expect(within(main).getByText('引用 小王的 Claude')).toBeTruthy()
    expect(within(main).getByText('上次的结论')).toBeTruthy()
    expect(within(main).getByRole('button', { name: /ci\.log/ }).textContent).toContain('文本日志 · 84 KB')
  })

  it('previews images, logs, markdown and unsupported files in the right panel', async () => {
    mockApi({
      'GET /attachments/a2': () => new Response('start\nWARN slow\nERROR boom\n'),
      'GET /attachments/a3': () => new Response('# 标题\n\n正文'),
    })
    renderChat()
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '在右侧查看 shot.png' }))
    const panel = () => screen.getByRole('complementary', { name: '侧栏' })
    expect(within(panel()).getByRole('img', { name: 'shot.png' })).toBeTruthy()
    expect(panel().textContent).toContain('来源李建国')
    expect(panel().textContent).toContain('位置.aiws/attachments/m2/shot.png')
    expect(panel().textContent).toContain('发送给 bot')

    fireEvent.click(within(main).getByRole('button', { name: /ci\.log/ }))
    expect(await within(panel()).findByText('ERROR boom')).toBeTruthy()
    expect(within(panel()).getByText('ERROR boom').className).toContain('pv-line--error')
    expect(within(panel()).getByText('WARN slow').className).toContain('pv-line--warn')
    expect(panel().textContent).toContain('工作树已加入 .git/info/exclude，不进 git')

    fireEvent.click(within(main).getByRole('button', { name: /spec\.md/ }))
    expect(await within(panel()).findByRole('heading', { name: '标题' })).toBeTruthy()
    fireEvent.click(within(panel()).getByRole('tab', { name: '源码' }))
    expect(within(panel()).getByText('# 标题')).toBeTruthy()

    fireEvent.click(within(main).getByRole('button', { name: /dump\.bin/ }))
    expect(within(panel()).getByText('该类型暂不支持预览，可下载查看')).toBeTruthy()
    expect(within(panel()).getByRole('link', { name: '下载' }).getAttribute('href')).toBe(
      '/api/attachments/a4',
    )

    fireEvent.click(within(panel()).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
  })
})
