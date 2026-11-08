import type { GroupThreadsDto, MessageDto, TimelineDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groups, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

vi.mock('../src/modules/runs/trigger.js', () => ({ triggerRuns: vi.fn(async () => {}) }))

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '路人' })
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id] })
  return {
    wang,
    li,
    claude,
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
const list = async (c: C, groupId: string, query = '') =>
  (await c.get<GroupThreadsDto>(`/api/groups/${groupId}/threads${query}`)).body

describe('group thread list', () => {
  it('lists threads with replies, latest activity first, with the viewer state', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '话题 A')).body
    const b = (await send(s.asWang, s.g.id, '话题 B')).body
    await send(s.asWang, s.g.id, '没有回复的消息')
    await send(s.asLi, s.g.id, 'A 回复', { threadRootId: a.id })
    await send(s.asLi, s.g.id, 'B 回复', { threadRootId: b.id })
    await send(s.asLi, s.g.id, '@王磊 A 又回复', { threadRootId: a.id })

    const { threads, next } = await list(s.asWang, s.g.id)
    expect(next).toBeNull()
    expect(threads.map((x) => x.root.body)).toEqual(['话题 A', '话题 B'])
    expect(threads[0]).toMatchObject({
      live: false,
      root: { thread: { replyCount: 2 } },
      state: { following: true, unread: 2, mentioned: true },
    })
    expect(threads[1]?.state).toMatchObject({ unread: 1, mentioned: false })
    // A member who never followed sees no unread.
    const other = await list(s.asLi, s.g.id)
    expect(other.threads.map((x) => x.state.unread)).toEqual([0, 0])
  })

  it('puts threads with a bot at work first, even without replies', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '话题 A')).body
    await send(s.asLi, s.g.id, 'A 回复', { threadRootId: a.id })
    const b = (await send(s.asWang, s.g.id, '话题 B')).body
    await t.db.insert(runs).values({
      groupId: s.g.id,
      botId: s.claude.id,
      triggerMessageId: b.id,
      triggerUserId: s.wang.id,
      originUserId: s.wang.id,
      threadRootId: b.id,
      status: 'running',
    })
    await send(s.asLi, s.g.id, 'B 回复', { threadRootId: b.id })
    const { threads, next } = await list(s.asWang, s.g.id, '?limit=1')
    expect(threads.map((x) => [x.root.body, x.live])).toEqual([
      ['话题 B', true],
      ['话题 A', false],
    ])
    // The newer thread B with its bot at work is not repeated among the quiet ones.
    expect((await list(s.asWang, s.g.id, `?limit=1&cursor=${next}`)).threads).toEqual([])
  })

  it('pages with a cursor', async () => {
    const s = await setup()
    for (const name of ['一', '二', '三']) {
      const root = (await send(s.asWang, s.g.id, `话题${name}`)).body
      await send(s.asLi, s.g.id, '回复', { threadRootId: root.id })
    }
    const first = await list(s.asWang, s.g.id, '?limit=2')
    expect(first.threads.map((x) => x.root.body)).toEqual(['话题三', '话题二'])
    expect(first.next).not.toBeNull()
    const second = await list(s.asWang, s.g.id, `?limit=2&cursor=${first.next}`)
    expect(second.threads.map((x) => x.root.body)).toEqual(['话题一'])
    expect(second.next).toBeNull()
  })

  it('is for members only', async () => {
    const s = await setup()
    expect((await s.asOutsider.get(`/api/groups/${s.g.id}/threads`)).status).toBe(404)
    await t.db.update(groups).set({ archivedAt: new Date() }).where(eq(groups.id, s.g.id))
    expect((await s.asWang.get(`/api/groups/${s.g.id}/threads`)).status).toBe(404)
  })
})

describe('thread summary on the root', () => {
  it('carries the viewer unread and @ in the main timeline', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    await send(s.asLi, s.g.id, '@王磊 看下', { threadRootId: root.id })
    const tl = (await s.asWang.get<TimelineDto>(`/api/groups/${s.g.id}/timeline`)).body.messages
    expect(tl.find((m) => m.id === root.id)?.thread).toMatchObject({ unread: 1, mentioned: true })
    const li = (await s.asLi.get<TimelineDto>(`/api/groups/${s.g.id}/timeline`)).body.messages
    expect(li.find((m) => m.id === root.id)?.thread).toMatchObject({ unread: 0, mentioned: false })
  })

  it('keeps the shared summary free of anyone state in thread.updated', async () => {
    const s = await setup()
    const got = events(t, s.wang.id)
    const root = (await send(s.asWang, s.g.id, '根')).body
    await send(s.asLi, s.g.id, '回复', { threadRootId: root.id })
    const updated = got.find((e) => e.t === 'thread.updated')
    expect(updated && 'thread' in updated ? updated.thread : null).not.toHaveProperty('unread')
    expect(triggerRuns).not.toHaveBeenCalled()
  })
})
