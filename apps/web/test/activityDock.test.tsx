import type { RunDetailDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActivityDock } from '../src/features/runs/ActivityDock'
import { processSteps, runningWork } from '../src/features/runs/steps'

const at = '2026-09-23T02:21:00.000Z'
const events: RunDetailDto['events'] = [
  {
    id: 1,
    at,
    event: { kind: 'subagent', agentId: 'a1', name: 'Explore', task: '找调用方', state: 'running' },
  },
  {
    id: 2,
    at,
    event: { kind: 'subagent', agentId: 'a2', parentId: 'a1', name: 'Grep', task: '搜索', state: 'running' },
  },
  {
    id: 3,
    at,
    event: {
      kind: 'task',
      taskId: 'bg1',
      name: 'pnpm dev',
      taskType: 'shell',
      state: 'running',
      canStop: true,
    },
  },
  {
    id: 4,
    at,
    event: { kind: 'task', taskId: 'bg2', name: 'pnpm build', taskType: 'shell', state: 'completed' },
  },
  { id: 5, at, event: { kind: 'subagent', agentId: 'a3', name: 'Plan', task: '规划', state: 'failed' } },
  {
    id: 6,
    at,
    event: { kind: 'subagent', agentId: 'a1', name: 'Explore', task: '找调用方', state: 'running' },
  },
]

describe('running work', () => {
  it('collects running subagents (nested too) and background tasks, even after the run ended', () => {
    const work = runningWork(processSteps(events, [], false))
    expect(work.map((s) => [s.kind, s.title])).toEqual([
      ['subagent', 'Explore'],
      ['subagent', 'Grep'],
      ['task', 'pnpm dev'],
    ])
  })
})

describe('activity dock', () => {
  it('stays hidden while nothing runs in the background', () => {
    const { container } = render(<ActivityDock steps={processSteps(events.slice(3, 5), [], true)} />)
    expect(container.innerHTML).toBe('')
  })

  it('counts running work, lists it on demand, stops a task and locates a row', () => {
    const onStopTask = vi.fn(() => Promise.resolve())
    const onLocate = vi.fn()
    const steps = processSteps(events, [], true)
    render(<ActivityDock steps={steps} onStopTask={onStopTask} onLocate={onLocate} />)
    const head = screen.getByRole('button', { name: /子 agent 2 个运行中.*后台任务 1 个运行中/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head)
    const list = screen.getByRole('list', { name: '后台运行' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(within(list).getByRole('button', { name: /Grep/ }))
    expect(onLocate).toHaveBeenCalledWith(runningWork(steps)[1]!.key)
    fireEvent.click(within(list).getByRole('button', { name: '停止后台任务 pnpm dev' }))
    expect(onStopTask).toHaveBeenCalledWith('bg1')
  })
})
