import type { MessageDto, ReactionsDto, TimelineDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
  const [m] = await t.db
    .insert(messages)
    .values({ groupId: g.id, kind: 'user', authorUserId: li.id, body: '好' })
    .returning()
  const [reply] = await t.db
    .insert(messages)
    .values({ groupId: g.id, kind: 'bot', authorBotId: bot.id, body: '完成' })
    .returning()
  return {
    wang,
    li,
    g,
    m: m!,
    reply: reply!,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
  }
}

const who = (u: { id: string; name: string }) => ({ id: u.id, name: u.name })

const path = (messageId: string, emoji: string) =>
  `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`

describe('message reactions', () => {
  it('adds a reaction idempotently and aggregates per emoji', async () => {
    const s = await setup()
    const first = await s.asWang.put<ReactionsDto>(path(s.m.id, '👍'))
    expect(first.status).toBe(200)
    expect(first.body).toEqual({
      groupId: s.g.id,
      messageId: s.m.id,
      reactions: [{ emoji: '👍', count: 1, mine: true, users: [who(s.wang)] }],
    })
    const again = await s.asWang.put<ReactionsDto>(path(s.m.id, '👍'))
    expect(again.body.reactions).toEqual(first.body.reactions)

    const li = await s.asLi.put<ReactionsDto>(path(s.m.id, '👍'))
    expect(li.body.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true, users: [who(s.wang), who(s.li)] },
    ])
    await s.asLi.put(path(s.m.id, '🎉'))
    const wangView = await s.asWang.put<ReactionsDto>(path(s.m.id, '👍'))
    expect(wangView.body.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true, users: [who(s.wang), who(s.li)] },
      { emoji: '🎉', count: 1, mine: false, users: [who(s.li)] },
    ])
  })

  it('removes a reaction idempotently', async () => {
    const s = await setup()
    await s.asWang.put(path(s.m.id, '👀'))
    const removed = await s.asWang.del<ReactionsDto>(path(s.m.id, '👀'))
    expect(removed.status).toBe(200)
    expect(removed.body.reactions).toEqual([])
    expect((await s.asWang.del<ReactionsDto>(path(s.m.id, '👀'))).body.reactions).toEqual([])
  })

  it('works on bot replies', async () => {
    const s = await setup()
    const res = await s.asLi.put<ReactionsDto>(path(s.reply.id, '✅'))
    expect(res.body.reactions).toEqual([{ emoji: '✅', count: 1, mine: true, users: [who(s.li)] }])
  })

  it('rejects emoji outside the fixed set', async () => {
    const s = await setup()
    expect((await s.asWang.put(path(s.m.id, '🍕'))).status).toBe(400)
    expect((await s.asWang.put(path(s.m.id, 'lol'))).status).toBe(400)
  })

  it('hides messages of groups the user is not in', async () => {
    const s = await setup()
    expect((await s.asOutsider.put(path(s.m.id, '👍'))).status).toBe(404)
    expect((await s.asOutsider.del(path(s.m.id, '👍'))).status).toBe(404)
    expect((await s.asWang.put(path('not-a-uuid', '👍'))).status).toBe(404)
  })

  it('timeline messages carry reactions from the viewer perspective', async () => {
    const s = await setup()
    await s.asWang.put(path(s.m.id, '👍'))
    await s.asLi.put(path(s.m.id, '👍'))
    await s.asLi.put(path(s.m.id, '❤️'))
    const tl = await s.asWang.get<TimelineDto>(`/api/groups/${s.g.id}/timeline`)
    const byId = new Map(tl.body.messages.map((m: MessageDto) => [m.id, m]))
    expect(byId.get(s.m.id)?.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true, users: [who(s.wang), who(s.li)] },
      { emoji: '❤️', count: 1, mine: false, users: [who(s.li)] },
    ])
    expect(byId.get(s.reply.id)?.reactions).toEqual([])
  })

  it('new messages start without reactions', async () => {
    const s = await setup()
    const res = await s.asWang.post<MessageDto>(`/api/groups/${s.g.id}/messages`, {
      body: 'hi',
      clientId: 'client-r-1',
    })
    expect(res.body.reactions).toEqual([])
  })

  it('broadcasts the new aggregate to each member with their own `mine`', async () => {
    const s = await setup()
    await s.asLi.put(path(s.m.id, '😂'))
    const wangEvents = events(t, s.wang.id)
    const liEvents = events(t, s.li.id)
    await s.asWang.put(path(s.m.id, '😂'))
    expect(wangEvents).toEqual([
      {
        t: 'message.reactions',
        groupId: s.g.id,
        messageId: s.m.id,
        reactions: [{ emoji: '😂', count: 2, mine: true, users: [who(s.li), who(s.wang)] }],
      },
    ])
    expect(liEvents).toEqual([
      {
        t: 'message.reactions',
        groupId: s.g.id,
        messageId: s.m.id,
        reactions: [{ emoji: '😂', count: 2, mine: true, users: [who(s.li), who(s.wang)] }],
      },
    ])
    await s.asLi.del(path(s.m.id, '😂'))
    expect(wangEvents[1]).toMatchObject({
      reactions: [{ emoji: '😂', count: 1, mine: true, users: [who(s.wang)] }],
    })
    expect(liEvents[1]).toMatchObject({
      reactions: [{ emoji: '😂', count: 1, mine: false, users: [who(s.wang)] }],
    })
  })

  it('does not broadcast when nothing changed', async () => {
    const s = await setup()
    await s.asWang.put(path(s.m.id, '👍'))
    const liEvents = events(t, s.li.id)
    await s.asWang.put(path(s.m.id, '👍'))
    await s.asWang.del(path(s.m.id, '🎉'))
    expect(liEvents).toEqual([])
  })
})
