import type { ConversationOverviewDto, GroupDto, ScheduleDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { ConversationStatsPanel } from '../src/features/conversation-stats/ConversationStatsPanel'
import { ScheduleDialog } from '../src/features/schedules/ScheduleDialog'
import { resetSchedules } from '../src/features/schedules/store'
import { apiError, mockApi } from './mockApi'

const metrics = (n: number) => ({
  activeConversations: n,
  newConversations: n,
  userMessages: n,
  botMessages: n,
  activeUsers: n,
  runs: n,
  completedRuns: n,
  endedRuns: n,
  avgRunMs: null,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('conversation stats delta on small samples', () => {
  it('shows the previous absolute value instead of a percentage when the previous period is under 10', async () => {
    const overview: ConversationOverviewDto = {
      groups: 1,
      dms: 0,
      current: { ...metrics(0), userMessages: 30 },
      previous: { ...metrics(1), userMessages: 25 },
      daily: [],
      statuses: [],
    }
    mockApi({
      [`GET /admin/conversation-stats/overview?days=30&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`]:
        overview,
      'GET /admin/conversation-stats/ops?days=30': {
        retention: { previous: 0, retained: 0 },
        activation: { joined: 0, activated: 0, medianHours: null },
        failures: { endedRuns: 0, failedRuns: 0, reasons: [] },
        audience: { userRuns: 0, builderRuns: 0, users: 0, builders: 0 },
      },
      'GET /admin/conversation-stats?by=conversation&days=30': [],
    })
    render(<ConversationStatsPanel base="/admin/conversation-stats" teamId="" />)
    const tile = async (label: string) =>
      (await screen.findByText(label, { selector: '.usage-stat__label' })).parentElement!
    const runs = await tile('运行轮次')
    expect(runs.textContent).not.toContain('100%')
    expect(runs.textContent).toContain('前 30 天：1')
    expect((await tile('新建会话')).textContent).toContain('前 30 天：1')
    expect((await tile('用户消息')).textContent).toContain('↑ 20%')
  })
})

describe('schedule dialog preview states', () => {
  beforeEach(() => {
    resetSchedules()
    useWorkspace.setState({
      groups: [
        {
          id: 'g1',
          name: '支付',
          kind: 'group',
          botIds: [],
          members: [],
        } as unknown as GroupDto,
      ],
      bots: [],
      machines: [],
    })
  })

  const schedule = {
    id: 's1',
    groupId: 'g1',
    name: '日报',
    prompt: '汇总',
    cron: '0 9 * * 1-5',
    runAt: null,
    timezone: 'Asia/Shanghai',
    botIds: ['b1'],
    runOptions: {},
    canManage: false,
  } as unknown as ScheduleDto

  it('says it is calculating while the preview is pending, and offers a retry when it fails', async () => {
    let reply: (r: unknown) => void = () => {}
    const calls = mockApi({
      'POST /schedules/preview': () =>
        new Promise((r) => {
          reply = r
        }),
    })
    render(<ScheduleDialog groupId="g1" botIds={['b1']} schedule={schedule} onClose={() => {}} />)
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(screen.getByText('正在计算执行时间…')).toBeTruthy()
    expect(screen.queryByText('请设置有效的执行时间')).toBeNull()
    expect(save.disabled).toBe(true)

    await waitFor(() => expect(calls.length).toBe(1))
    reply(apiError(500, 'internal'))
    expect(await screen.findByText('无法预览执行时间，请检查网络后重试')).toBeTruthy()
    expect(screen.queryByText('请设置有效的执行时间')).toBeNull()
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('正在计算执行时间…')).toBeTruthy()
    await waitFor(() => expect(calls.length).toBe(2))
    reply({ error: null, next: ['2026-10-05T01:00:00.000Z'] })
    await waitFor(() => expect(save.disabled).toBe(false))
    expect(screen.queryByText('正在计算执行时间…')).toBeNull()
  })
})
