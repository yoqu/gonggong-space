import type { ProgressCard, ProgressStageStatus } from '@gonggong/protocol'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunProgress } from '../src/features/chat/ProgressCard'

const card = (statuses: ProgressStageStatus[], status: ProgressCard['status'] = 'running'): ProgressCard => ({
  id: 'p1',
  botId: 'b1',
  runId: 'r1',
  title: '部署',
  stages: statuses.map((s, i) => ({ name: `第 ${i + 1} 步`, status: s })),
  percent: null,
  detail: null,
  link: null,
  status,
  updatedAt: '2026-11-10T00:00:00.000Z',
})

const walker = () => screen.getByTestId('progress-walker')
const reduced = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q }))

describe('共字君 walking the stages of a run progress card', () => {
  beforeEach(() => {
    reduced(false)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stands on the running stage in place of its spinner', () => {
    render(<RunProgress card={card(['done', 'running', 'pending'])} walker />)
    expect(walker().dataset.stage).toBe('1')
    expect(walker().dataset.move).toBeUndefined()
    const stages = screen.getAllByTestId('progress-stage')
    expect(stages.map((s) => s.dataset.walker)).toEqual([undefined, 'true', undefined])
  })

  it('hops when a stage is done, then walks to the next one', () => {
    const { rerender } = render(<RunProgress card={card(['done', 'running', 'pending'])} walker />)
    rerender(<RunProgress card={card(['done', 'done', 'running'])} walker />)
    expect([walker().dataset.move, walker().dataset.stage]).toEqual(['hop', '1'])
    // It stands on the stage it finished until it leaves; its check pops out then.
    expect(screen.getAllByTestId('progress-stage').map((s) => s.dataset.walker)).toEqual([
      undefined,
      'true',
      undefined,
    ])
    act(() => vi.advanceTimersByTime(650))
    expect([walker().dataset.move, walker().dataset.stage]).toEqual(['walk', '2'])
    act(() => vi.advanceTimersByTime(600))
    expect([walker().dataset.move, walker().dataset.stage]).toEqual([undefined, '2'])
  })

  it('fidgets now and then while it waits on a stage, never under reduced motion', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<RunProgress card={card(['running', 'pending'])} walker />)
    act(() => vi.advanceTimersByTime(3999))
    expect(walker().dataset.move).toBeUndefined()
    act(() => vi.advanceTimersByTime(1))
    expect(walker().dataset.move).toBe('peek')
    act(() => vi.advanceTimersByTime(900))
    expect(walker().dataset.move).toBeUndefined()
    act(() => vi.advanceTimersByTime(4000))
    expect(walker().dataset.move).toBe('peek')
  })

  it('keeps still under reduced motion', () => {
    reduced(true)
    render(<RunProgress card={card(['running', 'pending'])} walker />)
    act(() => vi.advanceTimersByTime(10_000))
    expect(walker().dataset.move).toBeUndefined()
  })

  it('appears at the new stage at once under reduced motion', () => {
    reduced(true)
    const { rerender } = render(<RunProgress card={card(['running', 'pending'])} walker />)
    rerender(<RunProgress card={card(['done', 'running'])} walker />)
    expect([walker().dataset.move, walker().dataset.stage]).toEqual([undefined, '1'])
  })

  it('is not there unless asked for on a running card', () => {
    const { rerender } = render(<RunProgress card={card(['done', 'running'])} />)
    expect(screen.queryByTestId('progress-walker')).toBeNull()
    rerender(<RunProgress card={card(['done', 'done'], 'done')} walker />)
    expect(screen.queryByTestId('progress-walker')).toBeNull()
  })
})
