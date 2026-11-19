import type {
  AgentCatalog,
  BotDto,
  GroupDto,
  GroupWebhooksDto,
  MessageDto,
  UserDto,
  WebhookDto,
  WebhookTokenDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { UserMessage } from '../src/features/chat/TimelineItems'
import { resetWebhooks } from '../src/features/webhooks/store'
import { WebhooksView } from '../src/features/webhooks/WebhooksView'
import { mockApi } from './mockApi'

const level = (value: string) => ({ value, name: value })
const CATALOG: AgentCatalog = {
  current: null,
  efforts: ['low', 'medium', 'high'].map(level),
  effort: 'medium',
  models: [
    { value: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'].map(level), effort: 'medium' },
    { value: 'opus', name: 'Opus', efforts: ['low', 'medium', 'high', 'max'].map(level), effort: 'high' },
  ],
}
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
  machineName: 'mac',
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
  groupCount: 1,
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

const group = (): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  kind: 'group',
  name: '共工空间迭代',
  avatar: null,
  notice: '',
  noticeHidden: false,
  visibility: 'private',
  sectionId: null,
  mode: 'partition',
  repo: null,
  extraRepos: [],
  protectBase: false,
  adminOnlyInvite: false,
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  foldRuns: false,
  notifyLevel: 'all',
  liveRunIds: [],
  liveRuns: [],
})

const webhook = (o: Partial<WebhookDto> = {}): WebhookDto => ({
  id: 'w1',
  groupId: 'g1',
  name: 'Jenkins 部署',
  botIds: ['b1', 'b2'],
  runOptions: {},
  prompt: null,
  enabled: true,
  hasToken: true,
  lastCalledAt: null,
  lastRunId: null,
  lastStatus: null,
  ownerId: 'u1',
  ownerName: '王磊',
  createdByBotId: null,
  canManage: true,
  createdAt: '2026-11-19T06:00:00Z',
  ...o,
})

beforeEach(() => {
  resetWebhooks()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({
    groups: [group()],
    bots: [bot({ id: 'b1', name: 'Claude', catalog: CATALOG }), bot({ id: 'b2', name: 'Codex' })],
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('WebhooksView', () => {
  it('creates a webhook with per-bot model selection and reveals the one-time URL dialog', async () => {
    const created = webhook({ botIds: ['b1'], runOptions: { b1: { model: 'opus' } } })
    const tokenRes: WebhookTokenDto = {
      webhook: created,
      token: 'gwh_test_secret_token',
      path: '/api/hooks/gwh_test_secret_token',
    }
    const calls = mockApi({
      'GET /groups/g1/webhooks': { webhooks: [] } satisfies GroupWebhooksDto,
      'GET /bots/b1/catalog': { catalog: CATALOG },
      'POST /groups/g1/webhooks': tokenRes,
    })

    render(<WebhooksView group={group()} readOnly={false} />)
    await screen.findByText('还没有 Webhook')

    fireEvent.click(screen.getByRole('button', { name: '新建 Webhook' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Jenkins 部署' } })
    fireEvent.click(screen.getByRole('button', { name: '添加 Claude' }))
    const chip = await screen.findByRole('button', { name: 'Claude 的模型与推理强度' })
    await vi.waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(chip)
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Opus' }))
    expect(within(chip).getByText('本 Webhook')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    const urlEl = await screen.findByTestId('webhook-url')
    expect(urlEl.textContent).toContain('/api/hooks/gwh_test_secret_token')
    expect(screen.getByText(/仅显示这一次/)).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'Jenkins 部署',
      botIds: ['b1'],
      runOptions: { b1: { model: 'opus' } },
    })
  })

  it('lists webhooks with configured model, rotates tokens and respects readOnly for plain members', async () => {
    const botCreated = webhook({
      id: 'w1',
      name: 'CI 告警',
      botIds: ['b1'],
      runOptions: { b1: { model: 'opus', effort: 'high' } },
      hasToken: false,
      createdByBotId: 'b1',
    })
    const rotated: WebhookTokenDto = {
      webhook: { ...botCreated, hasToken: true },
      token: 'gwh_new_token',
      path: '/api/hooks/gwh_new_token',
    }
    mockApi({
      'GET /groups/g1/webhooks': { webhooks: [botCreated] } satisfies GroupWebhooksDto,
      'POST /webhooks/w1/rotate': rotated,
    })

    const { rerender } = render(<WebhooksView group={group()} readOnly={false} />)
    await screen.findByText('CI 告警')
    expect(screen.getByText(/Claude（opus · 高）/)).toBeTruthy()
    expect(screen.getByText('待生成令牌')).toBeTruthy()
    expect(screen.getByText('Bot 创建')).toBeTruthy()

    // Generating first token skips confirm and shows URL directly
    fireEvent.click(screen.getByRole('button', { name: '生成令牌' }))
    expect((await screen.findByTestId('webhook-url')).textContent).toContain('/api/hooks/gwh_new_token')
    fireEvent.click(screen.getByRole('button', { name: '我已保存' }))

    // Read-only mode hides New button
    rerender(<WebhooksView group={group()} readOnly />)
    expect(screen.queryByRole('button', { name: '新建 Webhook' })).toBeNull()
  })
})

describe('Webhook message rendering', () => {
  it('shows webhook name and Webhook tag instead of owner', () => {
    const msg: MessageDto = {
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'user',
      authorId: 'u1',
      authorName: 'Jenkins 部署',
      body: '**❌ 构建失败** #42',
      mentions: [],
      userMentions: [],
      runId: null,
      createdAt: '2026-11-19T06:00:00Z',
      attachments: [],
      quote: null,
      reactions: [],
      recalled: false,
      webhook: { id: 'w1', name: 'Jenkins 部署' },
    }
    render(
      <MemoryRouter>
        <UserMessage m={msg} targets={[]} meId="u1" mine />
      </MemoryRouter>,
    )
    expect(screen.getByText('Jenkins 部署')).toBeTruthy()
    expect(screen.getByText('Webhook')).toBeTruthy()
  })
})
