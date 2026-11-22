import { readFileSync } from 'node:fs'
import type { BotDto, MessageDto, PinnedMessageDto, RunDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MessageQuote } from '../src/features/attachments/MessageAttachments'
import { MessageEditor } from '../src/features/chat/MessageEditor'
import { PinnedMessages } from '../src/features/chat/PinnedMessages'
import { BotReply, RunCard, UserMessage } from '../src/features/chat/TimelineItems'
import { ThreadScope } from '../src/features/chat/threadSummary'
import { escFree } from '../src/features/chat/unreadMark'
import { UserCardTrigger } from '../src/features/users'
import { Message, useEscape, useToasts } from '../src/ui'
import { mockApi } from './mockApi'

const at = '2026-10-22T03:00:00.000Z'

const makeUser = (o: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
  ...o,
})

const makeBot = (o: Partial<BotDto> = {}): BotDto => ({
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
  access: { trusted: 'ask', others: 'auto' },
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
  model: null,
  effort: null,
  catalog: null,
  ...o,
})

const makeMsg = (o: Partial<MessageDto> = {}): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '原消息',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})

const makePin = (o: Partial<PinnedMessageDto> = {}): PinnedMessageDto => ({
  messageId: 'm1',
  seq: 3,
  authorName: '王磊',
  text: '上线窗口：周四 20:00',
  attachments: 0,
  pinnedBy: { id: 'u2', name: '李建国' },
  pinnedAt: at,
  ...o,
})

const makeRun = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm2',
  triggerUserId: 'u1',
  hop: 1,
  status: 'completed',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
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
  ...o,
})

beforeEach(() => {
  useWorkspace.setState({ pins: {}, bots: [], groups: [] })
  useSession.setState({ user: null, status: 'idle' })
  useToasts.setState({ items: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useToasts.setState({ items: [] })
})

describe('R2A P1-2: MessageEditor', () => {
  it('saves and cancels with buttons, disabling save when empty without attachments', async () => {
    const m = makeMsg({ id: 'm1', body: '旧文案' })
    const calls = mockApi({
      'PATCH /messages/m1': { ...m, body: '新文案', editedAt: at },
    })
    const onDone = vi.fn()
    const { rerender } = render(<MessageEditor message={m} onDone={onDone} />)

    const box = screen.getByRole('textbox', { name: '编辑消息' }) as HTMLTextAreaElement
    const cancelBtn = screen.getByRole('button', { name: '取消' }) as HTMLButtonElement
    const saveBtn = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement

    // Blank body without attachments disables save and blocks Enter submit.
    fireEvent.change(box, { target: { value: '   ' } })
    expect(saveBtn.disabled).toBe(true)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(calls).toEqual([])

    // Editing text enables save and PATCHes on click.
    fireEvent.change(box, { target: { value: '新文案' } })
    expect(saveBtn.disabled).toBe(false)
    fireEvent.click(saveBtn)
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/messages/m1', body: { body: '新文案' } }),
    )
    expect(onDone).toHaveBeenCalledOnce()

    // Cancel exits without saving.
    fireEvent.click(cancelBtn)
    expect(onDone).toHaveBeenCalledTimes(2)

    // With attachments, an empty body stays saveable.
    const withAtt = makeMsg({
      id: 'm2',
      body: '带图',
      attachments: [{ id: 'a1', name: 'a.png', size: 10, mime: 'image/png', messageId: 'm2' }],
    })
    rerender(<MessageEditor message={withAtt} onDone={onDone} />)
    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), { target: { value: '' } })
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('isolates Escape from outer ThreadView useEscape and window mark-read handler', () => {
    const onOuterClose = vi.fn()
    const onMarkRead = vi.fn()
    const onDone = vi.fn()

    function Harness() {
      useEscape(onOuterClose)
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape' && !e.defaultPrevented && escFree()) onMarkRead()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      return <MessageEditor message={makeMsg()} onDone={onDone} />
    }

    const { unmount } = render(<Harness />)
    // Escape inside the textarea exits editing only.
    fireEvent.keyDown(screen.getByRole('textbox', { name: '编辑消息' }), { key: 'Escape' })
    expect(onDone).toHaveBeenCalledOnce()
    expect(onOuterClose).not.toHaveBeenCalled()
    expect(onMarkRead).not.toHaveBeenCalled()
    unmount()

    // Escape outside the textarea (e.g. focused on Cancel button) still exits editing via useEscape stack.
    onDone.mockClear()
    render(<Harness />)
    const cancelBtn = screen.getByRole('button', { name: '取消' })
    cancelBtn.focus()
    fireEvent.keyDown(cancelBtn, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledOnce()
    expect(onOuterClose).not.toHaveBeenCalled()
    expect(onMarkRead).not.toHaveBeenCalled()
  })

  it('disables buttons and ignores Escape while saving is in flight', async () => {
    let resolvePatch!: (v: MessageDto) => void
    const m = makeMsg({ id: 'm1', body: '旧' })
    mockApi({
      'PATCH /messages/m1': () =>
        new Promise<MessageDto>((r) => {
          resolvePatch = r
        }),
    })
    const onDone = vi.fn()
    render(<MessageEditor message={m} onDone={onDone} />)

    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), { target: { value: '新' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '保存' }).getAttribute('aria-busy')).toBe('true')
    fireEvent.keyDown(screen.getByRole('textbox', { name: '编辑消息' }), { key: 'Escape' })
    expect(onDone).not.toHaveBeenCalled()

    await act(async () => resolvePatch({ ...m, body: '新', editedAt: at }))
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
  })

  it('keeps narrow-rail width and coarse-pointer styles in edit.css', () => {
    const css = readFileSync('src/features/chat/edit.css', 'utf8')
    expect(css).toContain('width: min(460px, 100%)')
    expect(css).toContain('min-width: min(260px, 100%)')
    expect(css).not.toContain('min(360px, 60vw)')
    expect(css).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.msg-edit-hint \{\s*display: none;/)
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.msg-edit__actions \.ui-btn \{\s*min-height: 32px;/,
    )
  })
})

