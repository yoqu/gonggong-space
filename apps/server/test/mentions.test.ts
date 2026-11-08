import type { GroupDto, MessageDto, NotificationDto, WebEvent } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

vi.mock('../src/modules/runs/trigger.js', () => ({ triggerRuns: vi.fn(async () => {}) }))

let t: TestApp
beforeEach(async () => {
  vi.mocked(triggerRuns).mockClear()
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const chen = await t.seed.user({ name: '陈晨' })
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id, chen.id], botIds: [claude.id] })
  const as = async (id: string) => client(t, await t.seed.cookie(id))
  return {
    wang,
    li,
    chen,
    claude,
    g,
    asWang: await as(wang.id),
    asLi: await as(li.id),
    asChen: await as(chen.id),
  }
}

const send = (c: ReturnType<typeof client>, groupId: string, body: string) =>
  c.post<MessageDto>(`/api/groups/${groupId}/messages`, { body, clientId: `c-${Math.random()}` })
const notes = async (c: ReturnType<typeof client>) =>
  (await c.get<NotificationDto[]>('/api/notifications')).body
const groupOf = async (c: ReturnType<typeof client>, id: string) =>
  (await c.get<GroupDto[]>('/api/groups')).body.find((g) => g.id === id)

describe('被 @ 提醒', () => {
  it('notifies the members a message @s, not its author, and flags the group until read', async () => {
    const s = await setup()
    const res = await send(s.asWang, s.g.id, '@李建国 看下 @小王的 Claude 的改动，@王磊 自己不算')
    expect(res.body.userMentions).toEqual([s.li.id, s.wang.id])
    const [n] = await notes(s.asLi)
    expect(n).toMatchObject({
      type: 'mention',
      payload: { groupId: s.g.id, messageId: res.body.id, byName: '王磊' },
    })
    expect(await notes(s.asWang)).toEqual([])
    expect(await notes(s.asChen)).toEqual([])
    expect((await groupOf(s.asLi, s.g.id))?.mentionCount).toBe(1)
    expect((await groupOf(s.asChen, s.g.id))?.mentionCount).toBe(0)
    await s.asLi.post(`/api/groups/${s.g.id}/read`, {})
    expect((await groupOf(s.asLi, s.g.id))?.mentionCount).toBe(0)
  })

  it('marks the @ notifications read once the group is read up to them, and tells the user live', async () => {
    const s = await setup()
    const first = (await send(s.asWang, s.g.id, '@李建国 先看这个')).body
    const second = (await send(s.asWang, s.g.id, '@李建国 再看这个')).body
    const seen: WebEvent[] = []
    t.ctx.bus.attach(s.li.id, (e) => seen.push(e))

    await s.asLi.post(`/api/groups/${s.g.id}/read`, { seq: first.seq })
    const byMsg = async (id: string) => (await notes(s.asLi)).find((n) => n.payload.messageId === id)!
    const read = await byMsg(first.id)
    expect(read.readAt).not.toBeNull()
    expect((await byMsg(second.id)).readAt).toBeNull()
    expect(seen.filter((e) => e.t === 'notification.resolved')).toEqual([
      {
        t: 'notification.resolved',
        notifications: [expect.objectContaining({ id: read.id, readAt: read.readAt })],
        unread: 1,
      },
    ])

    await s.asLi.post(`/api/groups/${s.g.id}/read`, {})
    expect((await notes(s.asLi)).every((n) => n.readAt)).toBe(true)
    expect(seen.filter((e) => e.t === 'notification.resolved').at(-1)).toMatchObject({ unread: 0 })
    expect((await s.asLi.get<{ n: number }>('/api/notifications/unread')).body.n).toBe(0)

    await s.asLi.post(`/api/groups/${s.g.id}/read`, {})
    expect(seen.filter((e) => e.t === 'notification.resolved')).toHaveLength(2)
  })
})
