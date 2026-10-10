import {
  type BotDto,
  type GroupDto,
  type MessageDto,
  type RunDto,
  RunStatus,
  type UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { continues, eventFolds, isRich, unreadStart } from '../src/features/chat/grouping'
import { RunStatusIcon } from '../src/features/chat/RunGraphics'
import { fmtDuration, RUN_STATUS } from '../src/features/chat/TimelineItems'
import { EmptyChatArt, EmptyState } from '../src/ui'
import { mockApi } from './mockApi'

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

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  ...o,
})

const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
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
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  model: null,
  effort: null,
  catalog: null,
}

const t0 = Date.parse('2026-09-23T02:00:00.000Z')
const min = (n: number) => new Date(t0 + n * 60_000).toISOString()

const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u2',
  authorName: '李建国',
  body: `第 ${o.seq} 条`,
  mentions: [],
  runId: null,
  createdAt: min(o.seq ?? 1),
  attachments: [],
  quote: null,
  ...o,
})

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '读取 server/refund.go',
  filesChanged: 2,
  usage: { totalTokens: 1500 },
  newSessionReason: null,
  parentRunId: null,
  hopMax: 5,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  queuedAt: min(1),
  startedAt: min(1),
  endedAt: null,
  ...o,
})

const renderChat = (timeline: { messages: MessageDto[]; runs: RunDto[] }, g = group()) => {
  mockApi({
    'GET /groups': [g],
    'GET /bots': [bot],
    'GET /machines': [],
    'GET /notifications': [],
    'GET /groups/g1/timeline?limit=50': timeline,
  })
  return render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
    </MemoryRouter>,
  )
}

