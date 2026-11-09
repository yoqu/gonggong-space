import type { ArtifactDto, BotDto, GroupDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { clearContext } from '../src/features/artifacts/context'
import { setEditing, useEditing } from '../src/features/artifacts/editing'
import { resetGroupArtifacts } from '../src/features/artifacts/groupArtifacts'
import { resetArtifacts } from '../src/features/artifacts/store'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { GroupTabBar } from '../src/features/group-tabs/GroupTabBar'
import { mockApi } from './mockApi'

// 作品 in the tab bar, 正在编辑 in the composer and `#` to pick a work.

const at = '2026-11-09T08:00:00Z'
const bots = [{ id: 'b1', name: '共字君', presence: 'online', avatar: 'role-no' }] as BotDto[]
const group = { id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto
const work = (id: string, title: string, o: Partial<ArtifactDto> = {}) =>
  ({
    id,
    groupId: 'g1',
    title,
    botId: 'b1',
    headVersionId: `${id}-v`,
    head: { n: 7, thumbnailUrl: null },
    updatedAt: at,
    running: false,
    runner: null,
    ...o,
  }) as unknown as ArtifactDto
const works = [
  work('a1', 'codex俱乐部小程序原型', { runner: { botId: 'b1', status: 'running' }, running: true }),
  work('a2', '湖山VIP原型'),
]
const input = () => screen.getByRole('combobox') as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(input(), { target: { value } })
const posts = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/groups/g1/messages').map((c) => c.body)

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  useEditing.setState({ byGroup: {}, focus: 0 })
  resetArtifacts()
  resetGroupArtifacts()
  clearContext()
  vi.stubGlobal('WebSocket', NoopSocket)
  useWorkspace.setState({ groups: [group], bots })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('作品 in the group tab bar', () => {
  it('shows even without shared tabs, lists the works and starts editing one', async () => {
    mockApi({ 'GET /groups/g1/tabs': { tabs: [] }, 'GET /groups/g1/artifacts': works })
    render(<GroupTabBar group={group} />)
    const tab = await screen.findByTestId('group-works')
    expect(tab.textContent).toContain('2')
    fireEvent.click(tab)
    const pop = await screen.findByRole('dialog', { name: '本群作品' })
    expect(within(pop).getByText('共字君 运行中')).toBeTruthy()
    const rows = within(pop).getAllByRole('listitem')
    expect(rows[0]?.textContent).toContain('codex俱乐部小程序原型')
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: '继续对话' }))
    expect(useEditing.getState().byGroup.g1).toEqual({ artifactId: 'a2', title: '湖山VIP原型' })
  })

  it('stays hidden in a group without works or tabs', async () => {
    const calls = mockApi({ 'GET /groups/g1/tabs': { tabs: [] }, 'GET /groups/g1/artifacts': [] })
    const { container } = render(<GroupTabBar group={group} />)
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/artifacts')).toBe(true))
    expect(container.innerHTML).toBe('')
  })
})

describe('正在编辑 in the composer', () => {
  it('sends every message with the work to its bot until ended', async () => {
    const calls = mockApi({
      'GET /groups/g1/artifacts': works,
      'POST /groups/g1/messages': { id: 'm1', seq: 1, groupId: 'g1', kind: 'user', body: 'x', createdAt: at },
    })
    setEditing('g1', { artifactId: 'a2', title: '湖山VIP原型' })
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect((await screen.findByTestId('art-editing')).textContent).toContain('正在编辑 · 湖山VIP原型')
    expect(screen.getByTestId('art-context-to').textContent).toContain('发给 @共字君')
    type('放大储值余额')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]).toMatchObject({ body: '放大储值余额', artifactContext: { artifactId: 'a2' } })
    // It stays for the next message.
    await waitFor(() => expect(input().value).toBe(''))
    expect(screen.getByTestId('art-editing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '结束编辑 湖山VIP原型' }))
    expect(screen.queryByTestId('art-editing')).toBeNull()
    expect(useEditing.getState().byGroup.g1).toBeUndefined()
  })

  it('picks a work with #, removing what was typed', async () => {
    mockApi({ 'GET /groups/g1/artifacts': works })
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('#湖山')
    const pop = await screen.findByTestId('composer-popover')
    fireEvent.click(within(pop).getByRole('option', { name: /湖山VIP原型/ }))
    expect(useEditing.getState().byGroup.g1).toEqual({ artifactId: 'a2', title: '湖山VIP原型' })
    expect(input().value).toBe('')
    expect((await screen.findByTestId('art-editing')).textContent).toContain('湖山VIP原型')
  })
})
