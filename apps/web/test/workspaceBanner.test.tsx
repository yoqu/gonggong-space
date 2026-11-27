import type { BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { WorkspaceBanner } from '../src/features/chat/WorkspaceBanner'
import { WorkspacePicker } from '../src/features/workspaces/WorkspacePicker'
import { mockApi } from './mockApi'

const tree = (ui: ReactNode) => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={ui} />
      <Route path="/machine/:id" element={<MachinePath />} />
    </Routes>
  </MemoryRouter>
)
const render = (ui: ReactNode) => rtlRender(tree(ui))
function MachinePath() {
  const at = useLocation()
  return <span data-testid="machine-path">{`${at.pathname}${at.search}`}</span>
}

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
      extraDirs: [] as string[],
      repoPaths: {} as Record<string, string>,
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
  it('asks the owner to confirm a joining bot’s workspace, offering local clones the machine found', async () => {
    const state = unbound().g1.b1
    useWorkspace.setState({ bots: [bot()], botStates: { g1: { b1: { ...state, state: 'confirm' } } } })
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /groups/g1/local-paths': [{ machineId: 'm1', path: '/Users/w/old/pay' }],
      'GET /groups/g1/bots/b1/repo-candidates': {
        managedPath: '/Users/w/.gonggong/workspaces/g1/b1/r1',
        paths: ['/Users/w/code/pay', '/Users/w/old/pay'],
      },
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    const repo = { url: 'git@git.corp:pay/pay.git', branch: 'main' }
    render(<WorkspaceBanner group={group({ repo })} />)
    expect(screen.getByTestId('ws-banner-b1').textContent).toContain(
      '请先为 小王的 Claude 确认工作区，确认后即可开始工作',
    )
    fireEvent.click(screen.getByText('确认工作区'))
    expect(await screen.findByText('/Users/w/code/pay')).toBeTruthy()
    expect(screen.getAllByText('/Users/w/old/pay')).toHaveLength(1)
    expect(
      await screen.findByText('克隆 git@git.corp:pay/pay.git 到 /Users/w/.gonggong/workspaces/g1/b1/r1'),
    ).toBeTruthy()
    fireEvent.click(screen.getByText('/Users/w/code/pay'))
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        path: '/groups/g1/bots/b1/workspace',
        body: { path: '/Users/w/code/pay' },
      }),
    )
  })

  it('tells others the owner has to confirm', () => {
    const state = unbound().g1.b1
    useWorkspace.setState({
      bots: [bot({ ownerId: 'u2' })],
      botStates: { g1: { b1: { ...state, state: 'confirm' } } },
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@git.corp:pay/pay.git', branch: 'main' } })} />)
    expect(screen.getByTestId('ws-banner-b1').textContent).toContain('等待 王磊 为 小王的 Claude 确认工作区')
    expect(screen.queryByText('确认工作区')).toBeNull()
  })

  it('does not render any top banner for unbound bots in non-repo groups', () => {
    const state = (id: string, error: string | null = null) =>
      ({
        botId: id,
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
        extraDirs: [] as string[],
        repoPaths: {} as Record<string, string>,
      }) as const
    useWorkspace.setState({
      bots: [bot(), bot({ id: 'b2', name: '小王的 Codex' })],
      botStates: { g1: { b1: state('b1'), b2: state('b2') } },
    })
    const { container, rerender } = render(<WorkspaceBanner group={group({ botIds: ['b1', 'b2'] })} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('ws-banner-b1')).toBeNull()
    expect(screen.queryByText(/还没有选工作区/)).toBeNull()

    // Non-owner with an error string on an unbound non-repo bot still renders no top banner.
    useSession.setState({ user: { id: 'u2' } as UserDto, status: 'ready' })
    useWorkspace.setState({ bots: [bot()], botStates: unbound('目录不存在') })
    rerender(tree(<WorkspaceBanner group={group()} />))
    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('ws-banner-b1')).toBeNull()
  })

  it('folds several of my confirm bots into one line with a button each', () => {
    const state = (id: string) =>
      ({
        botId: id,
        workspace: 'managed',
        state: 'confirm',
        path: null,
        git: null,
        error: null,
        reason: null,
        tier: null,
        model: null,
        effort: null,
        context: null,
        extraDirs: [] as string[],
        repoPaths: {} as Record<string, string>,
      }) as const
    useWorkspace.setState({
      bots: [bot(), bot({ id: 'b2', name: '小王的 Codex' })],
      botStates: { g1: { b1: state('b1'), b2: state('b2') } },
    })
    render(
      <WorkspaceBanner
        group={group({ botIds: ['b1', 'b2'], repo: { url: 'git@git.corp:pay/pay.git', branch: 'main' } })}
      />,
    )
    expect(screen.getByText('请先为 2 个 Bot 确认工作区，确认后即可开始工作')).toBeTruthy()
    expect(screen.getByTestId('ws-banner-b1').textContent).toBe('确认 小王的 Claude')
    expect(screen.getByTestId('ws-banner-b2').textContent).toBe('确认 小王的 Codex')
  })

  it('lets the owner browse the machine and bind a directory', async () => {
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /machines/m1/dirs?path=%2FUsers%2Fw%2Fpay': {
        ...listing('/Users/w/pay'),
        entries: [],
        git: { root: '/Users/w/pay', remotes: ['git@x:pay.git'], branch: 'main' },
      },
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    const onClose = vi.fn()
    render(<WorkspacePicker group={group()} bot={{ ...bot(), machineId: 'm1' }} onClose={onClose} />)
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
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('goes up to the drive root and switches drives on Windows', async () => {
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
    render(<WorkspacePicker group={group()} bot={{ ...bot(), machineId: 'm1' }} onClose={() => {}} />)
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
    mockApi({
      'GET /machines/m1/dirs': { ...listing('/Users/w'), unusable: '目录范围过大，请选择具体的项目目录' },
    })
    render(<WorkspacePicker group={group()} bot={{ ...bot(), machineId: 'm1' }} onClose={() => {}} />)
    await screen.findByText('pay')
    expect(screen.queryByText('目录范围过大，请选择具体的项目目录')).toBeNull()
    expect(screen.getByText('进入具体项目目录后选择')).toBeTruthy()
    const choose = screen.getByRole('button', { name: '选择此目录' })
    expect(choose.hasAttribute('disabled')).toBe(true)
    expect(choose.getAttribute('title')).toBe('目录范围过大，请选择具体的项目目录')
  })

  it('offers the default workspace and the managed clone of the group repo', async () => {
    const confirmState = { g1: { b1: { ...unbound().g1.b1, state: 'confirm' as const } } }
    useWorkspace.setState({ bots: [bot({ defaultWorkspace: '/src/pay' })], botStates: confirmState })
    const calls = mockApi({
      'GET /machines/m1/dirs?path=%2Fsrc%2Fpay': {
        ...listing('/src/pay'),
        git: { root: '/src/pay', remotes: ['https://git.corp/team/pay.git'], branch: 'main' },
      },
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@git.corp:team/pay.git', branch: 'main' } })} />)
    fireEvent.click(screen.getByText('确认工作区'))
    fireEvent.click(await screen.findByText('自动克隆群仓库'))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: null }))
    fireEvent.click(screen.getByText('确认工作区'))
    fireEvent.click(await screen.findByText('使用默认工作区'))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: '/src/pay' }))
  })

  it('warns before binding a directory outside the group repo', async () => {
    const confirmState = { g1: { b1: { ...unbound().g1.b1, state: 'confirm' as const } } }
    useWorkspace.setState({ bots: [bot()], botStates: confirmState })
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
    fireEvent.click(screen.getByText('确认工作区'))
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

  it('offers directories on my machine that already hold the group repo', async () => {
    const confirmState = { g1: { b1: { ...unbound().g1.b1, state: 'confirm' as const } } }
    useWorkspace.setState({ bots: [bot()], botStates: confirmState })
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /groups/g1/local-paths': [
        { machineId: 'm1', path: '/Users/w/code/pay' },
        { machineId: 'm9', path: '/elsewhere/pay' },
      ],
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@x:pay.git', branch: 'main' } })} />)
    fireEvent.click(screen.getByText('确认工作区'))
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
        extraDirs: [] as string[],
        repoPaths: {} as Record<string, string>,
      } as const,
    },
  }
  const members = (admin: boolean) => [{ userId: 'u2', name: '陈晨', avatar: null, isAdmin: admin }]

  it('shows paused bots; their owner rechecks', async () => {
    useWorkspace.setState({ bots: [bot()], botStates: paused })
    const calls = mockApi({ 'POST /groups/g1/bots/b1/recheck': undefined })
    render(<WorkspaceBanner group={group({ members: members(false) })} />)
    expect(screen.getByTestId('ws-paused-b1').textContent).toContain(
      '小王的 Claude 已暂停：所在电脑连不上仓库（无权限或仓库不存在），在这台电脑的「Git 访问」里配置后重新检查',
    )
    fireEvent.click(screen.getByText('重新检查'))
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/groups/g1/bots/b1/recheck' }),
    )
  })

  it("takes the owner to the machine's Git 访问 with the repo to test", () => {
    useWorkspace.setState({ bots: [bot()], botStates: paused })
    const repo = { url: 'https://git.corp/pay/pay.git', branch: 'main' }
    render(<WorkspaceBanner group={group({ repo, members: members(false) })} />)
    fireEvent.click(screen.getByText('去配置'))
    expect(screen.getByTestId('machine-path').textContent).toBe(
      `/machine/${bot().machineId}?tab=git&repo=${encodeURIComponent(repo.url)}`,
    )
  })

  it('lets group admins recheck other people’s paused bots, not plain members', () => {
    useSession.setState({ user: { id: 'u2' } as UserDto, status: 'ready' })
    useWorkspace.setState({ bots: [bot()], botStates: paused })
    const { rerender } = render(<WorkspaceBanner group={group({ members: members(false) })} />)
    expect(screen.getByTestId('ws-paused-b1').textContent).toContain('等待 王磊 处理')
    expect(screen.queryByText('重新检查')).toBeNull()
    rerender(tree(<WorkspaceBanner group={group({ members: members(true) })} />))
    expect(screen.getByText('重新检查')).toBeTruthy()
  })

  it('hides a banner until the bot’s state changes, also after a reload', () => {
    localStorage.clear()
    useSession.setState({ user: { id: 'u2' } as UserDto, status: 'ready' })
    useWorkspace.setState({ bots: [bot()], botStates: paused })
    const { unmount } = render(<WorkspaceBanner group={group({ members: members(false) })} />)
    fireEvent.click(screen.getByRole('button', { name: '隐藏' }))
    expect(screen.queryByTestId('ws-paused-b1')).toBeNull()
    unmount()
    render(<WorkspaceBanner group={group({ members: members(false) })} />)
    expect(screen.queryByTestId('ws-paused-b1')).toBeNull()
    const state = unbound().g1.b1
    act(() => useWorkspace.setState({ botStates: { g1: { b1: { ...state, state: 'confirm' } } } }))
    expect(screen.getByTestId('ws-banner-b1')).toBeTruthy()
  })

  it('offers same-group ready workspaces on the same machine for reuse without re-cloning', async () => {
    const baseState = unbound().g1.b1
    const managedA = '/Users/w/gonggong/workspaces/仓库协作/小王的 Claude/pay'
    useWorkspace.setState({
      bots: [
        bot({ id: 'b1', name: '小王的 Claude', machineId: 'm1' }),
        bot({ id: 'b2', name: '小王的 Codex', machineId: 'm1' }),
        bot({ id: 'b3', name: '另一台机的 Bot', machineId: 'm2' }),
      ],
      botStates: {
        g1: {
          b1: { ...baseState, botId: 'b1', workspace: 'managed', state: 'ready', path: managedA },
          b2: { ...baseState, botId: 'b2', workspace: 'managed', state: 'confirm', path: null },
          b3: {
            ...baseState,
            botId: 'b3',
            workspace: 'managed',
            state: 'ready',
            path: '/Users/other/gonggong/workspaces/pay',
          },
        },
      },
    })
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'GET /groups/g1/local-paths': [{ machineId: 'm1', path: managedA }],
      'GET /groups/g1/bots/b2/repo-candidates': {
        managedPath: '/Users/w/gonggong/workspaces/仓库协作/小王的 Codex/pay',
        paths: ['/Users/w/code/pay'],
      },
      'PUT /groups/g1/bots/b2/workspace': undefined,
    })
    const repo = { url: 'git@git.corp:pay/pay.git', branch: 'main' }
    render(<WorkspaceBanner group={group({ botIds: ['b1', 'b2', 'b3'], repo })} />)
    fireEvent.click(screen.getByText('确认工作区'))
    expect(await screen.findByText('复用群内 小王的 Claude 的工作区')).toBeTruthy()
    expect(screen.getByText(`${managedA} · 只读并行不打扰，写入时确认`)).toBeTruthy()
    // Deduplicated from local-paths so the managed path is shown once; other machine's bot is excluded.
    expect(screen.getAllByText(new RegExp(managedA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toHaveLength(1)
    expect(screen.queryByText(/other\/gonggong/)).toBeNull()
    // Auto-clone loses 推荐 when an existing or reusable workspace is available.
    const autoClone = screen.getByText('自动克隆群仓库').closest('button')
    expect(autoClone?.textContent).toContain('独立目录')
    expect(autoClone?.textContent).not.toContain('推荐')
    fireEvent.click(screen.getByText('复用群内 小王的 Claude 的工作区'))
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        path: '/groups/g1/bots/b2/workspace',
        body: { path: managedA },
      }),
    )
  })
})