describe('R2A P1-3: PinnedMessages', () => {
  it('confirms unpin via AlertDialog before calling DELETE and toasts on confirm', async () => {
    const calls = mockApi({ 'DELETE /groups/g1/pins/m1': undefined })
    useWorkspace.setState({ pins: { g1: [makePin()] } })
    render(<PinnedMessages groupId="g1" onLocate={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '取消置顶' }))
    const dlg = screen.getByRole('alertdialog', { name: '要取消置顶这条消息吗？' })
    expect(dlg.textContent).toContain('所有群成员顶部将不再看到该置顶，并在群内留下一条记录。')
    expect(calls).toEqual([])

    // Cancelling closes without calling DELETE.
    fireEvent.click(within(dlg).getByRole('button', { name: '取消' }))
    expect(calls).toEqual([])
    expect(dlg.closest('.ui-overlay')?.getAttribute('data-state')).toBe('closed')

    // Confirming calls DELETE, removes pin, and toasts success.
    fireEvent.click(within(screen.getByTestId('pinned-messages')).getByRole('button', { name: '取消置顶' }))
    const dlg2 = screen.getByRole('alertdialog', { name: '要取消置顶这条消息吗？' })
    fireEvent.click(within(dlg2).getByRole('button', { name: '取消置顶' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/groups/g1/pins/m1', body: undefined }),
    )
    await waitFor(() => expect(useWorkspace.getState().pins.g1).toEqual([]))
    expect(useToasts.getState().items.map((x) => x.message)).toContain('已取消置顶')
  })

  it('omits top-bar unpin when multiple pins exist and confirms per-row inside expanded list', async () => {
    const calls = mockApi({ 'DELETE /groups/g1/pins/m2': undefined })
    useWorkspace.setState({
      pins: {
        g1: [makePin({ messageId: 'm1', text: '第一条' }), makePin({ messageId: 'm2', text: '第二条' })],
      },
    })
    render(<PinnedMessages groupId="g1" onLocate={() => {}} />)

    // Top bar omits ambiguous × when pins.length > 1.
    expect(screen.queryByRole('button', { name: '取消置顶' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '全部 2 条置顶' }))
    const items = screen.getAllByTestId('pinned-item')
    expect(items).toHaveLength(2)

    fireEvent.click(within(items[1]!).getByRole('button', { name: '取消置顶' }))
    const dlg = screen.getByRole('alertdialog', { name: '要取消置顶这条消息吗？' })
    expect(calls).toEqual([])
    fireEvent.click(within(dlg).getByRole('button', { name: '取消置顶' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/groups/g1/pins/m2', body: undefined }),
    )
  })

  it('hides all unpin buttons when readOnly is true', () => {
    useWorkspace.setState({ pins: { g1: [makePin()] } })
    const { rerender } = render(<PinnedMessages groupId="g1" readOnly onLocate={() => {}} />)
    expect(screen.queryByRole('button', { name: '取消置顶' })).toBeNull()

    useWorkspace.setState({
      pins: { g1: [makePin({ messageId: 'm1' }), makePin({ messageId: 'm2', text: '二' })] },
    })
    rerender(<PinnedMessages groupId="g1" readOnly onLocate={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '全部 2 条置顶' }))
    expect(screen.getAllByTestId('pinned-item')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '取消置顶' })).toBeNull()
  })

  it('closes expanded pin list on Escape and outside press, layering AlertDialog above it', () => {
    useWorkspace.setState({
      pins: { g1: [makePin({ messageId: 'm1' }), makePin({ messageId: 'm2', text: '二' })] },
    })
    render(
      <div>
        <PinnedMessages groupId="g1" onLocate={() => {}} />
        <div data-testid="outside">外面</div>
      </div>,
    )

    // Open expanded list -> Escape closes it.
    fireEvent.click(screen.getByRole('button', { name: '全部 2 条置顶' }))
    expect(screen.getAllByTestId('pinned-item')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryAllByTestId('pinned-item')).toHaveLength(0)

    // Open again -> outside mousedown closes it, inside mousedown keeps it open.
    fireEvent.click(screen.getByRole('button', { name: '全部 2 条置顶' }))
    fireEvent.mouseDown(screen.getByTestId('pinned-messages'))
    expect(screen.getAllByTestId('pinned-item')).toHaveLength(2)
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryAllByTestId('pinned-item')).toHaveLength(0)

    // With AlertDialog open from expanded list: first Escape closes AlertDialog only, second closes list.
    fireEvent.click(screen.getByRole('button', { name: '全部 2 条置顶' }))
    fireEvent.click(
      within(screen.getAllByTestId('pinned-item')[0]!).getByRole('button', { name: '取消置顶' }),
    )
    const dlg = screen.getByRole('alertdialog', { name: '要取消置顶这条消息吗？' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dlg.closest('.ui-overlay')?.getAttribute('data-state')).toBe('closed')
    expect(screen.getAllByTestId('pinned-item')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryAllByTestId('pinned-item')).toHaveLength(0)
  })

  it('enlarges .pn-pinned__close to 32x32 under coarse pointer', () => {
    const css = readFileSync('src/ui/im/notice.css', 'utf8')
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*\.pn-pinned__close \{\s*width: 32px;\s*height: 32px;/,
    )
  })
})

