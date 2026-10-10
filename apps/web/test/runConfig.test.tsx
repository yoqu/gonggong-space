import type {
  AgentCatalog,
  BotDto,
  GroupBotStateDto,
  GroupDto,
  MessageDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { apiError, mockApi } from './mockApi'

const level = (value: string) => ({ value, name: value })
const CATALOG: AgentCatalog = {
  current: 'sonnet',
  efforts: ['low', 'medium', 'high'].map(level),
  effort: 'medium',
  models: [
    { value: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'].map(level), effort: 'medium' },
    { value: 'opus', name: 'Opus', efforts: ['low', 'high', 'max'].map(level), effort: 'high' },
  ],
}

const user = (id: string, name: string): UserDto => ({
  id,
  account: id,
  name,
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
})
const wang = user('u1', '王磊')
const li = user('u2', '李建国')

const group: GroupDto = {
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
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: false },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
}

const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: 'cc',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  machineId: 'm1',
  machineName: 'mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: '2.1.4',
  agentMinVersion: '2.0.0',
  groupCount: 1,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  model: 'sonnet',
  effort: null,
  catalog: CATALOG,
}

const state = (o: Partial<GroupBotStateDto> = {}): GroupBotStateDto => ({
  botId: 'b1',
  workspace: 'managed',
  state: 'ready',
  path: null,
  git: null,
  error: null,
  reason: null,
  tier: null,
  model: null,
  effort: null,
  context: null,
  ...o,
})

const chip = () => screen.getByRole('button', { name: 'cc 的模型与推理强度' })
const ready = () => waitFor(() => expect(chip().hasAttribute('disabled')).toBe(false))
const LIVE = { 'GET /bots/b1/catalog': { catalog: CATALOG } }
const pick = (name: string) => fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))
const type = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })

beforeEach(() => {
  useWorkspace.setState({ bots: [bot], botStates: { g1: { b1: state() } } })
  useSession.setState({ user: wang, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

describe('run config chips', () => {
  it('show the defaults of each mentioned bot and send a one-shot pick', async () => {
    const calls = mockApi({ ...LIVE, 'POST /groups/g1/messages': { id: 'm1' } as MessageDto })
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.queryByRole('button', { name: 'cc 的模型与推理强度' })).toBeNull()
    type('@cc 构建')
    await ready()
    expect(chip().textContent).toContain('Sonnet · 中')
    fireEvent.click(chip())
    pick('Opus')
    expect(chip().textContent).toContain('Opus · 高')
    expect(within(chip()).getByText('仅本条')).toBeTruthy()
    fireEvent.click(chip())
    pick('最高')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      runOptions: { b1: { model: 'opus', effort: 'max' } },
    })
    type('@cc 再来')
    expect(chip().textContent).toContain('Sonnet · 中')
  })

  it('follow the group default and can save a pick as it', async () => {
    useWorkspace.setState({ botStates: { g1: { b1: state({ model: 'opus', effort: 'low' }) } } })
    const calls = mockApi({ ...LIVE, 'PUT /groups/g1/bots/b1/config': undefined })
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('@cc 构建')
    await ready()
    expect(chip().textContent).toContain('Opus · 低')
    fireEvent.click(chip())
    pick('高')
    fireEvent.click(chip())
    fireEvent.click(screen.getByRole('menuitem', { name: '设为本群默认' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ model: 'opus', effort: 'high' })
    expect(within(chip()).queryByText('仅本条')).toBeNull()
  })

  it("offer the models of the bot's next session, its third-party provider's rather than the reported ones", async () => {
    const kimi: AgentCatalog = {
      current: 'kimi-for-coding',
      efforts: [],
      effort: null,
      models: [
        { value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null },
        { value: 'kimi-k2', name: 'kimi-k2', efforts: [], effort: null },
      ],
    }
    useWorkspace.setState({ bots: [{ ...bot, model: null }] })
    const calls = mockApi({ 'GET /bots/b1/catalog': { catalog: kimi } })
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('@cc 构建')
    expect(chip().getAttribute('title')).toBe('正在读取可选模型…')
    await ready()
    expect(chip().textContent).toContain('kimi-for-coding')
    fireEvent.click(chip())
    const names = screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)
    expect(names).toEqual(['默认（kimi-for-coding）', 'kimi-for-coding', 'kimi-k2'])
    expect(calls.map((c) => c.path)).toEqual(['/bots/b1/catalog'])
  })

  it('are disabled with the reason when the catalog cannot be read', async () => {
    mockApi({ 'GET /bots/b1/catalog': apiError(409, 'conflict', '机器未响应，请稍后重试') })
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('@cc 构建')
    await waitFor(() => expect(chip().getAttribute('title')).toBe('机器未响应，请稍后重试'))
    expect(chip().hasAttribute('disabled')).toBe(true)
  })

  it('are read-only for members who are neither the bot owner nor a group admin', () => {
    useSession.setState({ user: li })
    mockApi({})
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('@cc 构建')
    expect(chip().hasAttribute('disabled')).toBe(true)
    expect(chip().getAttribute('title')).toBe('只有 Bot 主人或群管理员可以切换')
  })

  it('target the only bot of a dm without an @', () => {
    mockApi(LIVE)
    render(<MessageComposer group={{ ...group, kind: 'dm' }} onSent={() => {}} />)
    expect(chip().textContent).toContain('Sonnet · 中')
    type('帮我看下')
    expect(chip()).toBeTruthy()
    expect(screen.queryByText(/未 @ 的消息不会触发 Bot/)).toBeNull()
    type('/stop')
    expect(screen.queryByRole('button', { name: 'cc 的模型与推理强度' })).toBeNull()
    expect(screen.queryByText(/未 @ 的消息不会触发 Bot/)).toBeNull()
  })

  it('list the agent commands of the only bot of a dm without an @', async () => {
    const calls = mockApi({ 'GET /groups/g1/candidates/commands': { system: [], agent: [] } })
    render(<MessageComposer group={{ ...group, kind: 'dm' }} onSent={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/', selectionStart: 1 } })
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/groups/g1/candidates/commands?botId=b1'))
  })
})
