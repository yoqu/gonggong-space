import type { BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { WorkspaceBanner } from '../src/features/chat/WorkspaceBanner'
import { mockApi } from './mockApi'

const group = (o: Partial<GroupDto> = {}) =>
  ({ id: 'g1', mode: 'partition', repo: null, botIds: ['b1'], ...o }) as GroupDto
const bot = (o: Partial<BotDto> = {}) =>
  ({
    id: 'b1',
    name: '小王的 Claude',
    ownerId: 'u1',
    ownerName: '王磊',
    machineId: 'm1',
    defaultWorkspace: null,
    model: null,
    effort: null,
    catalog: null,
    ...o,
  }) as BotDto
const unbound = (error: string | null = null) => ({
  g1: {
    b1: {
      botId: 'b1',
      workspace: 'managed',
      state: 'unbound',
      path: null,
      git: null,
      error,
      reason: null,
      tier: null,
      model: null,
      effort: null,
      context: null,
    } as const,
  },
})
const listing = (path: string) => ({
  path,
  entries: [{ name: 'pay', git: true }],
  git: null,
  unusable: null,
  roots: ['/'],
})

beforeEach(() => useSession.setState({ user: { id: 'u1' } as UserDto, status: 'ready' }))
afterEach(() => vi.unstubAllGlobals())

describe('workspace banner', () => {
  it('lets the owner browse the machine and bind a directory', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: unbound() })
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /machines/m1/dirs?path=%2FUsers%2Fw%2Fpay': {
        ...listing('/Users/w/pay'),
        entries: [],
        git: { root: '/Users/w/pay', remotes: ['git@x:pay.git'], branch: 'main' },
      },
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group()} />)
    expect(screen.getByTestId('ws-banner-b1').textContent).toContain(
      '为 小王的 Claude 选择工作区后才能开始工作，此前 @ 它不会执行',
    )
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('pay'))
    expect((await screen.findByTestId('dirpick-git')).textContent).toContain('git 仓库 · main')
    fireEvent.click(screen.getByText('选择此目录'))
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        path: '/groups/g1/bots/b1/workspace',
        body: { path: '/Users/w/pay' },
      }),
    )
    await waitFor(() => expect(screen.queryByText('选择此目录')).toBeNull())
  })

  it('goes up to the drive root and switches drives on Windows', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: unbound() })
    const [c, d] = ['C:\\', 'D:\\']
    const win = (path: string, name: string) => ({
      ...listing(path),
      entries: [{ name, git: false }],
      roots: [c, d],
    })
    const calls = mockApi({
      'GET /machines/m1/dirs': win('C:\\Users', 'w'),
      [`GET /machines/m1/dirs?path=${encodeURIComponent(c)}`]: win(c, 'Users'),
      [`GET /machines/m1/dirs?path=${encodeURIComponent(d)}`]: win(d, 'code'),
    })
    render(<WorkspaceBanner group={group()} />)
    fireEvent.click(screen.getByText('绑定工作区'))
    await screen.findByText('w')
    fireEvent.click(screen.getByRole('button', { name: '上一级' }))
    await screen.findByText('Users')
    expect(screen.getByRole('button', { name: '上一级' }).hasAttribute('disabled')).toBe(true)
    const drive = screen.getByRole('button', { name: '磁盘' })
    expect(drive.textContent).toContain('C:')
    fireEvent.click(drive)
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'D:' }))
    await screen.findByText('code')
    expect(calls.at(-1)?.path).toBe(`/machines/m1/dirs?path=${encodeURIComponent(d)}`)
  })

  it('opens on a too-broad home directory with a neutral hint instead of an error', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: unbound() })
    mockApi({
      'GET /machines/m1/dirs': { ...listing('/Users/w'), unusable: '目录范围过大，请选择具体的项目目录' },
    })
    render(<WorkspaceBanner group={group()} />)
    fireEvent.click(screen.getByText('绑定工作区'))
    await screen.findByText('pay')
    expect(screen.queryByText('目录范围过大，请选择具体的项目目录')).toBeNull()
    expect(screen.getByText('进入具体项目目录后选择')).toBeTruthy()
    const choose = screen.getByRole('button', { name: '选择此目录' })
    expect(choose.hasAttribute('disabled')).toBe(true)
    expect(choose.getAttribute('title')).toBe('目录范围过大，请选择具体的项目目录')
  })

  it('offers the default workspace and the managed clone of the group repo', async () => {
    useWorkspace.setState({ bots: [bot({ defaultWorkspace: '/src/pay' })], botStates: unbound() })
    const calls = mockApi({
      'GET /machines/m1/dirs?path=%2Fsrc%2Fpay': {
        ...listing('/src/pay'),
        git: { root: '/src/pay', remotes: ['https://git.corp/team/pay.git'], branch: 'main' },
      },
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@git.corp:team/pay.git', branch: 'main' } })} />)
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('托管克隆群仓库'))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: null }))
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('使用默认工作区'))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: '/src/pay' }))
  })

  it('warns before binding a directory outside the group repo', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: unbound() })
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /machines/m1/dirs?path=%2FUsers%2Fw%2Fpay': {
        ...listing('/Users/w/pay'),
        entries: [],
        git: { root: '/Users/w/pay', remotes: ['git@git.corp:team/other.git'], branch: 'main' },
      },
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@git.corp:team/pay.git', branch: 'main' } })} />)
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('pay'))
    await screen.findByTestId('dirpick-git')
    fireEvent.click(screen.getByText('选择此目录'))
    expect(await screen.findByText('该目录不是群仓库')).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    fireEvent.click(screen.getByText('仍然使用'))
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        path: '/groups/g1/bots/b1/workspace',
        body: { path: '/Users/w/pay', force: true },
      }),
    )
  })

  it('folds several of my unbound bots into one line with a button each', () => {
    const state = (id: string) =>
      ({
        botId: id,
        workspace: 'managed',
        state: 'unbound',
        path: null,
        git: null,
        error: null,
        reason: null,
        tier: null,
        model: null,
        effort: null,
        context: null,
      }) as const
    useWorkspace.setState({
      bots: [bot(), bot({ id: 'b2', name: '小王的 Codex' })],
      botStates: { g1: { b1: state('b1'), b2: state('b2') } },
    })
    render(<WorkspaceBanner group={group({ botIds: ['b1', 'b2'] })} />)
    expect(screen.getByText('2 个 Bot 还没有工作区，此前 @ 它们不会执行')).toBeTruthy()
    expect(screen.getByTestId('ws-banner-b1').textContent).toBe('绑定 小王的 Claude')
    expect(screen.getByTestId('ws-banner-b2').textContent).toBe('绑定 小王的 Codex')
  })

  it('tells other members who has to bind, and shows nothing once bound', () => {
    useSession.setState({ user: { id: 'u2' } as UserDto, status: 'ready' })
    useWorkspace.setState({ bots: [bot()], botStates: unbound('目录不存在') })
    const { rerender } = render(<WorkspaceBanner group={group()} />)
    expect(screen.getByTestId('ws-banner-b1').textContent).toBe(
      '等待 王磊 为 小王的 Claude 绑定工作区 · 目录不存在',
    )
    expect(screen.queryByText('绑定工作区')).toBeNull()
    useWorkspace.setState({ botStates: {} })
    rerender(<WorkspaceBanner group={group()} />)
    expect(screen.queryByTestId('ws-banner-b1')).toBeNull()
  })

  it('offers directories on my machine that already hold the group repo', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: unbound() })
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /groups/g1/local-paths': [
        { machineId: 'm1', path: '/Users/w/code/pay' },
        { machineId: 'm9', path: '/elsewhere/pay' },
      ],
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@x:pay.git', branch: 'main' } })} />)
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('/Users/w/code/pay'))
    expect(screen.queryByText('/elsewhere/pay')).toBeNull()
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: '/Users/w/code/pay' }))
  })

  const paused = {
    g1: {
      b1: {
        botId: 'b1',
        workspace: 'managed',
        state: 'failed',
        path: null,
        git: null,
        error: 'clone 失败：Repository not found.',
        reason: 'denied',
        tier: null,
        model: null,
        effort: null,
        context: null,
      } as const,
    },
  }
  const members = (admin: boolean) => [{ userId: 'u2', name: '陈晨', avatar: null, isAdmin: admin }]

  it('shows paused bots; their owner rechecks', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: paused })
    const calls = mockApi({ 'POST /groups/g1/bots/b1/recheck': undefined })
    render(<WorkspaceBanner group={group({ members: members(false) })} />)
    expect(screen.getByTestId('ws-paused-b1').textContent).toContain(
      '小王的 Claude 已暂停：所在机器无法访问仓库（无权限或仓库不存在），在这台机器上配置 git 凭据后重新检查',
    )
    fireEvent.click(screen.getByText('重新检查'))
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/groups/g1/bots/b1/recheck' }),
    )
  })

  it('lets group admins recheck other people’s paused bots, not plain members', () => {
    useSession.setState({ user: { id: 'u2' } as UserDto, status: 'ready' })
    useWorkspace.setState({ bots: [bot()], botStates: paused })
    const { rerender } = render(<WorkspaceBanner group={group({ members: members(false) })} />)
    expect(screen.getByTestId('ws-paused-b1').textContent).toContain('等待 王磊 处理')
    expect(screen.queryByText('重新检查')).toBeNull()
    rerender(<WorkspaceBanner group={group({ members: members(true) })} />)
    expect(screen.getByText('重新检查')).toBeTruthy()
  })
})
