import type { RunDetailDto, RunDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunTab } from '../src/features/workbench/tabs/RunTab'

vi.mock('../src/lib/realtime', () => ({
  realtime: { subscribe: () => () => {}, onReconnect: () => () => {} },
}))

const local = (h: number, m: number, s: number) => new Date(2026, 9, 18, h, m, s).toISOString()
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'completed',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: local(10, 0, 0),
  startedAt: local(10, 0, 1),
  endedAt: local(10, 3, 20),
  lastActivityAt: local(10, 3, 20),
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  questions: [],
  approvals: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})
const detail = (r: RunDto, events: RunDetailDto['events'] = []): RunDetailDto => ({
  run: r,
  patch: null,
  purged: false,
  settings: null,
  patchRepos: [],
  sessionId: null,
  retentionDays: 30,
  events,
})

function serve(d: RunDetailDto) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = input.replace(/^\/api/, '').split('?')[0]
      if (path === '/runs/r1') return new Response(JSON.stringify(d))
      if (path === '/runs/r1/session') return new Response(JSON.stringify({ rounds: [] }))
      return new Response(JSON.stringify({ scope: 'turn', patch: null, base: null, branch: null, repos: [] }))
    }),
  )
}
afterEach(() => vi.unstubAllGlobals())

const props = {
  tab: { kind: 'run' as const, runId: 'r1', view: 'process' as const, file: null },
  tabKey: 'run:r1',
  active: true,
}

describe('run tab detail', () => {
  it('shows when the run started and ended', async () => {
    serve(detail(run()))
    render(<RunTab {...props} />)
    const span = await screen.findByTitle('开始 – 结束')
    expect(span.textContent).toBe('10:00:01 – 10:03:20')
  })

  it('lists the secrets injected into the run with their source, behind the info button', async () => {
    serve(
      detail(
        run({
          secrets: [
            { name: 'FEISHU_DEVOPS_TOKEN', source: 'team' },
            { name: 'GITHUB_TOKEN', source: 'personal' },
          ],
        }),
      ),
    )
    render(<RunTab {...props} />)
    await screen.findByTitle('开始 – 结束')
    expect(screen.queryByText('本次注入的密钥')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '机器与会话' }))
    const row = screen.getByText('本次注入的密钥').closest('.ui-group__row') as HTMLElement
    expect(row.textContent).toContain('FEISHU_DEVOPS_TOKEN（团队）、GITHUB_TOKEN（个人）')
  })

  it('shows a running run as started, still going', async () => {
    serve(detail(run({ status: 'running', endedAt: null })))
    render(<RunTab {...props} />)
    expect((await screen.findByTitle('开始 – 结束')).textContent).toBe('10:00:01 – 进行中')
  })

  it('shows why an agent failed, in full, with what to do', async () => {
    const error = [
      'API Error: 529 overloaded',
      ...Array.from({ length: 8 }, (_, i) => `  at line ${i}`),
    ].join('\n')
    serve(
      detail(
        run({
          status: 'interrupted',
          step: `agent 异常：${error}`,
          stepI18n: { key: 'agent 异常：{error}', params: { error } },
        }),
      ),
    )
    render(<RunTab {...props} />)
    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText('运行失败：agent 异常')).toBeTruthy()
    expect(within(banner).getByText(/API Error: 529 overloaded/)).toBeTruthy()
    expect(within(banner).queryByText(/at line 7/)).toBeNull()
    fireEvent.click(within(banner).getByRole('button', { name: '展开全部' }))
    expect(within(banner).getByText(/at line 7/)).toBeTruthy()
    expect(within(banner).getByRole('button', { name: '复制错误信息' })).toBeTruthy()
    expect(within(banner).getByText(/重新 @ Bot/)).toBeTruthy()
  })

  it('tells a stop, an expiry and a wait apart', async () => {
    serve(detail(run({ status: 'interrupted', step: '张三 执行了 /stop', stoppedBy: 'u2' })))
    const { unmount } = render(<RunTab {...props} />)
    const stopped = (await screen.findByText('运行已停止')).closest('[role="status"]') as HTMLElement
    expect(within(stopped).getByText('张三 执行了 /stop')).toBeTruthy()
    unmount()

    serve(detail(run({ status: 'expired', step: 'Bot 离线超过 30 分钟，已作废并通知 张三' })))
    const second = render(<RunTab {...props} />)
    const expired = await screen.findByRole('alert')
    expect(within(expired).getByText('运行已作废')).toBeTruthy()
    expect(within(expired).getByText(/机器/)).toBeTruthy()
    second.unmount()

    serve(detail(run({ status: 'offline_wait', step: 'Bot 离线，等待上线', startedAt: null, endedAt: null })))
    render(<RunTab {...props} />)
    const waiting = (await screen.findByText('等待 Bot 上线')).closest('[role="status"]') as HTMLElement
    expect(within(waiting).getByText(/超过 30 分钟/)).toBeTruthy()
  })

  it('opens failed calls and the segments holding them', async () => {
    const at = local(10, 0, 2)
    const tool = (
      id: number,
      toolCallId: string,
      cmd: string,
      status: 'completed' | 'failed',
      out: string,
    ) => ({
      id,
      at,
      event: {
        kind: 'tool' as const,
        toolCallId,
        title: cmd,
        toolKind: 'execute' as const,
        status,
        detail: `$ ${cmd}\n${out}`,
      },
    })
    serve(
      detail(run({ status: 'running', endedAt: null }), [
        tool(1, 't1', 'make build', 'completed', 'built'),
        tool(2, 't2', 'make test', 'failed', 'boom: 3 failed'),
      ]),
    )
    render(<RunTab {...props} />)
    expect(await screen.findByText(/boom: 3 failed/)).toBeTruthy()
    expect(screen.queryByText(/^built$/)).toBeNull()
  })
})