describe('R2A P1-5: thread RunCard copy link & MessageQuote jump', () => {
  function SearchProbe() {
    const { search } = useLocation()
    return <output data-testid="search">{search}</output>
  }

  it('preserves thread= when copying a RunCard reply link inside a thread or with threadRootId', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    const replyInThread = makeMsg({
      id: 'm3',
      seq: 3,
      kind: 'bot',
      authorId: 'b1',
      authorName: '小王的 Claude',
      body: '改好了',
      runId: 'r1',
      threadRootId: 'm1',
    })
    const { unmount } = render(
      <MemoryRouter>
        <ThreadScope.Provider value="m1">
          <RunCard
            run={makeRun({ threadRootId: 'm1' })}
            reply={replyInThread}
            botName="小王的 Claude"
            agent="Claude Code"
            trigger="王磊"
          />
        </ThreadScope.Provider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/g/g1?thread=m1&msg=m3`))
    unmount()

    // Main-channel RunCard reply omits thread=.
    writeText.mockClear()
    const mainReply = makeMsg({
      id: 'm4',
      seq: 4,
      kind: 'bot',
      authorId: 'b1',
      authorName: '小王的 Claude',
      body: '主频道回复',
      runId: 'r2',
    })
    render(
      <MemoryRouter>
        <RunCard
          run={makeRun({ id: 'r2' })}
          reply={mainReply}
          botName="小王的 Claude"
          agent="Claude Code"
          trigger="王磊"
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/g/g1?msg=m4`))
  })

  it('preserves thread= when clicking a MessageQuote inside ThreadScope, and omits it outside or for runs', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <ThreadScope.Provider value="m1">
          <MessageQuote quote={{ kind: 'message', id: 'm2', who: '李建国', text: '原回复' }} />
        </ThreadScope.Provider>
        <SearchProbe />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /引用 李建国/ }))
    const inThread = new URLSearchParams(screen.getByTestId('search').textContent ?? '')
    expect(inThread.get('thread')).toBe('m1')
    expect(inThread.get('msg')).toBe('m2')
    unmount()

    // Outside ThreadScope: only msg=.
    const { unmount: unmount2 } = render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <MessageQuote quote={{ kind: 'message', id: 'm2', who: '李建国', text: '原消息' }} />
        <SearchProbe />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /引用 李建国/ }))
    const outside = new URLSearchParams(screen.getByTestId('search').textContent ?? '')
    expect(outside.get('thread')).toBeNull()
    expect(outside.get('msg')).toBe('m2')
    unmount2()

    // Run quote inside ThreadScope: opens run without thread=.
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <ThreadScope.Provider value="m1">
          <MessageQuote quote={{ kind: 'run', id: 'r1', who: 'Bot 运行卡片', text: '读取文件' }} />
        </ThreadScope.Provider>
        <SearchProbe />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /引用 Bot 运行卡片/ }))
    const runJump = new URLSearchParams(screen.getByTestId('search').textContent ?? '')
    expect(runJump.get('run')).toBe('r1')
    expect(runJump.get('thread')).toBeNull()
  })
})

