import type { MessageDto, UserCardDto } from '@aiws/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BotReply, UserMessage } from '../src/features/chat/TimelineItems'
import { UserCardTrigger } from '../src/features/users'
import { mockApi } from './mockApi'

let n = 0
let id = ''
const card = (o: Partial<UserCardDto> = {}): UserCardDto => ({
  id,
  name: '王磊',
  account: 'wanglei',
  role: 'member',
  groupAdmin: true,
  online: true,
  ...o,
})
const path = () => `/users/${id}/card?groupId=g1`

/** Advances fake time and lets the card's fetch settle. */
const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await act(async () => {})
}
const dialog = () => screen.queryByRole('dialog', { name: '用户名片' })
const trigger = () => document.querySelector<HTMLElement>('.user-card-trigger')!

beforeEach(() => {
  id = `u${++n}`
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(o: Partial<UserCardDto> = {}) {
  const calls = mockApi({ [`GET ${path()}`]: card(o) })
  render(
    <UserCardTrigger userId={id} groupId="g1">
      王磊
    </UserCardTrigger>,
  )
  return calls
}

describe('UserCardTrigger', () => {
  it('opens after a short hover delay and shows the basic info', async () => {
    const calls = setup()
    fireEvent.mouseEnter(trigger())
    await tick(250)
    expect(dialog()).toBeNull()
    await tick(50)
    const d = dialog()!
    expect(d.textContent).toContain('王磊')
    expect(d.textContent).toContain('wanglei')
    expect(d.textContent).toContain('普通成员')
    expect(d.textContent).toContain('群管理员')
    expect(d.textContent).toContain('在线')
    expect(d.parentElement).toBe(document.body)
    expect(calls).toEqual([{ method: 'GET', path: path(), body: undefined }])
  })

  it('shows a sysadmin who is offline and not a group admin', async () => {
    setup({ role: 'sysadmin', groupAdmin: false, online: false })
    fireEvent.mouseEnter(trigger())
    await tick(300)
    expect(dialog()!.textContent).toContain('系统管理员')
    expect(dialog()!.textContent).not.toContain('群管理员')
    expect(dialog()!.textContent).toContain('离线')
  })

  it('does not open when the pointer passes by quickly', async () => {
    const calls = setup()
    fireEvent.mouseEnter(trigger())
    await tick(100)
    fireEvent.mouseLeave(trigger())
    await tick(500)
    expect(dialog()).toBeNull()
    expect(calls).toEqual([])
  })

  it('hides after a delay once the pointer leaves, but stays while over the card', async () => {
    setup()
    fireEvent.mouseEnter(trigger())
    await tick(300)
    fireEvent.mouseLeave(trigger())
    await tick(100)
    fireEvent.mouseEnter(dialog()!)
    await tick(1000)
    expect(dialog()?.dataset.state).toBe('open')
    fireEvent.mouseLeave(dialog()!)
    await tick(150)
    expect(dialog()?.dataset.state).toBe('open')
    await tick(50)
    expect(dialog()?.dataset.state).toBe('closed')
    await tick(300)
    expect(dialog()).toBeNull()
  })

  it('opens on keyboard focus and closes on Escape', async () => {
    setup()
    fireEvent.focus(trigger())
    await tick(300)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(dialog()?.dataset.state).toBe('closed')
  })

  it('caches the card per user', async () => {
    const calls = setup()
    fireEvent.mouseEnter(trigger())
    await tick(300)
    fireEvent.mouseLeave(trigger())
    await tick(600)
    fireEvent.mouseEnter(trigger())
    await tick(300)
    expect(dialog()!.textContent).toContain('wanglei')
    expect(calls).toHaveLength(1)
  })
})

describe('timeline wiring', () => {
  const m = (o: Partial<MessageDto>): MessageDto => ({
    id: 'm1',
    seq: 1,
    groupId: 'g1',
    kind: 'user',
    authorId: 'u2',
    authorName: '李建国',
    body: '好',
    mentions: [],
    runId: null,
    createdAt: '2026-09-24T08:00:00Z',
    attachments: [],
    quote: null,
    reactions: [],
    ...o,
  })

  it('makes other members’ name and avatar card triggers, not mine or bots', () => {
    const { unmount } = render(<UserMessage m={m({})} names={[]} />)
    expect(screen.getByText('李建国').closest('[aria-haspopup="dialog"]')).not.toBeNull()
    expect(screen.getByText('李').closest('[aria-haspopup="dialog"]')).not.toBeNull()
    unmount()
    render(<BotReply m={m({ kind: 'bot', authorId: 'b1', authorName: '小王的 Claude' })} />)
    expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull()
  })
})