class FakeSocket {
  close() {}
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('grouping rule', () => {
  it('folds runs of 3+ same-day events, breaking at other messages, day changes and the unread divider', () => {
    const ev = (seq: number, at = min(seq)) =>
      msg({ seq, id: `e${seq}`, kind: 'event', authorId: null, createdAt: at })
    const list = [ev(1), ev(2), ev(3), msg({ seq: 4, id: 'm4' }), ev(5), ev(6), ev(7), ev(8)]
    expect([...eventFolds(list)]).toEqual([
      [0, 2],
      [4, 7],
    ])
    expect([...eventFolds(list, 'e7')]).toEqual([[0, 2]])
    expect([...eventFolds([ev(1), ev(2), msg({ seq: 3 })])]).toEqual([])
    const nextDay = '2026-09-25T09:00:00.000Z'
    expect([...eventFolds([ev(1), ev(2), ev(3, nextDay), ev(4, nextDay)])]).toEqual([])
  })

  it('merges the same author within 5 minutes and nothing else', () => {
    const a = msg({ seq: 1 })
    expect(continues(a, msg({ seq: 2, createdAt: min(6) }))).toBe(true)
    expect(continues(a, msg({ seq: 2, createdAt: min(6.1) }))).toBe(false)
    expect(continues(a, msg({ seq: 2, authorId: 'u1', authorName: '王磊' }))).toBe(false)
    expect(continues(a, msg({ seq: 2, kind: 'event', authorId: null }))).toBe(false)
    expect(continues(msg({ seq: 1, kind: 'event', authorId: null }), msg({ seq: 2, kind: 'event' }))).toBe(
      false,
    )
    expect(continues(undefined, a)).toBe(false)
  })

  it('never merges across midnight', () => {
    const late = msg({ seq: 1, createdAt: new Date(2026, 8, 23, 23, 59).toISOString() })
    expect(continues(late, msg({ seq: 2, createdAt: new Date(2026, 8, 24, 0, 1).toISOString() }))).toBe(false)
  })
})

describe('unread divider position', () => {
  it('counts back only messages that count as unread (not mine, not events)', () => {
    const list = [
      msg({ seq: 1 }),
      msg({ seq: 2 }),
      msg({ seq: 3, kind: 'event', authorId: null }),
      msg({ seq: 4, authorId: 'u1' }),
      msg({ seq: 5 }),
    ]
    expect(unreadStart(list, 2, 'u1')).toBe('m2')
    expect(unreadStart(list, 1, 'u1')).toBe('m5')
    expect(unreadStart(list, 0, 'u1')).toBeNull()
    expect(unreadStart(list, 9, 'u1')).toBe('m1')
  })
})

describe('bot reply layout (C2)', () => {
  it('keeps plain text in a bubble and moves code, tables, files and attachments into the card', () => {
    expect(isRich(msg({ body: '好的，已经处理完了' }))).toBe(false)
    expect(isRich(msg({ body: '```ts\nconst a = 1\n```' }))).toBe(true)
    expect(isRich(msg({ body: '| a | b |\n| --- | --- |\n| 1 | 2 |' }))).toBe(true)
    expect(isRich(msg({ body: '已修改 `src/a.ts`' }))).toBe(true)
    expect(
      isRich(
        msg({
          body: '见附件',
          attachments: [{ id: 'a1', name: 'x.log', size: 1, mime: 'text/plain', messageId: 'm1' }],
        }),
      ),
    ).toBe(true)
  })
})

describe('run duration', () => {
  it('reads m:ss under an hour and h:mm:ss beyond', () => {
    expect(fmtDuration(65_000)).toBe('01:05')
    expect(fmtDuration((1 * 3600 + 57 * 60 + 39) * 1000)).toBe('1:57:39')
  })
})

describe('run status icons', () => {
  it('draws every status with a label; only awaiting states show the text', () => {
    for (const status of RunStatus.options) {
      const { unmount } = render(<RunStatusIcon status={status} />)
      const label = RUN_STATUS[status].label
      const icon = screen.getByTitle(label)
      expect(icon.querySelector('svg')?.closest('[aria-hidden="true"]')).toBeTruthy()
      const text = screen.getByText(label)
      const awaiting = status === 'awaiting_approval' || status === 'awaiting_answer'
      expect(text.classList.contains('run-vh')).toBe(!awaiting)
      unmount()
    }
  })
})

describe('timeline bubbles', () => {
  it('puts my messages on the right and merges consecutive messages of one author', async () => {
    renderChat({
      messages: [
        msg({ seq: 1 }),
        msg({ seq: 2 }),
        msg({ seq: 3, authorId: 'u1', authorName: '王磊', body: '我的消息' }),
        msg({ seq: 20 }),
      ],
      runs: [],
    })
    const mine = (await screen.findByText('我的消息')).closest('.pn-msg') as HTMLElement
    expect(mine.classList.contains('pn-msg--self')).toBe(true)
    expect(mine.querySelector('.pn-msg__meta b')).toBeNull()
    const rows = [...document.querySelectorAll<HTMLElement>('.pn-msg')]
    expect(rows.map((r) => r.classList.contains('pn-msg--cont'))).toEqual([false, true, false, false])
    expect(rows[1]!.querySelector('.ui-avatar')).toBeNull()
    expect(within(rows[1]!).queryByText('李建国')).toBeNull()
  })

  it('shows the day as a pill and marks where unread messages start', async () => {
    renderChat(
      {
        messages: [msg({ seq: 1 }), msg({ seq: 2, authorId: 'u1', authorName: '王磊' }), msg({ seq: 3 })],
        runs: [],
      },
      group({ unread: 1 }),
    )
    await screen.findByText('第 3 条')
    expect(document.querySelectorAll('.pn-notice--date')).toHaveLength(1)
    const divider = screen.getByText('以下为新消息').closest('.pn-notice--unread') as HTMLElement
    const next = divider.nextElementSibling as HTMLElement
    expect(next.dataset.msgId).toBe('m3')
  })

  it('draws fan-out as branches to the triggered bots', async () => {
    renderChat({
      messages: [msg({ seq: 1, authorId: 'u1', authorName: '王磊', body: '@小王的 Claude 两个一起' })],
      runs: [run(), run({ id: 'r2', queuedAt: min(2) })],
    })
    const fan = await screen.findByTitle('扇出 · 2 个 Bot 并行：小王的 Claude、小王的 Claude')
    expect(fan.querySelectorAll('path')).toHaveLength(2)
    expect(within(fan).getByText('扇出 · 2 个 Bot 并行')).toBeTruthy()
  })

  it('animates 共字君 in the step line while the bot works', async () => {
    renderChat({
      messages: [msg({ seq: 1, authorId: 'u1', authorName: '王磊' })],
      runs: [run(), run({ id: 'r2', step: '', queuedAt: min(2) })],
    })
    const [tool, idle] = await screen.findAllByTestId('run-card')
    const art = (card: Element) => card.querySelector('.run-card__mascot') as SVGElement
    // Decorative next to the step text, so screen readers skip it.
    expect(art(tool as HTMLElement).getAttribute('aria-hidden')).toBe('true')
    expect(art(tool as HTMLElement).getAttribute('data-action')).toBe('carry')
    expect(art(idle as HTMLElement).getAttribute('data-action')).toBe('carry')
    expect(within(idle as HTMLElement).getByText('正在工作…')).toBeTruthy()
    // The bot's own role plays the part, with its own body and moves.
    expect(art(tool as HTMLElement).getAttribute('data-role')).toBe('no')
  })

  it('shows run facts as labelled graphics', async () => {
    renderChat({
      messages: [msg({ seq: 1, authorId: 'u1', authorName: '王磊' })],
      runs: [run({ hop: 2 })],
    })
    const card = await screen.findByTestId('run-card')
    for (const label of ['运行中', '改动 2 个文件', '1.5k tokens', '接力 2/5'])
      expect(within(card).getByTitle(label).querySelector('svg, .token-meter, .hop-chain__dot')).toBeTruthy()
    expect(within(card).getByTitle(/^耗时 /)).toBeTruthy()
    expect(within(card).getByTitle('接力 2/5').querySelectorAll('.hop-chain__dot--on')).toHaveLength(2)
    fireEvent.click(within(card).getByRole('button', { name: '改动 2 个文件' }))
    expect(useWorkbench.getState().benches.g1?.tabs).toContainEqual({
      kind: 'run',
      runId: 'r1',
      view: 'diff',
      file: null,
    })
  })
})

describe('system event folding', () => {
  it('folds a run of setup events into one row that expands in place', async () => {
    const ev = (seq: number, body: string) =>
      msg({ seq, kind: 'event', authorId: null, authorName: '', body, createdAt: min(seq) })
    renderChat({
      messages: [
        ev(1, '王磊 创建了群 · 成为群管理员'),
        ev(2, '群绑定仓库 git@x:pay.git · main'),
        ev(3, '小王的 Claude 加入'),
        ev(4, '✓ 小王的 Claude 已使用托管工作区'),
        msg({ seq: 5, body: '开工' }),
      ],
      runs: [],
    })
    const head = await screen.findByRole('button', {
      name: /4 条系统事件 · ✓ 小王的 Claude 已使用托管工作区/,
    })
    expect(screen.queryByText('群绑定仓库 git@x:pay.git · main')).toBeNull()
    expect(screen.getByText('开工')).toBeTruthy()
    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('群绑定仓库 git@x:pay.git · main')).toBeTruthy()
  })
})

