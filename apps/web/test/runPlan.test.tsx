import type { PlanItem, ProgressCard, RunDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RunPlan, RunTodos } from '../src/features/chat/RunPlan'

const item = (content: string, status: PlanItem['status'] = 'pending'): PlanItem => ({ content, status })
const items = () => screen.queryAllByTestId('plan-item').map((e) => [e.textContent, e.dataset.status])
const head = () => screen.getByRole('button', { name: /计划/ })

describe('RunPlan', () => {
  it('lists a short plan whole while the run goes on, spinning on the entry in progress', () => {
    render(<RunPlan plan={[item('读代码', 'completed'), item('写测试', 'in_progress'), item('提交')]} live />)

    expect(head().textContent).toContain('1/3')
    expect(head().getAttribute('aria-expanded')).toBe('true')
    expect(items()).toEqual([
      ['读代码', 'completed'],
      ['写测试', 'in_progress'],
      ['提交', 'pending'],
    ])
    expect(document.querySelector('.run-plan__spin')).not.toBeNull()
  })

  it('folds a long plan: done entries in a line, then the active one and the next two, the rest counted', () => {
    const plan = [
      item('一', 'completed'),
      item('二', 'completed'),
      item('三', 'in_progress'),
      item('四'),
      item('五'),
      item('六'),
      item('七'),
    ]
    render(<RunPlan plan={plan} live />)

    expect(items().map(([c]) => c)).toEqual(['三', '四', '五'])
    expect(screen.getByRole('button', { name: '已完成 2 项' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '还有 2 项' }))
    expect(items()).toHaveLength(7)
  })

  it('opens on demand once the run ended, unfinished entries as they were and nothing spinning', () => {
    render(<RunPlan plan={[item('读代码', 'completed'), item('写测试', 'in_progress')]} live={false} />)

    expect(head().getAttribute('aria-expanded')).toBe('false')
    expect(items()).toEqual([])
    fireEvent.click(head())
    expect(items()).toEqual([
      ['读代码', 'completed'],
      ['写测试', 'in_progress'],
    ])
    expect(document.querySelector('.run-plan__spin')).toBeNull()
  })

  it('is always open atop the run tab', () => {
    render(<RunPlan plan={[item('读代码')]} live={false} panel />)

    expect(screen.queryByRole('button', { name: /计划/ })).toBeNull()
    expect(items()).toEqual([['读代码', 'pending']])
  })
})

describe('RunTodos', () => {
  const card: ProgressCard = {
    id: 'p1',
    botId: 'b1',
    runId: 'r1',
    title: '部署到 test',
    stages: [{ name: '构建', status: 'running' }],
    percent: null,
    detail: null,
    link: null,
    status: 'running',
    updatedAt: '2026-11-17T02:00:00Z',
  }
  const run = { id: 'r1', botId: 'b1', plan: [item('读代码', 'in_progress')] } as RunDto

  it('puts the progress card first and folds the plan behind it to one line', () => {
    render(<RunTodos run={run} live progress={[card]} />)

    const blocks = [...document.querySelectorAll('[data-testid="run-progress"], [data-testid="run-plan"]')]
    expect(blocks.map((b) => b.getAttribute('data-testid'))).toEqual(['run-progress', 'run-plan'])
    expect(head().getAttribute('aria-expanded')).toBe('false')
    expect(items()).toEqual([])
  })

  it('shows the plan open without a progress card, and nothing without a plan', () => {
    const { rerender } = render(<RunTodos run={run} live />)
    expect(items()).toEqual([['读代码', 'in_progress']])
    rerender(<RunTodos run={{ ...run, plan: undefined }} live />)
    expect(screen.queryByTestId('run-plan')).toBeNull()
  })
})
