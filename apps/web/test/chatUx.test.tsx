import type { BotDto, GroupDto, MessageDto, RunDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { uploadFile } from '../src/features/attachments/api'
import { useQuote } from '../src/features/attachments/quote'
import { Markdown } from '../src/features/chat/Markdown'
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
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'force',
  notice: '',
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', isAdmin: true },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 4,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  ...o,
})

const bot = (o: Partial<BotDto>): BotDto => ({
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
  agentMinVersion: null,
  groupCount: 0,
  defaultWorkspace: null,
  ...o,
})
const bots = [bot({}), bot({ id: 'b2', name: '老李的 Codex', agentKind: 'codex', presence: 'offline' })]

const at = '2026-09-23T02:21:00.000Z'
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})
const reply = (o: Partial<MessageDto>) =>
  msg({ kind: 'bot', authorId: 'b1', authorName: '小王的 Claude', runId: 'r1', ...o })

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm2',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '读取 server/refund.go',
  filesChanged: 2,
  usage: { totalTokens: 1500 },
  newSessionReason: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  queuedAt: at,
  startedAt: at,
  endedAt: null,
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

type Timeline = { messages: MessageDto[]; runs: RunDto[] }
type Call = { method: string; path: string; body: Record<string, unknown> | undefined }
/** Handlers get the full path (with query) so pages can be told apart. */
function mockApi(
  timeline: Timeline | ((path: string) => Timeline | Promise<Timeline>),
  extra: Record<string, (body: unknown) => unknown> = {},
) {
  const calls: Call[] = []
  const routes: Record<string, (body: unknown, path: string) => unknown> = {
    'GET /groups': () => [group()],
    'GET /users': () => [],
    'GET /bots': () => bots,
    'GET /machines': () => [],
    'GET /notifications': () => [],
    'GET /groups/g1/timeline': (_b, path) => (typeof timeline === 'function' ? timeline(path) : timeline),
    'POST /groups/g1/read': () => group(),
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
      return new Response(JSON.stringify(await handler(body, path)))
    }),
  )
  return calls
}

function Probe() {
  const loc = useLocation()
  return <output data-testid="loc">{loc.search}</output>
}
const renderAt = (path = '/g/g1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Probe />
    </MemoryRouter>,
  )

const box = () =>
  screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement
const sendButton = () => screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
const timelineEl = () => document.querySelector('.timeline') as HTMLDivElement
const precedes = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/** jsdom has no layout: fake a scrolled-up timeline. */
function scrollUp(el: HTMLElement) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 })
  el.scrollTop = 600
  fireEvent.scroll(el)
}

const page = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => msg({ seq: from + i, body: `第 ${from + i} 条` }))

