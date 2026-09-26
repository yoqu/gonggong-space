import type { UsageDayDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageDialog } from '../src/features/usage/UsagePage'
import { mockApi } from './mockApi'

const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
const start = Date.UTC(2026, 6, 28)
// 60 days ending 2026-09-25: the prior 30 at 100 tokens / 2 runs, the last 30 at 150 / 2 with a 1.5k / 5 peak today.
const days: UsageDayDto[] = Array.from({ length: 60 }, (_, i) => ({
  day: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  runs: i === 59 ? 5 : 2,
  totalTokens: i === 59 ? 1500 : i < 30 ? 100 : 150,
  unreported: i === 59 ? 1 : 0,
}))

const setup = () =>
  mockApi({
    'GET /usage?by=bot&days=30': [
      { key: 'b1', name: '小王的 Claude', runs: 50, totalTokens: 4000, unreported: 0 },
      { key: 'b2', name: '老李的 Codex', runs: 13, totalTokens: 1000, unreported: 1 },
    ],
    [`GET /usage/daily?days=60&tz=${tz}`]: days,
  })

afterEach(() => vi.unstubAllGlobals())

describe('usage charts', () => {
  it('shows stat tiles with the change against the prior 30 days', async () => {
    setup()
    render(<UsageDialog onClose={() => {}} />)
    const tokens = (await screen.findByText('token 合计')).closest('.usage-stat') as HTMLElement
    expect(await within(tokens).findByText('↑ 95%')).toBeTruthy()
    expect(within(tokens).getByText('较前 30 天')).toBeTruthy()
    const runs = screen.getByText('运行轮次').closest('.usage-stat') as HTMLElement
    expect(within(runs).getByText('↑ 5%')).toBeTruthy()
    const unreported = screen.getByText('未上报轮次').closest('.usage-stat') as HTMLElement
    expect(within(unreported).queryByText('较前 30 天')).toBeNull()
  })

  it('draws a 30-day trend that can be read with the keyboard', async () => {
    setup()
    render(<UsageDialog onClose={() => {}} />)
    const chart = await screen.findByRole('group', { name: /^近 30 天每日 token/ })
    expect(chart.getAttribute('aria-label')).toMatch(/峰值 9月25日/)
    expect(chart.querySelectorAll('.ui-trend__bar')).toHaveLength(30)
    fireEvent.keyDown(chart, { key: 'End' })
    const status = within(chart.parentElement as HTMLElement).getByRole('status')
    expect(status.textContent).toBe('9月25日 · 2k tokens · 5 轮 · 1 轮未上报')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(status.textContent).toBe('9月24日 · 150 tokens · 2 轮')
    fireEvent.keyDown(chart, { key: 'Home' })
    expect(status.textContent).toMatch(/^8月27日/)

    fireEvent.click(screen.getByRole('radio', { name: '轮次' }))
    expect(screen.getByRole('group', { name: /^近 30 天每日运行轮次/ })).toBeTruthy()
  })

  it('labels the token share of each bot', async () => {
    setup()
    render(<UsageDialog onClose={() => {}} />)
    const share = await screen.findByRole('img', { name: /^token 分布/ })
    expect(share.getAttribute('aria-label')).toBe('token 分布：小王的 Claude 80%，老李的 Codex 20%')
    const legend = screen.getByRole('list', { name: 'token 分布图例' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['小王的 Claude4k80%', '老李的 Codex1k20%'])
  })
})
