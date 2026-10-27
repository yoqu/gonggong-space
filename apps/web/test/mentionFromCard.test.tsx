import type { BotDto, GroupDto, MessageDto, UserCardDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render as renderBare, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { mentionInChat, useMention } from '../src/features/chat/mention'
import { BotReply } from '../src/features/chat/TimelineItems'
import { UserCardTrigger } from '../src/features/users'
import { mockApi } from './mockApi'

/** Message rows open the chat's router (branch navigation), so every render gets one. */
const render = (ui: ReactElement) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const group = {
  id: 'g1',
  kind: 'group',
  mode: 'partition',
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: false },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
} as GroupDto
const bot = {
  id: 'b1',
  name: 'MBP 的 CC',
  ownerId: 'u2',
  ownerName: '李建国',
  agentKind: 'claude',
  agentVersion: '2.1.4',
  avatar: 'role-no',
  avatarUrl: null,
  binding: 'bound',
  presence: 'running',
} as BotDto
const card = (id: string, name: string): UserCardDto => ({
  id,
  name,
  account: id,
  avatar: null,
  role: 'member',
  groupAdmin: false,
  online: true,
})

const hover = async (el: Element) => {
  fireEvent.mouseEnter(el)
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
  await act(async () => {})
}

beforeEach(() => {
  useMention.setState({ pending: null })
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [group], bots: [bot], botStates: {} })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('@TA on a hover card', () => {
  beforeEach(() => vi.useFakeTimers())

  it("puts another member's name into the group's composer and closes the card; my own card has no button", async () => {
    mockApi({
      'GET /users/u2/card?groupId=g1': card('u2', '李建国'),
      'GET /users/u1/card?groupId=g1': card('u1', '王磊'),
    })
    render(
      <>
        <UserCardTrigger userId="u2" groupId="g1">
          李建国
        </UserCardTrigger>
        <UserCardTrigger userId="u1" groupId="g1">
          王磊
        </UserCardTrigger>
      </>,
    )
    const [li, wang] = document.querySelectorAll('.user-card-trigger')
    await hover(li!)
    const dialog = screen.getByRole('dialog', { name: '用户名片' })
    fireEvent.click(screen.getByRole('button', { name: '@TA' }))
    expect(useMention.getState().pending).toEqual({ groupId: 'g1', name: '李建国' })
    expect(dialog.dataset.state).toBe('closed')

    await hover(wang!)
    expect(screen.getAllByRole('dialog', { name: '用户名片' }).at(-1)?.textContent).toContain('王磊')
    expect(screen.queryByRole('button', { name: '@TA' })).toBeNull()
  })

  it("shows a bot's card from its name in the timeline, with owner, agent and state", async () => {
    const reply = {
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'bot',
      authorId: 'b1',
      authorName: 'MBP 的 CC',
      body: '好了',
      mentions: [],
      runId: null,
      createdAt: '2026-10-14T08:00:00Z',
      attachments: [],
      quote: null,
      reactions: [],
    } as MessageDto
    render(<BotReply m={reply} />)
    await hover(document.querySelectorAll('.user-card-trigger')[1]!)
    const dialog = screen.getByRole('dialog', { name: 'Bot 名片' })
    expect(dialog.textContent).toContain('李建国')
    expect(dialog.textContent).toContain('Claude Code 2.1.4')
    expect(dialog.textContent).toContain('运行中')
    fireEvent.click(screen.getByRole('button', { name: '@TA' }))
    expect(useMention.getState().pending).toEqual({ groupId: 'g1', name: 'MBP 的 CC' })
    expect(dialog.dataset.state).toBe('closed')
  })
})

describe('the composer takes the mention', () => {
  const box = () => screen.getByRole('combobox') as HTMLTextAreaElement

  it('keeps the picked bot mention intact when completing /new', async () => {
    const claude = { ...bot, name: '共字君' }
    const codex = { ...bot, id: 'b2', name: '共字君Codex', agentKind: 'codex' } as const
    const codexGroup = { ...group, botIds: [claude.id, codex.id] }
    useWorkspace.setState({ bots: [claude, codex] })
    mockApi({
      'GET /groups/g1/candidates/commands?botId=b1,b2': {
        system: [{ name: 'new', hint: '开新会话' }],
        skill: [],
        agent: [],
      },
    })
    render(<MessageComposer group={codexGroup} onSent={() => {}} />)
    fireEvent.change(box(), { target: { value: '@共', selectionStart: 2 } })
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('@共字君Codex ')

    fireEvent.change(box(), { target: { value: '@共字君Codex /new', selectionStart: 14 } })
    await screen.findByRole('option', { name: /\/new/ })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('@共字君Codex /new ')
  })

  it('inserts @name at the caret, focuses the input and never mentions twice', () => {
    render(<MessageComposer group={group} onSent={() => {}} />)
    fireEvent.change(box(), { target: { value: '请看下这个' } })
    box().setSelectionRange(2, 2)
    act(() => mentionInChat('g1', '李建国'))
    expect(box().value).toBe('请看 @李建国 下这个')
    expect(document.activeElement).toBe(box())
    expect(box().selectionStart).toBe('请看 @李建国 '.length)
    expect(useMention.getState().pending).toBeNull()

    act(() => mentionInChat('g1', '李建国'))
    expect(box().value).toBe('请看 @李建国 下这个')
    // Another group's mention is left for its own composer.
    act(() => mentionInChat('g2', 'MBP 的 CC'))
    expect(box().value).toBe('请看 @李建国 下这个')
    expect(useMention.getState().pending).toEqual({ groupId: 'g2', name: 'MBP 的 CC' })
  })
})
