import {
  type MessageDto,
  type NotificationDto,
  PROTOCOL_VERSION,
  type RunStart,
  type ThreadUnreadDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  groupBots,
  groupMembers,
  groups,
  messages,
  runs,
  threadFollows,
  threadSessions,
} from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function daemon(token: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.1.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { send: (m: unknown) => ws.send(JSON.stringify(m)), next: () => box.next<RunStart>() }
}

const done = (runId: string, o: Record<string, unknown> = {}) => ({
  t: 'run.done',
  runId,
  outcome: 'completed',
  reply: '已完成',
  filesChanged: 0,
  usage: null,
  sessionId: 'sess-thread',
  newSessionReason: 'first',
  error: null,
  git: null,
  patch: null,
  appendsApplied: 0,
  ...o,
})

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({
    ownerId: alice.id,
    name: '小王的 Claude',
    machineId: machine.id,
    binding: 'bound',
  })
  const group = await t.seed.group({ createdBy: alice.id, memberIds: [bob.id], botIds: [bot.id] })
  await t.db
    .update(groupBots)
    .set({ sessionId: 'sess-group', workspaceState: 'ready' })
    .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
  const say = async (
    body: string,
    o: { userId?: string; botId?: string; thread?: string; mentions?: string[] },
  ) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: o.botId ? 'bot' : 'user',
        authorUserId: o.userId ?? null,
        authorBotId: o.botId ?? null,
        body,
        meta: { mentions: o.mentions ?? [] },
        threadRootId: o.thread ?? null,
      })
      .returning()
    return m!
  }
  const mention = async (body: string, thread?: string) => {
    const m = await say(body, { userId: alice.id, thread, mentions: [bot.id] })
    await triggerRuns(t.ctx, m)
    return m
  }
  const groupBot = async () =>
    (
      await t.db
        .select()
        .from(groupBots)
        .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
    )[0]!
  const replyOf = async (runId: string) =>
    vi.waitFor(async () => {
      const [m] = await t.db.select().from(messages).where(eq(messages.runId, runId))
      if (!m) throw new Error('no reply yet')
      return m
    })
  return { alice, bob, bot, group, token, say, mention, groupBot, replyOf }
}

