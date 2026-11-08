import type { GroupDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/app/Sidebar'

const group = (id: string, lastAt: string): GroupDto => ({
  id,
  teamId: 't1',
  name: id,
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
  lastSeq: 1,
  last: '',
  lastAt,
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
})

const groups = [
  group('g1', '2026-09-23T03:00:00.000Z'),
  group('g2', '2026-09-23T02:00:00.000Z'),
  group('g3', '2026-09-23T01:00:00.000Z'),
]

/** Renders the list with g2 open; returns a re-render with other groups. */
function renderList() {
  const ui = (list: GroupDto[]) => (
    <MemoryRouter initialEntries={['/g/g2']}>
      <Sidebar groups={list} bots={[]} machines={[]} loaded guide={false} />
    </MemoryRouter>
  )
  const { rerender } = render(ui(groups))
  return (list: GroupDto[]) => rerender(ui(list))
}

afterEach(() => vi.restoreAllMocks())

it('re-renders only the conversation rows whose group changed', () => {
  const rerender = renderList()
  // Every row but the open one reads its draft when it renders.
  const getItem = vi.spyOn(Storage.prototype, 'getItem')
  rerender([{ ...groups[0]!, unread: 2 }, groups[1]!, groups[2]!])
  const drafts = getItem.mock.calls.map(([key]) => key).filter((key) => key.startsWith('gonggong:draft:'))
  expect(drafts).toEqual(['gonggong:draft:g1'])
})

it('re-measures the selection capsule only when the open conversation moves', () => {
  const rerender = renderList()
  const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  rerender([{ ...groups[0]!, unread: 2 }, groups[1]!, groups[2]!])
  expect(measure).not.toHaveBeenCalled()
  rerender([groups[0]!, groups[1]!, { ...groups[2]!, lastAt: '2026-09-23T04:00:00.000Z' }])
  expect(measure).toHaveBeenCalled()
})

it('a group with unread only turns bold; its number is the @ of me, a DM’s its unread; 关闭 greys it', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar
        groups={[
          { ...groups[0]!, unread: 5 },
          { ...groups[1]!, unread: 5, mentionCount: 2 },
          { ...groups[2]!, kind: 'dm', unread: 3 },
          { ...group('g4', '2026-09-22T01:00:00.000Z'), unread: 4, mentionCount: 1, notifyLevel: 'off' },
        ]}
        bots={[]}
        machines={[]}
        loaded
        guide={false}
      />
    </MemoryRouter>,
  )
  const row = (id: string) => screen.getByTestId(`group-item-${id}`)
  const badge = (id: string) => row(id).querySelector('.ui-badge')
  expect(row('g1').querySelector('.pn-conv__name--bold')).toBeTruthy()
  expect(badge('g1')).toBeNull()
  expect(badge('g2')?.textContent).toBe('2')
  expect(badge('g3')?.textContent).toBe('3')
  expect(row('g4').querySelector('.pn-conv__name--bold')).toBeNull()
  expect(badge('g4')?.classList.contains('ui-badge--muted')).toBe(true)
})
