import type { BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { GitBar } from '../src/features/chat/GitBar'
import { ThreadScope } from '../src/features/chat/threadSummary'
import { BotCardTrigger, botIntro } from '../src/features/users/BotCard'
import { mockApi } from './mockApi'

const group = {
  id: 'g1',
  kind: 'group',
  mode: 'partition',
  repo: null,
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: false }],
  botIds: ['b1'],
} as unknown as GroupDto
const bot = (o: Partial<BotDto> = {}) =>
  ({
    id: 'b1',
    name: 'MBP 的 CC',
    ownerId: 'u2',
    ownerName: '李建国',
    agentKind: 'claude',
    agentVersion: '2.1.4',
    avatar: 'role-no',
    followAgent: false,
    avatarUrl: null,
    binding: 'bound',
    presence: 'online',
    systemPrompt: '',
    ...o,
  }) as BotDto

const sent = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/groups/g1/messages').map((c) => c.body)

beforeEach(() => {
  useSession.setState({ user: { id: 'u1', name: '王磊' } as UserDto, status: 'ready' })
  useWorkspace.setState({
    groups: [group],
    bots: [bot()],
    botStates: {
      g1: {
        b1: {
          botId: 'b1',
          workspace: 'managed',
          path: null,
          state: 'ready',
          git: null,
          error: null,
          reason: null,
          tier: null,
          model: null,
          effort: null,
          context: null,
          extraDirs: [],
          repoPaths: {},
        },
      },
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('bot intro', () => {
  it('shows the system prompt flattened, cut when long', () => {
    expect(botIntro('')).toBeNull()
    expect(botIntro('## 角色\n\n你是  支付组的 **后端** 助手')).toEqual({
      text: '角色：你是 支付组的 后端 助手',
      cut: false,
    })
    expect(
      botIntro('# 角色\n你是 **CC专家**，负责开发。\n\n- 先读 AGENTS.md\n* 看 `my_file`\n1. 用中文'),
    ).toEqual({ text: '角色：你是 CC专家，负责开发。先读 AGENTS.md 看 my_file 用中文', cut: false })
    const long = botIntro('啊'.repeat(200))
    expect(long?.cut).toBe(true)
    expect(long?.text).toBe(`${'啊'.repeat(50)}…`)
  })
})

describe('新会话', () => {
  it('sends /new @bot from the bot menu in the status bar', async () => {
    const calls = mockApi({ 'POST /groups/g1/messages': { id: 'm1' } })
    render(
      <MemoryRouter>
        <GitBar group={group} />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'MBP 的 CC 的工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '让 MBP 的 CC 开始新会话' }))
    await waitFor(() => expect(sent(calls)).toHaveLength(1))
    expect(sent(calls)[0]).toMatchObject({ body: '/new @MBP 的 CC', appendTo: null })
    expect(sent(calls)[0]).not.toHaveProperty('threadRootId')
  })

  it('the hover card offers it with the intro, in the thread it was opened from', async () => {
    vi.useFakeTimers()
    useWorkspace.setState({ bots: [bot({ systemPrompt: `负责支付服务。${'细节'.repeat(100)}` })] })
    const calls = mockApi({ 'POST /groups/g1/messages': { id: 'm1' } })
    render(
      <MemoryRouter>
        <ThreadScope.Provider value="root1">
          <BotCardTrigger botId="b1" groupId="g1">
            MBP 的 CC
          </BotCardTrigger>
        </ThreadScope.Provider>
      </MemoryRouter>,
    )
    fireEvent.mouseEnter(document.querySelector('.user-card-trigger') as Element)
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    const dialog = screen.getByRole('dialog', { name: 'Bot 名片' })
    expect(dialog.textContent).toContain('负责支付服务。')
    expect(screen.getByRole('link', { name: '完整内容见 Bot 详情' }).getAttribute('href')).toBe('/bot/b1')
    fireEvent.click(screen.getByRole('button', { name: '新会话' }))
    vi.useRealTimers()
    await waitFor(() => expect(sent(calls)).toHaveLength(1))
    expect(sent(calls)[0]).toMatchObject({ body: '/new @MBP 的 CC', threadRootId: 'root1' })
    expect(dialog.dataset.state).toBe('closed')
  })
})
