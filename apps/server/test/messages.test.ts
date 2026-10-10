import type { MessageDto, TimelineDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

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
  const outsider = await t.seed.user({ name: '赵敏' })
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const small = await t.seed.bot({ ownerId: wang.id, name: '小王' })
  const codex = await t.seed.bot({ ownerId: li.id, name: 'Codex' })
  const notInGroup = await t.seed.bot({ ownerId: li.id, name: '外面的 Bot' })
  const g = await t.seed.group({
    createdBy: wang.id,
    memberIds: [li.id],
    botIds: [claude.id, small.id, codex.id],
  })
  return {
    wang,
    li,
    g,
    claude,
    small,
    codex,
    notInGroup,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
  }
}

let n = 0
const send = (c: ReturnType<typeof client>, groupId: string, body: string, clientId = `client-${++n}-x`) =>
  c.post<MessageDto>(`/api/groups/${groupId}/messages`, { body, clientId })

describe('send message', () => {
  it('stores the message, parses mentions, publishes and triggers runs', async () => {
    const s = await setup()
    const liEvents = events(t, s.li.id)
    const res = await send(s.asWang, s.g.id, '@小王的 Claude 和 @Codex 看下，@外面的 Bot 不算，@小王 也来')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      kind: 'user',
      authorId: s.wang.id,
      authorName: '王磊',
      groupId: s.g.id,
      mentions: [s.claude.id, s.codex.id, s.small.id],
      runId: null,
    })
    expect(liEvents).toEqual([{ t: 'message.new', message: res.body }])
    expect(triggerRuns).toHaveBeenCalledTimes(1)
    expect(vi.mocked(triggerRuns).mock.calls[0]![1]).toMatchObject({ id: res.body.id })
  })

  it('does not trigger anything without mentions', async () => {
    const s = await setup()
    const res = await send(s.asLi, s.g.id, '大家好，没有 @ 任何 Bot')
    expect(res.body.mentions).toEqual([])
    expect(triggerRuns).not.toHaveBeenCalled()
  })

  it('targets the only bot of a dm without an explicit @', async () => {
    const s = await setup()
    const dm = await t.seed.group({ createdBy: s.wang.id, kind: 'dm', botIds: [s.claude.id] })
    const res = await send(s.asWang, dm.id, '帮我看下这个报错')
    expect(res.body.mentions).toEqual([s.claude.id])
    expect(triggerRuns).toHaveBeenCalledTimes(1)
  })

  it('still requires an @ in a dm with several bots', async () => {
    const s = await setup()
    const dm = await t.seed.group({ createdBy: s.wang.id, kind: 'dm', botIds: [s.claude.id, s.small.id] })
    expect((await send(s.asWang, dm.id, '帮我看下')).body.mentions).toEqual([])
    expect((await send(s.asWang, dm.id, '@小王 帮我看下')).body.mentions).toEqual([s.small.id])
    expect(triggerRuns).toHaveBeenCalledTimes(1)
  })

  it('ignores bots removed from the group', async () => {
    const s = await setup()
    await s.asWang.del(`/api/groups/${s.g.id}/bots/${s.codex.id}`)
    expect((await send(s.asWang, s.g.id, '@Codex 在吗')).body.mentions).toEqual([])
  })

  it('is idempotent per user + group + clientId, even when requests race', async () => {
    const s = await setup()
    const liEvents = events(t, s.li.id)
    const [a, b] = await Promise.all([
      send(s.asWang, s.g.id, '@Codex 跑测试', 'dup-client-1'),
      send(s.asWang, s.g.id, '@Codex 跑测试', 'dup-client-1'),
    ])
    const c = await send(s.asWang, s.g.id, '@Codex 跑测试', 'dup-client-1')
    expect(a.body.id).toBe(b.body.id)
    expect(c.body.id).toBe(a.body.id)
    const rows = await t.db.select().from(messages).where(eq(messages.groupId, s.g.id))
    expect(rows.filter((m) => m.kind === 'user')).toHaveLength(1)
    expect(liEvents.filter((e) => e.t === 'message.new')).toHaveLength(1)
    expect(triggerRuns).toHaveBeenCalledTimes(1)

    const other = await send(s.asLi, s.g.id, 'same key, other user', 'dup-client-1')
    expect(other.body.id).not.toBe(a.body.id)
  })

  it('accepts very long messages up to the limit', async () => {
    const s = await setup()
    expect((await send(s.asWang, s.g.id, 'x'.repeat(20000))).status).toBe(200)
    expect((await send(s.asWang, s.g.id, 'x'.repeat(20001))).status).toBe(400)
    expect((await send(s.asWang, s.g.id, '   ')).status).toBe(400)
  })

  it('rejects non-members', async () => {
    const s = await setup()
    expect((await send(s.asOutsider, s.g.id, 'hi')).status).toBe(404)
  })
})

