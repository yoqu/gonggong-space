import type { GroupDto, MessageDto, UnreadsDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notifications } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function people() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  return {
    wang,
    li,
    zhao,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asZhao: client(t, await t.seed.cookie(zhao.id)),
  }
}

let n = 0
const send = async (c: ReturnType<typeof client>, groupId: string, body: string, extra = {}) =>
  (
    await c.post<MessageDto>(`/api/groups/${groupId}/messages`, {
      body,
      clientId: `client-${String(++n).padStart(4, '0')}`,
      ...extra,
    })
  ).body

const unreadOf = async (c: ReturnType<typeof client>, groupId: string) =>
  (await c.get<GroupDto>(`/api/groups/${groupId}`)).body.unread

describe('从这里标为未读', () => {
  it('moves the read cursor back to just before the message and tells the reader', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id] })
    await send(p.asLi, g.id, 'a')
    const b = await send(p.asLi, g.id, 'b')
    await send(p.asLi, g.id, 'c')
    await p.asWang.post(`/api/groups/${g.id}/read`, {})
    const got = events(t, p.wang.id)
    const res = await p.asWang.put<GroupDto>(`/api/groups/${g.id}/unread`, { seq: b.seq })
    expect(res.status).toBe(200)
    expect(res.body.unread).toBe(2)
    expect(await unreadOf(p.asWang, g.id)).toBe(2)
    expect(got).toContainEqual(expect.objectContaining({ t: 'group.updated' }))
    // Only my cursor moved.
    expect(await unreadOf(p.asLi, g.id)).toBe(0)
  })

  it('rejects seqs past the end and non-members', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id] })
    const a = await send(p.asLi, g.id, 'a')
    expect((await p.asWang.put(`/api/groups/${g.id}/unread`, { seq: a.seq + 1000 })).status).toBe(400)
    expect((await p.asZhao.put(`/api/groups/${g.id}/unread`, { seq: a.seq })).status).toBe(404)
  })
})

describe('全部已读', () => {
  it('reads every group of the caller only, settling their @ notifications', async () => {
    const p = await people()
    const g1 = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id, p.zhao.id] })
    const g2 = await t.seed.group({ createdBy: p.li.id, memberIds: [p.wang.id, p.zhao.id] })
    await send(p.asLi, g1.id, '@王磊 看一下')
    await send(p.asLi, g2.id, '@赵敏 也看一下')
    await send(p.asZhao, g2.id, 'hi')
    const res = await p.asWang.post('/api/groups/read-all', {})
    expect(res.status).toBe(204)
    expect([await unreadOf(p.asWang, g1.id), await unreadOf(p.asWang, g2.id)]).toEqual([0, 0])
    expect(await unreadOf(p.asZhao, g2.id)).toBe(1)
    const mine = await t.db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.userId, p.wang.id), eq(notifications.type, 'mention')))
    expect(mine.length).toBe(1)
    expect(mine[0]?.readAt).not.toBeNull()
    const zhaos = await t.db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.userId, p.zhao.id))
    expect(zhaos.every((r) => r.readAt === null)).toBe(true)
  })
})

describe('GET /api/unreads', () => {
  it('lists groups with unread main-timeline messages, latest group first, oldest message first', async () => {
    const p = await people()
    const quiet = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id], name: '安静' })
    const g1 = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id], name: '一' })
    const g2 = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id], name: '二' })
    await send(p.asLi, quiet.id, 'old')
    await p.asWang.post(`/api/groups/${quiet.id}/read`, {})
    const root = await send(p.asLi, g1.id, 'g1-a')
    await send(p.asWang, g1.id, 'mine')
    await send(p.asLi, g1.id, 'in thread', { threadRootId: root.id })
    await send(p.asLi, g2.id, 'g2-a')
    await send(p.asLi, g2.id, 'g2-b')
    const res = await p.asWang.get<UnreadsDto>('/api/unreads')
    expect(res.status).toBe(200)
    expect(res.body.groups.map((x) => x.group.name)).toEqual(['二', '一'])
    expect(res.body.groups.map((x) => x.messages.map((m) => m.body))).toEqual([['g2-a', 'g2-b'], ['g1-a']])
    expect(res.body.groups.every((x) => !x.more)).toBe(true)
  })

  it('shows the first 20 and says there are more', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id] })
    for (let i = 0; i < 22; i++) await send(p.asLi, g.id, `m${i}`)
    const [item] = (await p.asWang.get<UnreadsDto>('/api/unreads')).body.groups
    expect(item?.messages.length).toBe(20)
    expect(item?.messages[0]?.body).toBe('m0')
    expect(item?.more).toBe(true)
  })
})
