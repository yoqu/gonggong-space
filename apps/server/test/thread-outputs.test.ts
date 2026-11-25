import { type MessageDto, PROTOCOL_VERSION, type ToolCallRes, type WebEvent } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages, runs, threadFollows } from '../src/db/schema.js'
import { forgetRedactors } from '../src/modules/secrets/resolve.js'
import { threadSummaries } from '../src/modules/threads/service.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => {
  forgetRedactors()
  return t.close()
})

/**
 * Zhao asked the bot in the main timeline of a chat that puts bot replies in threads: the run answers in the thread
 * under the asking message. The chat setting is off by now, so nothing but the run itself says where it answers.
 */
async function world(status = 'running') {
  const wang = await t.seed.user({ name: '王磊' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id, binding: 'bound' })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [zhao.id], botIds: [bot.id] })
  const [root] = await t.db
    .insert(messages)
    .values({
      groupId: group.id,
      kind: 'user',
      authorUserId: zhao.id,
      body: '@Claude 干活',
      meta: { mentions: [bot.id] },
    })
    .returning()
  const [run] = await t.db
    .insert(runs)
    .values({
      groupId: group.id,
      botId: bot.id,
      triggerMessageId: root!.id,
      originUserId: zhao.id,
      triggerUserId: zhao.id,
      threadRootId: root!.id,
      status,
    })
    .returning()
  const seen: WebEvent[] = []
  t.ctx.bus.attach(wang.id, (e) => seen.push(e))
  const call = async (name: string, args: unknown = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${run!.id}/tools/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    return res.json<ToolCallRes>()
  }
  const events = () => t.db.select().from(messages).where(eq(messages.kind, 'event'))
  const summary = async () => (await threadSummaries(t.ctx, [root!.id])).get(root!.id)
  const updated = () => seen.filter((e) => e.t === 'thread.updated' && e.rootId === root!.id)
  return { wang, zhao, bot, group, root: root!, run: run!, token, call, events, summary, updated }
}

describe('a run answering in a thread keeps its output there', () => {
  it('sends attachments into the thread: a reply that the asker follows', async () => {
    const w = await world()
    const form = new FormData()
    form.set('text', '附件')
    form.append('files', new Blob([new Uint8Array(Buffer.from('# v3'))], { type: 'text/markdown' }), 'v3.md')
    const res = await fetch(t.url(`/api/daemon/runs/${w.run.id}/attachments`), {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}` },
      body: form,
    })
    const body = (await res.json()) as MessageDto
    expect(res.status).toBe(200)
    expect(body.threadRootId).toBe(w.root.id)
    expect((await w.summary())?.replyCount).toBe(1)
    expect(w.updated()).toHaveLength(1)
    const [follow] = await t.db
      .select()
      .from(threadFollows)
      .where(and(eq(threadFollows.rootMessageId, w.root.id), eq(threadFollows.userId, w.zhao.id)))
    expect(follow?.following).toBe(true)
  })

  it('posts progress cards in the thread, giving the root its thread entry', async () => {
    const w = await world()
    const res = await w.call('progress_card', {
      title: '部署',
      stages: [{ name: '构建', status: 'running' }],
    })
    expect(res.isError).toBeFalsy()
    const [card] = await w.events()
    expect(card?.threadRootId).toBe(w.root.id)
    expect((await w.summary())?.replyCount).toBe(1)
    expect(w.updated()).toHaveLength(1)
  })

  it('asks for secrets in the thread, and carries on there once filled', async () => {
    const w = await world()
    const wang = client(t, await t.seed.cookie(w.wang.id))
    await wang.post(`/api/teams/${w.group.teamId}/secrets`, { name: 'JIRA_TOKEN', mode: 'personal' })
    const asked = await w.call('secret_request', { names: ['JIRA_TOKEN'] })
    expect(asked.isError, asked.text).toBeFalsy()
    const [card] = await w.events()
    expect(card?.threadRootId).toBe(w.root.id)
    expect((await w.summary())?.replyCount).toBe(1)

    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, w.run.id))
    const id = (card!.meta as { secretCard: { id: string } }).secretCard.id
    const zhao = client(t, await t.seed.cookie(w.zhao.id))
    expect(
      (await zhao.post(`/api/secret-requests/${id}`, { values: { JIRA_TOKEN: 'zhao-jira-value' } })).status,
    ).toBe(200)
    const notice = (await w.events()).find((m) => m.body.startsWith('已填写密钥'))
    expect(notice?.threadRootId).toBe(w.root.id)
    await vi.waitFor(async () => {
      const again = await t.db.select().from(runs).where(eq(runs.triggerMessageId, w.root.id))
      expect(again.map((r) => r.threadRootId)).toEqual([w.root.id, w.root.id])
    }, 10_000)
  })

  it('runs 重新运行 in the thread the run answered in', async () => {
    const w = await world('interrupted')
    const wang = client(t, await t.seed.cookie(w.wang.id))
    expect((await wang.post(`/api/runs/${w.run.id}/retry`, {})).status).toBe(204)
    const again = await t.db.select().from(runs).where(eq(runs.triggerMessageId, w.root.id))
    expect(again.map((r) => r.threadRootId)).toEqual([w.root.id, w.root.id])
  })

  it('tells a compaction in the thread', async () => {
    const w = await world()
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: w.token,
        daemonVersion: '0.1.0',
        machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
        agents: [],
        activeRuns: [w.run.id],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    ws.send(
      JSON.stringify({
        t: 'run.event',
        runId: w.run.id,
        event: { kind: 'compaction', compactionId: 'c1', status: 'completed', trigger: 'auto' },
      }),
    )
    await vi.waitFor(async () => {
      const [m] = await w.events()
      expect(m).toMatchObject({ body: 'Claude 已自动压缩上下文', threadRootId: w.root.id })
    }, 10_000)
  })
})
