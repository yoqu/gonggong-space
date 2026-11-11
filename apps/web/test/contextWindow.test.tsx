import type { RunDetailDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextWindow, lastContext } from '../src/features/runs/ContextWindow'

const at = '2026-11-11T02:21:00.000Z'
const context = { used: 105_000, size: 272_000 }
const breakdown = {
  tools: [
    { name: 'Bash', kind: 'execute', count: 11, tokens: 49_800 },
    { kind: 'read', count: 2, tokens: 3_000 },
  ],
  turns: [35_600, 1_200],
  cache: { read: 104_000, total: 104_897 },
}

describe('上下文窗口', () => {
  it('takes the last reported occupancy and the breakdown sent with it', () => {
    const events: RunDetailDto['events'] = [
      { id: 1, at, event: { kind: 'usage', usage: {}, context: { used: 9, size: 10 } } },
      { id: 2, at, event: { kind: 'usage', usage: {}, context, breakdown } },
      { id: 3, at, event: { kind: 'usage', usage: { costUsd: 1 } } },
    ]
    expect(lastContext(events)).toEqual({ context, breakdown })
    expect(lastContext(events.slice(0, 1))).toEqual({ context: { used: 9, size: 10 }, breakdown: null })
    expect(lastContext([])).toBeNull()
  })

  it('shows the occupancy, cache hits and the estimated items, system as the rest', () => {
    render(<ContextWindow context={context} breakdown={breakdown} />)
    expect(screen.getByText('健康')).toBeTruthy()
    expect(screen.getByText('已用 39% · 剩余 167k')).toBeTruthy()
    expect(screen.getByText('99%')).toBeTruthy()
    expect(screen.getByText('104k 来自缓存 · 897 新增')).toBeTruthy()
    const list = screen.getAllByRole('listitem').filter((li) => li.closest('.ctxw__list'))
    expect(list.map((li) => li.querySelector('.ctxw__name')?.textContent)).toEqual([
      'Bash',
      '第 1 轮',
      '系统提示词与工具定义',
      '读取文件',
      '第 2 轮',
    ])
    expect(within(list[0] as HTMLElement).getByText('×11')).toBeTruthy()
    expect(within(list[0] as HTMLElement).getByText('执行命令')).toBeTruthy()
    // 105000 − 49800 − 3000 − 35600 − 1200
    expect(within(list[2] as HTMLElement).getByText('15k')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '会话内容' }))
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('.ctxw__list'))).toHaveLength(2)
  })

  it('says what is unknown: earlier parts, and items before the run ends', () => {
    const { unmount } = render(
      <ContextWindow context={context} breakdown={{ ...breakdown, partial: true }} />,
    )
    expect(screen.getAllByText('系统与早先内容').length).toBeGreaterThan(0)
    unmount()
    render(<ContextWindow context={context} breakdown={null} />)
    expect(screen.getByText('分项在本轮结束后统计。')).toBeTruthy()
    expect(screen.queryByText('提示词缓存')).toBeNull()
  })
})