describe('hover action bar', () => {
  it('is a keyboard-reachable toolbar with quote, copy and more', async () => {
    renderChat({ messages: [msg({ seq: 1, body: '你好' })], runs: [] })
    const row = (await screen.findByText('你好')).closest('.pn-msg') as HTMLElement
    const bar = within(row).getByRole('toolbar', { name: '消息操作' })
    const names = within(bar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['添加表情回应', '引用回复', '复制', '更多'])
    for (const b of within(bar).getAllByRole('button')) expect(b.tabIndex).toBe(0)
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    fireEvent.click(within(bar).getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制链接' }))
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/g/g1?msg=m1`)
  })

  it('offers 查看过程 only on run cards', async () => {
    renderChat({ messages: [msg({ seq: 1, authorId: 'u1', authorName: '王磊' })], runs: [run()] })
    const card = await screen.findByTestId('run-card')
    expect(within(card).getByRole('button', { name: '查看过程' })).toBeTruthy()
    const bar = within(card).getByRole('toolbar', { name: '消息操作' })
    expect(within(bar).queryByRole('button', { name: '查看过程' })).toBeNull()
    const row = screen.getByText('第 1 条').closest('.pn-msg') as HTMLElement
    expect(within(row).queryByRole('button', { name: '查看过程' })).toBeNull()
  })

  it('right-click opens a menu with every action of the bar, including the ones under 更多', async () => {
    renderChat({ messages: [msg({ seq: 1, body: '你好' })], runs: [] })
    const bubble = await screen.findByText('你好')
    fireEvent.contextMenu(bubble)
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['表情回应', '引用回复', '复制', '复制链接'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: '表情回应' }))
    const row = bubble.closest('.pn-msg') as HTMLElement
    expect(within(row).getByRole('button', { name: '添加表情回应' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(within(row).getByRole('toolbar', { name: '消息操作' }).dataset.open).toBe('true')
  })

  it('keeps 查看过程 out of the run card menu', async () => {
    renderChat({ messages: [msg({ seq: 1, authorId: 'u1', authorName: '王磊' })], runs: [run()] })
    fireEvent.contextMenu(await screen.findByTestId('run-card'))
    expect(screen.getByRole('menuitem', { name: '引用回复' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '查看过程' })).toBeNull()
  })

  it('ends the list with the working Bots whose run card is not in view', async () => {
    renderChat({ messages: [msg({ seq: 2 })], runs: [run()] })
    expect((await screen.findByText('小王的 Claude 正在处理…')).closest('[role=status]')).toBeTruthy()
    const mascot = document.querySelector('.pn-typing .ui-mascot')
    expect(mascot?.getAttribute('data-action')).toBe('think')
    expect(mascot?.getAttribute('data-role')).toBe('no')
  })

  it('shows no typing row for a Bot whose running card is in the timeline', async () => {
    renderChat({ messages: [msg({ seq: 1 })], runs: [run()] })
    await screen.findByTestId('run-card')
    expect(screen.queryByText('小王的 Claude 正在处理…')).toBeNull()
  })

  it('keeps the group mode and the per-Bot wording out of a private chat header', async () => {
    renderChat({ messages: [msg({ seq: 1 })], runs: [] }, group({ kind: 'dm', name: '王磊 的私聊' }))
    const head = (await screen.findByRole('heading', { name: '王磊 的私聊' })).closest(
      'header',
    ) as HTMLElement
    expect(within(head).queryByText('分区模式')).toBeNull()
    expect(head.textContent).toContain('仅你和你的 Bot · 未绑定仓库 · Bot 使用本机目录')
  })

  it('shows a drop zone while files are dragged over the chat', async () => {
    renderChat({ messages: [msg({ seq: 1 })], runs: [] })
    const view = (await screen.findByText('第 1 条')).closest('.chat-view') as HTMLElement
    fireEvent.dragEnter(view, { dataTransfer: { types: ['text/plain'] } })
    expect(screen.queryByRole('group', { name: '添加附件' })).toBeNull()
    fireEvent.dragEnter(view, { dataTransfer: { types: ['Files'] } })
    expect(screen.getByRole('group', { name: '添加附件' })).toBeTruthy()
    fireEvent.dragLeave(view, { dataTransfer: { types: ['Files'] } })
    expect(screen.queryByRole('group', { name: '添加附件' })).toBeNull()
  })

  it('opens on a touch long-press', async () => {
    renderChat({ messages: [msg({ seq: 1, body: '长按我' })], runs: [] })
    const row = (await screen.findByText('长按我')).closest('.pn-msg') as HTMLElement
    const host = row.closest('[data-actions]') as HTMLElement
    vi.useFakeTimers()
    fireEvent.pointerDown(host, { pointerType: 'touch' })
    act(() => vi.advanceTimersByTime(600))
    expect(host.dataset.actions).toBe('open')
  })
})

describe('EmptyState illustration', () => {
  it('renders a decorative svg', () => {
    render(<EmptyState title="还没有消息" illustration={<EmptyChatArt />} />)
    expect(document.querySelector('.ui-empty__art svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