describe('timeline', () => {
  it('pages backwards by seq and includes runs triggered in the page', async () => {
    const s = await setup()
    const sent: MessageDto[] = []
    for (let i = 0; i < 60; i++) sent.push((await send(s.asWang, s.g.id, `m${i}`)).body)
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: s.g.id,
        botId: s.codex.id,
        triggerMessageId: sent[59]!.id,
        triggerUserId: s.wang.id,
        originUserId: s.wang.id,
        status: 'running',
        step: '读取 README.md',
      })
      .returning()
    await t.db.insert(runs).values({
      groupId: s.g.id,
      botId: s.codex.id,
      triggerMessageId: sent[0]!.id,
      originUserId: s.wang.id,
      status: 'completed',
    })

    const page1 = (await s.asLi.get<TimelineDto>(`/api/groups/${s.g.id}/timeline`)).body
    expect(page1.messages).toHaveLength(50)
    expect(page1.messages.at(-1)!.body).toBe('m59')
    expect(page1.messages[0]!.body).toBe('m10')
    expect(page1.runs).toEqual([
      expect.objectContaining({ id: run!.id, status: 'running', step: '读取 README.md', usage: null }),
    ])

    const before = page1.messages[0]!.seq
    const page2 = (await s.asLi.get<TimelineDto>(`/api/groups/${s.g.id}/timeline?before=${before}&limit=50`))
      .body
    expect(page2.messages.map((m) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`))
    expect(page2.runs.map((r) => r.status)).toEqual(['completed'])

    const small = (await s.asLi.get<TimelineDto>(`/api/groups/${s.g.id}/timeline?limit=5`)).body
    expect(small.messages.map((m) => m.body)).toEqual(['m55', 'm56', 'm57', 'm58', 'm59'])
    expect((await s.asLi.get(`/api/groups/${s.g.id}/timeline?limit=0`)).status).toBe(400)
  })

  it('first page also includes live runs whose trigger is off the page', async () => {
    const s = await setup()
    const sent: MessageDto[] = []
    for (let i = 0; i < 4; i++) sent.push((await send(s.asWang, s.g.id, `m${i}`)).body)
    const base = { groupId: s.g.id, botId: s.codex.id, originUserId: s.wang.id }
    const [live] = await t.db
      .insert(runs)
      .values({ ...base, triggerMessageId: sent[0]!.id, status: 'awaiting_approval' })
      .returning()
    await t.db.insert(runs).values({ ...base, triggerMessageId: sent[1]!.id, status: 'completed' })
    const [onPage] = await t.db
      .insert(runs)
      .values({ ...base, triggerMessageId: sent[3]!.id, status: 'running' })
      .returning()

    const page1 = (await s.asLi.get<TimelineDto>(`/api/groups/${s.g.id}/timeline?limit=2`)).body
    expect(page1.messages.map((m) => m.body)).toEqual(['m2', 'm3'])
    expect(page1.runs.map((r) => r.id)).toEqual([live!.id, onPage!.id])

    const page2 = (
      await s.asLi.get<TimelineDto>(`/api/groups/${s.g.id}/timeline?before=${page1.messages[0]!.seq}&limit=1`)
    ).body
    expect(page2.messages.map((m) => m.body)).toEqual(['m1'])
    expect(page2.runs.map((r) => r.status)).toEqual(['completed'])
  })
})
