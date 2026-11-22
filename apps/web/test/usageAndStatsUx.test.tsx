import type {
  ConversationOverviewDto,
  ConversationStatsRowDto,
  UsageDayDto,
  UsageRowDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationStatsPanel } from '../src/features/conversation-stats/ConversationStatsPanel'
import { UsageBars, UsagePanel } from '../src/features/usage/UsagePage'
import { api } from '../src/lib/api'

describe('UsagePanel & ConversationStatsPanel UX', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render a fill bar for 0-token rows and keeps Trend mounted while switching usage dimension', async () => {
    const { container: barsContainer } = render(
      <UsageBars
        rows={[
          { key: 'b1', name: 'Bot A', totalTokens: 1000, runs: 2, unreported: 0 },
          { key: 'b2', name: 'Bot B', totalTokens: 0, runs: 1, unreported: 1 },
        ]}
      />,
    )
    const bars = barsContainer.querySelectorAll('.usage-bar')
    expect(bars[0]?.querySelector('span')).not.toBeNull()
    expect(bars[1]?.querySelector('span')).toBeNull()

    const botRows: UsageRowDto[] = [{ key: 'b1', name: 'Bot A', totalTokens: 1200, runs: 3, unreported: 0 }]
    const daily: UsageDayDto[] = [{ day: '2026-11-20', totalTokens: 1200, runs: 3, unreported: 0 }]
    let resolveUser!: (v: UsageRowDto[]) => void
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/daily')) return Promise.resolve(daily)
      if (path.includes('by=user'))
        return new Promise<UsageRowDto[]>((r) => {
          resolveUser = r
        })
      return Promise.resolve(botRows)
    })

    render(<UsagePanel />)
    await waitFor(() => expect(screen.getByText('每日趋势')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: '按触发人' }))
    // While the new dimension is still loading, Trend and stats should remain mounted without collapsing.
    expect(screen.getByText('每日趋势')).toBeTruthy()
    expect(screen.getByText('token 合计')).toBeTruthy()
    resolveUser([{ key: 'u1', name: '张三', totalTokens: 1200, runs: 3, unreported: 0 }])
    await waitFor(() => expect(screen.getAllByText('张三').length).toBeGreaterThan(0))
  })

  it('shows ops error alert and resets team tab when narrowing to a single team', async () => {
    const overview: ConversationOverviewDto = {
      groups: 1,
      dms: 1,
      current: {
        activeConversations: 2,
        newConversations: 0,
        userMessages: 10,
        botMessages: 8,
        activeUsers: 1,
        runs: 5,
        completedRuns: 5,
        endedRuns: 5,
        avgRunMs: 1000,
      },
      previous: {
        activeConversations: 1,
        newConversations: 0,
        userMessages: 5,
        botMessages: 4,
        activeUsers: 1,
        runs: 2,
        completedRuns: 2,
        endedRuns: 2,
        avgRunMs: 1000,
      },
      daily: [
        {
          day: '2026-11-20',
          userMessages: 10,
          botMessages: 8,
          runs: 5,
          activeUsers: 1,
          activeConversations: 2,
        },
      ],
      statuses: [{ status: 'completed', count: 5 }],
    }
    const rows: ConversationStatsRowDto[] = []
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/overview')) return Promise.resolve(overview)
      if (path.includes('/ops')) return Promise.reject(new Error('运营指标加载失败'))
      return Promise.resolve(rows)
    })

    const { rerender } = render(<ConversationStatsPanel base="/admin/conversation-stats" teamId="" />)
    await waitFor(() => expect(screen.getByText('运营指标加载失败')).toBeTruthy())

    fireEvent.click(screen.getByRole('tab', { name: '按团队' }))
    expect(screen.getByRole('tab', { name: '按团队' }).getAttribute('aria-selected')).toBe('true')

    rerender(<ConversationStatsPanel base="/admin/conversation-stats" teamId="t1" />)
    expect(screen.queryByRole('tab', { name: '按团队' })).toBeNull()

    rerender(<ConversationStatsPanel base="/admin/conversation-stats" teamId="" />)
    expect(screen.getByRole('tab', { name: '按会话' }).getAttribute('aria-selected')).toBe('true')
  })
})
