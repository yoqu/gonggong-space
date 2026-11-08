import type { BotDto, GroupDto, MessageDto, SavedMessageDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { remindLabel, remindPresets, useSaved } from '../src/features/saved/store'
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

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
  botIds: [],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u2',
  authorName: '李建国',
  body: `第 ${o.seq} 条`,
  mentions: [],
  runId: null,
  createdAt: '2026-11-08T02:00:00.000Z',
  attachments: [],
  quote: null,
  ...o,
})

const saved = (o: Partial<SavedMessageDto> = {}): SavedMessageDto => ({
  groupId: 'g1',
  groupName: '退款 v2 迁移',
  message: msg({ seq: 1, body: '记得看发版清单' }),
  remindAt: null,
  remindedAt: null,
  doneAt: null,
  createdAt: '2026-11-08T02:05:00.000Z',
  ...o,
})

class FakeSocket {
  close() {}
}

const renderAt = (path: string, routes: Record<string, unknown> = {}) => {
  const calls = mockApi({
    'GET /groups': [group],
    'GET /bots': [] as BotDto[],
    'GET /machines': [],
    'GET /notifications/unread': { n: 0 },
    'GET /threads/unread': { unread: 0, mentioned: 0 },
    'GET /saved/state': { ids: [], due: 0 },
    'GET /groups/g1/timeline?limit=50': { messages: [msg({ seq: 1, body: '记得看发版清单' })], runs: [] },
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return calls
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useInspector.setState({ view: null, payload: null })
  useSaved.setState({ ids: new Set(), due: 0 })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('稍后处理 on a message', () => {
  it('saves from the 更多 menu with a reminder and marks the message', async () => {
    let ids: string[] = []
    const calls = renderAt('/g/g1', {
      'GET /saved/state': () => ({ ids, due: 0 }),
      'PUT /messages/m1/save': () => {
        ids = ['m1']
        return { ok: true }
      },
    })
    const row = (await screen.findByText('记得看发版清单')).closest('.pn-msg') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '稍后处理' }))
    const before = Date.now()
    fireEvent.click(await screen.findByRole('menuitem', { name: '1 小时后' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.path === '/messages/m1/save')).toBe(true),
    )
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/messages/m1/save')!
    const at = Date.parse((put.body as { remindAt: string }).remindAt)
    expect(at - before).toBeGreaterThanOrEqual(59 * 60_000)
    expect(at - before).toBeLessThanOrEqual(61 * 60_000)
    expect(await within(row).findByRole('img', { name: '稍后处理' })).toBeTruthy()
  })

  it('removes a saved message from the menu', async () => {
    const calls = renderAt('/g/g1', {
      'GET /saved/state': { ids: ['m1'], due: 0 },
      'DELETE /messages/m1/save': { ok: true },
    })
    const row = (await screen.findByText('记得看发版清单')).closest('.pn-msg') as HTMLElement
    await within(row).findByRole('img', { name: '稍后处理' })
    fireEvent.click(within(row).getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '修改提醒' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '移除稍后处理' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/messages/m1/save')).toBe(true),
    )
  })
})

describe('稍后处理 page', () => {
  it('counts due reminders in the sidebar and lists saved messages', async () => {
    const calls = renderAt('/later', {
      'GET /saved/state': { ids: ['m1'], due: 1 },
      'GET /saved?state=open': {
        items: [saved({ remindAt: '2026-11-08T03:00:00.000Z', remindedAt: '2026-11-08T03:00:00.000Z' })],
      },
      'PUT /messages/m1/save/done': { ok: true },
    })
    const row = await screen.findByTestId('later-item')
    await waitFor(() => expect(within(row).getByText('1 条提醒到期')).toBeTruthy())
    expect(within(row).getByText('1')).toBeTruthy()
    const item = await screen.findByTestId('later-m1')
    expect(within(item).getByText('记得看发版清单')).toBeTruthy()
    expect(within(item).getByText('提醒已到期')).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: '完成' }))
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', path: '/messages/m1/save/done', body: { done: true } }),
      ),
    )
  })

  it('shows no count while nothing is due, and lists done ones on their tab', async () => {
    renderAt('/later', {
      'GET /saved/state': { ids: ['m1'], due: 0 },
      'GET /saved?state=open': { items: [saved()] },
      'GET /saved?state=done': {
        items: [saved({ message: msg({ seq: 2, body: '已经处理了' }), doneAt: '2026-11-08T04:00:00.000Z' })],
      },
    })
    const row = await screen.findByTestId('later-item')
    await waitFor(() => expect(within(row).getByText('1 条进行中')).toBeTruthy())
    expect(row.querySelector('.ui-badge')).toBeNull()
    await screen.findByTestId('later-m1')
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: '已完成' })))
    expect(await screen.findByText('已经处理了')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移回进行中' })).toBeTruthy()
  })
})

