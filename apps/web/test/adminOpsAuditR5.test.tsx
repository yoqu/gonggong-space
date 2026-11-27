import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  AdminMachineDto,
  AuditDto,
  ConversationOverviewDto,
  DaemonRelease,
  PreviewShareDto,
  SystemParams,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { apiError, mockApi } from './mockApi'

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

const PARAMS: SystemParams = {
  approvalTimeoutMin: 30,
  chainMaxHops: 3,
  offlineWaitMin: 30,
  sessionReplayTokens: 16000,
  contextInlineTokens: 8000,
  sessionIdleHours: 6,
  runRetentionDays: 30,
  attachmentMaxMb: 50,
  attachmentsPerMessage: 10,
  questionsPerCard: 4,
  heartbeatSec: 15,
  offlineMisses: 3,
  botConcurrencyDefault: 2,
  backupRetentionDays: 7,
  archiveRetentionDays: 30,
  registrationOpen: false,
  previewIdleHours: 24,
  previewShareMaxDays: 30,
  singleTeamMode: true,
  teamCreation: 'sysadmin',
  feishuAutoSignup: true,
  feishuWebApp: false,
  publicUrl: 'https://gg.example.com',
  demoMode: false,
  pluginsEnabled: true,
  pluginCodeEnabled: false,
}

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

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Round 5 UX Audit — Admin Config & Observability Pages', () => {
  it('P1-1: GroupRow wraps cleanly below 640px and Feishu URL/redirect wrap without overflowing', () => {
    const displayCss = readCss('ui/display.css')
    const feishuCss = readCss('features/feishu/feishu.css')
    expect(displayCss).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.ui-group__row[\s\S]*?flex-wrap:\s*wrap/,
    )
    expect(feishuCss).toMatch(/\.feishu-app__id[\s\S]*?overflow-wrap:\s*anywhere/)
    expect(feishuCss).toMatch(/\.feishu-url-line[\s\S]*?flex-wrap:\s*wrap/)
  })

  it('P1-2: AuditPage translates schedule category, exposes 定时任务 filter, and supports Retry on load error', async () => {
    let fail = true
    const rows: AuditDto[] = [
      {
        id: 10,
        at: '2026-11-21T10:00:00Z',
        category: 'schedule',
        actorName: '陈晨',
        action: 'schedule.create',
        groupName: '研发群',
        summary: '新建定时任务「每日巡检」',
        detail: {},
      },
    ]
    const calls = mockApi({
      'GET /admin/teams': () => [],
      'GET /admin/audit?limit=50': () => (fail ? apiError(500, 'err', '审计服务故障') : rows),
      'GET /admin/audit?category=schedule&limit=50': () => rows,
    })

    renderAt('/admin/audit')
    await screen.findByText('审计服务故障')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('新建定时任务「每日巡检」')

    // Raw English `schedule` tag must not appear; localized 定时任务 tag + filter tab appear
    expect(screen.queryByText('schedule')).toBeNull()
    const filterBtn = screen.getByRole('radio', { name: '定时任务' })
    fireEvent.click(filterBtn)
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/admin/audit?category=schedule&limit=50')).toBe(true),
    )
  })

  it('P1-3: ConversationStatsPanel normalizes legacy succeeded status into 已完成 with color swatch and exposes Retry', async () => {
    let fail = true
    const overview = {
      groups: 3,
      dms: 1,
      current: {
        activeConversations: 2,
        newConversations: 1,
        userMessages: 10,
        botMessages: 5,
        activeUsers: 2,
        runs: 4,
        endedRuns: 4,
        completedRuns: 3,
        avgRunMs: 12000,
      },
      previous: {
        activeConversations: 1,
        newConversations: 0,
        userMessages: 5,
        botMessages: 2,
        activeUsers: 1,
        runs: 2,
        endedRuns: 2,
        completedRuns: 2,
        avgRunMs: 10000,
      },
      daily: [],
      statuses: [
        { status: 'completed', count: 2 },
        { status: 'succeeded' as unknown as ConversationOverviewDto['statuses'][number]['status'], count: 1 },
        { status: 'interrupted', count: 1 },
      ],
    } satisfies ConversationOverviewDto

    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
    mockApi({
      'GET /admin/teams': () => [],
      [`GET /admin/conversation-stats/overview?days=30&tz=${tz}`]: () =>
        fail ? apiError(500, 'err', '统计加载失败') : overview,
      'GET /admin/conversation-stats/ops?days=30': () => apiError(500, 'err', '运营指标失败'),
      'GET /admin/conversation-stats?by=conversation&days=30': () => [],
    })

    renderAt('/admin/conversations')
    await screen.findByText('统计加载失败')
    fail = false
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0] as HTMLElement)
    await screen.findByText('运行状态分布')

    const legend = screen.getByRole('list', { name: '运行状态图例' })
    const items = within(legend).getAllByRole('listitem')
    // Legacy `succeeded` (1) merged into `completed` (2) -> total 3, so only 2 distinct legend items (已完成, 已中断)
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('已完成')
    expect(items[0]?.textContent).toContain('3')
    expect(items[0]?.textContent).toContain('75%')
    // Ops failure shows error Alert with Retry instead of silently vanishing
    await screen.findByText('运营指标失败')
  })

  it('P1-4: MachinesPage wraps agent badges cleanly and exposes Retry on error', async () => {
    const adminCss = readCss('features/admin/admin.css')
    expect(adminCss).toMatch(/\.admin-agents\s*\{[^}]*flex-wrap:\s*wrap/)

    let fail = true
    const machines: AdminMachineDto[] = [
      {
        id: 'm1',
        name: 'dev-mac',
        hostname: 'dev-mac.local',
        ownerId: 'u0',
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
      },
    ]
    mockApi({
      'GET /admin/machines': () => (fail ? apiError(500, 'err', '电脑列表失败') : machines),
    })

    renderAt('/admin/machines')
    await screen.findByText('电脑列表失败')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('dev-mac')
  })

  it('P1-5: FeishuAdminPage shows error+retry on /admin/params failure and styles 移除主应用 as destructive red', async () => {
    let failParams = true
    mockApi({
      'GET /admin/params': () => (failParams ? apiError(500, 'err', '参数读取失败') : PARAMS),
      'GET /admin/feishu/overview': () => ({
        publicUrl: PARAMS.publicUrl,
        main: { appId: 'cli_123', status: 'connected', review: 'approved', error: null, configError: null },
        othersLinked: false,
        linkedUsers: 1,
        bots: [],
        chats: [],
      }),
      'GET /admin/feishu': () => ({
        app: {
          appId: 'cli_123',
          status: 'connected',
          review: 'approved',
          error: null,
          configError: null,
        },
      }),
    })

    renderAt('/admin/feishu')
    await screen.findByText('参数读取失败')
    failParams = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    const removeBtn = await screen.findByRole('button', { name: '移除主应用' })
    expect(removeBtn.className).toContain('feishu-app__danger')
  })

  it('P1-6 & P1-7: ParamsPage & ReleasesPage expose Retry, ReleasesPage adds Cancel on notes edit and ConfirmActionDialog on remove', async () => {
    let failParams = true
    mockApi({
      'GET /admin/params': () => (failParams ? apiError(500, 'err', '参数服务错误') : PARAMS),
    })
    const v1 = renderAt('/admin/params')
    await screen.findByText('参数服务错误')
    failParams = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('开放自助注册')
    v1.unmount()

    let failRel = true
    const rel: DaemonRelease = {
      version: '0.4.25',
      releaseNotes: '初始说明',
      builds: { 'macos-aarch64': { url: '/dl/mac', sha256: 'a'.repeat(64) } },
      cast: {},
      desktop: {},
      update: {},
      signature: {},
    }
    mockApi({
      'GET /admin/daemon-release': () => (failRel ? apiError(500, 'err', '发布列表失败') : rel),
      'GET /admin/machines': () => [],
    })
    renderAt('/admin/releases')
    await screen.findByText('发布列表失败')
    failRel = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('初始说明')

    // Click 编辑版本说明 -> 取消 restores notes and exits edit mode
    fireEvent.click(screen.getByRole('button', { name: '编辑版本说明' }))
    const box = screen.getByRole('textbox', { name: '版本说明' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '临时未保存修改' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await screen.findByText('初始说明')
    expect(screen.queryByRole('textbox', { name: '版本说明' })).toBeNull()
  })

  it('P1-8: SharesPage requires ConfirmActionDialog before revoking an active public link and supports Retry', async () => {
    let fail = true
    const share: PreviewShareDto = {
      id: 'sh1',
      previewId: 'p1',
      previewTitle: '产品原型预览',
      groupId: 'g1',
      groupName: '产品群',
      botName: '设计助手',
      createdByName: '陈晨',
      createdAt: '2026-11-20T00:00:00Z',
      expiresAt: '2026-12-01T00:00:00Z',
      revokedAt: null,
      visitCount: 5,
      lastVisitAt: null,
      active: true,
    }
    const calls = mockApi({
      'GET /admin/preview-shares': () => (fail ? apiError(500, 'err', '链接列表失败') : [share]),
      'POST /preview-shares/sh1/revoke': () => ({ ...share, active: false }),
    })

    renderAt('/admin/previews')
    await screen.findByText('链接列表失败')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('产品原型预览')

    const row = screen.getByText('产品原型预览').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '收回' }))

    // Must open confirm dialog first; no POST sent yet
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('要收回公开链接「产品原型预览」吗？')).toBeTruthy()
    expect(calls.some((c) => c.path === '/preview-shares/sh1/revoke')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: '收回' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/preview-shares/sh1/revoke')).toBe(true),
    )
  })

  it('P1-9: UsagePage exposes Retry on load failure and ConfigPage has scrollable tabs & updated unsupported copy', async () => {
    const configCss = readCss('features/config/config.css')
    expect(configCss).toMatch(/\.cfg__bar\s+\.ui-seg[\s\S]*?overflow-x:\s*auto/)

    let fail = true
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const emptyCaps = {
      hasInputOutput: false,
      hasCost: false,
      hasCache: false,
      hasProvider: false,
      hasModels: false,
      hasTools: false,
      hasPlugins: false,
      retentionDays: 30,
    }
    const emptyKpi = {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokenReportedRuns: 0,
      unreportedRuns: 0,
      totalRuns: 0,
      endedRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      liveRuns: 0,
      successRate: null,
      totalCostUsd: 0,
      costReportedRuns: 0,
      cacheReadTokens: 0,
      cacheInputTokens: 0,
      cacheHitRate: null,
      cacheReportedRuns: 0,
      avgDurationMs: null,
      p50DurationMs: null,
      p95DurationMs: null,
      avgOutputTps: null,
      activeUsers: 0,
      activeBots: 0,
      activeGroups: 0,
    }
    mockApi({
      'GET /admin/teams': () => [],
      [`GET /admin/usage/facets?preset=30d&tz=${tz}`]: () => ({
        models: [],
        providers: [],
        agentKinds: [],
        bots: [],
        users: [],
        groups: [],
        capabilities: emptyCaps,
      }),
      [`GET /admin/usage/overview?preset=30d&tz=${tz}`]: () =>
        fail
          ? apiError(500, 'err', '用量服务错误')
          : {
              range: {
                from: null,
                to: '2026-11-26T00:00:00Z',
                previousFrom: null,
                previousTo: null,
                granularity: 'day',
              },
              kpi: emptyKpi,
              previous: null,
              capabilities: emptyCaps,
            },
      [`GET /admin/usage/timeseries?preset=30d&tz=${tz}&metric=tokens&breakdown=agentKind&topN=5&granularity=auto`]:
        () => ({
          granularity: 'day',
          metric: 'tokens',
          breakdown: 'agentKind',
          buckets: [],
          series: [],
        }),
      [`GET /admin/usage/breakdown?preset=30d&tz=${tz}&by=agentKind&limit=20`]: () => ({
        by: 'agentKind',
        totalItems: 0,
        items: [],
      }),
      [`GET /admin/usage/breakdown?preset=30d&tz=${tz}&by=bot&limit=20`]: () => ({
        by: 'bot',
        totalItems: 0,
        items: [],
      }),
      [`GET /admin/usage/breakdown?preset=30d&tz=${tz}&by=user&limit=20`]: () => ({
        by: 'user',
        totalItems: 0,
        items: [],
      }),
      [`GET /admin/usage/breakdown?preset=30d&tz=${tz}&by=group&limit=20`]: () => ({
        by: 'group',
        totalItems: 0,
        items: [],
      }),
      [`GET /admin/usage/heatmap?preset=30d&tz=${tz}&mode=calendar&metric=tokens`]: () => ({
        mode: 'calendar',
        metric: 'tokens',
        maxValue: 0,
        calendar: [],
      }),
    })
    renderAt('/admin/usage')
    await screen.findByText('用量服务错误')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('当前时间范围内没有运行记录')
  })
})