describe('a bot asked in a thread', () => {
  it('runs in a session of the thread, with the thread alone as context, and replies there', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const root = await w.say('退款接口要不要拆？', { userId: w.bob.id })
    await w.say('主频道的闲聊', { userId: w.bob.id })
    await w.say('我觉得要拆', { userId: w.bob.id, thread: root.id })
    const before = await w.groupBot()
    const trigger = await w.mention('@小王的 Claude 你看呢', root.id)

    const start = await d.next()
    expect(start.resumeSessionId).toBeNull()
    expect(start.bot.systemPrompt).toMatch(/^This turn comes from a thread of the group/)
    expect(start.prompt.context.map((c) => c.body)).toEqual(['退款接口要不要拆？', '我觉得要拆'])
    const [run] = await t.db.select().from(runs).where(eq(runs.id, start.runId))
    expect(run?.threadRootId).toBe(root.id)
    // The group's conversation is untouched.
    expect(await w.groupBot()).toMatchObject({ contextSeq: before.contextSeq, sessionId: 'sess-group' })

    d.send(done(start.runId, { reply: '建议拆' }))
    const reply = await w.replyOf(start.runId)
    expect(reply).toMatchObject({ threadRootId: root.id, body: '建议拆' })
    await vi.waitFor(async () => {
      const [ts] = await t.db.select().from(threadSessions).where(eq(threadSessions.rootMessageId, root.id))
      expect(ts).toMatchObject({ botId: w.bot.id, sessionId: 'sess-thread', contextSeq: trigger.seq })
    })
    expect((await w.groupBot()).sessionId).toBe('sess-group')

    // The next turn in the thread resumes its session and hears only what came since, without its own reply.
    await w.say('那就拆吧', { userId: w.bob.id, thread: root.id })
    await w.mention('@小王的 Claude 开工', root.id)
    const second = await d.next()
    expect(second.resumeSessionId).toBe('sess-thread')
    expect(second.prompt.context.map((c) => c.body)).toEqual(['那就拆吧'])
    expect(second.prompt.fallbackContext.map((c) => c.body)).toEqual([
      '退款接口要不要拆？',
      '我觉得要拆',
      '@小王的 Claude 你看呢',
      '建议拆',
      '那就拆吧',
    ])
  })

  it('leaves thread replies out of the group context', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const root = await w.say('根', { userId: w.bob.id })
    await w.say('话题里的', { userId: w.bob.id, thread: root.id })
    const also = await w.say('也发到群里', { userId: w.bob.id, thread: root.id })
    await t.db
      .update(messages)
      .set({ meta: { mentions: [], alsoSent: true } })
      .where(eq(messages.id, also.id))
    await w.mention('@小王的 Claude 总结下')
    const start = await d.next()
    expect(start.resumeSessionId).toBe('sess-group')
    expect(start.prompt.context.map((c) => c.body)).toEqual(['根', '也发到群里'])
  })

  it('starts over the thread session only on /new in the thread', async () => {
    const w = await world()
    const asAlice = client(t, await t.seed.cookie(w.alice.id))
    const root = await w.say('根', { userId: w.bob.id })
    await t.db
      .insert(threadSessions)
      .values({ rootMessageId: root.id, botId: w.bot.id, sessionId: 'sess-thread' })
    const res = await asAlice.post<MessageDto>(`/api/groups/${w.group.id}/messages`, {
      body: '/new @小王的 Claude',
      clientId: 'client-new-1',
      threadRootId: root.id,
    })
    expect(res.status).toBe(200)
    const [ts] = await t.db.select().from(threadSessions).where(eq(threadSessions.rootMessageId, root.id))
    expect(ts).toMatchObject({ sessionId: null, newSessionReason: 'requested' })
    expect(await w.groupBot()).toMatchObject({ sessionId: 'sess-group', newSessionReason: null })
    const [event] = await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, w.group.id), eq(messages.kind, 'event')))
    expect(event).toMatchObject({ threadRootId: root.id })
  })
})

describe('Bot 回复进话题', () => {
  it('puts the reply to a main-timeline @ into a thread of it, in the group session', async () => {
    const w = await world()
    await t.db
      .update(groups)
      .set({ params: { botRepliesInThread: true } })
      .where(eq(groups.id, w.group.id))
    const d = await daemon(w.token)
    const trigger = await w.mention('@小王的 Claude 查下报错')
    const start = await d.next()
    expect(start.resumeSessionId).toBe('sess-group')
    const [run] = await t.db.select().from(runs).where(eq(runs.id, start.runId))
    expect(run?.threadRootId).toBe(trigger.id)
    d.send(done(start.runId, { reply: '查到了', sessionId: 'sess-group-2' }))
    expect(await w.replyOf(start.runId)).toMatchObject({ threadRootId: trigger.id })
    await vi.waitFor(async () => expect((await w.groupBot()).sessionId).toBe('sess-group-2'))

    // Asked again in that thread: a thread session that sees the whole thread, its first reply included.
    await w.mention('@小王的 Claude 怎么修', trigger.id)
    const next = await d.next()
    expect(next.resumeSessionId).toBeNull()
    expect(next.prompt.context.map((c) => c.body)).toEqual(['@小王的 Claude 查下报错', '查到了'])
  })

  it('posts the refusal notice in the thread of the asking message', async () => {
    const w = await world()
    const root = await w.say('发版前要不要冻结主干？', { userId: w.bob.id })
    await t.db
      .update(groupBots)
      .set({ workspaceState: 'unbound' })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    await w.mention('@小王的 Claude 看下', root.id)
    const [notice] = await vi.waitFor(async () => {
      const rows = await t.db.select().from(messages).where(eq(messages.kind, 'event'))
      if (!rows.length) throw new Error('no notice yet')
      return rows
    })
    expect(notice).toMatchObject({ threadRootId: root.id })
    expect(notice?.body).toContain('还没有工作区')
  })

  it('keeps the refusal notice of a main-timeline @ in the group, not in a new thread nobody sees', async () => {
    const w = await world()
    await t.db
      .update(groups)
      .set({ params: { botRepliesInThread: true } })
      .where(eq(groups.id, w.group.id))
    await t.db
      .update(groupBots)
      .set({ workspaceState: 'unbound' })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    await w.mention('@小王的 Claude 看下')
    const [notice] = await vi.waitFor(async () => {
      const rows = await t.db.select().from(messages).where(eq(messages.kind, 'event'))
      if (!rows.length) throw new Error('no notice yet')
      return rows
    })
    expect(notice).toMatchObject({ threadRootId: null })
  })

  it('is a group setting for admins, announced in the group', async () => {
    const w = await world()
    const asAlice = client(t, await t.seed.cookie(w.alice.id))
    const res = await asAlice.patch<{ botRepliesInThread?: boolean }>(`/api/groups/${w.group.id}`, {
      botRepliesInThread: true,
    })
    expect(res.body.botRepliesInThread).toBe(true)
    const asBob = client(t, await t.seed.cookie(w.bob.id))
    expect((await asBob.patch(`/api/groups/${w.group.id}`, { botRepliesInThread: false })).status).toBe(403)
    const events = await t.db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.groupId, w.group.id), eq(messages.kind, 'event')))
    expect(events.map((e) => e.body)).toEqual(['王磊 开启了「Bot 回复进话题」'])
  })
})