describe('R2A P1-6: mobile meta ellipsis, coarse touch targets & long-press top-message flip', () => {
  it('constrains .pn-msg__meta and enlarges coarse-pointer action bar and reactions in message.css', () => {
    const css = readFileSync('src/ui/im/message.css', 'utf8')
    const metaStart = css.indexOf('.pn-msg__meta {')
    const metaRule = css.slice(metaStart, css.indexOf('}', metaStart))
    expect(metaRule).toContain('max-width: 100%')
    expect(metaRule).toContain('min-width: 0')
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.pn-reaction \{\s*height: 32px;/)
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*\.pn-msgactions \{\s*height: 38px;\s*\}\s*\.pn-msgactions button:not\(\[role\^="menuitem"\]\):not\(\[role="option"\]\) \{\s*width: 36px;\s*height: 34px;/,
    )
  })

  it('flips the action bar below a top-clipped message when long-press sets data-actions="open"', async () => {
    const rect = (top: number, left: number, width: number, height: number) =>
      ({ top, left, width, height, right: left + width, bottom: top + height }) as DOMRect
    const { container } = render(
      <div style={{ overflowX: 'hidden' }} data-testid="clip">
        <Message author={{ name: '李建国' }} actionBar={<span>bar</span>}>
          首条消息
        </Message>
      </div>,
    )
    const host = container.querySelector('.pn-msg') as HTMLElement
    const row = container.querySelector('.pn-msg__row') as HTMLElement
    const bar = container.querySelector('.pn-msg__actions') as HTMLElement
    vi.spyOn(screen.getByTestId('clip'), 'getBoundingClientRect').mockReturnValue(rect(52, 0, 390, 792))
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(56, 0, 390, 52))
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(78, 54, 324, 26))
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(16, 160, 218, 38))

    act(() => {
      host.dataset.actions = 'open'
    })
    await waitFor(() => expect(bar.dataset.place).toBe('flip'))
    expect(bar.style.getPropertyValue('--actions-top')).toBe('52px')
  })
})

