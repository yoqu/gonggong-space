import type { BotDto, BotShareRequestDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { BotShares } from '../src/features/bots/BotShares'
import { ShareRequestAction } from '../src/features/bots/ShareRequest'
import { mockApi } from './mockApi'

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: 'Claude',
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
  ...o,
})

const me: UserDto = {
  id: 'u2',
  account: 'li',
  name: '李建国',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}
const ask: BotShareRequestDto = {
  id: 'r1',
  botId: 'b1',
  userId: 'u2',
  userName: '李建国',
  reason: '写周报',
  createdAt: '2026-10-14T00:00:00Z',
}

beforeEach(() => useSession.setState({ user: me, status: 'ready' }))
afterEach(() => vi.unstubAllGlobals())

describe('申请共享', () => {
  it("asks for someone else's bot with a reason, then waits for the owner", async () => {
    let pending: BotShareRequestDto[] = []
    const calls = mockApi({
      'GET /bots/b1/share-requests': () => pending,
      'POST /bots/b1/share-requests': () => {
        pending = [ask]
        return ask
      },
    })
    render(
      <MemoryRouter>
        <ShareRequestAction bot={bot({})} />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '申请共享' }))
    const dialog = await screen.findByRole('dialog', { name: '申请共享 Claude' })
    expect(within(dialog).getByText(/单独的托管工作区/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('用途'), { target: { value: '写周报' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '提交申请' }))
    expect(await screen.findByText('等待主人同意')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ reason: '写周报' })
  })

  it('offers a DM once shared, and nothing on my own bot', async () => {
    mockApi({})
    const { rerender } = render(
      <MemoryRouter>
        <ShareRequestAction bot={bot({ sharedWith: ['u2'] })} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '私聊' })).toBeTruthy()
    rerender(
      <MemoryRouter>
        <ShareRequestAction bot={bot({ ownerId: 'u2' })} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lists pending requests for the owner to approve or decline', async () => {
    useSession.setState({ user: { ...me, id: 'u1', name: '王磊' }, status: 'ready' })
    const calls = mockApi({
      'GET /bots/b1/share-requests': [ask],
      'POST /share-requests/r1/approve': { groupId: 'g9' },
    })
    render(<BotShares bot={bot({})} users={[]} />)
    const list = await screen.findByRole('list', { name: '共享申请' })
    expect(within(list).getByText('李建国')).toBeTruthy()
    expect(within(list).getByText('写周报')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '同意' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/share-requests/r1/approve')).toBe(true))
  })
})
