import { readFileSync } from 'node:fs'
import type { AdminUserDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
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
const row = (o: Partial<AdminUserDto>): AdminUserDto => ({
  ...admin,
  machineCount: 0,
  online: false,
  teams: [],
  ...o,
})

class NoopSocket {
  close() {}
}

/** Picks an item from a row's trailing「操作」pull-down. */
const rowAction = (r: HTMLElement, item: string) => {
  fireEvent.click(within(r).getByRole('button', { name: '操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}
const menuItems = () => screen.getAllByRole('menuitem').map((m) => m.textContent)

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

beforeEach(() => vi.stubGlobal('WebSocket', NoopSocket))
afterEach(() => vi.unstubAllGlobals())

describe('admin console', () => {
  it('has the prototype navigation groups', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({ 'GET /admin/users': [] })
    renderAt('/admin/users')
    const nav = await screen.findByRole('navigation', { name: '管理后台' })
    for (const t of [
      '管理',
      '配置',
      '观测',
      '账号与角色',
      'Bot',
      '群',
      '配置中心',
      '系统参数',
      '机器',
      '会话统计',
      '用量',
      '审计记录',
    ])
      expect(within(nav).getByText(t)).toBeTruthy()
    expect(screen.getByRole('link', { name: /返回消息/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '账户菜单' })).toBeTruthy()
  })

  it('keeps 返回消息 first and pinned in the phone tab row, not scrolled off its far end', () => {
    const css = readFileSync('src/features/admin/admin.css', 'utf8')
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'))
    const back = phone.slice(
      phone.indexOf('.admin__back {'),
      phone.indexOf('}', phone.indexOf('.admin__back {')),
    )
    expect(back).toContain('order: -1')
    expect(back).toContain('position: sticky')
  })

  it('shows every admin table as cards on a phone, keeping status and row actions', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(max-width: 767px)',
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }))
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({ 'GET /admin/users': [row({ id: 'u1', account: 'wanglei', name: '王磊', role: 'member' })] })
    renderAt('/admin/users')
    const grid = await screen.findByRole('grid', { name: '账号列表' })
    expect(grid.className).toContain('ui-table--cards')
    const card = screen.getByRole('gridcell', { name: 'wanglei' }).closest('[role="row"]') as HTMLElement
    const texts = within(card)
      .getAllByRole('gridcell')
      .map((c) => c.textContent)
    expect(texts).toContain('状态：正常')
    expect(within(card).getByRole('button', { name: '操作' })).toBeTruthy()
  })

  it('lists accounts with role, machines and status', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({
      'GET /admin/users': [
        row({ machineCount: 2, online: true, teams: ['默认团队', '风控组'] }),
        row({ id: 'u1', account: 'wanglei', name: '王磊', role: 'member', machineCount: 1 }),
        row({ id: 'u2', account: 'zhaomin', name: '赵敏', role: 'member', mustChangePassword: true }),
        row({ id: 'u3', account: 'liuyang', name: '刘洋', role: 'member', disabled: true }),
      ],
    })
    renderAt('/admin/users')
    expect(await screen.findByRole('heading', { name: '账号与角色' })).toBeTruthy()
    for (const h of ['成员', '账号', '所属团队', '角色', '机器', '状态'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const rowOf = (account: string) =>
      screen.getByRole('gridcell', { name: account }).closest('[role="row"]') as HTMLElement
    const cells = (account: string) =>
      within(rowOf(account))
        .getAllByRole('gridcell')
        .map((c) => c.textContent)
    expect(cells('chenchen')).toEqual([
      '陈晨陈晨',
      'chenchen',
      '默认团队、风控组',
      '系统管理员',
      '2 台 · 在线',
      '正常',
      '',
    ])
    expect(cells('wanglei').slice(2, 6)).toEqual(['--', '普通成员', '1 台 · 离线', '正常'])
    expect(cells('zhaomin').slice(4, 6)).toEqual(['未绑定', '待修改密码'])
    expect(cells('liuyang').slice(4, 6)).toEqual(['--', '已停用'])
    // Row actions live in one trailing「操作」pull-down; my own row can only be edited.
    const more = within(rowOf('chenchen')).getByRole('button', { name: '操作' })
    expect(more.className).toContain('ui-btn--small')
    fireEvent.click(more)
    expect(menuItems()).toEqual(['编辑…'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.click(within(rowOf('wanglei')).getByRole('button', { name: '操作' }))
    expect(menuItems()).toEqual(['编辑…', '重置密码…', '停用…'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    // Right-click offers the same actions.
    fireEvent.contextMenu(rowOf('liuyang'))
    expect(menuItems()).toEqual(['编辑…', '启用'])
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑…' }))
    expect(await screen.findByRole('dialog', { name: '编辑成员 刘洋' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Enter (or a double click) on a selected row opens the same dialog.
    fireEvent.mouseDown(rowOf('wanglei'))
    fireEvent.keyDown(screen.getByRole('grid', { name: '账号列表' }), { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: '编辑成员 王磊' })).toBeTruthy()
    expect(screen.queryByText(/一期|二期|OIDC/)).toBeNull()
  })

  it('creates an account', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    const created = row({
      id: 'u9',
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      mustChangePassword: true,
    })
    let list: AdminUserDto[] = [row({})]
    const calls = mockApi({
      'GET /admin/users': () => list,
      'POST /admin/users': () => {
        list = [...list, created]
        return created
      },
    })
    renderAt('/admin/users')
    fireEvent.click(await screen.findByRole('button', { name: '新建账号…' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('账号'), { target: { value: 'wanglei' } })
    fireEvent.change(within(dialog).getByLabelText('姓名'), { target: { value: '王磊' } })
    fireEvent.change(within(dialog).getByLabelText('初始密码'), { target: { value: 'wanglei-init' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(await screen.findByRole('gridcell', { name: 'wanglei' })).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      password: 'wanglei-init',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('resets a member password to a generated temporary one', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    const wanglei = row({ id: 'u1', account: 'wanglei', name: '王磊', role: 'member' })
    const calls = mockApi({
      'GET /admin/users': [row({}), wanglei],
      'POST /admin/users/u1/password': { ...wanglei, mustChangePassword: true },
    })
    renderAt('/admin/users')
    const rowOf = async (a: string) =>
      (await screen.findByRole('gridcell', { name: a })).closest('[role="row"]') as HTMLElement
    fireEvent.click(within(await rowOf('chenchen')).getByRole('button', { name: '操作' }))
    expect(screen.queryByRole('menuitem', { name: '重置密码…' })).toBeNull()
    rowAction(await rowOf('wanglei'), '重置密码…')
    const dialog = screen.getByRole('dialog', { name: '重置 王磊 的密码' })
    const temp = (within(dialog).getByLabelText('临时密码') as HTMLInputElement).value
    expect(temp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/)
    fireEvent.click(within(dialog).getByRole('button', { name: '重置并复制' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.path === '/admin/users/u1/password')?.body).toEqual({ password: temp })
  })

  it('keeps members out of the admin console', async () => {
    useSession.setState({ user: { ...admin, role: 'member' }, status: 'ready' })
    mockApi({
      'GET /groups': [],
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications/unread': { n: 0 },
    })
    renderAt('/admin/bots')
    expect(await screen.findByRole('navigation', { name: '会话列表' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '管理后台' })).toBeNull()
    expect(screen.queryByRole('link', { name: '管理后台' })).toBeNull()
    expect(screen.queryByRole('button', { name: '管理后台' })).toBeNull()
  })

  it('shows conversation stats across teams with breakdowns', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    const zero = { activeConversations: 0, userMessages: 0, botMessages: 0, activeUsers: 0, runs: 0 }
    const metrics = {
      activeConversations: 12,
      newConversations: 3,
      userMessages: 240,
      botMessages: 180,
      activeUsers: 9,
      runs: 200,
      endedRuns: 190,
      completedRuns: 171,
      avgRunMs: 95_000,
    }
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const overview = (days: number) => ({
      groups: 20,
      dms: 6,
      current: metrics,
      previous: { ...metrics, userMessages: 200 },
      daily: [
        { day: '2026-10-12', ...zero },
        { day: '2026-10-13', ...zero, userMessages: 30, botMessages: 20, runs: days },
      ],
      statuses: [
        { status: 'completed', count: 171 },
        { status: 'interrupted', count: 19 },
      ],
    })
    const conv = {
      kind: 'group',
      teamName: '默认团队',
      ownerName: '王磊',
      conversations: 1,
      userMessages: 50,
      botMessages: 40,
      activeUsers: 4,
      runs: 40,
      endedRuns: 40,
      completedRuns: 30,
      lastActiveAt: '2026-10-13T08:00:00.000Z',
    }
    const calls = mockApi({
      [`GET /admin/conversation-stats/overview?days=30&tz=${tz}`]: overview(30),
      [`GET /admin/conversation-stats/overview?days=7&tz=${tz}`]: overview(7),
      'GET /admin/conversation-stats?by=conversation&days=30': [
        { ...conv, key: 'g1', name: '支付服务重构' },
        {
          ...conv,
          key: 'd1',
          name: '小王的 Claude',
          kind: 'dm',
          userMessages: 5,
          endedRuns: 0,
          completedRuns: 0,
        },
      ],
      'GET /admin/conversation-stats?by=conversation&days=7': [],
      'GET /admin/conversation-stats/ops?days=30': {
        retention: { previous: 8, retained: 6 },
        activation: { joined: 5, activated: 2, medianHours: 3.5 },
        failures: {
          endedRuns: 190,
          failedRuns: 19,
          reasons: [
            { status: 'interrupted', step: '机器离线', count: 12 },
            { status: 'expired', step: '等待超时', count: 7 },
          ],
        },
        audience: { userRuns: 60, builderRuns: 140, users: 5, builders: 4 },
      },
      'GET /admin/conversation-stats?by=team&days=7': [
        { ...conv, key: 't1', name: '风控组', kind: null, ownerName: null, teamName: null, conversations: 8 },
      ],
      'GET /admin/teams': [],
    })
    renderAt('/admin/conversations')
    expect(await screen.findByRole('heading', { name: '会话统计' })).toBeTruthy()
    const tile = (label: string) => screen.getByText(label, { selector: '.usage-stat__label' }).parentElement!
    await waitFor(() => expect(tile('会话总数').textContent).toContain('26'))
    expect(tile('会话总数').textContent).toContain('群 20 · 私聊 6')
    expect(tile('用户消息').textContent).toContain('↑ 20%')
    expect(tile('成功率').textContent).toContain('90%')
    expect(tile('平均耗时').textContent).toContain('1 分 35 秒')
    expect(screen.getByRole('img', { name: '运行状态：已完成 90%，已中断 10%' })).toBeTruthy()
    expect(screen.getByRole('group', { name: /^近 30 天每日用户消息：合计 30/ })).toBeTruthy()

    const ops = await screen.findByRole('region', { name: '运营' })
    const opsTile = (label: string) =>
      within(ops).getByText(label, { selector: '.usage-stat__label' }).parentElement!
    await waitFor(() => expect(opsTile('留存').textContent).toContain('75%'))
    expect(opsTile('留存').textContent).toContain('前 30 天活跃 8 人，6 人回访')
    expect(opsTile('新成员激活').textContent).toContain('40%')
    expect(opsTile('新成员激活').textContent).toContain('新加入 5 人，2 人已发起运行 · 中位 3.5 小时')
    expect(opsTile('失败率').textContent).toContain('10%')
    expect(opsTile('使用者占比').textContent).toContain('30%')
    expect(opsTile('使用者占比').textContent).toContain('使用者 5 人 60 轮 · 搭建者 4 人 140 轮')
    const reasons = within(ops).getByRole('grid', { name: '失败原因' })
    expect(
      within(reasons)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual([expect.stringMatching(/^已中断机器离线12/), expect.stringMatching(/^已作废等待超时7/)])

    const table = await screen.findByRole('grid', { name: '会话明细' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^支付服务重构默认团队王磊5040440/),
      expect.stringMatching(/^小王的 Claude私聊默认团队王磊540440—/),
    ])
    expect(within(rows[1]!).getByText('—')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: '近 7 天' }))
    fireEvent.click(screen.getByRole('tab', { name: '按团队' }))
    await waitFor(() =>
      expect(within(screen.getByRole('grid', { name: '会话明细' })).getByText('风控组')).toBeTruthy(),
    )
    expect(calls.some((c) => c.path.startsWith('/admin/conversation-stats/overview?days=7'))).toBe(true)
    for (const name of ['按会话', '按成员', '按 Bot']) expect(screen.getByRole('tab', { name })).toBeTruthy()
  })

  it('shows usage by bot, trigger user and group', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({
      'GET /admin/usage?by=bot&days=30': [
        { key: 'b1', name: '小王的 Claude', runs: 58, totalTokens: 412_000, unreported: 0 },
        { key: 'b2', name: '老李的 Codex', runs: 41, totalTokens: 0, unreported: 41 },
      ],
      'GET /admin/usage?by=user&days=30': [
        { key: 'u1', name: '王磊', runs: 61, totalTokens: 356_000, unreported: 0 },
      ],
      [`GET /admin/usage/daily?days=60&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`]:
        [{ day: '2026-09-25', runs: 99, totalTokens: 412_000, unreported: 41 }],
    })
    renderAt('/admin/usage')
    expect(await screen.findByRole('heading', { name: '用量' })).toBeTruthy()
    const table = await screen.findByRole('grid', { name: '用量明细' })
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(['小王的 Claude412k580', '老李的 Codex未上报4141'])
    expect(screen.getByRole('img', { name: 'token 分布：小王的 Claude 100%' })).toBeTruthy()
    expect(screen.getByRole('group', { name: /^近 30 天每日 token：合计 412k tokens/ })).toBeTruthy()
    expect(screen.getByText(/不做配额限制/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '按触发人' }))
    await waitFor(() =>
      expect(within(screen.getByRole('grid', { name: '用量明细' })).getByText('王磊')).toBeTruthy(),
    )
    expect(screen.getByRole('tab', { name: '按群' })).toBeTruthy()
  })
})
