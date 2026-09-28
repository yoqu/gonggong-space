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
}
const group = (id: string, name: string): GroupDto => ({
  id,
  name,
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [{ userId: 'u1', name: '王磊', isAdmin: true }],
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
const setWidth = (w: number) =>
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
    window.dispatchEvent(new Event('resize'))
  })
const bench = () => screen.queryByRole('region', { name: '工作台' })
const chatTitle = () => screen.queryByRole('heading', { name: '退款' })
const openTwo = () =>
  act(() => {
    useWorkbench.getState().show(run('r1'))
    useWorkbench.getState().show(run('r2'))
  })
const header = () => document.querySelector('.pn-chathead') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
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

describe('workbench on phones', () => {
  it('takes over the screen when open, and 返回聊天 goes back to the chat', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    expect(bench()).toBeNull()
    openTwo()
    expect(bench()).not.toBeNull()
    expect(chatTitle()).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: '专注' })).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(within(bench() as HTMLElement).getByRole('button', { name: '全部标签页' }).textContent).toContain(
      '运行 r2',
    )
    fireEvent.click(screen.getByRole('button', { name: '返回聊天' }))
    expect(bench()).toBeNull()
    expect(chatTitle()).not.toBeNull()
    expect(useWorkbench.getState().benches.g1?.tabs).toHaveLength(2)
  })

  it('mounts only the active tab body', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    openTwo()
    expect(screen.getByTestId('body-run:r2')).toBeTruthy()
    expect(screen.queryByTestId('body-run:r1')).toBeNull()
  })

  it('switches and closes tabs from the dropdown', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    openTwo()
    fireEvent.click(screen.getByRole('button', { name: '全部标签页' }))
    const list = screen.getByRole('dialog', { name: '标签页' })
    fireEvent.click(within(list).getByRole('button', { name: '运行 r1' }))
    expect(useWorkbench.getState().benches.g1?.active).toBe('run:r1')
    expect(screen.getByTestId('body-run:r1')).toBeTruthy()
    expect(screen.queryByTestId('body-run:r2')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '全部标签页' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '标签页' })).getByRole('button', { name: '关闭 运行 r2' }),
    )
    expect(useWorkbench.getState().benches.g1?.tabs).toHaveLength(1)
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '标签页' })).getByRole('button', { name: '关闭 运行 r1' }),
    )
    expect(bench()).toBeNull()
    expect(chatTitle()).not.toBeNull()
  })

  it('shows the header 工作台 button, disabled without tabs, toggling the page', async () => {
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    const btn = within(header()).getByRole('button', { name: /工作台/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.getAttribute('title')).toContain('还没有打开的标签页')
    openTwo()
    fireEvent.click(screen.getByRole('button', { name: '返回聊天' }))
    fireEvent.click(within(header()).getByRole('button', { name: '工作台' }))
    expect(bench()).not.toBeNull()
    expect(chatTitle()).toBeNull()
  })

  it('keeps tabs and the desktop mode across the breakpoint', async () => {
    setWidth(1440)
    renderAt('/g/g1')
    await screen.findByRole('heading', { name: '退款' })
    openTwo()
    act(() => useWorkbench.getState().setMode('full'))
    expect(screen.getByRole('tablist')).toBeTruthy()
    setWidth(375)
    expect(bench()).not.toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByTestId('body-run:r2')).toBeTruthy()
    setWidth(1440)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(useWorkbench.getState().mode).toBe('full')
    expect(screen.getByTestId('body-run:r1')).toBeTruthy()
  })
})
