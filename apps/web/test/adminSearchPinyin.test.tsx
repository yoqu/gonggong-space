import type {
  AdminGroupDto,
  AdminScheduleDto,
  AdminSchedulesDto,
  AdminTeamDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { pinyinReady } from '../src/lib/match'
import { mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const team = (o: Partial<AdminTeamDto>): AdminTeamDto => ({
  id: 't1',
  name: '产品研发团队',
  avatar: null,
  ownerId: 'u0',
  ownerName: '陈晨',
  members: 3,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...o,
})

const group = (o: Partial<AdminGroupDto>): AdminGroupDto => ({
  id: 'g1',
  teamId: 't1',
  teamName: '产品研发团队',
  name: '架构讨论群',
  ownerName: '陈晨',
  kind: 'group',
  mode: 'partition',
  repo: null,
  members: 2,
  bots: 1,
  archivedAt: null,
  ...o,
})

const schedule = (o: Partial<AdminScheduleDto>): AdminScheduleDto => ({
  id: 's1',
  teamId: 't1',
  teamName: '产品研发团队',
  groupId: 'g1',
  groupName: '研发群',
  groupKind: 'group',
  name: '每日构建巡检任务',
  prompt: '检查构建状态',
  cron: '0 9 * * 1-5',
  runAt: null,
  timezone: 'Asia/Shanghai',
  botIds: ['b1'],
  botNames: ['研发助手 Bot'],
  runOptions: {},
  enabled: true,
  pausedReason: null,
  nextRunAt: '2026-11-22T01:00:00Z',
  lastFiredAt: null,
  lastRunId: null,
  lastBotId: null,
  lastStatus: null,
  failStreak: 0,
  ownerId: 'u0',
  ownerName: '陈晨',
  createdByBotId: null,
  canManage: true,
  createdAt: '2026-11-20T00:00:00Z',
  ...o,
})

class NoopSocket {
  close() {}
  send() {}
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

const search = (value: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value } })

beforeAll(() => pinyinReady)
beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})

describe('admin list search', () => {
  it('TeamsPage matches pinyin initials per field', async () => {
    mockApi({
      'GET /admin/teams': () => [
        team({}),
        team({ id: 't2', name: '运维团队', ownerId: 'u1', ownerName: '王磊' }),
      ],
    })
    renderAt('/admin/teams')
    await screen.findByText('运维团队')
    search('cpyf')
    await waitFor(() => expect(screen.queryByText('运维团队')).toBeNull())
    expect(screen.getByText('产品研发团队')).toBeTruthy()
    search('wl')
    await waitFor(() => expect(screen.queryByText('产品研发团队')).toBeNull())
    expect(screen.getByText('运维团队')).toBeTruthy()
  })

  it('GroupsPage matches pinyin initials', async () => {
    mockApi({
      'GET /admin/teams': () => [team({})],
      'GET /admin/groups': () => [group({}), group({ id: 'g2', name: '运营群' })],
    })
    renderAt('/admin/groups')
    await screen.findByText('运营群')
    search('jgtl')
    await waitFor(() => expect(screen.queryByText('运营群')).toBeNull())
    expect(screen.getByText('架构讨论群')).toBeTruthy()
  })

  it('SchedulesPage matches pinyin initials and does not match across fields', async () => {
    mockApi({
      'GET /admin/teams': () => [team({})],
      'GET /admin/schedules': (): AdminSchedulesDto => ({
        schedules: [schedule({}), schedule({ id: 's2', name: '周报汇总', botNames: ['运营 Bot'] })],
        stats: { enabled: 2, fired24h: 0, failed24h: 0, autoPaused: 0 },
      }),
    })
    renderAt('/admin/schedules')
    await screen.findByText('周报汇总')
    search('mrgj')
    await waitFor(() => expect(screen.queryByText('周报汇总')).toBeNull())
    expect(screen.getByText('每日构建巡检任务')).toBeTruthy()
    // 「务 研」 used to hit the old space-joined name + group string.
    search('务 研')
    await waitFor(() => expect(screen.queryByText('每日构建巡检任务')).toBeNull())
  })
})
