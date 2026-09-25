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
}
const row = (o: Partial<AdminUserDto>): AdminUserDto => ({
  ...admin,
  machineCount: 0,
  online: false,
  ...o,
})

class NoopSocket {
  close() {}
}

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
      '用量',
      '审计记录',
    ])
      expect(within(nav).getByText(t)).toBeTruthy()
    expect(screen.getByRole('link', { name: /返回消息/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '账户菜单' })).toBeTruthy()
  })

  it('lists accounts with role, machines and status', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({
      'GET /admin/users': [
        row({ machineCount: 2, online: true }),
        row({ id: 'u1', account: 'wanglei', name: '王磊', role: 'member', machineCount: 1 }),
        row({ id: 'u2', account: 'zhaomin', name: '赵敏', role: 'member', mustChangePassword: true }),
        row({ id: 'u3', account: 'liuyang', name: '刘洋', role: 'member', disabled: true }),
      ],
    })
    renderAt('/admin/users')
    expect(await screen.findByRole('heading', { name: '账号与角色' })).toBeTruthy()
    for (const h of ['成员', '账号', '角色', '机器', '状态'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const rowOf = (account: string) =>
      screen.getByRole('gridcell', { name: account }).closest('[role="row"]') as HTMLElement
    const cells = (account: string) =>
      within(rowOf(account))
        .getAllByRole('gridcell')
        .map((c) => c.textContent)
    expect(cells('chenchen')).toEqual(['陈晨陈晨', 'chenchen', '系统管理员', '2 台 · 在线', '正常', '编辑…'])
    expect(cells('wanglei').slice(2, 5)).toEqual(['普通成员', '1 台 · 离线', '正常'])
    expect(cells('zhaomin').slice(3, 5)).toEqual(['未绑定', '待修改密码'])
    expect(cells('liuyang').slice(3, 5)).toEqual(['--', '已停用'])
    const edit = within(rowOf('chenchen')).getByRole('button', { name: '编辑…' })
    expect(edit.className).toContain('ui-btn--small')
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
    expect(within(await rowOf('chenchen')).queryByRole('button', { name: '重置密码…' })).toBeNull()
    fireEvent.click(within(await rowOf('wanglei')).getByRole('button', { name: '重置密码…' }))
    const dialog = screen.getByRole('dialog', { name: '重置 王磊 的密码' })
    const temp = (within(dialog).getByLabelText('临时密码') as HTMLInputElement).value
    expect(temp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/)
    fireEvent.click(within(dialog).getByRole('button', { name: '重置并复制' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.path === '/admin/users/u1/password')?.body).toEqual({ password: temp })
  })

  it('keeps members out of the admin console', async () => {
    useSession.setState({ user: { ...admin, role: 'member' }, status: 'ready' })
    mockApi({ 'GET /groups': [], 'GET /bots': [], 'GET /machines': [], 'GET /notifications': [] })
    renderAt('/admin/bots')
    expect(await screen.findByRole('navigation', { name: '会话列表' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '管理后台' })).toBeNull()
    expect(screen.queryByRole('link', { name: '管理后台' })).toBeNull()
    expect(screen.queryByRole('button', { name: '管理后台' })).toBeNull()
  })

  it('shows usage by bot, trigger user and group', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({
      'GET /usage?by=bot&days=30': [
        { key: 'b1', name: '小王的 Claude', runs: 58, totalTokens: 412_000, unreported: 0 },
        { key: 'b2', name: '老李的 Codex', runs: 41, totalTokens: 0, unreported: 41 },
      ],
      'GET /usage?by=user&days=30': [
        { key: 'u1', name: '王磊', runs: 61, totalTokens: 356_000, unreported: 0 },
      ],
    })
    renderAt('/admin/usage')
    expect(await screen.findByRole('heading', { name: '用量' })).toBeTruthy()
    await screen.findByText('小王的 Claude')
    const table = screen.getByRole('grid', { name: '用量明细' })
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(['小王的 Claude412k580', '老李的 Codex未上报4141'])
    expect(screen.getByRole('meter', { name: 'token 分布' })).toBeTruthy()
    expect(screen.getByText(/不做配额限制/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '按触发人' }))
    expect(await screen.findByText('王磊')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '按群' })).toBeTruthy()
  })
})
