import type { ApprovalDto, BotDto, GroupDto, RunDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { BotDialogHost } from '../src/features/bots/BotDialogHost'
import { useBotDialog } from '../src/features/bots/dialogStore'
import { ApprovalBlock } from '../src/features/runs/ApprovalBlock'
import { resetApprovalGuide } from '../src/features/runs/approvalGuide'
import { Toaster, useToasts } from '../src/ui'
import { mockApi } from './mockApi'

const NOW = new Date(2026, 8, 23, 10, 21, 0)

const fullBot = (o: Partial<BotDto> = {}): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'm1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  access: { trusted: 'auto', others: 'ask' },
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 1,
  defaultWorkspace: null,
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  model: null,
  effort: null,
  catalog: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  ...o,
})

const approval = (o: Partial<ApprovalDto> = {}): ApprovalDto => ({
  id: 'a1',
  runId: 'r1',
  title: 'Bash',
  toolKind: 'execute',
  detail: 'go build ./...',
  reason: 'not_allowed',
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
  remember: [],
  rememberSession: [],
  review: null,
  mcp: null,
  status: 'pending',
  voidReason: null,
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  expiresAt: new Date(NOW.getTime() + 90_000).toISOString(),
  createdAt: NOW.toISOString(),
  ...o,
})

const run = (approvals: ApprovalDto[], o: Partial<RunDto> = {}) =>
  ({ id: 'r1', botId: 'b1', status: 'awaiting_approval', step: '', approvals, ...o }) as RunDto

