import {
  type AdminSchedulesDto,
  type BotDto,
  formatInZone,
  type GroupSchedulesDto,
  type ScheduleDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { SchedulesPage } from '../src/features/admin/SchedulesPage'
import { ScheduleCard } from '../src/features/schedules/ScheduleCard'
import { ScheduleDialog } from '../src/features/schedules/ScheduleDialog'
import { SchedulesView } from '../src/features/schedules/SchedulesView'
import { resetSchedules } from '../src/features/schedules/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: 'Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 0,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  model: null,
  effort: null,
  catalog: null,
  ...o,
})

const schedule = (o: Partial<ScheduleDto> = {}): ScheduleDto => ({
  id: 's1',
  groupId: 'g1',
  name: '日报',
  prompt: '汇总昨天合并的 PR',
  cron: '0 9 * * 1-5',
  runAt: null,
  timezone: 'Asia/Shanghai',
  botIds: ['b2', 'b1'],
  enabled: true,
  pausedReason: null,
  nextRunAt: '2026-10-05T01:00:00.000Z',
  lastFiredAt: null,
  lastRunId: null,
  lastBotId: null,
  lastStatus: null,
  failStreak: 0,
  ownerId: 'u1',
  ownerName: '王磊',
  createdByBotId: null,
  canManage: true,
  createdAt: '2026-10-03T10:00:00Z',
  ...o,
})
const list = (...schedules: ScheduleDto[]): GroupSchedulesDto => ({ schedules })

class NoopSocket {
  close() {}
}

beforeEach(() => {
  resetSchedules()
  vi.stubGlobal('WebSocket', NoopSocket)
  useWorkspace.setState({ bots: [bot({}), bot({ id: 'b2', name: 'Codex', agentKind: 'codex' })] })
})
afterEach(() => vi.unstubAllGlobals())

describe('schedules panel', () => {
  it('lists tasks in words with their bots in order; managers pause them in place', async () => {
    const calls = mockApi({
      'GET /groups/g1/schedules': list(
        schedule(),
        schedule({ id: 's2', name: '周报', cron: '0 18 * * 5', canManage: false, botIds: ['b1'] }),
      ),
      'PATCH /schedules/s1': schedule({ enabled: false, nextRunAt: null }),
    })
    render(<SchedulesView groupId="g1" />)
    const row = (await screen.findByText('日报')).closest('.sc-row') as HTMLElement
    expect(within(row).getByText(/每个工作日 09:00/)).toBeTruthy()
    expect(within(row).getByText(/Codex → Claude/)).toBeTruthy()
    const other = screen.getByText('周报').closest('.sc-row') as HTMLElement
    expect(within(other).queryByRole('switch')).toBeNull()
    fireEvent.click(within(row).getByRole('switch', { name: '启用「日报」' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        path: '/schedules/s1',
        body: { enabled: false },
      }),
    )
  })

  it('follows realtime updates', async () => {
    mockApi({ 'GET /groups/g1/schedules': list(schedule()) })
    let push: ((e: never) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h as never
      return () => {}
    })
    render(<SchedulesView groupId="g1" />)
    await screen.findByText('日报')
    act(() => push!({ t: 'group.schedules', groupId: 'g1', schedules: [] } as never))
    expect(screen.getByText('还没有定时任务')).toBeTruthy()
  })
})

describe('schedule editor', () => {
  it('builds the cron from a preset, previews it and saves the bots in order', async () => {
    const calls = mockApi({
      'POST /schedules/preview': {
        error: null,
        next: ['2026-10-05T01:00:00.000Z', '2026-10-06T01:00:00.000Z'],
      },
      'POST /groups/g1/schedules': schedule(),
    })
    const onClose = vi.fn()
    render(<ScheduleDialog groupId="g1" botIds={['b1', 'b2']} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '日报' } })
    fireEvent.change(screen.getByLabelText('指令'), { target: { value: '汇总昨天合并的 PR' } })
    fireEvent.click(screen.getByRole('radio', { name: '每个工作日' }))
    fireEvent.click(screen.getByRole('button', { name: '添加 Codex' }))
    fireEvent.click(screen.getByRole('button', { name: '添加 Claude' }))
    fireEvent.click(screen.getByRole('button', { name: '上移 Claude' }))
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    await screen.findByText(new RegExp(formatInZone('2026-10-05T01:00:00.000Z', tz)))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/groups/g1/schedules')?.body).toEqual({
      name: '日报',
      prompt: '汇总昨天合并的 PR',
      botIds: ['b1', 'b2'],
      cron: '0 9 * * 1-5',
      timezone: tz,
    })
  })

  it('shows why a custom expression is refused', async () => {
    mockApi({
      'POST /schedules/preview': { error: { key: '执行间隔不能小于 {n} 分钟', params: { n: 5 } }, next: [] },
    })
    render(<ScheduleDialog groupId="g1" botIds={['b1']} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: '自定义' }))
    fireEvent.change(screen.getByLabelText('cron 表达式'), { target: { value: '* * * * *' } })
    expect(await screen.findByText('执行间隔不能小于 5 分钟')).toBeTruthy()
    expect((screen.getByRole('button', { name: '创建' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('schedule card', () => {
  it('shows the task and lets managers pause or delete it; a deleted one says so', async () => {
    const calls = mockApi({
      'GET /groups/g1/schedules': list(schedule({ createdByBotId: 'b1' })),
      'PATCH /schedules/s1': schedule({ enabled: false }),
      'DELETE /schedules/s1': undefined,
    })
    let push: ((e: never) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h as never
      return () => {}
    })
    render(<ScheduleCard scheduleId="s1" groupId="g1" fallback="Claude 创建了定时任务「日报」" />)
    await screen.findByText('日报')
    expect(screen.getByText(/每个工作日 09:00/)).toBeTruthy()
    expect(screen.getByText(/Codex → Claude/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    act(() => push!({ t: 'group.schedules', groupId: 'g1', schedules: [] } as never))
    expect(screen.getByText('已删除')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
  })
})

describe('admin schedules', () => {
  it('lists every task with totals and filters by status', async () => {
    const row = (o: Partial<ScheduleDto>) => ({
      ...schedule(o),
      groupName: '支付重构',
      groupKind: 'group' as const,
      teamId: 't1',
      teamName: '默认团队',
      botNames: ['Codex', 'Claude'],
    })
    const data: AdminSchedulesDto = {
      schedules: [
        row({}),
        row({
          id: 's2',
          name: '巡检',
          enabled: false,
          pausedReason: { key: '连续 {n} 次失败', params: { n: 3 } },
        }),
      ],
      stats: { enabled: 1, fired24h: 4, failed24h: 1, autoPaused: 1 },
    }
    mockApi({ 'GET /admin/schedules': data, 'GET /admin/teams': [] })
    render(
      <MemoryRouter>
        <SchedulesPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('日报')).toBeTruthy()
    expect(screen.getByText('巡检')).toBeTruthy()
    expect(screen.getByText(/已停用：连续 3 次失败/)).toBeTruthy()
    expect(screen.getByText('24 小时内触发')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '已停用' }))
    expect(screen.queryByText('日报')).toBeNull()
  })
})
