import type { DirectoryGroupDto, GroupDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/app/Sidebar'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { DeleteSectionDialog } from '../src/features/groups/SidebarDialogs'
import { useSections, useTeamSections } from '../src/features/groups/sections'
import { Toaster, useToasts } from '../src/ui'
import { mockApi } from './mockApi'

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

const group = (id: string, name: string, o: Partial<GroupDto> = {}): GroupDto => ({
  id,
  teamId: 't1',
  name,
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const dir = (id: string, name: string, o: Partial<DirectoryGroupDto> = {}): DirectoryGroupDto => ({
  id,
  name,
  avatar: null,
  notice: '',
  memberCount: 4,
  visibility: 'private',
  teamSectionId: 'ts1',
  admins: ['李建国'],
  requestId: null,
  ...o,
})

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function Harness() {
  const groups = useWorkspace((s) => s.groups)
  return (
    <>
      <Sidebar groups={groups} bots={[]} machines={[]} loaded />
      <Toaster />
      <Where />
    </>
  )
}

const renderSidebar = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  )

const baseRoutes = {
  'GET /threads/unread': { unread: 0, mentioned: 0 },
  'GET /saved/state': { ids: [], due: 0 },
}

beforeEach(() => {
  localStorage.clear()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: true, notifCount: 0 })
  useSections.setState({ sections: [] })
  useTeamSections.setState({ sections: [], canManage: false, directory: [] })
  useToasts.setState({ items: [] })
})

afterEach(() => vi.unstubAllGlobals())