describe('R2A P1-7: UserCard & BotCard a11y, touch outside-press, keyboard Tab', () => {
  it('labels avatar triggers for both user and bot messages', () => {
    useWorkspace.setState({ bots: [makeBot()] })
    const { unmount } = render(
      <MemoryRouter>
        <UserMessage m={makeMsg({ authorId: 'u2', authorName: '李建国' })} targets={[]} />
      </MemoryRouter>,
    )
    const userAvatarBtn = screen.getByRole('button', { name: '查看 李建国 的名片' })
    expect(userAvatarBtn.tabIndex).toBe(-1)
    expect(userAvatarBtn.getAttribute('aria-haspopup')).toBe('dialog')
    unmount()

    render(
      <MemoryRouter>
        <BotReply m={makeMsg({ kind: 'bot', authorId: 'b1', authorName: '小王的 Claude' })} />
      </MemoryRouter>,
    )
    const botAvatarBtn = screen.getByRole('button', { name: '查看 小王的 Claude 的名片' })
    expect(botAvatarBtn.tabIndex).toBe(-1)
    expect(botAvatarBtn.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('closes on outside mousedown on touch devices while staying open on inside press', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({ matches: q.includes('coarse') })),
    )
    mockApi({
      'GET /users/r2-touch/card?groupId=g1': {
        id: 'r2-touch',
        name: '王磊',
        account: 'wanglei',
        avatar: null,
        role: 'member',
        groupAdmin: false,
        online: true,
      },
    })
    render(
      <MemoryRouter>
        <UserCardTrigger userId="r2-touch" groupId="g1">
          王磊
        </UserCardTrigger>
        <div data-testid="outside">外面</div>
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: '王磊' })
    fireEvent.click(trigger)
    const dlg = await screen.findByRole('dialog', { name: '用户名片' })
    expect(dlg.dataset.state).toBe('open')

    fireEvent.mouseDown(dlg)
    expect(dlg.dataset.state).toBe('open')

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(dlg.dataset.state).toBe('closed')
  })

  it('keeps card open when keyboard focus moves into portaled card and returns focus on Escape', async () => {
    vi.useFakeTimers()
    useSession.setState({ user: makeUser({ id: 'me' }), status: 'ready' })
    mockApi({
      'GET /users/r2-kbd/card?groupId=g1': {
        id: 'r2-kbd',
        name: '李建国',
        account: 'lijg',
        avatar: null,
        role: 'member',
        groupAdmin: false,
        online: true,
      },
    })
    render(
      <MemoryRouter>
        <UserCardTrigger userId="r2-kbd" groupId="g1">
          李建国
        </UserCardTrigger>
        <button type="button">外部按钮</button>
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: '李建国' })
    act(() => trigger.focus())
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {})
    const dlg = screen.getByRole('dialog', { name: '用户名片' })
    const mentionBtn = within(dlg).getByRole('button', { name: '@TA' })

    // Tab moves focus into the portaled card and keeps it open past closeDelay.
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(document.activeElement).toBe(mentionBtn)
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(dlg.dataset.state).toBe('open')

    // Escape closes the card, returns focus to trigger, and does not re-open after openDelay.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    // Re-open, enter card, verify blur to trigger stays open, blur to outside closes.
    fireEvent.focus(trigger)
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {})
    const dlg2 = screen.getByRole('dialog', { name: '用户名片' })
    const mentionBtn2 = within(dlg2).getByRole('button', { name: '@TA' })
    act(() => mentionBtn2.focus())
    fireEvent.blur(mentionBtn2, { relatedTarget: trigger })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(dlg2.dataset.state).toBe('open')

    const outside = screen.getByRole('button', { name: '外部按钮' })
    fireEvent.blur(mentionBtn2, { relatedTarget: outside })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(dlg2.dataset.state).toBe('closed')
  })
})
