import type { BotDto, MachineDto, RunDetailDto, RunDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { RunCard } from '../src/features/chat/TimelineItems'
import { isAuthRunError, runIssue } from '../src/features/runs/issue'
import { RunTab } from '../src/features/workbench/tabs/RunTab'
import { realtime } from '../src/lib/realtime'
import { Toaster } from '../src/ui'
import { mockApi } from './mockApi'

const baseRun = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u-owner',
  hop: 1,
  status: 'interrupted',
  step: '运行出错：无法建立 agent 会话：Authentication required: {"category":"auth"}',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: '2026-10-18T02:00:00.000Z',
  startedAt: '2026-10-18T02:00:01.000Z',
  endedAt: '2026-10-18T02:00:05.000Z',
  lastActivityAt: '2026-10-18T02:00:05.000Z',
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u-owner',
  questions: [],
  approvals: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})

const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小王的 CodeBuddy',
  ownerId: 'u-owner',
  ownerName: '王磊',
  agentKind: 'codebuddy',
  avatar: 'role-gong',
  followAgent: false,
  avatarUrl: null,
  machineId: 'm1',
  machineName: 'win-box',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u-owner',
  agentVersion: '2.186.0',
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
}

const machine: MachineDto = {
  id: 'm1',
  ownerId: 'u-owner',
  name: 'win-box',
  os: 'windows',
  arch: 'x86_64',
  online: true,
  agents: [
    {
      kind: 'codebuddy',
      available: true,
      version: '2.186.0',
      path: 'C:\\Users\\wl\\.gonggong\\tools\\codebuddy.cmd',
      minVersion: null,
      catalog: null,
      latest: '2.187.0',
      managed: true,
      upgradeCommand: null,
      installCommand: null,
      loginState: 'logged_out',
      loginLabel: null,
      loginFlow: 'acp',
    },
  ],
  daemonVersion: '0.4.35',
  features: ['tools', 'providers', 'codebuddy', 'agent_login'],
  lastSeenAt: null,
  hostname: 'win-box',
  system: null,
  boundAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
}

let handlers: Set<(e: WebEvent) => void>
const emit = (e: WebEvent) =>
  act(() => {
    for (const h of handlers) h(e)
  })

beforeEach(() => {
  handlers = new Set()
  vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
    handlers.add(h)
    return () => handlers.delete(h)
  })
  vi.spyOn(realtime, 'onReconnect').mockImplementation(() => () => {})
  useWorkspace.setState({ bots: [bot], machines: [machine], groups: [] })
  useSession.setState({ user: { id: 'u-owner', name: '王磊' } as UserDto, status: 'ready' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('issue.ts auth & agent error matching', () => {
  it('matches both 运行出错：{error} and legacy agent 异常：{error}', () => {
    const modern = runIssue(
      baseRun({
        step: '运行出错：rate limit exceeded',
        stepI18n: { key: '运行出错：{error}', params: { error: 'rate limit exceeded' } },
      }),
    )
    expect(modern?.title).toBe('运行失败：Agent 异常')
    expect(modern?.detail).toBe('rate limit exceeded')

    const legacy = runIssue(
      baseRun({
        step: 'agent 异常：process crashed',
        stepI18n: { key: 'agent 异常：{error}', params: { error: 'process crashed' } },
      }),
    )
    expect(legacy?.title).toBe('运行失败：Agent 异常')
    expect(legacy?.detail).toBe('process crashed')
  })

  it('detects auth errors from errorKind, stepI18n key, and legacy Authentication required text', () => {
    expect(isAuthRunError(baseRun({ step: 'something else', errorKind: 'auth' }))).toBe(true)
    expect(
      isAuthRunError(
        baseRun({
          step: 'other',
          stepI18n: { key: '运行出错：{agent} 尚未登录或登录已过期', params: { agent: 'CodeBuddy' } },
        }),
      ),
    ).toBe(true)
    expect(isAuthRunError(baseRun())).toBe(true)
    expect(isAuthRunError(baseRun({ step: '运行出错：timeout' }))).toBe(false)

    const issue = runIssue(baseRun({ errorKind: 'auth' }), 'CodeBuddy')
    expect(issue).toMatchObject({
      tone: 'error',
      kind: 'auth',
      title: 'CodeBuddy 尚未登录',
      hint: '请先登录官方账号或在供应商中配置 API Key，完成后重新运行。',
    })
  })
})

describe('RunCard & RunTab auth error recovery', () => {
  it('lets the owner log in in-place from RunCard and immediately rerun on success', async () => {
    const calls = mockApi({
      'POST /machines/m1/agents/codebuddy/login': { opId: 'op-1', machineId: 'm1', kind: 'codebuddy' },
      'POST /runs/r1/retry': null,
    })
    render(
      <MemoryRouter>
        <RunCard run={baseRun({ errorKind: 'auth' })} botName={bot.name} agent="CodeBuddy" trigger="王磊" />
        <Toaster />
      </MemoryRouter>,
    )
    const card = screen.getByTestId('run-card')
    expect(card.textContent).toContain('CodeBuddy（WorkBuddy） 尚未登录或登录已过期')
    expect(card.textContent).not.toContain('Authentication required')
    expect(within(card).getByRole('button', { name: '配置 API Key' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: '重新运行' })).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: /去登录 CodeBuddy/ }))
    const dialog = await screen.findByRole('dialog', { name: /登录 CodeBuddy.*官方账号/ })
    fireEvent.click(within(dialog).getByRole('button', { name: '开始登录授权' }))
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/machines/m1/agents/codebuddy/login')).toBe(true),
    )
    emit({ t: 'machine.agentLogin.result', machineId: 'm1', opId: 'op-1', kind: 'codebuddy', ok: true })
    expect(await within(dialog).findByText('登录成功')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))

    const rerunBtn = await within(card).findByRole('button', { name: '立即重新运行' })
    fireEvent.click(rerunBtn)
    await waitFor(() => expect(calls.some((c) => c.path === '/runs/r1/retry')).toBe(true))
  })

  it('shows a muted owner-wait hint to non-owners on RunCard and RunTab IssueBanner', async () => {
    useSession.setState({ user: { id: 'u-other', name: '李明' } as UserDto, status: 'ready' })
    const authRun = baseRun({ errorKind: 'auth' })
    const { unmount } = render(
      <MemoryRouter>
        <RunCard run={authRun} botName={bot.name} agent="CodeBuddy" trigger="李明" />
      </MemoryRouter>,
    )
    const card = screen.getByTestId('run-card')
    expect(card.textContent).toContain('请等待电脑主人 王磊 登录 CodeBuddy（WorkBuddy） 后重试')
    expect(within(card).queryByRole('button', { name: /去登录/ })).toBeNull()
    unmount()

    const detail: RunDetailDto = {
      run: authRun,
      patch: null,
      purged: false,
      settings: null,
      patchRepos: [],
      sessionId: null,
      retentionDays: 30,
      events: [],
    }
    mockApi({
      'GET /runs/r1': detail,
      'GET /runs/r1/session': { rounds: [] },
    })
    render(
      <MemoryRouter>
        <RunTab tab={{ kind: 'run', runId: 'r1', view: 'process', file: null }} tabKey="run:r1" active />
      </MemoryRouter>,
    )
    expect(await screen.findByText('CodeBuddy（WorkBuddy） 尚未登录')).toBeTruthy()
    expect(screen.getByText('请等待电脑主人 王磊 登录 CodeBuddy（WorkBuddy） 后重试')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /去登录/ })).toBeNull()
  })
})