describe('稍后处理 page actions', () => {
  it('puts fired reminders first', async () => {
    renderAt('/later', {
      'GET /saved?state=open': {
        items: [
          saved(),
          saved({
            message: msg({ seq: 2, body: '提醒到了' }),
            remindAt: '2026-11-08T03:00:00.000Z',
            remindedAt: '2026-11-08T03:00:00.000Z',
          }),
        ],
      },
    })
    await screen.findByTestId('later-m2')
    const ids = [...document.querySelectorAll('[data-testid^="later-m"]')].map((e) =>
      e.getAttribute('data-testid'),
    )
    expect(ids).toEqual(['later-m2', 'later-m1'])
  })

  it('takes a done item off the list at once, with 撤销 in the toast', async () => {
    const calls = renderAt('/later', {
      'GET /saved?state=open': { items: [saved()] },
      'PUT /messages/m1/save/done': { ok: true },
    })
    const item = await screen.findByTestId('later-m1')
    fireEvent.click(within(item).getByRole('button', { name: '完成' }))
    expect(item.classList.contains('ui-leaving')).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('later-m1')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/messages/m1/save/done').map((c) => c.body)).toEqual([
        { done: true },
        { done: false },
      ]),
    )
  })

  it('removes an item and brings it back with its reminder on 撤销', async () => {
    const calls = renderAt('/later', {
      'GET /saved?state=open': { items: [saved({ remindAt: '2026-11-09T01:00:00.000Z' })] },
      'DELETE /messages/m1/save': { ok: true },
      'PUT /messages/m1/save': { ok: true },
    })
    const item = await screen.findByTestId('later-m1')
    fireEvent.click(within(item).getByRole('button', { name: '移除' }))
    await waitFor(() => expect(screen.queryByTestId('later-m1')).toBeNull())
    expect(await screen.findByText('已移除')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          path: '/messages/m1/save',
          body: { remindAt: '2026-11-09T01:00:00.000Z' },
        }),
      ),
    )
  })
})

describe('reminder presets', () => {
  it('offers the next Monday at 9, a week ahead on a Monday', () => {
    const monday = new Date(2026, 10, 9, 15, 0)
    const at = remindPresets(monday).find((p) => p.value === 'remind:monday')!.at!
    expect([at.getDate(), at.getHours()]).toEqual([16, 9])
    const sunday = new Date(2026, 10, 8, 15, 0)
    expect(
      remindPresets(sunday)
        .find((p) => p.value === 'remind:monday')!
        .at!.getDate(),
    ).toBe(9)
    expect(
      remindPresets(sunday)
        .find((p) => p.value === 'remind:tomorrow')!
        .at!.getDate(),
    ).toBe(9)
  })

  it('labels today and tomorrow', () => {
    const now = new Date(2026, 10, 8, 15, 0)
    expect(remindLabel(new Date(2026, 10, 8, 18, 30).toISOString(), now)).toBe('今天 18:30')
    expect(remindLabel(new Date(2026, 10, 9, 9, 0).toISOString(), now)).toBe('明天 09:00')
    expect(remindLabel(new Date(2026, 10, 12, 9, 0).toISOString(), now)).toBe('11-12 09:00')
  })
})
