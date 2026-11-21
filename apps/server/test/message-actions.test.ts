import type { MessageDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const fence = (lang: string, json: object) => `\`\`\`${lang}\n${JSON.stringify(json)}\n\`\`\``
const ENV = fence('actions', {
  id: 'env',
  prompt: '发布到哪里？',
  options: [{ label: '测试环境', value: 'test' }, { label: '生产', style: 'danger' }, { label: '预发' }],
})
const CHECKS = fence('actions', {
  id: 'checks',
  options: [{ label: 'lint' }, { label: 'e2e' }],
  multiple: true,
})

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李娜' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const { machine } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
  const post = async (body: string, o: { kind?: 'bot' | 'user'; recalled?: boolean } = {}) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: g.id,
        kind: o.kind ?? 'bot',
        authorBotId: o.kind === 'user' ? null : bot.id,
        authorUserId: o.kind === 'user' ? wang.id : null,
        body,
        meta: {},
        recalledAt: o.recalled ? new Date() : null,
      })
      .returning()
    return m!
  }
  const reply = await post(`选一个：\n\n${ENV}\n\n然后检查：\n\n${CHECKS}`)
  return {
    wang,
    li,
    bot,
    g,
    reply,
    post,
    asLi: client(t, await t.seed.cookie(li.id)),
    asWang: client(t, await t.seed.cookie(wang.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
  }
}

type W = Awaited<ReturnType<typeof world>>
const answer = (as: W['asLi'], id: string, blockId: string, options: number[]) =>
  as.post<MessageDto & { error?: string; message?: string }>(`/api/messages/${id}/actions`, {
    blockId,
    options,
  })

describe('POST /api/messages/:id/actions', () => {
  it('records the answer, pushes message.edited and @s the bot as the clicker quoting the reply', async () => {
    const w = await world()
    const seen = events(t, w.wang.id)
    const res = await answer(w.asLi, w.reply.id, 'env', [0])
    expect(res.status).toBe(200)
    expect(res.body.actions).toEqual({
      env: { userId: w.li.id, name: '李娜', labels: ['测试环境'], at: expect.any(String) },
    })
    const edited = seen.find((e) => e.t === 'message.edited')
    expect(edited).toMatchObject({ message: { id: w.reply.id, actions: { env: { labels: ['测试环境'] } } } })

    const [sent] = await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, w.g.id), eq(messages.authorUserId, w.li.id)))
    expect(sent).toMatchObject({ kind: 'user', body: '@小王的 Claude 选择了「test」' })
    expect(sent!.meta).toMatchObject({
      mentions: [w.bot.id],
      quote: {
        kind: 'message',
        id: w.reply.id,
        who: '小王的 Claude',
        text: expect.stringContaining('选一个'),
      },
    })
    expect(seen.find((e) => e.t === 'message.new')).toMatchObject({ message: { id: sent!.id } })
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent!.id))
    expect(run).toMatchObject({ botId: w.bot.id, originUserId: w.li.id })

    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'actions.answer'))
    expect(log).toMatchObject({
      actorUserId: w.li.id,
      groupId: w.g.id,
      detail: { messageId: w.reply.id, blockId: 'env', options: [0] },
    })
  })

  it('takes several options of a multiple block, joined with 、', async () => {
    const w = await world()
    expect((await answer(w.asLi, w.reply.id, 'checks', [0, 1])).status).toBe(200)
    const [sent] = await t.db.select().from(messages).where(eq(messages.authorUserId, w.li.id))
    expect(sent?.body).toBe('@小王的 Claude 选择了「lint、e2e」')
  })

  it('answers a block only once', async () => {
    const w = await world()
    expect((await answer(w.asLi, w.reply.id, 'env', [1])).status).toBe(200)
    const again = await answer(w.asWang, w.reply.id, 'env', [0])
    expect(again.status).toBe(409)
    expect(again.body.message).toContain('已有人作答')
    // The other block of the reply is still open.
    expect((await answer(w.asWang, w.reply.id, 'checks', [0])).status).toBe(200)
    const [row] = await t.db.select().from(messages).where(eq(messages.id, w.reply.id))
    expect(Object.keys((row!.meta as { actions: object }).actions).sort()).toEqual(['checks', 'env'])
  })

  it('refuses non-members, other messages, missing blocks and bad options', async () => {
    const w = await world()
    expect((await answer(w.asOutsider, w.reply.id, 'env', [0])).status).toBe(404)
    expect((await answer(w.asLi, '00000000-0000-0000-0000-000000000000', 'env', [0])).status).toBe(404)
    expect((await answer(w.asLi, 'not-a-uuid', 'env', [0])).status).toBe(404)
    const mine = await w.post(ENV, { kind: 'user' })
    expect((await answer(w.asLi, mine.id, 'env', [0])).status).toBe(404)
    const recalled = await w.post(ENV, { recalled: true })
    expect((await answer(w.asLi, recalled.id, 'env', [0])).status).toBe(404)
    expect((await answer(w.asLi, w.reply.id, 'nope', [0])).status).toBe(404)
    expect((await answer(w.asLi, w.reply.id, 'env', [0, 1])).status).toBe(400)
    expect((await answer(w.asLi, w.reply.id, 'env', [3])).status).toBe(400)
    expect((await t.db.select().from(messages).where(eq(messages.authorUserId, w.li.id))).length).toBe(0)
  })

  it('refuses when the bot has left the group', async () => {
    const w = await world()
    await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.botId, w.bot.id))
    expect((await answer(w.asLi, w.reply.id, 'env', [0])).status).toBe(409)
    const [row] = await t.db.select().from(messages).where(eq(messages.id, w.reply.id))
    expect((row!.meta as { actions?: object }).actions).toBeUndefined()
  })
})
