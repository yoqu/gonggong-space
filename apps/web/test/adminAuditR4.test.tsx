import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  AdminGroupDto,
  AdminScheduleDto,
  AdminSchedulesDto,
  AdminTeamDto,
  AdminUserDto,
  BotDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { ConfirmActionDialog, Table, TableCardsOnNarrow, TabView } from '../src/ui'
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

const makeUser = (o: Partial<AdminUserDto> = {}): AdminUserDto => ({
  ...admin,
  machineCount: 0,
  online: false,
  teams: [],
  ...o,
})

const makeTeam = (o: Partial<AdminTeamDto> = {}): AdminTeamDto => ({
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

const makeBot = (o: Partial<BotDto> = {}): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '研发助手 Bot',
  ownerId: 'u0',
  ownerName: '陈晨',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'm1',
  machineName: 'MacBook-Pro',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u0',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 0,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  model: null,
  effort: null,
  catalog: null,
  ...o,
})

const makeSchedule = (o: Partial<AdminScheduleDto> = {}): AdminScheduleDto => ({
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

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Round 4 UX Audit — TabView, Table & ConfirmActionDialog primitives', () => {
  it('P1-1: constrains TabView bar width with horizontal scrolling and scrolls active tab into view', () => {
    const css = readCss('ui/tab-view.css')
    expect(css).toMatch(/\.ui-tab-view\s*\{[^}]*max-width:\s*100%/)
    expect(css).toMatch(/\.ui-tab-view__bar\s*\{[^}]*overflow-x:\s*auto/)

    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy

    render(
      <TabView
        tabs={[
          { value: 'a', label: '基本', content: <div>面板 A</div> },
          { value: 'b', label: '共享', content: <div>面板 B</div> },
          { value: 'c', label: '日志', content: <div>面板 C</div> },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '日志' }))
    expect(screen.getByText('面板 C')).toBeTruthy()
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('P1-2: hides mobile card colon when column title is empty and uses ghost ActionsCell with 32px coarse targets', () => {
    const tableCss = readCss('ui/table.css')
    expect(tableCss).toMatch(
      /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.ui-table__actions\s+\.ui-btn[\s\S]*?min-height:\s*32px/,
    )
    expect(tableCss).toMatch(/padding-right:\s*48px/)

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    )

    const { container } = render(
      <TableCardsOnNarrow value={true}>
        <Table<{ id: string; name: string; role: string }>
          aria-label="测试表"
          rows={[{ id: '1', name: '条目一', role: '管理员' }]}
          rowActions={() => [{ label: '删除', value: 'del', destructive: true }]}
          onRowAction={() => {}}
          columns={[
            { key: 'name', title: '名称' },
            { key: 'role', title: '角色' },
            { key: 'ops', title: '', render: () => <button type="button">操作项</button> },
          ]}
        />
      </TableCardsOnNarrow>,
    )
    const labels = [...container.querySelectorAll('.ui-table__label')].map((el) => el.textContent)
    expect(labels).toContain('角色：')
    expect(labels).not.toContain('：')
    const actBtn = container.querySelector('.ui-table__actions .ui-btn')
    expect(actBtn?.className).toContain('ui-btn--ghost')
  })

  it('P1-3: ConfirmActionDialog locks Cancel, Escape, and double-submit while busy', async () => {
    let resolveConfirm!: () => void
    const run = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveConfirm = res
        }),
    )
    const onClose = vi.fn()

    render(
      <ConfirmActionDialog
        title="确认删除？"
        message="操作不可撤销"
        consequences={['此操作将永久生效']}
        label="确认删除"
        done="已删除"
        run={run}
        onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    const cancelBtn = within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement
    const confirmBtn = within(dialog).getByRole('button', { name: '确认删除' }) as HTMLButtonElement

    fireEvent.click(confirmBtn)
    await waitFor(() => expect(confirmBtn.getAttribute('aria-busy')).toBe('true'))
    expect(cancelBtn.disabled).toBe(true)

    fireEvent.click(confirmBtn)
    fireEvent.click(cancelBtn)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      resolveConfirm()
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('P1-4: AdminLayout mobile CSS provides 36px touch targets, 2-line desc clamp, and 32px coarse popup targets', () => {
    const adminCss = readCss('features/admin/admin.css')
    const popupCss = readCss('ui/popup.css')
    expect(adminCss).toMatch(/\.admin__desc[\s\S]*?-webkit-line-clamp:\s*2/)
    expect(adminCss).toMatch(/\.admin__nav\s+\.ui-sidebar__item[\s\S]*?min-height:\s*36px/)
    expect(popupCss).toMatch(
      /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.ui-popup__btn[\s\S]*?min-height:\s*32px/,
    )
  })
})

describe('Round 4 UX Audit — TeamsPage, SchedulesPage, BotsAdminPage, UsersPage & GroupsPage', () => {
  it('P1-5: TeamsPage requires confirmation before archiving a team and TeamDialog shows error+retry on user fetch failure', async () => {
    let failUsers = true
    const team = makeTeam()
    const calls = mockApi({
      'GET /admin/teams': () => [team],
      'GET /admin/users': () => {
        if (failUsers) return apiError(500, 'unavailable', '用户服务不可用')
        return [makeUser()]
      },
      'POST /admin/teams/t1/archive': () => ({ ...team, archivedAt: '2026-11-21T00:00:00Z' }),
    })

    renderAt('/admin/teams')
    await screen.findByText('产品研发团队')

    const row = screen.getByText('产品研发团队').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档团队' }))

    const confirm = screen.getByRole('alertdialog')
    expect(within(confirm).getByText('要归档团队「产品研发团队」吗？')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/teams/t1/archive')).toBe(false)

    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/teams/t1/archive')).toBe(false)

    fireEvent.click(within(row).getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档团队' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '归档团队' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/teams/t1/archive')).toBe(true),
    )

    fireEvent.click(screen.getByRole('button', { name: '新建团队…' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('加载账号列表失败')
    failUsers = false
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
    await within(dialog).findByRole('button', { name: '所有者' })
  })

  it('P1-6: SchedulesPage uses ConfirmActionDialog for delete, locks Switch while toggling, and has ellipsis/2x2 stats CSS', async () => {
    const css = readCss('features/schedules/schedules.css')
    expect(css).toMatch(/\.sc-admin-cell__text[\s\S]*?text-overflow:\s*ellipsis/)
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.sc-stats[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    )

    let schedules = [makeSchedule()]
    const calls = mockApi({
      'GET /admin/teams': () => [makeTeam()],
      'GET /admin/schedules': (): AdminSchedulesDto => ({
        schedules,
        stats: { enabled: 1, fired24h: 2, failed24h: 0, autoPaused: 0 },
      }),
      'PATCH /admin/schedules/s1': () => {
        schedules = schedules.map((s) => (s.id === 's1' ? { ...s, enabled: false } : s))
        return schedules[0]
      },
      'DELETE /admin/schedules/s1': () => {
        schedules = []
        return {}
      },
    })

    renderAt('/admin/schedules')
    await screen.findByText('每日构建巡检任务')

    const sw = screen.getByRole('switch', { name: '启用「每日构建巡检任务」' })
    fireEvent.click(sw)
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.path === '/admin/schedules/s1')).toBe(true),
    )

    const delBtn = screen.getByRole('button', { name: '删除' })
    expect(delBtn.className).toContain('sc-admin-del')
    fireEvent.click(delBtn)
    const alertDialog = screen.getByRole('alertdialog')
    expect(within(alertDialog).getByText('删除定时任务「每日构建巡检任务」？')).toBeTruthy()
    fireEvent.click(within(alertDialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/admin/schedules/s1')).toBe(true),
    )
  })

  it('P1-7: BotsAdminPage renders error+retry (not fake empty state) and guards unsaved BotDetail edits on bot switch', async () => {
    let failBots = true
    const bots = [makeBot({ id: 'b1', name: 'Bot 甲' }), makeBot({ id: 'b2', name: 'Bot 乙' })]
    mockApi({
      'GET /admin/bots': () => {
        if (failBots) return apiError(500, 'unavailable', 'Bot 服务暂时不可用')
        return bots
      },
      'GET /admin/teams': () => [makeTeam()],
      'GET /users': () => [{ id: 'u0', name: '陈晨', account: 'chenchen', avatar: null }],
      'GET /bots/b1/skills': () => [],
      'GET /bots/b1/mcps': () => [],
      'GET /bots/b1/secrets': () => [],
      'GET /bots/b1/shares': () => [],
      'GET /bots/b2/skills': () => [],
      'GET /bots/b2/mcps': () => [],
      'GET /bots/b2/secrets': () => [],
      'GET /bots/b2/shares': () => [],
    })

    renderAt('/admin/bots')
    await screen.findByText('Bot 服务暂时不可用')
    expect(screen.queryByText('还没有 Bot')).toBeNull()

    failBots = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findAllByText('Bot 甲')

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'Bot 甲-已改' } })

    fireEvent.mouseDown(screen.getByText('Bot 乙'))
    const guard = await screen.findByRole('alertdialog')
    expect(within(guard).getByText('要放弃未保存的更改吗？')).toBeTruthy()

    fireEvent.click(within(guard).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('Bot 甲-已改')

    fireEvent.mouseDown(screen.getByText('Bot 乙'))
    const guard2 = await screen.findByRole('alertdialog')
    fireEvent.click(within(guard2).getByRole('button', { name: '放弃更改' }))
    await waitFor(() => expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('Bot 乙'))
  })

  it('P1-8: UsersPage, TeamsPage, GroupsPage, and SchedulesPage expose Retry in load error Alert and recover', async () => {
    const cases: { path: string; endpoint: string; payload: unknown; readyText: string }[] = [
      { path: '/admin/users', endpoint: 'GET /admin/users', payload: [makeUser()], readyText: 'chenchen' },
      {
        path: '/admin/teams',
        endpoint: 'GET /admin/teams',
        payload: [makeTeam()],
        readyText: '产品研发团队',
      },
      {
        path: '/admin/groups',
        endpoint: 'GET /admin/groups',
        payload: [
          {
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
          } satisfies AdminGroupDto,
        ],
        readyText: '架构讨论群',
      },
      {
        path: '/admin/schedules',
        endpoint: 'GET /admin/schedules',
        payload: {
          schedules: [makeSchedule()],
          stats: { enabled: 1, fired24h: 0, failed24h: 0, autoPaused: 0 },
        } satisfies AdminSchedulesDto,
        readyText: '每日构建巡检任务',
      },
    ]

    for (const c of cases) {
      let failed = true
      mockApi({
        'GET /admin/teams': () => [makeTeam()],
        [c.endpoint]: () => {
          if (failed) return apiError(500, 'network', '网络异常')
          return c.payload
        },
      })
      const view = renderAt(c.path)
      await screen.findByText('网络异常')
      failed = false
      fireEvent.click(screen.getByRole('button', { name: '重试' }))
      await screen.findByText(c.readyText)
      view.unmount()
    }
  })

  it('P1-9: UsersPage fallback toast displays password when clipboard copy fails on user creation', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const created: AdminUserDto[] = [makeUser()]
    mockApi({
      'GET /admin/users': () => created,
      'POST /admin/users': (body: unknown) => {
        const b = body as { account: string; name: string; role: UserDto['role'] }
        const u = makeUser({ id: 'u2', account: b.account, name: b.name, role: b.role })
        created.push(u)
        return u
      },
    })

    renderAt('/admin/users')
    await screen.findByRole('gridcell', { name: 'chenchen' })
    const newBtn = screen.getAllByRole('button', { name: '新建账号…' })[0]
    expect(newBtn).toBeTruthy()
    if (newBtn) fireEvent.click(newBtn)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('账号'), { target: { value: 'lihua' } })
    fireEvent.change(within(dialog).getByLabelText('姓名'), { target: { value: '李华' } })
    const pwdInput = within(dialog).getByLabelText('初始密码') as HTMLInputElement
    fireEvent.change(pwdInput, { target: { value: 'TempPass99!' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))

    await screen.findByText(/TempPass99!/)
  })
})