describe('a bot answering in a thread', () => {
  async function asked() {
    const w = await world()
    const d = await daemon(w.token)
    const root = await w.say('退款接口要不要拆？', { userId: w.bob.id })
    await t.db
      .insert(threadFollows)
      .values({ rootMessageId: root.id, userId: w.alice.id, groupId: w.group.id })
    await w.mention('@小王的 Claude 你看呢', root.id)
    const start = await d.next()
    const asAlice = client(t, await t.seed.cookie(w.alice.id))
    const finish = async () => {
      d.send(done(start.runId, { reply: '建议拆' }))
      await w.replyOf(start.runId)
    }
    return { w, root, asAlice, finish }
  }
  const notes = async (c: ReturnType<typeof client>) =>
    (await c.get<NotificationDto[]>('/api/notifications')).body

  it('alerts the one who asked: a @ on the thread, a notification opening it', async () => {
    const { w, root, asAlice, finish } = await asked()
    await finish()
    await vi.waitFor(async () => expect(await notes(asAlice)).toHaveLength(1))
    expect((await notes(asAlice))[0]).toMatchObject({
      type: 'mention',
      payload: { groupId: w.group.id, threadRootId: root.id, byName: '小王的 Claude', botReply: true },
    })
    expect((await asAlice.get<ThreadUnreadDto>('/api/threads/unread')).body).toEqual({
      unread: 1,
      mentioned: 1,
    })
    // Reading the thread settles it.
    await asAlice.put(`/api/messages/${root.id}/thread/read`, {})
    expect((await notes(asAlice))[0]?.readAt).not.toBeNull()
  })

  it('does not notify with 通知 「关闭」, but still counts the @', async () => {
    const { w, asAlice, finish } = await asked()
    await t.db.update(groupMembers).set({ notifyLevel: 'off' }).where(eq(groupMembers.userId, w.alice.id))
    await finish()
    expect(await notes(asAlice)).toEqual([])
    expect((await asAlice.get<ThreadUnreadDto>('/api/threads/unread')).body.mentioned).toBe(1)
  })

  it('does not alert someone who did not ask', async () => {
    const { w, root, finish } = await asked()
    await finish()
    const asBob = client(t, await t.seed.cookie(w.bob.id))
    await t.db
      .insert(threadFollows)
      .values({ rootMessageId: root.id, userId: w.bob.id, groupId: w.group.id })
      .onConflictDoNothing()
    expect(await notes(asBob)).toEqual([])
    expect((await asBob.get<ThreadUnreadDto>('/api/threads/unread')).body.mentioned).toBe(0)
  })
})
