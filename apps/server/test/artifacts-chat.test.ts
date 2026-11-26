import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ArtifactChatDto,
  ArtifactSubmitRes,
  GroupDto,
  GroupThreadsDto,
  MessageDto,
  ThreadDto,
  TimelineDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupBots, runs, threadFollows } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const prev = await w.run([a.id], { status: 'completed' })
  ;(await w.submit(prev.id, a.id, L1)).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const req = (method: 'GET' | 'POST', url: string, payload?: object, c = cookie) =>
    t.app.inject({ method, url, headers: { cookie: c }, payload })
  const timeline = async () =>
    ((await req('GET', `/api/groups/${w.g.id}/timeline`)).json() as TimelineDto).messages.map((m) => m.id)
  return { ...w, a, req, timeline }
}

describe('canvas AI chat (画布 AI 对话)', () => {
  it('keeps one hidden conversation per artifact', async () => {
    const s = await setup()
    const first = await s.req('POST', `/api/artifacts/${s.a.id}/chat`)
    expect(first.statusCode).toBe(200)
    const { rootId, group } = first.json() as ArtifactChatDto
    expect(group).toBeUndefined()
    expect(((await s.req('POST', `/api/artifacts/${s.a.id}/chat`)).json() as ArtifactChatDto).rootId).toBe(
      rootId,
    )
    expect(await s.timeline()).not.toContain(rootId)
    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await s.req('POST', `/api/artifacts/${s.a.id}/chat`, undefined, outsider)).statusCode).toBe(404)
  })

  it("sends what is typed on the canvas to the artifact's bot, outside the group's messages", async () => {
    const s = await setup()
    const { rootId } = (await s.req('POST', `/api/artifacts/${s.a.id}/chat`)).json() as ArtifactChatDto
    const sent = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '首页改成深色',
      clientId: 'canvas-chat-1',
      threadRootId: rootId,
      alsoSent: true,
    })
    expect(sent.statusCode).toBe(200)
    const m = sent.json() as MessageDto
    expect(m).toMatchObject({ threadRootId: rootId })
    expect(m.alsoSent).toBeUndefined()

    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m.id))
    expect(run).toMatchObject({ botId: s.bot.id, threadRootId: rootId })
    expect(await s.timeline()).not.toContain(m.id)
    // Nobody follows it: it never shows in 话题 or counts as unread there.
    expect(await t.db.select().from(threadFollows).where(eq(threadFollows.rootMessageId, rootId))).toEqual([])
    const threads = (await s.req('GET', `/api/groups/${s.g.id}/threads`)).json() as GroupThreadsDto
    expect(threads.threads.map((x) => x.root.id)).not.toContain(rootId)

    const chat = (await s.req('GET', `/api/messages/${rootId}/thread`)).json() as ThreadDto
    expect(chat.replies.map((r) => r.id)).toEqual([m.id])
    expect(chat.runs.map((r) => r.id)).toEqual([run!.id])
  })

  it("sends to the AI picked under the canvas input instead of the artifact's bot", async () => {
    const s = await setup()
    const second = await t.seed.bot({ ownerId: s.wang.id, name: '小王的 Codex', triggerScope: 'all' })
    await t.db.insert(groupBots).values({ groupId: s.g.id, botId: second.id })
    const { rootId } = (await s.req('POST', `/api/artifacts/${s.a.id}/chat`)).json() as ArtifactChatDto
    const sent = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '首页改成深色',
      clientId: 'canvas-chat-pick',
      threadRootId: rootId,
      botId: second.id,
    })
    expect(sent.statusCode).toBe(200)
    const m = sent.json() as MessageDto
    expect(m.mentions).toEqual([second.id])
  })

  it('runs a fixed artifact AI picked on the canvas without putting it in the group', async () => {
    const s = await setup()
    const gz = await t.seed.bot({ ownerId: s.outsider.id, name: '共字君', triggerScope: 'all' })
    const { rootId } = (await s.req('POST', `/api/artifacts/${s.a.id}/chat`)).json() as ArtifactChatDto
    const before = await s.timeline()
    const sent = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '首页改成深色',
      clientId: 'canvas-chat-guest',
      threadRootId: rootId,
      botId: gz.id,
    })
    expect(sent.statusCode).toBe(200)
    const m = sent.json() as MessageDto
    expect(m.mentions).toEqual([gz.id])
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m.id))
    expect(run).toMatchObject({ botId: gz.id, threadRootId: rootId })
    // Not a bot of the group: not listed, nothing about it in the group's messages, its owner not pulled in.
    const group = (await s.req('GET', `/api/groups/${s.g.id}`)).json() as GroupDto
    expect(group.botIds).toEqual([s.bot.id])
    expect(group.members.map((u) => u.userId)).not.toContain(s.outsider.id)
    expect(await s.timeline()).toEqual(before)
    // Pulled in later, it becomes a bot of the group like any other.
    const admin = await t.seed.cookie(s.wang.id)
    const added = await s.req('POST', `/api/groups/${s.g.id}/bots`, { botId: gz.id }, admin)
    expect((added.json() as GroupDto).botIds).toEqual([s.bot.id, gz.id])
  })

  it('ignores a picked AI that is neither in the group nor open for works', async () => {
    const s = await setup()
    const stranger = await t.seed.bot({ ownerId: s.outsider.id, name: '路人的 Codex', triggerScope: 'all' })
    const { rootId } = (await s.req('POST', `/api/artifacts/${s.a.id}/chat`)).json() as ArtifactChatDto
    const m = (
      await s.req('POST', `/api/groups/${s.g.id}/messages`, {
        body: '首页改成深色',
        clientId: 'canvas-chat-stranger',
        threadRootId: rootId,
        botId: stranger.id,
      })
    ).json() as MessageDto
    expect(m.mentions).toEqual([s.bot.id])
  })

  it('puts canvas commands in the conversation too', async () => {
    const s = await setup()
    const sent = (
      await s.req('POST', `/api/artifacts/${s.a.id}/commands`, {
        command: 'regenerate',
        botId: s.bot.id,
        screenIds: ['home'],
      })
    ).json() as MessageDto
    const { rootId } = (await s.req('POST', `/api/artifacts/${s.a.id}/chat`)).json() as ArtifactChatDto
    expect(sent.threadRootId).toBe(rootId)
    expect(await s.timeline()).not.toContain(sent.id)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.id))
    expect(run?.threadRootId).toBe(rootId)
  })

  it('lets someone given 可协作 from outside the group talk in it, and only there', async () => {
    const s = await setup()
    const zhang = await t.seed.user({ name: '张三' })
    const viewer = await t.seed.user({ name: '赵六' })
    const zc = await t.seed.cookie(zhang.id)
    const vc = await t.seed.cookie(viewer.id)
    const wc = await t.seed.cookie(s.wang.id)
    for (const [u, role] of [
      [zhang, 'edit'],
      [viewer, 'view'],
    ] as const)
      await t.app.inject({
        method: 'PUT',
        url: `/api/artifacts/${s.a.id}/members/${u.id}`,
        headers: { cookie: wc },
        payload: { role },
      })
    const sent: { to: string[]; e: WebEvent }[] = []
    vi.spyOn(t.ctx.bus, 'publish').mockImplementation((to, e) => {
      sent.push({ to: [...to], e: e as WebEvent })
    })

    const opened = (
      await s.req('POST', `/api/artifacts/${s.a.id}/chat`, undefined, zc)
    ).json() as ArtifactChatDto
    const { rootId } = opened
    expect(opened.group).toMatchObject({ id: s.g.id, unread: 0, last: '' })
    const say = (c: string, body: object) =>
      s.req('POST', `/api/groups/${s.g.id}/messages`, { body: '标题改大', clientId: `c-${c}`, ...body }, c)
    const m = (await say(zc, { threadRootId: rootId })).json() as MessageDto
    expect(m.threadRootId).toBe(rootId)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m.id))
    expect(run).toMatchObject({ botId: s.bot.id, threadRootId: rootId })
    const chat = (await s.req('GET', `/api/messages/${rootId}/thread`, undefined, zc)).json() as ThreadDto
    expect(chat.replies.map((r) => r.id)).toEqual([m.id])
    // The message and its run reach the guest; the group's other news does not.
    const heard = (t: WebEvent['t']) => sent.filter((x) => x.e.t === t && x.to.includes(zhang.id))
    expect(heard('message.new')).toHaveLength(1)
    expect(heard('run.updated').length).toBeGreaterThan(0)
    expect(sent.filter((x) => x.to.includes(viewer.id))).toEqual([])

    expect((await say(zc, {})).statusCode).toBe(404)
    expect((await say(vc, { threadRootId: rootId })).statusCode).toBe(403)
    expect((await s.req('GET', `/api/messages/${rootId}/thread`, undefined, vc)).statusCode).toBe(403)
    const main = await s.req('POST', `/api/groups/${s.g.id}/messages`, { body: '群里聊', clientId: 'g1' })
    expect(
      sent.some(
        (x) => x.e.t === 'message.new' && x.to.includes(zhang.id) && x.e.message.id === main.json().id,
      ),
    ).toBe(false)
  })
})
