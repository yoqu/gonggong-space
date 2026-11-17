import type { BotDto, GroupDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { BotAvatar } from '../src/features/bots/avatars'
import { dmLead, presenceBadge } from '../src/features/bots/model'
import { presenceHint } from '../src/features/chat/BotPresenceHint'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { GroupAvatar } from '../src/features/groups/GroupAvatar'
import { mockApi } from './mockApi'

const bot = (o: Partial<BotDto> = {}) =>
  ({
    id: 'b1',
    name: 'cc',
    agentKind: 'claude',
    avatar: 'role-no',
    followAgent: false,
    avatarUrl: null,
    binding: 'bound',
    presence: 'online',
    catalog: null,
    ...o,
  }) as BotDto

const group = (o: Partial<GroupDto> = {}) =>
  ({
    id: 'g1',
    name: '退款',
    kind: 'group',
    avatar: null,
    members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: false }],
    botIds: ['b1', 'b2'],
    liveRuns: [],
    liveRunIds: [],
    ...o,
  }) as GroupDto

const dot = (c: HTMLElement) => c.querySelector('.ui-avatar__status')

beforeEach(() => {
  sessionStorage.clear()
  useSession.setState({ user: { id: 'u1', name: '王磊' } as never, status: 'ready' })
})
afterEach(() => {
  useWorkspace.setState({ bots: [] })
  vi.unstubAllGlobals()
})

describe('presence badge', () => {
  it('maps every presence to a dot', () => {
    expect(presenceBadge(bot({ presence: 'online' })).status).toBe('online')
    expect(presenceBadge(bot({ presence: 'running' })).status).toBe('running')
    expect(presenceBadge(bot({ presence: 'offline' })).status).toBe('offline')
    expect(presenceBadge(bot({ presence: 'pending_bind' })).status).toBe('offline')
    expect(presenceBadge(bot({ presence: 'pending_confirm' })).status).toBe('offline')
    expect(presenceBadge(bot({ presence: 'agent_missing' })).status).toBe('away')
    expect(presenceBadge(undefined)).toEqual({})
  })

  it('BotAvatar shows it from 24px, labelled, and follows bot.updated', () => {
    useWorkspace.setState({ bots: [bot({ presence: 'running' })] })
    const { container, rerender } = render(<BotAvatar id="b1" name="cc" size={32} />)
    expect(dot(container)?.className).toContain('ui-avatar__status--running')
    expect(screen.getByRole('img', { name: 'cc（运行中）' })).toBeTruthy()
    act(() => useWorkspace.setState({ bots: [bot({ presence: 'offline' })] }))
    expect(dot(container)?.className).toContain('ui-avatar__status--offline')
    rerender(<BotAvatar id="b1" name="cc" size={18} />)
    expect(dot(container)).toBeNull()
  })

  it('a deleted bot has no dot', () => {
    const { container } = render(<BotAvatar id="gone" name="cc" size={32} />)
    expect(dot(container)).toBeNull()
  })

  it('a DM avatar carries its bot presence; groups do not', () => {
    useWorkspace.setState({ bots: [bot({ presence: 'agent_missing' })] })
    const { container, rerender } = render(
      <GroupAvatar group={group({ kind: 'dm', botIds: ['b1'] })} size={40} />,
    )
    expect(dot(container)?.className).toContain('ui-avatar__status--away')
    rerender(<GroupAvatar group={group()} size={40} />)
    expect(dot(container)).toBeNull()
  })
})

describe('DM header', () => {
  it('leads the subtitle with machine and state', () => {
    const b = bot({ machineName: 'mbp', presence: 'offline' })
    expect(dmLead([b], 'b1', undefined)).toBe('mbp · 离线 · 仅你和你的 Bot · ')
    expect(dmLead([], 'b1', '王磊')).toBe('王磊 共享的 Bot · ')
  })
})

describe('composer presence hint', () => {
  it('merges the unavailable bots into one line; online and running say nothing', () => {
    const bots = [
      bot({ id: 'a', name: 'A', presence: 'offline' }),
      bot({ id: 'b', name: 'B', presence: 'offline' }),
      bot({ id: 'c', name: 'C', presence: 'agent_missing' }),
      bot({ id: 'd', name: 'D', presence: 'pending_bind' }),
      bot({ id: 'e', name: 'E', presence: 'running' }),
      bot({ id: 'f', name: 'F', presence: 'online' }),
    ]
    expect(presenceHint(bots, 30)).toBe(
      'A、B 离线，消息会等上线后处理，超过 30 分钟自动失效；C 所在电脑缺少 Agent，暂时无法响应；D 还不可触发',
    )
    expect(presenceHint(bots.slice(0, 1), null)).toBe('A 离线，消息会等上线后处理')
    expect(presenceHint(bots.slice(4), 30)).toBeNull()
  })

  it('shows for an @ed offline bot and goes away once it is online', async () => {
    mockApi({ 'GET /groups/g1/params': { approvalTimeoutMin: 5, chainMaxHops: 3, offlineWaitMin: 45 } })
    useWorkspace.setState({ bots: [bot({ presence: 'offline' }), bot({ id: 'b2', name: 'dd' })] })
    render(<MessageComposer group={group()} onSent={() => {}} />)
    expect(screen.queryByText(/离线，消息会等/)).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '@cc 构建' } })
    await screen.findByText('cc 离线，消息会等上线后处理，超过 45 分钟自动失效')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '@dd 构建' } })
    expect(screen.queryByText(/离线，消息会等/)).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '@cc 构建' } })
    await screen.findByText(/cc 离线/)
    act(() => useWorkspace.setState({ bots: [bot(), bot({ id: 'b2', name: 'dd' })] }))
    await waitFor(() => expect(screen.queryByText(/离线，消息会等/)).toBeNull())
  })

  it('a DM with an offline bot warns before anything is typed', async () => {
    mockApi({ 'GET /groups/g2/params': { approvalTimeoutMin: 5, chainMaxHops: 3, offlineWaitMin: 10 } })
    useWorkspace.setState({ bots: [bot({ presence: 'offline' })] })
    render(<MessageComposer group={group({ id: 'g2', kind: 'dm', botIds: ['b1'] })} onSent={() => {}} />)
    await screen.findByText('cc 离线，消息会等上线后处理，超过 10 分钟自动失效')
  })
})