let hidden = false
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  hidden = false
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  sessionStorage.clear()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useQuote.setState({ quote: null })
  useToasts.setState({ items: [] })
  vi.mocked(uploadFile).mockReset()
  vi.mocked(uploadFile).mockImplementation((_g, f) => ({
    done: Promise.resolve({ id: 'up1', name: f.name, size: f.size, mime: f.type }),
    abort: vi.fn(),
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('run card merged with the final reply', () => {
  it('keeps the card under its trigger until the reply arrives, then shows one item at the reply', async () => {
    mockApi({
      messages: [msg({ seq: 2, body: '@小王的 Claude 看下字段' }), msg({ seq: 3, body: '插一句' })],
      runs: [run()],
    })
    renderAt()
    const card = await screen.findByTestId('run-card')
    expect(precedes(card, screen.getByText('插一句'))).toBe(true)
    expect(screen.queryByTestId('bot-reply')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: '引用回复' }))
    expect(useQuote.getState().quote).toMatchObject({
      kind: 'run',
      id: 'r1',
      who: '小王的 Claude 的运行卡片',
    })

    push({ t: 'run.updated', run: run({ status: 'completed', endedAt: at }) })
    push({ t: 'message.new', message: reply({ seq: 4, body: '已修改 `src/a.ts`' }) })
    const cards = screen.getAllByTestId('run-card')
    expect(cards).toHaveLength(1)
    const merged = cards[0]!
    expect(precedes(screen.getByText('插一句'), merged)).toBe(true)
    expect(merged.textContent).toContain('Claude Code · 王磊 触发')
    expect(merged.textContent).toContain('已完成')
    expect(merged.textContent).toContain('改动 2 个文件')
    const body = within(merged).getByTestId('bot-reply')
    expect(within(body).getByRole('button', { name: /src\/a\.ts/ })).toBeTruthy()
    expect(screen.queryByText('最终回复')).toBeNull()
    expect(within(merged).queryByRole('button', { name: '引用' })).toBeNull()
    fireEvent.click(within(body).getByRole('button', { name: '引用回复' }))
    expect(useQuote.getState().quote).toMatchObject({ kind: 'message', id: 'm4' })
    expect(within(merged).getByRole('button', { name: '查看过程' })).toBeTruthy()
  })

  it('renders bot messages without a run as plain replies', async () => {
    mockApi({ messages: [reply({ seq: 2, body: '独立消息', runId: null })], runs: [] })
    renderAt()
    const r = await screen.findByTestId('bot-reply')
    expect(r.textContent).toContain('独立消息')
    expect(screen.queryByTestId('run-card')).toBeNull()
  })
})

describe('timeline loading', () => {
  it('shows a retry state when the first load fails', async () => {
    let fail = true
    mockApi(() => {
      if (fail) throw new Error('down')
      return { messages: [msg({ seq: 2, body: '你好' })], runs: [] }
    })
    renderAt()
    const retry = await screen.findByRole('button', { name: '重试' })
    expect(screen.getByText('消息加载失败')).toBeTruthy()
    fail = false
    fireEvent.click(retry)
    expect(await screen.findByText('你好')).toBeTruthy()
  })

  it('shows a spinner while loading older pages and a retry row when that fails', async () => {
    let older: (() => void) | null = null
    let fail = true
    mockApi((path) => {
      if (!path.includes('before=')) return { messages: page(100, 50), runs: [] }
      if (fail)
        return new Promise((_, reject) => {
          older = () => reject(new Error('down'))
        })
      return { messages: page(90, 10), runs: [] }
    })
    renderAt()
    await screen.findByText('第 149 条')
    const el = timelineEl()
    el.scrollTop = 0
    fireEvent.scroll(el)
    expect(await screen.findByTestId('older-loading')).toBeTruthy()
    await act(async () => older?.())
    const row = await screen.findByTestId('older-error')
    expect(row.textContent).toContain('加载更早消息失败')
    fail = false
    fireEvent.click(within(row).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('第 90 条')).toBeTruthy()
    expect(screen.queryByTestId('older-error')).toBeNull()
  })
})

describe('scroll position', () => {
  it('counts new items while scrolled up and jumps to the bottom from the pill', async () => {
    mockApi({ messages: [msg({ seq: 2, body: '你好' })], runs: [] })
    renderAt()
    await screen.findByText('你好')
    const el = timelineEl()
    scrollUp(el)
    push({ t: 'message.new', message: msg({ seq: 3, authorId: 'u2', authorName: '李建国', body: '在吗' }) })
    expect(screen.getByRole('button', { name: '↓ 1 条新消息' })).toBeTruthy()
    push({ t: 'run.updated', run: run({ triggerMessageId: 'm3' }) })
    fireEvent.click(screen.getByRole('button', { name: '↓ 2 条新消息' }))
    expect(el.scrollTop).toBe(2000)
    expect(screen.queryByRole('button', { name: /条新消息/ })).toBeNull()
  })

  it('opens a deep-linked message from an older page, highlights it and drops the param', async () => {
    mockApi((path) =>
      path.includes('before=') ? { messages: page(1, 50), runs: [] } : { messages: page(51, 50), runs: [] },
    )
    renderAt('/g/g1?msg=m7')
    const target = await screen.findByText('第 7 条', {}, { timeout: 3000 })
    const item = target.closest('[data-msg-id]') as HTMLElement
    expect(item.dataset.msgId).toBe('m7')
    await waitFor(() => expect(item.className).toContain('tl-item--flash'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(''))
  })
})

describe('read marks and timestamps', () => {
  it('does not mark read while the tab is hidden and flushes when it becomes visible', async () => {
    hidden = true
    const calls = mockApi({ messages: [msg({ seq: 2, body: '你好' })], runs: [] })
    renderAt()
    await screen.findByText('你好')
    expect(calls.some((c) => c.path === '/groups/g1/read')).toBe(false)
    hidden = false
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/groups/g1/read').map((c) => c.body)).toEqual([{ seq: 2 }]),
    )
  })

  it('separates days and shows the full time on hover', async () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 86_400_000)
    const old = new Date(2026, 2, 5, 9, 30)
    mockApi({
      messages: [
        msg({ seq: 1, body: '很早', createdAt: old.toISOString() }),
        msg({ seq: 2, body: '昨天的', createdAt: yesterday.toISOString() }),
        msg({ seq: 3, body: '今天的', createdAt: now.toISOString() }),
        msg({ seq: 4, body: '又一条', createdAt: now.toISOString() }),
      ],
      runs: [],
    })
    renderAt()
    await screen.findByText('今天的')
    expect([...document.querySelectorAll('.tl-day')].map((d) => d.textContent)).toEqual([
      '3月5日',
      '昨天',
      '今天',
    ])
    const time = document.querySelector(`time[datetime="${old.toISOString()}"]`) as HTMLElement
    expect(time.title).toBe('2026-03-05 09:30')
  })
})

