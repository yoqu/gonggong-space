import type { GroupDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Sidebar, useLongPress } from '../src/app/Sidebar'

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

it('marks public channels with # and private groups with a lock; shortcuts share one line', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar
        groups={[
          { ...groups[0]!, visibility: 'public' },
          { ...groups[1]!, visibility: 'private' },
        ]}
        bots={[]}
        machines={[]}
        loaded
        guide={false}
      />
    </MemoryRouter>,
  )
  expect(screen.getByTestId('group-item-g1').querySelector('[aria-label="公开频道"]')).toBeTruthy()
  expect(screen.getByTestId('group-item-g2').querySelector('[aria-label="私有群"]')).toBeTruthy()
  const shortcuts = screen.getByRole('navigation', { name: '快捷入口' })
  expect([...shortcuts.querySelectorAll('.pn-shortcut__label')].map((e) => e.textContent)).toEqual([
    '话题',
    '全部未读',
    '稍后处理',
  ])
})

it('opens the menu on a long press despite a finger’s drift, but not when the press turns into a scroll', () => {
  vi.useFakeTimers()
  const onMenu = vi.fn()
  function Row() {
    return (
      <button type="button" data-testid="row" onContextMenu={onMenu} {...useLongPress()}>
        row
      </button>
    )
  }
  render(<Row />)
  const row = screen.getByTestId('row')
  const press = (moveY: number) => {
    fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 12, clientY: 10 + moveY })
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerUp(row)
  }
  press(4)
  expect(onMenu).toHaveBeenCalledTimes(1)
  press(30)
  expect(onMenu).toHaveBeenCalledTimes(1)
  vi.useRealTimers()
})

it('fades the row being dragged until the drag ends', () => {
  renderList()
  const row = screen.getByTestId('group-item-g1')
  fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  expect(row.hasAttribute('data-dragging')).toBe(true)
  fireEvent.dragEnd(row)
  expect(row.hasAttribute('data-dragging')).toBe(false)
})

it('turns one chevron to fold a section and eases the rows in when it unfolds', () => {
  renderList()
  const head = screen.getByRole('button', { name: /^频道/ })
  expect(head.querySelectorAll('svg')).toHaveLength(1)
  expect(head.querySelector('.sidebar__chev')).toBeTruthy()
  const list = () => screen.getByRole('group', { name: '频道' }).querySelector('.sidebar__list')!
  expect(list().classList.contains('sidebar__reveal')).toBe(false)
  fireEvent.click(head)
  expect(head.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(head)
  expect(head.getAttribute('aria-expanded')).toBe('true')
  expect(list().classList.contains('sidebar__reveal')).toBe(true)
})

it('marks the footer with the connection state so a dropped link can pulse', () => {
  renderList()
  const foot = document.querySelector('.sidebar__foot')!
  expect(foot.getAttribute('data-state')).toMatch(/^(open|connecting|closed)$/)
  expect(foot.querySelector('[aria-live="polite"]')?.textContent).toBeTruthy()
})
