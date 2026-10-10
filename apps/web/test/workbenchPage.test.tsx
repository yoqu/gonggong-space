import type { BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { mockApi } from './mockApi'

vi.mock('../src/features/workbench/tabs/RunTab', () => ({
  RunTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useRunTabMeta: (t: { runId: string }) => ({ icon: 'bot', title: `运行 ${t.runId}` }),
}))

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}
const group = (id: string, name: string): GroupDto => ({
  id,
  teamId: 't1',
  name,
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
})

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close() {}
}

const run = (id: string) => ({ kind: 'run', runId: id, view: 'process', file: null }) as const

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
const header = () => document.querySelector('.pn-chathead') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [] as BotDto[], machines: [], activeGroupId: null })
  useWorkbench.setState({ groupId: null, open: false, mode: 'split', previous: 'split', benches: {} })
  const empty = { messages: [], runs: [] }
  mockApi({
    'GET /groups': [group('g1', '退款'), group('g2', '支付')],
    'GET /users': [],
    'GET /bots': [],
    'GET /machines': [],
    'GET /notifications': [],
    'GET /groups/g1/timeline': empty,
    'GET /groups/g2/timeline': empty,
    'GET /groups/g1/bot-states': [],
    'GET /groups/g2/bot-states': [],
    'GET /groups/g1/previews': { previews: [], services: [] },
    'GET /groups/g2/previews': { previews: [], services: [] },
    'POST /groups/g1/read': group('g1', '退款'),
    'POST /groups/g2/read': group('g2', '支付'),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('chat header 工作台 button', () => {
  it('is disabled while the group has no tabs', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    expect(useWorkbench.getState().groupId).toBe('g1')
    const btn = within(header()).getByRole('button', { name: /工作台/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.getAttribute('title')).toContain('还没有打开的标签页')
  })

  it('shows the tab count and toggles the workbench column', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    act(() => {
      useWorkbench.getState().show(run('r1'))
      useWorkbench.getState().show(run('r2'))
    })
    expect(screen.getByRole('region', { name: '工作台' })).toBeTruthy()
    const btn = within(header()).getByRole('button', { name: '工作台' })
    expect(btn.textContent).toContain('2')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(screen.queryByRole('region', { name: '工作台' })).toBeNull()
    fireEvent.click(btn)
    expect(screen.getByRole('region', { name: '工作台' })).toBeTruthy()
  })

  it('switches the tab set with the group', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    act(() => {
      useWorkbench.getState().show(run('r1'))
    })
    fireEvent.click(screen.getByTestId('group-item-g2'))
    await screen.findByRole('heading', { name: '支付' })
    expect(useWorkbench.getState().groupId).toBe('g2')
    expect(screen.queryByRole('region', { name: '工作台' })).toBeNull()
  })

  it('opens 群设置 as a drawer over the open workbench', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    act(() => {
      useWorkbench.getState().show(run('r1'))
    })
    fireEvent.click(within(header()).getByRole('button', { name: '群设置' }))
    const drawer = await screen.findByRole('complementary', { name: '侧栏' })
    expect(drawer.className).toContain('chat__drawer')
    expect(screen.getByRole('region', { name: '工作台' })).toBeTruthy()
  })
})