const login = (id: string, name: string) =>
  useSession.setState({
    user: {
      id,
      account: id,
      name,
      role: 'member',
      mustChangePassword: false,
      disabled: false,
      gitProtocol: 'auto',
      email: null,
      avatar: null,
    },
    status: 'ready',
  })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  resetApprovalGuide()
  useBotDialog.setState({ target: null })
  useToasts.setState({ items: [] })
  useSession.setState({ tenancy: undefined as never })
  useWorkspace.setState({ bots: [fullBot()], groups: [], botStates: {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetApprovalGuide()
  useBotDialog.setState({ target: null })
  useToasts.setState({ items: [] })
})

describe('ApprovalBlock permission guide & shortcut', () => {
  it('shows the active mode pill in the header, opens BotDialog access tab, and highlights the governing row', async () => {
    login('u1', '王磊')
    useWorkspace.setState({
      bots: [fullBot({ triggerList: ['u2'] })],
      groups: [{ id: 'g1', name: '开发群', kind: 'group' } as GroupDto],
    })
    mockApi({ 'GET /users': [], 'GET /machines': [] })
    const { rerender } = render(
      <>
        <ApprovalBlock run={run([approval()], { groupId: 'g1', originUserId: 'u1' })} />
        <BotDialogHost />
      </>,
    )
    const pill = screen.getByRole('button', { name: /当前：每次问我/ })
    expect(pill).toBeTruthy()

    // Also exposed at the bottom of the 更多 menu.
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menuitem', { name: '调整权限设置…' })).toBeTruthy()
    fireEvent.click(pill)

    const dialog = await screen.findByRole('dialog', { name: 'Bot 详情' })
    expect(within(dialog).getByRole('tab', { name: '权限' }).getAttribute('aria-selected')).toBe('true')
    expect(dialog.querySelector('[data-focus-row="owner"]')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))

    // Trusted user run shows 信任名单 and highlights trusted row.
    rerender(
      <>
        <ApprovalBlock run={run([approval()], { groupId: 'g1', originUserId: 'u2' })} />
        <BotDialogHost />
      </>,
    )
    const trustedPill = screen.getByRole('button', { name: /信任名单：自动审批/ })
    fireEvent.click(trustedPill)
    const dialog2 = await screen.findByRole('dialog', { name: 'Bot 详情' })
    expect(dialog2.querySelector('[data-focus-row="trusted"]')).toBeTruthy()
    fireEvent.click(within(dialog2).getByRole('button', { name: '关闭' }))

    // Unlisted member run shows 其他成员 and highlights others row.
    rerender(
      <>
        <ApprovalBlock run={run([approval()], { groupId: 'g1', originUserId: 'u3' })} />
        <BotDialogHost />
      </>,
    )
    const othersPill = screen.getByRole('button', { name: /其他成员：需要审批/ })
    fireEvent.click(othersPill)
    const dialog3 = await screen.findByRole('dialog', { name: 'Bot 详情' })
    expect(dialog3.querySelector('[data-focus-row="others"]')).toBeTruthy()
  })

  it('shows group override warning in BotDialog and lets the owner reset to follow global', async () => {
    login('u1', '王磊')
    useWorkspace.setState({
      bots: [fullBot({ aiReview: true })],
      groups: [{ id: 'g1', name: '支付群', kind: 'group' } as GroupDto],
      botStates: {
        g1: {
          b1: {
            botId: 'b1',
            workspace: 'managed',
            state: 'ready',
            path: '/tmp/ws',
            git: null,
            error: null,
            reason: null,
            tier: 'read-only',
            model: null,
            effort: null,
            context: null,
            extraDirs: [],
            repoPaths: {},
          },
        },
      },
    })
    const calls = mockApi({
      'GET /users': [],
      'PUT /groups/g1/bots/b1/tier': undefined,
      'PATCH /me/onboarding': { approvalGuide: 'graduated' },
    })
    render(
      <>
        <ApprovalBlock run={run([approval()], { groupId: 'g1', originUserId: 'u1' })} />
        <BotDialogHost />
        <Toaster />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: /本群：只读/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Bot 详情' })
    expect(within(dialog).getByText(/当前群「支付群」已单独设为「只读」/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '恢复跟随全局' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT' && c.path === '/groups/g1/bots/b1/tier')?.body).toEqual({
        tier: null,
      }),
    )
    await waitFor(() => expect(within(dialog).queryByText(/已单独设为/)).toBeNull())
    expect(screen.getByRole('button', { name: /当前：帮我审批/ })).toBeTruthy()
  })

  it('hides the guide and gear shortcut for non-owners and avoids 完全允许 in demoMode', () => {
    login('u2', '陈晨')
    useWorkspace.setState({ bots: [fullBot()] })
    const { rerender } = render(<ApprovalBlock run={run([approval()], { originUserId: 'u2' })} />)
    expect(screen.queryByRole('button', { name: /当前：|其他成员：/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '去设置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '不再提醒' })).toBeNull()

    login('u1', '王磊')
    useSession.setState({ tenancy: { demoMode: true } as never })
    rerender(<ApprovalBlock run={run([approval()], { originUserId: 'u1' })} />)
    expect(screen.getByRole('button', { name: '去设置' })).toBeTruthy()
    expect(screen.getByText(/帮我审批/)).toBeTruthy()
    expect(screen.queryByText(/完全允许/)).toBeNull()
  })

  it('dismisses on 不再提醒, persists, shows reverse-teaching toast, and flashes the header gear pill', async () => {
    login('u1', '王磊')
    useWorkspace.setState({ bots: [fullBot()] })
    const calls = mockApi({
      'PATCH /me/onboarding': (body: unknown) => ({
        ...(body as object),
        approvalGuideAt: NOW.toISOString(),
      }),
    })
    render(
      <>
        <ApprovalBlock run={run([approval()], { originUserId: 'u1' })} />
        <Toaster />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '不再提醒' }))
    expect(screen.queryByRole('button', { name: '去设置' })).toBeNull()
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/me/onboarding')?.body).toEqual({ approvalGuide: 'dismissed' }),
    )
    expect(await screen.findByText(/已收起提示；随时可点卡片右上角「当前：每次问我」调整权限/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /当前：每次问我/ }).className).toContain(
      'approval__mode--highlight',
    )
  })

  it('auto-graduates and distinguishes immediate vs next-session save feedback when bot permissions are saved', async () => {
    login('u1', '王磊')
    const b = fullBot()
    useWorkspace.setState({ bots: [b] })
    const calls = mockApi({
      'GET /users': [],
      'PATCH /bots/b1': (body: unknown) => ({ ...b, ...(body as object) }),
      'PATCH /me/onboarding': { approvalGuide: 'graduated' },
    })
    render(
      <>
        <ApprovalBlock run={run([approval()], { originUserId: 'u1' })} />
        <BotDialogHost />
        <Toaster />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '去设置' }))
    const dialog = await screen.findByRole('dialog', { name: 'Bot 详情' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '完全允许' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(calls.find((c) => c.path === '/me/onboarding')?.body).toEqual({ approvalGuide: 'graduated' }),
    )
    expect(await screen.findByText(/小王的 Claude 已保存 · 运行中的任务立即生效/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去设置' })).toBeNull()
    expect(screen.getByRole('button', { name: /当前：完全允许/ })).toBeTruthy()

    // Editing a session-level field keeps the next-session copy.
    fireEvent.click(within(dialog).getByRole('tab', { name: '基本信息' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: '系统提示词' }), {
      target: { value: '请用中文回答' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await screen.findByText(/小王的 Claude 已保存 · 下一次新开会话时生效/)).toBeTruthy()
  })

  it('auto-collapses silently after 3 ignored approval decisions and syncs from MeDto onboarding', async () => {
    login('u1', '王磊')
    useWorkspace.setState({ bots: [fullBot()] })
    const calls = mockApi({
      'POST /runs/r1/approvals/a1': approval({ status: 'approved' }),
      'POST /runs/r1/approvals/a2': approval({ id: 'a2', status: 'approved' }),
      'POST /runs/r1/approvals/a3': approval({ id: 'a3', status: 'approved' }),
      'PATCH /me/onboarding': (body: unknown) => body,
    })
    const { rerender, unmount } = render(<ApprovalBlock run={run([approval()], { originUserId: 'u1' })} />)
    expect(screen.getByRole('button', { name: '去设置' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/me/onboarding')?.body).toEqual({ approvalGuideSeen: 1 }),
    )
    rerender(<ApprovalBlock run={run([approval({ id: 'a2' })], { originUserId: 'u1' })} />)
    expect(screen.getByRole('button', { name: '去设置' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/me/onboarding').at(-1)?.body).toEqual({ approvalGuideSeen: 2 }),
    )
    rerender(<ApprovalBlock run={run([approval({ id: 'a3' })], { originUserId: 'u1' })} />)
    expect(screen.getByRole('button', { name: '去设置' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/me/onboarding').at(-1)?.body).toEqual({
        approvalGuide: 'fatigued',
        approvalGuideSeen: 3,
      }),
    )
    rerender(<ApprovalBlock run={run([approval({ id: 'a4' })], { originUserId: 'u1' })} />)
    expect(screen.queryByRole('button', { name: '去设置' })).toBeNull()
    expect(useToasts.getState().items).toHaveLength(0)

    // Cross-device sync: fresh localStorage + tenancy.onboarding.approvalGuide hides tip on frame 0.
    unmount()
    resetApprovalGuide()
    useSession.setState({ tenancy: { onboarding: { approvalGuide: 'graduated' } } as never })
    render(<ApprovalBlock run={run([approval({ id: 'a5' })], { originUserId: 'u1' })} />)
    expect(screen.queryByRole('button', { name: '去设置' })).toBeNull()
  })
})
