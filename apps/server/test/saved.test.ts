import type { MessageDto, NotificationDto, SavedListDto, SavedStateDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { fireDueReminders } from '../src/modules/saved/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

vi.mock('../src/modules/runs/trigger.js', () => ({ triggerRuns: vi.fn(async () => {}) }))

let t: TestApp
let clock = new Date('2026-11-08T08:00:00Z')
beforeEach(async () => {
  vi.mocked(triggerRuns).mockClear()
  clock = new Date('2026-11-08T08:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '路人' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id] })
  return {
    wang,
    li,
    g,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
  }
}

let n = 0
type C = ReturnType<typeof client>
const send = (c: C, groupId: string, body: string, o: { threadRootId?: string } = {}) =>
  c.post<MessageDto>(`/api/groups/${groupId}/messages`, { body, clientId: `client-${++n}-x`, ...o })
const list = async (c: C, state = 'open') =>
  (await c.get<SavedListDto>(`/api/saved?state=${state}`)).body.items
const state = async (c: C) => (await c.get<SavedStateDto>('/api/saved/state')).body

describe('稍后处理', () => {
  it('saves a message for the caller only, newest first', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '记得看下发版清单')).body
    const b = (await send(s.asWang, s.g.id, '周五复盘')).body
    expect((await s.asLi.put(`/api/messages/${a.id}/save`, { remindAt: null })).status).toBe(200)
    clock = new Date('2026-11-08T08:01:00Z')
    await s.asLi.put(`/api/messages/${b.id}/save`, { remindAt: null })

    const items = await list(s.asLi)
    expect(items.map((i) => i.message.body)).toEqual(['周五复盘', '记得看下发版清单'])
    expect(items[0]).toMatchObject({ groupId: s.g.id, remindAt: null, doneAt: null })
    expect(items[0]!.groupName).toBeTruthy()
    expect(await state(s.asLi)).toEqual({ ids: [b.id, a.id], due: 0 })
    expect(await list(s.asWang)).toEqual([])
  })

  it('only lets members of the group save its messages', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '内部消息')).body
    expect((await s.asOutsider.put(`/api/messages/${a.id}/save`, { remindAt: null })).status).toBe(404)
    expect((await s.asOutsider.put('/api/messages/not-a-uuid/save', { remindAt: null })).status).toBe(404)
  })

  it('reminds once when due, counts it until done, and re-arms on a new time', async () => {
    const s = await setup()
    const ev = events(t, s.li.id)
    const a = (await send(s.asWang, s.g.id, '记得看下发版清单')).body
    await s.asLi.put(`/api/messages/${a.id}/save`, { remindAt: '2026-11-08T08:20:00Z' })
    expect(ev.some((e) => e.t === 'saved.changed')).toBe(true)

    expect(await fireDueReminders(t.ctx)).toBe(0)
    clock = new Date('2026-11-08T08:20:30Z')
    expect(await fireDueReminders(t.ctx)).toBe(1)
    expect(await fireDueReminders(t.ctx)).toBe(0)

    const notes = (await s.asLi.get<NotificationDto[]>('/api/notifications')).body
    const reminder = notes.find((x) => x.type === 'reminder')
    expect(reminder?.payload).toMatchObject({ groupId: s.g.id, messageId: a.id, text: '记得看下发版清单' })
    expect(await state(s.asLi)).toEqual({ ids: [a.id], due: 1 })
    expect((await list(s.asLi))[0]!.remindedAt).toBeTruthy()

    await s.asLi.put(`/api/messages/${a.id}/save`, { remindAt: '2026-11-08T09:00:00Z' })
    expect(await state(s.asLi)).toEqual({ ids: [a.id], due: 0 })
    clock = new Date('2026-11-08T09:00:00Z')
    expect(await fireDueReminders(t.ctx)).toBe(1)

    await s.asLi.put(`/api/messages/${a.id}/save/done`, { done: true })
    expect(await state(s.asLi)).toEqual({ ids: [], due: 0 })
    expect(await list(s.asLi)).toEqual([])
    expect((await list(s.asLi, 'done')).map((i) => i.message.id)).toEqual([a.id])

    await s.asLi.put(`/api/messages/${a.id}/save/done`, { done: false })
    expect((await list(s.asLi)).map((i) => i.message.id)).toEqual([a.id])
  })

  it('does not remind about done messages', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '看一下')).body
    await s.asLi.put(`/api/messages/${a.id}/save`, { remindAt: '2026-11-08T08:20:00Z' })
    await s.asLi.put(`/api/messages/${a.id}/save/done`, { done: true })
    clock = new Date('2026-11-08T09:00:00Z')
    expect(await fireDueReminders(t.ctx)).toBe(0)
  })

  it('removes a saved message', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '看一下')).body
    await s.asLi.put(`/api/messages/${a.id}/save`, { remindAt: null })
    expect((await s.asLi.del(`/api/messages/${a.id}/save`)).status).toBe(200)
    expect(await state(s.asLi)).toEqual({ ids: [], due: 0 })
    expect((await s.asLi.put(`/api/messages/${a.id}/save/done`, { done: true })).status).toBe(404)
  })

  it('points a reminder about a thread reply at its thread', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    const reply = (await send(s.asWang, s.g.id, '话题里的事', { threadRootId: root.id })).body
    await s.asLi.put(`/api/messages/${reply.id}/save`, { remindAt: '2026-11-08T08:00:00Z' })
    await fireDueReminders(t.ctx)
    const notes = (await s.asLi.get<NotificationDto[]>('/api/notifications')).body
    expect(notes.find((x) => x.type === 'reminder')?.payload).toMatchObject({ threadRootId: root.id })
  })

  it('leaves out messages of groups the caller has left', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '看一下')).body
    await s.asLi.put(`/api/messages/${a.id}/save`, { remindAt: '2026-11-08T08:10:00Z' })
    expect((await s.asWang.del(`/api/groups/${s.g.id}/members/${s.li.id}`)).status).toBe(200)
    expect(await list(s.asLi)).toEqual([])
    clock = new Date('2026-11-08T09:00:00Z')
    expect(await fireDueReminders(t.ctx)).toBe(0)
  })
})
