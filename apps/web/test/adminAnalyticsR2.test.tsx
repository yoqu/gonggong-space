import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  AdminMachineDto,
  AuditDto,
  ConversationOverviewDto,
  DaemonRelease,
  UserDto,
} from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { AuditPage, AuditPanel } from '../src/features/admin/AuditPage'
import { MachinesPage } from '../src/features/admin/MachinesPage'
import { ReleasesPage } from '../src/features/admin/ReleasesPage'
import * as attachApi from '../src/features/attachments/api'
import { BotsAdminPage } from '../src/features/bots/BotsAdminPage'
import { ConversationStatsPanel } from '../src/features/conversation-stats/ConversationStatsPanel'
import { api } from '../src/lib/api'
import { browserTimeZone } from '../src/lib/time'
import { mockApi } from './mockApi'

const readCss = (rel: string) => readFileSync(resolve(__dirname, '../src', rel), 'utf8')

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

beforeEach(() => {
  useSession.setState({ user: admin, status: 'ready' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Round 2 Consolidation — Slice 1 (Admin, Analytics, Search)', () => {
  it('P0-1: audit.css is self-contained for TeamSettings AuditPanel and admin.css drops audit rules', () => {
    const auditCss = readCss('features/admin/audit.css')
    const adminCss = readCss('features/admin/admin.css')
    expect(auditCss).toContain('.admin-audit__filters')
    expect(auditCss).toContain('display: flex')
    expect(auditCss).toContain('.admin-audit__summary')
    expect(auditCss).toContain('.admin-audit__detail')
    expect(auditCss).toContain('.admin-more')
    expect(adminCss).not.toContain('.admin-audit__summary')
    expect(adminCss).not.toContain('.admin-audit__detail')
    expect(adminCss).not.toContain('.admin-more')
  })

  it('P0-2: ReleasesPage serializes overlapping drops, tracks items by id on removal, and preserves editing notes', async () => {
    const baseRelease: DaemonRelease = {
      version: '0.4.25',
      releaseNotes: '初始说明',
      builds: { 'macos-aarch64': { url: '/dl/mac', sha256: 'a'.repeat(64) } },
      cast: {},
      desktop: {},
      update: {},
      signature: {},
    }
    mockApi({
      'GET /admin/daemon-release': () => baseRelease,
      'GET /admin/machines': () => [],
    })

    const active: string[] = []
    let maxConcurrent = 0
    const resolvers: Array<(r: DaemonRelease) => void> = []
    vi.spyOn(attachApi, 'postForm').mockImplementation((_url, form) => {
      const f = form.get('file') as File
      active.push(f.name)
      maxConcurrent = Math.max(maxConcurrent, active.length)
      const done = new Promise<DaemonRelease>((res) => {
        resolvers.push((val) => {
          active.splice(active.indexOf(f.name), 1)
          res(val)
        })
      })
      return { done, abort: () => {} }
    })

    const { container } = render(
      <MemoryRouter>
        <ReleasesPage />
      </MemoryRouter>,
    )
    await screen.findByText('初始说明')

    // Start editing release notes so uploads must NOT clobber draft notes.
    fireEvent.click(screen.getByRole('button', { name: '编辑版本说明' }))
    const box = screen.getByRole('textbox', { name: '版本说明' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '我的未保存草稿' } })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const f1 = new File(['a'], 'gonggong-0.4.26-macos-aarch64')
    const f2 = new File(['b'], 'gonggong-0.4.26-linux-x86_64')
    fireEvent.change(input, { target: { files: [f1] } })
    fireEvent.change(input, { target: { files: [f2] } })

    await waitFor(() => expect(resolvers).toHaveLength(1))
    expect(maxConcurrent).toBe(1)

    // Remove item 0 from the list while item 1 is still queued; item 1 must still finish cleanly.
    const removeButtons = screen.getAllByRole('button', { name: /移除 / })
    fireEvent.click(removeButtons[0] as HTMLElement)

    resolvers[0]?.({ ...baseRelease, version: '0.4.26', releaseNotes: '服务器覆盖说明' })
    await waitFor(() => expect(resolvers).toHaveLength(2))
    expect(maxConcurrent).toBe(1)

    resolvers[1]?.({ ...baseRelease, version: '0.4.26', releaseNotes: '服务器二次覆盖' })
    await waitFor(() => expect(screen.getByText('当前版本 0.4.26')).toBeTruthy())

    // Draft notes are preserved!
    expect((screen.getByRole('textbox', { name: '版本说明' }) as HTMLTextAreaElement).value).toBe(
      '我的未保存草稿',
    )
    // Remaining item f2 shows 100% / uploaded cleanly without corrupting index.
    expect(screen.getByText('gonggong-0.4.26-linux-x86_64')).toBeTruthy()
  })

  it('P0-3: AuditPanel discards stale loadMore after filter change, resets actor, and clears stale subtitle', async () => {
    const page1: AuditDto[] = Array.from({ length: 50 }, (_, i) => ({
      id: 100 - i,
      at: '2026-11-21T10:00:00Z',
      category: 'admin',
      actorName: i === 0 ? '张三' : '李四',
      action: 'admin.op',
      groupName: '产品群',
      summary: `记录 ${i + 1}`,
      detail: {},
    }))
    let resolveMore!: (v: AuditDto[]) => void
    let resolveRun!: (v: AuditDto[]) => void

    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path === '/admin/teams') return Promise.resolve([])
      if (path.includes('before=')) {
        return new Promise<AuditDto[]>((r) => {
          resolveMore = r
        })
      }
      if (path.includes('category=run')) {
        return new Promise<AuditDto[]>((r) => {
          resolveRun = r
        })
      }
      return Promise.resolve(page1)
    })

    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>,
    )
    await screen.findByText('记录 1')
    await screen.findByText('已载入 50 条')

    // Select actor 张三, then start loadMore, then switch category to 运行.
    fireEvent.click(screen.getByRole('button', { name: '操作人' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '张三' }))
    expect(screen.queryByText('记录 2')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    fireEvent.click(screen.getByRole('radio', { name: '运行' }))

    // Subtitle clears while loading new category.
    await waitFor(() => expect(screen.queryByText('已载入 50 条')).toBeNull())

    // Stale loadMore settles first -> must be ignored.
    resolveMore([
      {
        id: 1,
        at: '2026-11-21T09:00:00Z',
        category: 'admin',
        actorName: '旧人',
        action: 'admin.old',
        groupName: null,
        summary: '过期分页记录',
        detail: {},
      },
    ])
    resolveRun([
      {
        id: 200,
        at: '2026-11-21T11:00:00Z',
        category: 'run',
        actorName: '王五',
        action: 'run.start',
        groupName: '研发群',
        summary: '新分类记录',
        detail: {},
      },
    ])

    await screen.findByText('新分类记录')
    // Stale loadMore row must not appear; actor reset to all so 王五 is visible.
    expect(await screen.findByText('已载入 1 条')).toBeTruthy()
    expect(screen.queryByText('过期分页记录')).toBeNull()
  })

  it('P0-5: ConversationStatsPanel Statuses shows <1% instead of 0% for sub-1% non-zero buckets', async () => {
    const overview: ConversationOverviewDto = {
      groups: 1,
      dms: 0,
      current: {
        activeConversations: 1,
        newConversations: 0,
        userMessages: 10,
        botMessages: 10,
        activeUsers: 1,
        runs: 300,
        endedRuns: 300,
        completedRuns: 299,
        avgRunMs: 1000,
      },
      previous: {
        activeConversations: 1,
        newConversations: 0,
        userMessages: 10,
        botMessages: 10,
        activeUsers: 1,
        runs: 100,
        endedRuns: 100,
        completedRuns: 100,
        avgRunMs: 1000,
      },
      daily: [],
      statuses: [
        { status: 'completed', count: 299 },
        { status: 'interrupted', count: 1 },
      ],
    }
    mockApi({
      [`GET /admin/conversation-stats/overview?days=30&tz=${encodeURIComponent(browserTimeZone)}`]: () =>
        overview,
      'GET /admin/conversation-stats/ops?days=30': () => ({
        retention: { previous: 0, retained: 0 },
        activation: { joined: 0, activated: 0, medianHours: null },
        failures: { endedRuns: 300, failedRuns: 1, reasons: [] },
        audience: { users: 1, userRuns: 1, builders: 1, builderRuns: 299 },
      }),
      'GET /admin/conversation-stats?by=conversation&days=30': () => [],
    })

    render(<ConversationStatsPanel base="/admin/conversation-stats" />)
    const legend = await screen.findByRole('list', { name: '运行状态图例' })
    const interrupted = within(legend)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('已中断'))
    expect(interrupted?.textContent).toContain('<1%')
    expect(interrupted?.textContent).not.toContain('0%')
  })

  it('P1-6: BotsAdminPage fetches /admin/teams only once (shared with TeamFilter)', async () => {
    const calls = mockApi({
      'GET /admin/bots': () => [],
      'GET /admin/teams': () => [
        {
          id: 't1',
          name: '产品团队',
          ownerName: '陈晨',
          members: 2,
          createdAt: '2026-11-01T00:00:00Z',
          archivedAt: null,
          avatar: null,
        },
      ],
      'GET /users': () => [],
    })
    render(
      <MemoryRouter>
        <BotsAdminPage />
      </MemoryRouter>,
    )
    await screen.findByText('还没有 Bot')
    expect(calls.filter((c) => c.path === '/admin/teams')).toHaveLength(1)
  })

  it('Old P2 #22: AuditPanel and MachinesPage support pinyin search and avoid cross-field false positives', async () => {
    const audits: AuditDto[] = [
      {
        id: 1,
        at: '2026-11-21T10:00:00Z',
        category: 'admin',
        actorName: '陈晨',
        action: 'admin.op',
        groupName: '产品研发群',
        summary: '发布新版本',
        detail: {},
      },
      {
        id: 2,
        at: '2026-11-21T10:01:00Z',
        category: 'admin',
        actorName: '王磊',
        action: 'admin.op',
        groupName: '运营群',
        summary: '调整配额',
        detail: {},
      },
    ]
    const machines: AdminMachineDto[] = [
      {
        id: 'm1',
        name: 'studio-mac',
        hostname: 'mac.local',
        ownerId: 'u1',
        ownerName: '陈晨',
        os: 'macos',
        arch: 'aarch64',
        system: null,
        boundAt: '2026-11-01T00:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
        daemonVersion: '0.4.25',
        protocol: 1,
        online: true,
        lastSeenAt: '2026-11-21T10:00:00Z',
        latencyMs: 3,
        bandwidthMbps: 120,
        netMeasuredAt: '2026-11-21T10:00:00Z',
        agents: [],
        features: [],
        allowMemberConnect: false,
      },
    ]
    mockApi({
      'GET /admin/audit?limit=50': () => audits,
      'GET /admin/machines': () => machines,
    })

    const v1 = render(<AuditPanel base="/admin/audit" keyword="fbxbb" />)
    await screen.findByText('发布新版本')
    expect(screen.queryByText('调整配额')).toBeNull()
    v1.unmount()

    render(
      <MemoryRouter>
        <MachinesPage />
      </MemoryRouter>,
    )
    await screen.findByText('studio-mac')
    const search = screen.getByPlaceholderText('搜索电脑或主人')
    fireEvent.change(search, { target: { value: 'cc' } })
    expect(screen.getByText('studio-mac')).toBeTruthy()
    // Cross-field concatenation (`mac.local 陈晨`) must NOT match.
    fireEvent.change(search, { target: { value: 'local 陈' } })
    expect(screen.queryByText('studio-mac')).toBeNull()
  })
})
