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
import { mockApi } from './mockApi'

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
})
const wang = user('u1', '王磊')
const li = user('u2', '李建国')

const group: GroupDto = {
  id: 'g1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', isAdmin: false },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
}

const bot: BotDto = {
  id: 'b1',
  name: 'cc',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: null,
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
  approval: 'ask',
  allowlist: [],
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
  tier: null,
  model: null,
  effort: null,
  ...o,
})

const chip = () => screen.getByRole('button', { name: 'cc 的模型与推理强度' })
const pick = (name: string) => fireEvent.click(screen.getByRole('menuitemcheckbox', { name }))
const type = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })

beforeEach(() => {
  useWorkspace.setState({ bots: [bot], botStates: { g1: { b1: state() } } })
  useSession.setState({ user: wang, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

describe('run config chips', () => {
  it('show the defaults of each mentioned bot and send a one-shot pick', async () => {
    const calls = mockApi({ 'POST /groups/g1/messages': { id: 'm1' } as MessageDto })
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.queryByRole('button', { name: 'cc 的模型与推理强度' })).toBeNull()
    type('@cc 构建')
    expect(chip().textContent).toContain('Sonnet · 中')
    fireEvent.click(chip())
    pick('Opus')
    expect(chip().textContent).toContain('Opus · 高')
    expect(within(chip()).getByText('仅本条')).toBeTruthy()
    fireEvent.click(chip())
    pick('最高')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toMatchObject({ runOptions: { b1: { model: 'opus', effort: 'max' } } })
    type('@cc 再来')
    expect(chip().textContent).toContain('Sonnet · 中')
  })

  it('follow the group default and can save a pick as it', async () => {
    useWorkspace.setState({ botStates: { g1: { b1: state({ model: 'opus', effort: 'low' }) } } })
    const calls = mockApi({ 'PUT /groups/g1/bots/b1/config': undefined })
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('@cc 构建')
    expect(chip().textContent).toContain('Opus · 低')
    fireEvent.click(chip())
    pick('高')
    fireEvent.click(chip())
    fireEvent.click(screen.getByRole('menuitem', { name: '设为本群默认' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({ model: 'opus', effort: 'high' })
    expect(within(chip()).queryByText('仅本条')).toBeNull()
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
    mockApi({})
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