describe('R1-02 sidebar keyboard access', () => {
  it('keeps ThreadsRow, UnreadsRow and LaterRow focusable by Tab without tabindex="-1"', () => {
    mockApi(baseRoutes)
    useWorkspace.setState({ groups: [group('g1', '退款')] })
    renderSidebar('/g/g1')

    for (const id of ['threads-item', 'unreads-item', 'later-item']) {
      const link = screen.getByTestId(id)
      expect(link.getAttribute('tabindex')).not.toBe('-1')
      expect(link.tabIndex).toBe(0)
      link.focus()
      expect(document.activeElement).toBe(link)
    }
  })

  it('gives the first directory row tabindex="0" when the user has no joined groups and navigates with arrow keys', () => {
    mockApi(baseRoutes)
    useTeamSections.setState({
      sections: [{ id: 'ts1', name: '支付线', parentId: null }],
      canManage: false,
      directory: [dir('d1', '结算'), dir('d2', '清分')],
    })
    const view = renderSidebar('/')

    const first = screen.getByTestId('directory-item-d1')
    const second = screen.getByTestId('directory-item-d2')
    expect([first.tabIndex, second.tabIndex]).toEqual([0, -1])

    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    expect(screen.getByTestId('where').textContent).toBe('/g/d2')

    view.unmount()
    renderSidebar('/g/d2')
    expect(screen.getByTestId('directory-item-d1').tabIndex).toBe(-1)
    expect(screen.getByTestId('directory-item-d2').tabIndex).toBe(0)
  })

  it('moves arrow-key focus smoothly from joined groups into directory rows', () => {
    mockApi(baseRoutes)
    useWorkspace.setState({ groups: [group('g1', '退款', { teamSectionId: 'ts1' })] })
    useTeamSections.setState({
      sections: [{ id: 'ts1', name: '支付线', parentId: null }],
      canManage: false,
      directory: [dir('d1', '结算')],
    })
    renderSidebar('/g/g1')

    const joined = screen.getByTestId('group-item-g1')
    const outside = screen.getByTestId('directory-item-d1')
    expect([joined.tabIndex, outside.tabIndex]).toEqual([0, -1])

    joined.focus()
    fireEvent.keyDown(joined, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(outside)
    expect(screen.getByTestId('where').textContent).toBe('/g/d1')
  })
})

describe('R1-03 sidebar section delete confirmation', () => {
  it('confirms before deleting a personal section, aborts on cancel, and deletes with toast on confirm', async () => {
    const calls = mockApi({
      ...baseRoutes,
      'DELETE /sidebar-sections/s1': () => undefined,
    })
    useWorkspace.setState({ groups: [group('g1', '退款', { sectionId: 's1' })] })
    useSections.setState({
      sections: [
        { id: 's1', name: '发版', parentId: null },
        { id: 's2', name: '灰度', parentId: 's1' },
      ],
    })
    renderSidebar('/g/g1')

    fireEvent.click(screen.getByRole('button', { name: '发版 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除分区' }))

    // Must NOT delete before confirmation.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const alert = await screen.findByRole('alertdialog', { name: '删除分区「发版」？' })
    expect(within(alert).getByText(/1 个子分区/)).toBeTruthy()
    expect(within(alert).getByText(/会话和消息都会保留/)).toBeTruthy()

    // Cancel aborts deletion and keeps the section intact.
    fireEvent.click(within(alert).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByRole('group', { name: '发版' })).toBeTruthy()

    // Confirming deletes the section, returns conversations to default list, and shows a toast.
    fireEvent.click(screen.getByRole('button', { name: '发版 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除分区' }))
    const alert2 = await screen.findByRole('alertdialog', { name: '删除分区「发版」？' })
    fireEvent.click(within(alert2).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/sidebar-sections/s1')).toBe(true),
    )
    await waitFor(() => expect(screen.queryByRole('group', { name: '发版' })).toBeNull())
    expect(within(screen.getByRole('group', { name: '频道' })).getByTestId('group-item-g1')).toBeTruthy()
    expect(await screen.findByText('已删除分区「发版」，其中的会话已保留')).toBeTruthy()
  })

  it('warns about all team members and subsections before deleting a team section', async () => {
    const calls = mockApi({
      ...baseRoutes,
      'DELETE /team-sections/ts1': () => undefined,
      'GET /team-sections': { sections: [], canManage: true },
      'GET /team-directory': [],
    })
    useWorkspace.setState({ groups: [group('g1', '退款', { teamSectionId: 'ts1' })] })
    useTeamSections.setState({
      sections: [
        { id: 'ts1', name: '研发', parentId: null },
        { id: 'ts2', name: '支付线', parentId: 'ts1' },
        { id: 'ts3', name: '结算', parentId: 'ts2' },
      ],
      canManage: true,
      directory: [],
    })
    renderSidebar('/g/g1')

    fireEvent.click(screen.getByRole('button', { name: '研发 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除分区' }))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const alert = await screen.findByRole('alertdialog', { name: '删除团队分区「研发」？' })
    expect(within(alert).getByText(/团队所有成员/)).toBeTruthy()
    expect(within(alert).getByText(/2 个子分区/)).toBeTruthy()

    fireEvent.click(within(alert).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/team-sections/ts1')).toBe(true),
    )
    expect(await screen.findByText('已删除分区「研发」，其中的会话已保留')).toBeTruthy()
  })

  it('renders leaf-section copy cleanly and disables actions while busy', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const view = render(
      <DeleteSectionDialog
        name="日常"
        team={false}
        childCount={0}
        busy
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    const alert = screen.getByRole('alertdialog', { name: '删除分区「日常」？' })
    expect(within(alert).queryByText(/子分区/)).toBeNull()
    expect(within(alert).getByText('其中的会话和消息都会保留，并回到默认列表。')).toBeTruthy()
    expect((within(alert).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(alert).getByRole('button', { name: '删除' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    view.rerender(
      <DeleteSectionDialog name="平台" team childCount={0} onConfirm={onConfirm} onClose={onClose} />,
    )
    const teamAlert = screen.getByRole('alertdialog', { name: '删除团队分区「平台」？' })
    expect(within(teamAlert).queryByText(/子分区/)).toBeNull()
    expect(
      within(teamAlert).getByText('将对团队所有成员生效；其中的群和消息都会保留，并回到默认列表。'),
    ).toBeTruthy()
  })
})