describe('chat header', () => {
  it('labels member and bot counts', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    const btn = await screen.findByRole('button', { name: '群成员：2 人，2 个 Bot' })
    expect(btn.textContent).toBe('2 人 · 2 Bot')
  })
})

describe('composer', () => {
  it('only sends real content', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    await screen.findByText('还没有消息')
    for (const v of ['  ', '@', ' / ']) {
      fireEvent.change(box(), { target: { value: v } })
      expect(sendButton().disabled).toBe(true)
    }
    fireEvent.change(box(), { target: { value: '@小王的 Claude' } })
    expect(sendButton().disabled).toBe(false)
    expect(screen.getByText('未 @ 的消息不会触发 Bot，会作为背景补充给下一次任务')).toBeTruthy()
  })

  it('grows with its content', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    await screen.findByText('还没有消息')
    Object.defineProperty(box(), 'scrollHeight', { configurable: true, value: 120 })
    fireEvent.change(box(), { target: { value: 'a\nb\nc\nd' } })
    expect(box().style.height).toBe('120px')
    expect(box().style.overflowY).toBe('hidden')
  })

  it('caps its growth and scrolls beyond the cap', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    await screen.findByText('还没有消息')
    Object.defineProperty(box(), 'scrollHeight', { configurable: true, value: 2000 })
    fireEvent.change(box(), { target: { value: 'long\n'.repeat(100) } })
    expect(box().style.height).toBe('240px')
    expect(box().style.overflowY).toBe('auto')
  })

  it('shows quote and attachment chips inside the input block, above the text', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    await screen.findByText('还没有消息')
    act(() =>
      useQuote.getState().set({ kind: 'message', id: 'm1', who: '李建国', text: '看下字段', groupId: 'g1' }),
    )
    fireEvent.paste(box(), { clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } })
    const block = document.querySelector('.composer__box') as HTMLElement
    const chips = within(block).getByTestId('composer-chips')
    expect(within(chips).getByText('引用 李建国')).toBeTruthy()
    expect(await within(chips).findByText('shot.png')).toBeTruthy()
    expect(precedes(chips, box())).toBe(true)
    expect(precedes(box(), within(block).getByRole('button', { name: '发送' }))).toBe(true)
  })

  it('shows the send state and replays the sent animation after each send', async () => {
    mockApi({ messages: [], runs: [] }, { 'POST /groups/g1/messages': () => msg({ seq: 9, body: '你好' }) })
    renderAt()
    await screen.findByText('还没有消息')
    expect(sendButton().dataset.state).toBe('idle')
    fireEvent.change(box(), { target: { value: '你好' } })
    expect(sendButton().dataset.state).toBe('ready')
    expect(sendButton().dataset.sent).toBe('0')
    fireEvent.click(sendButton())
    await waitFor(() => expect(sendButton().dataset.sent).toBe('1'))
    expect(sendButton().dataset.state).toBe('idle')
  })

  it('adds pasted and dropped files to the uploads', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    await screen.findByText('还没有消息')
    fireEvent.paste(box(), { clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByText('shot.png')).toBeTruthy()
    const drop = document.querySelector('.composer__box') as HTMLElement
    fireEvent.drop(drop, {
      dataTransfer: { files: [new File(['x'], 'ci.log', { type: 'text/plain' })], types: ['Files'] },
    })
    expect(await screen.findByText('ci.log')).toBeTruthy()
    expect(uploadFile).toHaveBeenCalledTimes(2)
  })

  it('keeps a draft per group and clears it on send', async () => {
    mockApi({ messages: [], runs: [] }, { 'POST /groups/g1/messages': () => msg({ seq: 9, body: '草稿' }) })
    const view = renderAt()
    await screen.findByText('还没有消息')
    fireEvent.change(box(), { target: { value: '草稿' } })
    view.unmount()
    renderAt()
    await screen.findByText('还没有消息')
    expect(box().value).toBe('草稿')
    fireEvent.click(sendButton())
    await waitFor(() => expect(box().value).toBe(''))
    expect(sessionStorage.getItem('gonggong:draft:g1')).toBeNull()
  })

  it('ignores Enter while an IME composition is active or just ended', async () => {
    const calls = mockApi(
      { messages: [], runs: [] },
      { 'POST /groups/g1/messages': () => msg({ seq: 9, body: '你好' }) },
    )
    renderAt()
    await screen.findByText('还没有消息')
    fireEvent.change(box(), { target: { value: '你好' } })
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 })
    fireEvent.compositionStart(box())
    fireEvent.compositionEnd(box())
    fireEvent.keyDown(box(), { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.some((c) => c.path === '/groups/g1/messages')).toBe(false)
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/messages')).toBe(true))
  })

  it('shows bot status in @ candidates and exposes combobox semantics', async () => {
    mockApi({ messages: [], runs: [] })
    renderAt()
    await screen.findByText('还没有消息')
    const input = screen.getByRole('combobox')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } })
    const list = screen.getByRole('listbox', { name: '@ 候选' })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    const options = within(list).getAllByRole('option')
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
    expect(options[0]!.tabIndex).toBe(-1)
    expect(within(list).getByRole('option', { name: /小王的 Claude/ }).textContent).toContain('在线')
    expect(within(list).getByRole('option', { name: /老李的 Codex/ }).textContent).toContain('离线')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id)
  })
})

describe('markdown code blocks', () => {
  it('folds long blocks and reports copy failures', async () => {
    const code = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    render(<Markdown text={`\`\`\`ts\n${code}\n\`\`\``} />)
    const block = document.querySelector('.md-code') as HTMLElement
    const toggle = await screen.findByRole('button', { name: '展开' })
    expect(block.className).toContain('md-code--capped')
    fireEvent.click(toggle)
    expect(block.className).not.toContain('md-code--capped')
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()

    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(useToasts.getState().items.map((t) => t.message)).toContain('复制失败'))
  })

  it('does not fold short blocks', () => {
    render(<Markdown text={'```ts\nconst a = 1\n```'} />)
    expect(screen.queryByRole('button', { name: '展开' })).toBeNull()
  })
})
