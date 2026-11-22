import { readFileSync } from 'node:fs'
import type { BotDto, GroupDto, GroupSchedulesDto, GroupTabDto, ScheduleDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GroupTabBar } from '../src/features/group-tabs/GroupTabBar'
import { ScheduleCard } from '../src/features/schedules/ScheduleCard'
import { ScheduleDialog } from '../src/features/schedules/ScheduleDialog'
import { SchedulesView } from '../src/features/schedules/SchedulesView'
import { resetSchedules } from '../src/features/schedules/store'
import { NewTabMenu } from '../src/features/workbench/NewTabMenu'
import { useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

class NoopSocket {
  close() {}
}

const bot = (o: Partial<BotDto> = {}): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: 'Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 1,
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

const group = (o: Partial<GroupDto> = {}): GroupDto =>
  ({
    id: 'g1',
    name: '支付',
    kind: 'group',
    botIds: ['b1'],
    members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
    ...o,
  }) as unknown as GroupDto

const schedule = (o: Partial<ScheduleDto> = {}): ScheduleDto => ({
  id: 's1',
  groupId: 'g1',
  name: '日报',
  prompt: '汇总昨天合并的 PR',
  cron: '0 9 * * 1-5',
  runAt: null,
  timezone: 'Asia/Shanghai',
  botIds: ['b1'],
  runOptions: {},
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

const tab = (o: Partial<GroupTabDto> & Pick<GroupTabDto, 'id' | 'title' | 'target'>): GroupTabDto => ({
  stale: false,
  createdBy: { name: '王磊', bot: false },
  createdAt: '2026-10-22T03:00:00.000Z',
  ...o,
})

const docs = tab({
  id: 't1',
  title: '接口文档',
  target: { kind: 'link', url: 'https://docs.example.com/', icon: null, embeddable: true },
})
const notice = tab({ id: 't2', title: '群公告', target: { kind: 'entry', entry: 'notice' } })

beforeEach(() => {
  localStorage.clear()
  resetSchedules()
  useToasts.setState({ items: [] })
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: { id: 'u1', name: '王磊' } as never, status: 'ready' })
  useWorkspace.setState({ groups: [group()], bots: [bot()], machines: [] })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('R3B P1-1: ScheduleDialog, ScheduleCard and SchedulesView', () => {
  it('deletes a manageable schedule in ScheduleDialog after confirmation and toasts', async () => {
    const calls = mockApi({
      'POST /schedules/preview': { error: null, next: ['2026-10-05T01:00:00.000Z'] },
      'DELETE /schedules/s1': undefined,
    })
    const onClose = vi.fn()
    render(<ScheduleDialog groupId="g1" botIds={['b1']} schedule={schedule()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    const confirm = await screen.findByRole('alertdialog', { name: '删除定时任务「日报」？' })
    expect(within(confirm).getByText('删除后不再按计划执行，历史运行记录仍保留在聊天中。')).toBeTruthy()

    // Cancel keeps the editor open and makes no DELETE call.
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()

    // Confirm deletes, toasts success, and closes the dialog.
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const confirmAgain = await screen.findByRole('alertdialog', { name: '删除定时任务「日报」？' })
    fireEvent.click(within(confirmAgain).getByRole('button', { name: '确认删除' }))

    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/schedules/s1', body: undefined }),
    )
    expect(useToasts.getState().items[0]).toMatchObject({ type: 'success', message: '已删除定时任务' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides delete in ScheduleDialog when creating or when canManage is false', () => {
    mockApi({ 'POST /schedules/preview': { error: null, next: ['2026-10-05T01:00:00.000Z'] } })
    const { rerender } = render(<ScheduleDialog groupId="g1" botIds={['b1']} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()

    rerender(
      <ScheduleDialog
        groupId="g1"
        botIds={['b1']}
        schedule={schedule({ canManage: false })}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
  })

  it('ScheduleCard locks 立即执行 and 暂停 while a request is in flight', async () => {
    let release = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    const calls = mockApi({
      'GET /groups/g1/schedules': list(schedule()),
      'POST /schedules/s1/run': () => held.then(() => schedule()),
    })
    render(<ScheduleCard scheduleId="s1" groupId="g1" fallback="Claude 创建了定时任务「日报」" />)
    await screen.findByText('日报')

    const run = screen.getByRole('button', { name: '立即执行' })
    fireEvent.click(run)
    fireEvent.click(run)
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/schedules/s1/run')).toHaveLength(1)

    release()
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false))
  })

  it('guards ScheduleCard deletion with ConfirmActionDialog instead of two-click delete', async () => {
    const calls = mockApi({
      'GET /groups/g1/schedules': list(schedule()),
      'DELETE /schedules/s1': undefined,
    })
    render(<ScheduleCard scheduleId="s1" groupId="g1" fallback="Claude 创建了定时任务「日报」" />)
    await screen.findByText('日报')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    const confirm = await screen.findByRole('alertdialog', { name: '删除定时任务「日报」？' })
    expect(within(confirm).getByText('删除后不再按计划执行，历史运行记录仍保留在聊天中。')).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const confirmAgain = await screen.findByRole('alertdialog', { name: '删除定时任务「日报」？' })
    fireEvent.click(within(confirmAgain).getByRole('button', { name: '确认删除' }))

    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/schedules/s1', body: undefined }),
    )
    expect(useToasts.getState().items[0]).toMatchObject({ type: 'success', message: '已删除定时任务' })
    expect(await screen.findByText('已删除')).toBeTruthy()
  })

  it('shows an error Alert with Retry when SchedulesView fails to load and recovers', async () => {
    let tries = 0
    const calls = mockApi({
      'GET /groups/g1/schedules': () => {
        tries++
        if (tries === 1) return apiError(500, 'internal_error', '服务暂时不可用')
        return list(schedule())
      },
    })
    render(<SchedulesView groupId="g1" />)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('定时任务加载失败')).toBeTruthy()
    expect(within(alert).getByText('服务暂时不可用')).toBeTruthy()
    expect(screen.queryByRole('status', { name: '加载中' })).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('日报')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls.filter((c) => c.path === '/groups/g1/schedules')).toHaveLength(2)
  })
})

describe('R3B P1-6: GroupTabBar, group-tabs.css and NewTabMenu', () => {
  it('requires ConfirmActionDialog before deleting a shared group tab and toasts', async () => {
    const g = group({ id: 'r3-tabs-del' })
    const calls = mockApi({
      'GET /groups/r3-tabs-del/tabs': { tabs: [docs, notice] },
      'DELETE /groups/r3-tabs-del/tabs/t1': { tabs: [notice] },
    })
    render(<GroupTabBar group={g} />)
    const tabButtons = await screen.findAllByTestId('group-tab')

    fireEvent.contextMenu(tabButtons[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除标签' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    const confirm = await screen.findByRole('alertdialog', { name: '删除标签「接口文档」？' })
    expect(within(confirm).getByText('所有群成员顶部标签栏将移除该入口，原内容本身不会被删除。')).toBeTruthy()

    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    fireEvent.contextMenu(tabButtons[0]!)
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除标签' }))
    const confirmAgain = await screen.findByRole('alertdialog', { name: '删除标签「接口文档」？' })
    fireEvent.click(within(confirmAgain).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/groups/r3-tabs-del/tabs/t1',
        body: undefined,
      }),
    )
    expect(useToasts.getState().items[0]).toMatchObject({ type: 'success', message: '已删除标签' })
    await waitFor(() =>
      expect(screen.getAllByTestId('group-tab').map((el) => el.textContent)).toEqual(['群公告']),
    )
  })

  it('copies tab links via copyText without navigator.clipboard and toasts on failure', async () => {
    const g = group({ id: 'r3-tabs-copy' })
    mockApi({ 'GET /groups/r3-tabs-copy/tabs': { tabs: [docs] } })

    const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const origExec = Object.getOwnPropertyDescriptor(document, 'execCommand')
    const execCommand = vi.fn(() => true)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    try {
      render(<GroupTabBar group={g} />)
      const tabBtn = await screen.findByTestId('group-tab')

      fireEvent.contextMenu(tabBtn)
      fireEvent.click(await screen.findByRole('menuitem', { name: '复制链接' }))
      await waitFor(() =>
        expect(useToasts.getState().items[0]).toMatchObject({ type: 'success', message: '已复制链接' }),
      )
      expect(execCommand).toHaveBeenCalledWith('copy')

      execCommand.mockReturnValue(false)
      useToasts.setState({ items: [] })
      fireEvent.contextMenu(tabBtn)
      fireEvent.click(await screen.findByRole('menuitem', { name: '复制链接' }))
      await waitFor(() =>
        expect(useToasts.getState().items[0]).toMatchObject({ type: 'error', message: '复制失败' }),
      )
    } finally {
      if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
      if (origExec) Object.defineProperty(document, 'execCommand', origExec)
      else Reflect.deleteProperty(document, 'execCommand')
    }
  })

  it('supports touch rename and delete via manage button and respects readOnly', async () => {
    const g = group({ id: 'r3-tabs-touch' })
    const calls = mockApi({
      'GET /groups/r3-tabs-touch/tabs': { tabs: [docs] },
      'PATCH /groups/r3-tabs-touch/tabs/t1': { tabs: [{ ...docs, title: 'API 文档' }] },
      'DELETE /groups/r3-tabs-touch/tabs/t1': { tabs: [] },
    })
    const { rerender } = render(<GroupTabBar group={g} />)
    await screen.findByTestId('group-tab')

    // Rename without contextmenu (works even with a single non-overflowing tab).
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '接口文档' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }))
    const renameDialog = await screen.findByRole('dialog', { name: '重命名标签' })
    fireEvent.click(within(renameDialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Delete via touch menu opens ConfirmActionDialog.
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '接口文档' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除标签' }))
    const confirm = await screen.findByRole('alertdialog', { name: '删除标签「接口文档」？' })
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    // Read-only hides manage & add buttons.
    rerender(<GroupTabBar group={g} readOnly />)
    expect(screen.queryByRole('button', { name: '管理标签' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加标签' })).toBeNull()
  })

  it('splits Presence wrappers in GroupTabBar and NewTabMenu for modal exit state', async () => {
    const g = group({ id: 'r3-tabs-presence' })
    mockApi({
      'GET /groups/r3-tabs-presence/tabs': { tabs: [docs] },
      'GET /groups/r3-tabs-presence/knowledge': { entries: [], canManage: false },
    })
    const { unmount } = render(<GroupTabBar group={g} />)
    fireEvent.click(await screen.findByRole('button', { name: '添加标签' }))
    expect(document.querySelector('.ui-overlay')?.getAttribute('data-state')).toBe('open')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    // Separate <Presence> keeps the overlay mounted in `closed` state during its exit transition.
    expect(document.querySelector('.ui-overlay')?.getAttribute('data-state')).toBe('closed')
    await waitFor(() => expect(document.querySelector('.ui-overlay')).toBeNull())
    unmount()

    render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '打开网页…' }))
    expect(document.querySelector('.ui-overlay')?.getAttribute('data-state')).toBe('open')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(document.querySelector('.ui-overlay')?.getAttribute('data-state')).toBe('closed')
    await waitFor(() => expect(document.querySelector('.ui-overlay')).toBeNull())
  })

  it('hides 添加群标签… in NewTabMenu for DM and when no group is active', async () => {
    const dm = group({ id: 'dm1', kind: 'dm', name: 'Claude' })
    useWorkspace.setState({ groups: [dm], bots: [bot()], machines: [] })
    useWorkbench.setState({ groupId: 'dm1' })

    const first = render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    expect(await screen.findByRole('menuitem', { name: '打开网页…' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '添加群标签…' })).toBeNull()
    first.unmount()

    useWorkbench.setState({ groupId: null })
    render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    expect(await screen.findByRole('menuitem', { name: '打开网页…' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '添加群标签…' })).toBeNull()
  })

  it('grows GroupTabBar touch targets to >=32px under @media (pointer: coarse)', () => {
    const css = readFileSync('src/features/group-tabs/group-tabs.css', 'utf8')
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.gtabs \{\s*height: 44px;[\s\S]*?\.gtab,\s*\.gtabs__more,\s*\.gtabs__add,\s*\.gtabs__manage \{\s*min-height: 32px;\s*min-width: 32px;/,
    )
  })
})
