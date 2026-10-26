import type { RunDetailDto, RunDto, RunSessionDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildItems } from '../src/features/runs/activity'
import { buildSteps } from '../src/features/runs/process'
import { RunTab } from '../src/features/workbench/tabs/RunTab'

vi.mock('../src/features/runs/process', async (orig) => {
  const m = await orig<typeof import('../src/features/runs/process')>()
  return { ...m, buildSteps: vi.fn(m.buildSteps) }
})
vi.mock('../src/features/runs/activity', async (orig) => {
  const m = await orig<typeof import('../src/features/runs/activity')>()
  return { ...m, buildItems: vi.fn(m.buildItems) }
})

const at = new Date(Date.now() - 65_000).toISOString()
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: at,
  startedAt: at,
  endedAt: null,
  lastActivityAt: at,
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
const detail = (r: RunDto): RunDetailDto => ({
  run: r,
  patch: null,
  purged: false,
  settings: null,
  patchRepos: [],
  sessionId: null,
  retentionDays: 30,
  events: [
    {
      id: 1,
      at,
      event: {
        kind: 'tool',
        toolCallId: 't1',
        title: 'echo hi',
        toolKind: 'execute',
        status: 'completed',
        detail: '$ echo hi\nhi',
      },
    },
  ],
})
const earlier = run({ id: 'r0', status: 'completed', endedAt: at })
const session: RunSessionDto = { rounds: [{ run: earlier, prompt: '上一轮的问题' }] }

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = input.replace(/^\/api/, '').split('?')[0]
      if (path === '/runs/r1') return new Response(JSON.stringify(detail(run())))
      if (path === '/runs/r0') return new Response(JSON.stringify(detail(earlier)))
      if (path === '/runs/r1/session') return new Response(JSON.stringify(session))
      return new Response(JSON.stringify({ scope: 'turn', patch: null, base: null, branch: null, repos: [] }))
    }),
  )
  // Only the clocks' intervals and time: requests and RTL's waits keep real timeouts.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const props = (active: boolean) => ({
  tab: { kind: 'run' as const, runId: 'r1', view: 'process' as const, file: null },
  tabKey: 'run:r1',
  active,
})

describe('run tab clock', () => {
  it('ticks the elapsed times without rebuilding the process', async () => {
    render(<RunTab {...props(true)} />)
    fireEvent.click(await screen.findByRole('button', { name: '查看上一轮（还有 1 轮）' }))
    expect(await screen.findByText('上一轮的问题')).toBeTruthy()
    expect(await screen.findByText('正在处理')).toBeTruthy()
    const [steps, items] = [vi.mocked(buildSteps).mock.calls.length, vi.mocked(buildItems).mock.calls.length]
    const clock = screen.getByText('正在处理').nextElementSibling?.textContent
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('正在处理').nextElementSibling?.textContent).not.toBe(clock)
    expect(vi.mocked(buildSteps).mock.calls.length).toBe(steps)
    expect(vi.mocked(buildItems).mock.calls.length).toBe(items)
  })

  it('keeps no clock running in a hidden tab', async () => {
    render(<RunTab {...props(false)} />)
    expect(await screen.findByText('正在处理')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
