import type { GroupDto, GroupTabDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { tabKey, useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GroupTabBar } from '../src/features/group-tabs/GroupTabBar'
import { NewTabMenu } from '../src/features/workbench/NewTabMenu'
import { LinkTab } from '../src/features/workbench/tabs/LinkTab'
import { mockApi } from './mockApi'

const group = { id: 'g1', name: '支付', kind: 'group', botIds: [], members: [] } as unknown as GroupDto
const tab = (o: Partial<GroupTabDto> & Pick<GroupTabDto, 'id' | 'title' | 'target'>): GroupTabDto => ({
  stale: false,
  createdBy: { name: '王磊', bot: false },
  createdAt: '2026-10-22T03:00:00.000Z',
  ...o,
})
const docs = tab({
  id: 't1',
  title: '接口文档',
  target: { kind: 'link', url: 'https://docs.example.com/', icon: null, embeddable: true },
})
const jenkins = tab({
  id: 't2',
  title: 'Jenkins',
  target: { kind: 'link', url: 'https://ci.example.com/', icon: null, embeddable: false },
})
const notice = tab({ id: 't3', title: '群公告', target: { kind: 'entry', entry: 'notice' } })

beforeEach(() => {
  localStorage.clear()
  useSession.setState({ user: { id: 'u1', name: '王磊' } as never })
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '小王的 Claude', ownerId: 'u1' } as never],
    groups: [group],
  })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  useInspector.setState({ view: null, payload: null })
})

describe('群标签栏', () => {
  it('hides the empty bar until the group has a custom tab', async () => {
    const calls = mockApi({ 'GET /groups/g0/tabs': { tabs: [] } })
    render(<GroupTabBar group={{ ...group, id: 'g0' }} />)
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'GET', path: '/groups/g0/tabs', body: undefined }),
    )
    expect(screen.queryByRole('navigation', { name: '群标签栏' })).toBeNull()
    expect(screen.queryByText('消息')).toBeNull()
    expect(screen.queryByRole('button', { name: '添加标签' })).toBeNull()
  })

  it('keeps the first-tab entry in the workbench when the bar is empty', async () => {
    mockApi({
      'GET /groups/g0/knowledge': { entries: [], canManage: false },
    })
    useWorkspace.setState({ groups: [{ ...group, id: 'g0' }] })
    useWorkbench.setState({ groupId: 'g0' })
    render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加群标签…' }))
    expect(screen.getByRole('dialog', { name: '添加标签' })).toBeTruthy()
  })

  it('lists 消息 then the group’s tabs; a click opens the page in the workbench, or a new tab when it can’t be framed', async () => {
    mockApi({ 'GET /groups/g1/tabs': { tabs: [docs, jenkins, notice] } })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<GroupTabBar group={group} />)
    const tabs = await screen.findAllByTestId('group-tab')
    expect(tabs.map((x) => x.textContent)).toEqual(['接口文档', 'Jenkins', '群公告'])
    expect(screen.getByText('消息')).toBeTruthy()

    fireEvent.click(tabs[0]!)
    const bench = useWorkbench.getState()
    expect(bench.open).toBe(true)
    expect(bench.benches.g1?.active).toBe(
      tabKey({ kind: 'link', url: 'https://docs.example.com/', title: '' }),
    )
    await waitFor(() => expect(tabs[0]!.className).toContain('gtab--active'))

    fireEvent.click(tabs[1]!)
    expect(open).toHaveBeenCalledWith('https://ci.example.com/', '_blank', 'noopener,noreferrer')
    fireEvent.click(tabs[0]!, { metaKey: true })
    expect(open).toHaveBeenLastCalledWith('https://docs.example.com/', '_blank', 'noopener,noreferrer')

    fireEvent.click(tabs[2]!)
    expect(useInspector.getState()).toMatchObject({ view: 'group-info', payload: 'notices' })
    open.mockRestore()
  })

  it('adds a link titled after its page unless a title was typed', async () => {
    const calls = mockApi({
      'GET /groups/g2/tabs': { tabs: [notice] },
      'GET /groups/g2/knowledge': { entries: [], canManage: false },
      'POST /link-meta': { title: '共工文档', icon: null, embeddable: true },
      'POST /groups/g2/tabs': { tabs: [notice, docs] },
    })
    render(<GroupTabBar group={{ ...group, id: 'g2' }} />)
    fireEvent.click(await screen.findByRole('button', { name: '添加标签' }))
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: 'https://docs.example.com/' } })
    await waitFor(() => expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('共工文档'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g2/tabs',
        body: { title: '共工文档', target: { kind: 'link', url: 'https://docs.example.com/' } },
      }),
    )
    expect((await screen.findAllByTestId('group-tab')).map((x) => x.textContent)).toEqual([
      '群公告',
      '接口文档',
    ])
  })

  it('marks a tab whose target is gone', async () => {
    // Each group's bar is cached for the session: a fresh group.
    mockApi({ 'GET /groups/g3/tabs': { tabs: [{ ...notice, stale: true }] } })
    render(<GroupTabBar group={{ ...group, id: 'g3' }} />)
    expect((await screen.findByTestId('group-tab')).textContent).toBe('群公告已失效')
  })
})

describe('link tab', () => {
  it('frames another site sandboxed and without referrer; our own origin loses same-origin access', () => {
    const { container, rerender } = render(
      <LinkTab tab={{ kind: 'link', url: 'https://docs.example.com/', title: '文档' }} tabKey="k" active />,
    )
    const frame = () => container.querySelector('iframe') as HTMLIFrameElement
    expect(frame().getAttribute('sandbox')).toContain('allow-same-origin')
    expect(frame().getAttribute('referrerpolicy')).toBe('no-referrer')
    rerender(<LinkTab tab={{ kind: 'link', url: `${location.origin}/x`, title: '本站' }} tabKey="k" active />)
    expect(frame().getAttribute('sandbox')).not.toContain('allow-same-origin')
  })
})
