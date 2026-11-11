import type { GroupDto, MachineDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'xiaoli',
  name: '小李',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const team = { id: 't1', name: '团队', avatar: null, archivedAt: null, createdAt: '', unread: 0 }

class NoopSocket {
  close() {}
}

function At() {
  return <div data-testid="at">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <At />
    </MemoryRouter>,
  )
}

const routes = (o: { groups?: GroupDto[]; machines?: MachineDto[] } = {}) => ({
  'GET /groups': () => o.groups ?? [],
  'GET /bots': () => [],
  'GET /machines': () => o.machines ?? [],
  'GET /notifications/unread': () => ({ n: 0 }),
  'GET /terminal-spaces': () => [],
})

const rail = () => screen.getByRole('navigation', { name: '应用导航' })

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({
    user: me,
    status: 'ready',
    tenancy: {
      teams: [{ ...team, role: 'member' }],
      singleTeamMode: true,
      canCreateTeam: false,
      demoMode: false,
      pluginsEnabled: false,
    },
  })
  useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('gg.builder')
})

describe('使用者 / 搭建者', () => {
  it('shows a member owning nothing only 消息 and 通知, and the 使用者 welcome', async () => {
    mockApi(routes())
    renderAt('/')
    const welcome = await within(screen.getByRole('main')).findByRole('region', { name: '开始使用' })
    expect(within(welcome).getByText('等同事把你拉进群，在群里 @ Bot 直接提问就行。')).toBeTruthy()
    expect(within(welcome).getByText('@Bot 帮我查一下上个月的销售额')).toBeTruthy()
    expect(within(welcome).queryByRole('button', { name: '开始绑定' })).toBeNull()
    expect(within(rail()).queryByRole('button', { name: '市场' })).toBeNull()
    expect(within(rail()).queryByRole('button', { name: '机器与 Bot' })).toBeNull()
    expect(within(rail()).getByRole('button', { name: /^消息/ })).toBeTruthy()
    expect(within(rail()).getByRole('button', { name: /^通知/ })).toBeTruthy()

    fireEvent.click(within(welcome).getByRole('button', { name: '我想搭自己的 Bot' }))
    for (const b of ['开始绑定', '新建 Bot', '发起会话'])
      expect(await within(welcome).findByRole('button', { name: b })).toBeTruthy()
    expect(localStorage.getItem('gg.builder')).toBe('1')
    expect(within(rail()).getByRole('button', { name: '机器与 Bot' })).toBeTruthy()
  })

  it('offers 搭建自己的 Bot in the account menu, which opens 机器与 Bot with the full rail', async () => {
    mockApi({ ...routes(), 'GET /bots/owners': () => [{ id: 'u1', name: '小李', machines: [] }] })
    renderAt('/')
    await screen.findByRole('region', { name: '开始使用' })
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '搭建自己的 Bot' }))
    await waitFor(() => expect(screen.getByTestId('at').textContent).toBe('/machines'))
    expect(within(rail()).getByRole('button', { name: '市场' })).toBeTruthy()
    expect(within(rail()).getByRole('button', { name: '机器与 Bot' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: '搭建自己的 Bot' })).toBeNull()
  })

  it('still opens /machines directly for a 使用者', async () => {
    mockApi({ ...routes(), 'GET /bots/owners': () => [{ id: 'u1', name: '小李', machines: [] }] })
    renderAt('/machines')
    expect(await screen.findByRole('navigation', { name: '机器与 Bot' })).toBeTruthy()
    expect(within(rail()).queryByRole('button', { name: '机器与 Bot' })).toBeNull()
  })

  it('counts owning a machine, a group admin seat, a team role or sysadmin as a builder', async () => {
    mockApi(routes())
    renderAt('/')
    await screen.findByRole('region', { name: '开始使用' })
    const builder = () => within(rail()).queryByRole('button', { name: '机器与 Bot' }) !== null
    expect(builder()).toBe(false)

    act(() => useWorkspace.setState({ machines: [{ id: 'm1', ownerId: 'u1' } as MachineDto] }))
    expect(builder()).toBe(true)
    act(() => useWorkspace.setState({ machines: [{ id: 'm1', ownerId: 'u2' } as MachineDto] }))
    expect(builder()).toBe(false)

    act(() =>
      useWorkspace.setState({
        groups: [
          {
            id: 'g1',
            teamId: 't1',
            name: '销售群',
            kind: 'group',
            mode: 'partition',
            adminOnlyInvite: false,
            protectBase: false,
            notice: '',
            noticeHidden: false,
            avatar: null,
            repo: null,
            members: [{ userId: 'u1', name: '小李', avatar: null, isAdmin: true }],
            botIds: [],
            unread: 0,
            lastSeq: 0,
            last: '',
            pinned: false,
            notifyLevel: 'mentions',
            foldRuns: false,
            liveRunIds: [],
            liveRuns: [],
          },
        ],
      }),
    )
    expect(builder()).toBe(true)
    act(() => useWorkspace.setState({ groups: [] }))

    act(() => useSession.getState().setTeams((teams) => teams.map((x) => ({ ...x, role: 'admin' }))))
    expect(builder()).toBe(true)
    act(() => useSession.getState().setTeams((teams) => teams.map((x) => ({ ...x, role: 'member' }))))
    expect(builder()).toBe(false)

    act(() => useSession.setState({ user: { ...me, role: 'sysadmin' } }))
    expect(builder()).toBe(true)
  })
})
