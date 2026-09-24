import type { BotDto, GroupDto, UserDto } from '@aiws/protocol'
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
    ...o,
  }) as BotDto
const unbound = (error: string | null = null) => ({
  g1: { b1: { botId: 'b1', workspace: 'managed', state: 'unbound', path: null, git: null, error } as const },
})
const listing = (path: string) => ({
  path,
  entries: [{ name: 'pay', git: true }],
  git: null,
  unusable: null,
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
      '为 小王的 Claude 选择工作目录后才能开始工作',
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
    expect(screen.queryByText('选择此目录')).toBeNull()
  })

  it('offers the default workspace and the managed clone of the group repo', async () => {
    useWorkspace.setState({ bots: [bot({ defaultWorkspace: '/src/pay' })], botStates: unbound() })
    const calls = mockApi({
      'GET /machines/m1/dirs?path=%2Fsrc%2Fpay': listing('/src/pay'),
      'PUT /groups/g1/bots/b1/workspace': undefined,
    })
    render(<WorkspaceBanner group={group({ repo: { url: 'git@x:pay.git', branch: 'main' } })} />)
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('托管克隆群仓库'))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: null }))
    fireEvent.click(screen.getByText('绑定工作区'))
    fireEvent.click(await screen.findByText('使用默认工作区'))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: '/src/pay' }))
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
})
