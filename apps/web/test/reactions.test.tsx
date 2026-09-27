import type { MessageDto, ReactionDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { ReactionBar, ReactionPicker } from '../src/features/reactions'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

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
MotionGlobalConfig.skipAnimations = true

const push = (e: WebEvent) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify(e) }))

let n = 0
let id = ''
const msg = (reactions: ReactionDto[]): Pick<MessageDto, 'id' | 'groupId' | 'reactions'> => ({
  id,
  groupId: 'g1',
  reactions,
})
const u = (...names: string[]) => names.map((name) => ({ id: `id-${name}`, name }))
/** Visible reactor names of a pill, e.g. `李建国、赵敏`. */
const names = (emoji: string) =>
  pill(emoji).closest('.reaction-pill')?.querySelector('.reaction-pill__users')?.textContent
const path = (emoji: string) => `/messages/${id}/reactions/${encodeURIComponent(emoji)}`
/** A pill's accessible name is `<emoji> <count>`. */
const pill = (emoji: string) => screen.getByRole('button', { name: new RegExp(`^${emoji} \\d+$`) })
const count = (emoji: string) => pill(emoji).getAttribute('aria-label')?.split(' ')[1]
const thumbs = (o: Partial<ReactionDto> = {}): ReactionDto => ({
  emoji: '👍',
  count: 2,
  mine: false,
  users: u('李建国', '赵敏'),
  ...o,
})

beforeEach(() => {
  id = `m${++n}`
  vi.stubGlobal('WebSocket', FakeSocket)
  realtime.start()
  act(() => FakeSocket.last!.onopen!())
  useSession.setState({
    user: {
      id: 'u1',
      account: 'wang',
      name: '王磊',
      role: 'member',
      mustChangePassword: false,
      disabled: false,
      gitProtocol: 'auto',
    },
  } as never)
})
afterEach(() => {
  realtime.stop()
  vi.unstubAllGlobals()
})

describe('ReactionBar', () => {
  it('renders nothing without reactions', () => {
    const { container } = render(<ReactionBar message={msg([])} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows a pill per emoji with count, who reacted, and my own highlighted', () => {
    render(<ReactionBar message={msg([thumbs(), { emoji: '🎉', count: 1, mine: true, users: u('王磊') }])} />)
    expect(count('👍')).toBe('2')
    expect(pill('👍').getAttribute('aria-pressed')).toBe('false')
    expect(names('👍')).toBe('李建国、赵敏')
    expect(names('🎉')).toBe('王磊')
    const img = pill('👍').querySelector('img') as HTMLImageElement
    expect(img.alt).toBe('👍')
    expect(img.getAttribute('src')).toMatch(/\/1f44d\.svg\b/)
    expect(pill('🎉').getAttribute('aria-pressed')).toBe('true')
  })

  it('lists the first three reactors, then how many in total', () => {
    render(<ReactionBar message={msg([thumbs({ count: 5, users: u('甲', '乙', '丙', '丁', '戊') })])} />)
    expect(names('👍')).toBe('甲、乙、丙 等 5 人')
    const bar = screen.getByRole('group', { name: '表情回应' })
    expect([...bar.querySelectorAll('.reaction-pill__user')].map((n) => n.textContent)).toEqual([
      '甲',
      '乙',
      '丙',
    ])
  })

  it('clicking someone else’s emoji adds mine, optimistically then from the server', async () => {
    const calls = mockApi({
      [`PUT ${path('👍')}`]: {
        groupId: 'g1',
        messageId: id,
        reactions: [thumbs({ count: 4, mine: true, users: u('李建国', '赵敏', '孙强', '王磊') })],
      },
    })
    render(<ReactionBar message={msg([thumbs()])} />)
    fireEvent.click(pill('👍'))
    expect(count('👍')).toBe('3')
    expect(pill('👍').getAttribute('aria-pressed')).toBe('true')
    expect(names('👍')).toBe('李建国、赵敏、王磊')
    expect(calls).toEqual([{ method: 'PUT', path: path('👍'), body: undefined }])
    await waitFor(() => expect(count('👍')).toBe('4'))
  })

  it('clicking my own emoji removes it', async () => {
    const calls = mockApi({ [`DELETE ${path('🎉')}`]: { groupId: 'g1', messageId: id, reactions: [] } })
    render(<ReactionBar message={msg([{ emoji: '🎉', count: 1, mine: true, users: u('王磊') }])} />)
    fireEvent.click(pill('🎉'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /🎉/ })).toBeNull())
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: path('🎉') })
  })

  it('rolls back when the server refuses', async () => {
    mockApi({})
    render(<ReactionBar message={msg([thumbs()])} />)
    fireEvent.click(pill('👍'))
    expect(count('👍')).toBe('3')
    await waitFor(() => expect(count('👍')).toBe('2'))
    expect(pill('👍').getAttribute('aria-pressed')).toBe('false')
  })

  it('applies realtime changes from other members', async () => {
    render(<ReactionBar message={msg([thumbs()])} />)
    push({
      t: 'message.reactions',
      groupId: 'g1',
      messageId: id,
      reactions: [
        thumbs({ count: 3, users: u('李建国', '赵敏', '孙强') }),
        { emoji: '😂', count: 1, mine: false, users: u('孙强') },
      ],
    })
    expect(count('👍')).toBe('3')
    expect(count('😂')).toBe('1')
    push({ t: 'message.reactions', groupId: 'g1', messageId: 'other', reactions: [] })
    expect(count('👍')).toBe('3')
  })
})

describe('ReactionPicker', () => {
  it('opens the fixed emoji set and toggles the chosen one', async () => {
    const calls = mockApi({
      [`PUT ${path('✅')}`]: {
        groupId: 'g1',
        messageId: id,
        reactions: [{ emoji: '✅', count: 1, mine: true, users: u('王磊') }],
      },
    })
    const onOpenChange = vi.fn()
    render(
      <>
        <ReactionPicker message={msg([])} onOpenChange={onOpenChange} />
        <ReactionBar message={msg([])} />
      </>,
    )
    const trigger = screen.getByRole('button', { name: '添加表情回应' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.querySelector('img')?.alt)).toEqual(['👍', '✅', '👀', '🎉', '❤️', '😂'])
    fireEvent.click(screen.getByRole('option', { name: '完成' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => expect(pill('✅').getAttribute('aria-pressed')).toBe('true'))
    expect(calls[0]).toMatchObject({ method: 'PUT', path: path('✅') })
  })

  it('marks my reactions and closes on Escape', () => {
    render(<ReactionPicker message={msg([{ emoji: '👀', count: 1, mine: true, users: u('王磊') }])} />)
    fireEvent.click(screen.getByRole('button', { name: '添加表情回应' }))
    expect(screen.getByRole('option', { name: '看' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: '赞' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: '添加表情回应' }).getAttribute('aria-expanded')).toBe('false')
  })
})
