import type { AdminUserDto, UserDto } from '@aiws/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { apiError, mockApi } from './mockApi'

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
      '机器与网络',
      '用量',
      '审计记录',
    ])
      expect(within(nav).getByText(t)).toBeTruthy()
    expect(screen.getByRole('link', { name: /返回群聊/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '账户菜单' })).toBeTruthy()
  })

  it('lists accounts with role, machines and status', async () => {
    useSession.setState({ user: admin, status: 'ready' })
    mockApi({
      'GET /admin/users': [
        row({ machineCount: 2, online: true }),
        row({ id: 'u1', account: 'wanglei', name: '王磊', role: 'member', machineCount: 1 }),
        row({ id: 'u2', account: 'zhaomin', name: '赵敏', role: 'member' }),
        row({ id: 'u3', account: 'liuyang', name: '刘洋', role: 'member', disabled: true }),
      ],
    })
    renderAt('/admin/users')
    expect(await screen.findByRole('heading', { name: '账号与角色' })).toBeTruthy()
    for (const h of ['成员', '账号', '角色', '机器', '状态'])
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    const cells = (account: string) =>
      within(screen.getByRole('cell', { name: account }).closest('tr') as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    expect(cells('chenchen')).toEqual(['陈陈晨', 'chenchen', '系统管理员', '2 台', '在线', '编辑'])
    expect(cells('wanglei').slice(2, 5)).toEqual(['普通成员', '1 台', '离线'])
    expect(cells('zhaomin').slice(3, 5)).toEqual(['0 台', '未绑定'])
    expect(cells('liuyang').slice(3, 5)).toEqual(['—', '已停用'])
    const edit = within(
      screen.getByRole('cell', { name: 'chenchen' }).closest('tr') as HTMLElement,
    ).getByRole('button', { name: '编辑' })
    expect(edit.className).toContain('ui-btn--outline')
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
    fireEvent.click(await screen.findByRole('button', { name: '新建账号' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('账号'), { target: { value: 'wanglei' } })
    fireEvent.change(within(dialog).getByLabelText('姓名'), { target: { value: '王磊' } })
    fireEvent.change(within(dialog).getByLabelText('初始密码'), { target: { value: 'wanglei-init' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(await screen.findByRole('cell', { name: 'wanglei' })).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      account: 'wanglei',
      name: '王磊',
      role: 'member',
      password: 'wanglei-init',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tells members they cannot manage accounts', async () => {
    useSession.setState({ user: { ...admin, role: 'member' }, status: 'ready' })
    mockApi({ 'GET /admin/users': () => apiError(403, 'forbidden', '仅系统管理员可操作') })
    renderAt('/admin/users')
    expect(await screen.findByText('仅系统管理员可管理账号与角色')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新建账号' })).toBeNull()
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
    expect(screen.getAllByTestId('usage-row').map((r) => r.textContent)).toEqual([
      '小王的 Claude412k tokens58 轮',
      '老李的 Codex未上报41 轮',
    ])
    expect(screen.getByText(/不做配额限制/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '按触发人' }))
    expect(await screen.findByText('王磊')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '按群' })).toBeTruthy()
  })
})
