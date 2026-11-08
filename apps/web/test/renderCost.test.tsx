import type { RunDto } from '@gonggong/protocol'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const renders = vi.hoisted(() => ({ token: 0 }))
vi.mock('../src/features/chat/RunGraphics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/chat/RunGraphics')>()
  return {
    ...actual,
    TokenFact: (p: Parameters<typeof actual.TokenFact>[0]) => {
      renders.token++
      return actual.TokenFact(p)
    },
  }
})

const { RunCard } = await import('../src/features/chat/TimelineItems')

const run: RunDto = {
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm0',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '画图',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  parentRunId: null,
  hopMax: 5,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  queuedAt: '2026-09-29T08:00:00Z',
  startedAt: '2026-09-29T08:00:00Z',
  endedAt: null,
  lastActivityAt: '2026-09-29T08:00:00Z',
}

afterEach(() => vi.useRealTimers())

describe('live run clock', () => {
  it('ticks every second without re-rendering the rest of the card', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-29T08:00:05Z'))
    render(
      <MemoryRouter>
        <RunCard run={run} botName="小助手" agent="Claude" trigger="王磊" />
      </MemoryRouter>,
    )
    expect(screen.getByTitle('耗时 00:05')).toBeTruthy()
    const before = renders.token
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByTitle('耗时 00:08')).toBeTruthy()
    expect(renders.token).toBe(before)
  })
})
