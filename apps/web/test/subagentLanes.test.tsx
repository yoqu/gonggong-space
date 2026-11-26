import type { RunDetailDto, RunEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERSONAS } from '../src/features/bots/personas'
import { ActivityDock, chipLimit } from '../src/features/runs/ActivityDock'
import { ProcessView } from '../src/features/runs/ProcessView'
import { processSteps } from '../src/features/runs/steps'
import { subagentFaces } from '../src/features/runs/subagents'

type Ev = RunDetailDto['events']
const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 2, 0, s)).toISOString()
const sub = (
  id: number,
  agentId: string,
  state: 'running' | 'completed' | 'failed',
  extra = {},
): Ev[number] => ({
  id,
  at: at(id),
  event: { kind: 'subagent', agentId, name: `Agent ${agentId}`, task: `任务 ${agentId}`, state, ...extra },
})
const tool = (id: number, agentId: string, title: string): Ev[number] => ({
  id,
  at: at(id),
  event: {
    kind: 'tool',
    agentId,
    toolCallId: `c${id}`,
    toolKind: 'read',
    title,
    status: 'completed',
  } as RunEvent,
})
const many = (n: number, state: 'running' | 'completed' = 'running') =>
  Array.from({ length: n }, (_, i) => sub(i + 1, `agent-${i}`, state))

afterEach(() => vi.useRealTimers())

describe('subagent faces', () => {
  it('gives each subagent of a run its own persona, the same on every rebuild', () => {
    const steps = processSteps([...many(12), sub(13, 'nested', 'running', { parentId: 'agent-0' })], [], true)
    const faces = subagentFaces(steps)
    expect(faces.size).toBe(13)
    const first12 = [...faces.values()].slice(0, 12).map((f) => f.role)
    expect(new Set(first12).size).toBe(12)
    for (const f of faces.values()) expect(PERSONAS.map((p) => `role-${p.key}`)).toContain(f.role)
    expect([...subagentFaces(processSteps(many(12), [], false)).values()].map((f) => f.role)).toEqual(first12)
  })

  it('carries the persona colour for the lane', () => {
    const [face] = subagentFaces(processSteps(many(1), [], true)).values()
    const p = PERSONAS.find((x) => `role-${x.key}` === face!.role)!
    expect(face!.from).toBe(p.from)
  })
})

describe('subagent lane', () => {
  const lane = () => document.querySelector('[data-family="subagent"]') as HTMLElement
  const nested = () => lane().querySelector(':scope > ol')
  const view = (events: Ev, live = true) => (
    <ProcessView
      steps={processSteps(events, [], live)}
      root={null}
      live={live}
      startedAt={null}
      workedMs={null}
    />
  )

  it('shows the persona face, open while it works and folding itself shortly after it finishes', () => {
    vi.useFakeTimers()
    const running = [sub(1, 'a', 'running'), tool(2, 'a', '读 README')]
    const { rerender } = render(view(running))
    expect(lane().querySelector('.act-face img')).not.toBeNull()
    expect(nested()).not.toBeNull()
    rerender(view([...running, sub(3, 'a', 'completed')]))
    expect(nested()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(nested()).toBeNull()
  })

  it('stays open after a failure, and after a user unfold', () => {
    vi.useFakeTimers()
    const running = [sub(1, 'a', 'running'), tool(2, 'a', '读 README')]
    const { rerender } = render(view(running))
    rerender(view([...running, sub(3, 'a', 'failed')]))
    act(() => vi.advanceTimersByTime(1000))
    expect(nested()).not.toBeNull()
    expect(lane().getAttribute('data-state')).toBe('failed')
  })

  it('does not fold a lane the user opened by hand', () => {
    vi.useFakeTimers()
    const running = [sub(1, 'a', 'running'), tool(2, 'a', '读 README')]
    const { rerender } = render(view(running))
    const head = within(lane()).getAllByRole('button')[0]!
    fireEvent.click(head)
    fireEvent.click(head)
    rerender(view([...running, sub(3, 'a', 'completed')]))
    act(() => vi.advanceTimersByTime(1000))
    expect(nested()).not.toBeNull()
  })

  it('starts folded when the run is looked back at', () => {
    render(view([sub(1, 'a', 'completed'), tool(2, 'a', '读 README')], false))
    expect(nested()).toBeNull()
  })
})

describe('subagent dock', () => {
  it('shows at most 3 chips (2 when narrow), the rest behind +N', () => {
    expect(chipLimit(false)).toBe(3)
    expect(chipLimit(true)).toBe(2)
    render(<ActivityDock steps={processSteps(many(6), [], true)} />)
    const bar = screen.getByTestId('activity-dock')
    expect(within(bar).getAllByTestId('dock-chip')).toHaveLength(3)
    const more = within(bar).getByRole('button', { name: '+3' })
    expect(within(bar).getByText('子 Agent 6 个运行中')).toBeTruthy()
    fireEvent.click(more)
    const list = screen.getByRole('list', { name: '后台运行' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(within(list).getByText('任务 agent-5')).toBeTruthy()
  })

  it("names each chip's current action and locates its lane", () => {
    const onLocate = vi.fn()
    const steps = processSteps([sub(1, 'a', 'running'), tool(2, 'a', '读 README')], [], true)
    render(<ActivityDock steps={steps} onLocate={onLocate} />)
    const chip = screen.getByTestId('dock-chip')
    expect(within(chip).getByText('Agent a')).toBeTruthy()
    expect(within(chip).getByText(/读 README/)).toBeTruthy()
    fireEvent.click(chip)
    expect(onLocate).toHaveBeenCalledWith(steps[0]!.key)
  })

  it('marks a finished chip, lets it go, then sums up and hides', () => {
    vi.useFakeTimers()
    const { rerender, container } = render(<ActivityDock steps={processSteps(many(2), [], true)} />)
    rerender(<ActivityDock steps={processSteps([...many(2), sub(3, 'agent-0', 'completed')], [], true)} />)
    expect(within(screen.getAllByTestId('dock-chip')[0]!).getByText('完成')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getAllByTestId('dock-chip')).toHaveLength(1)
    rerender(
      <ActivityDock
        steps={processSteps(
          [...many(2), sub(3, 'agent-0', 'completed'), sub(4, 'agent-1', 'failed')],
          [],
          true,
        )}
      />,
    )
    expect(within(screen.getByTestId('dock-chip')).getByText('失败')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByText('已全部结束：1 个完成，1 个失败')).toBeTruthy()
    act(() => vi.advanceTimersByTime(3000))
    expect(container.innerHTML).toBe('')
  })
})
