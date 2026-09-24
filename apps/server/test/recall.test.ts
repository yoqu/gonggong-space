import {
  type GroupDto,
  type MessageDto,
  PROTOCOL_VERSION,
  RECALLED_QUOTE,
  type RunStart,
  type SearchResultDto,
  type TimelineDto,
  type ToolCallRes,
} from '@aiws/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, messages, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const HOUR = 3600_000
const att = { id: 'a1', name: 'spec.pdf', size: 3, mime: 'application/pdf', messageId: 'm' }

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const g = await t.seed.group({ createdBy: wang.id, name: '支付', memberIds: [li.id], botIds: [bot.id] })
  const say = async (
    body: string,
    o: { userId?: string; botId?: string; kind?: string; ago?: number; meta?: object } = {},
  ) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: g.id,
        kind: o.kind ?? (o.botId ? 'bot' : 'user'),
        authorUserId: o.botId || o.kind === 'event' ? null : (o.userId ?? wang.id),
        authorBotId: o.botId ?? null,
        body,
        meta: o.meta ?? {},
        createdAt: new Date(Date.now() - (o.ago ?? 0)),
      })
      .returning()
    return m!
  }
  return {
    wang,
    li,
    bot,
    g,
    token,
    say,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
  }
}

type W = Awaited<ReturnType<typeof world>>
const recall = (as: W['asWang'], id: string) =>
  as.post<MessageDto & { error?: string }>(`/api/messages/${id}/recall`)
const hide = (as: W['asWang'], id: string) => as.post(`/api/messages/${id}/hide`)
const timeline = async (as: W['asWang'], w: W) =>
  (await as.get<TimelineDto>(`/api/groups/${w.g.id}/timeline`)).body.messages
const search = async (as: W['asWang'], q: string) =>
  (await as.get<SearchResultDto[]>(`/api/search?q=${encodeURIComponent(q)}&tab=msg`)).body

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
  return { next: () => box.next<RunStart>() }
}

describe('recall (撤回)', () => {
  it('blanks the message for everyone, drops its reactions and tells every member', async () => {
    const w = await world()
    const quoted = await w.say('被引用的原文')
    const m = await w.say('机密方案', {
      meta: {
        mentions: [],
        attachments: [att],
        quote: { kind: 'message', id: quoted.id, who: '王磊', text: '被引用的原文' },
      },
    })
    expect((await w.asLi.put(`/api/messages/${m.id}/reactions/${encodeURIComponent('👍')}`)).status).toBe(200)
    const wangEvents = events(t, w.wang.id)
    const liEvents = events(t, w.li.id)

    const res = await recall(w.asWang, m.id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: m.id,
      recalled: true,
      body: '',
      attachments: [],
      quote: null,
      mentions: [],
      reactions: [],
    })
    const event = { t: 'message.recalled', groupId: w.g.id, messageId: m.id }
    expect(liEvents).toContainEqual(event)
    expect(wangEvents).toContainEqual(event)

    for (const as of [w.asWang, w.asLi]) {
      const got = (await timeline(as, w)).find((x) => x.id === m.id)
      expect(got).toMatchObject({ recalled: true, body: '', attachments: [], quote: null, reactions: [] })
      expect(JSON.stringify(got)).not.toContain('机密方案')
    }
    const other = (await timeline(w.asLi, w)).find((x) => x.id === quoted.id)
    expect(other?.recalled).toBe(false)

    // Idempotent.
    expect((await recall(w.asWang, m.id)).status).toBe(200)
  })

  it('rewrites quotes of the recalled message and refuses new quotes of it', async () => {
    const w = await world()
    const m = await w.say('机密方案')
    const quoting = await w.asLi.post<MessageDto>(`/api/groups/${w.g.id}/messages`, {
      body: '收到',
      clientId: 'client-quote-1',
      quote: { kind: 'message', id: m.id },
    })
    expect(quoting.body.quote?.text).toBe('机密方案')
    await recall(w.asWang, m.id)
    const got = (await timeline(w.asLi, w)).find((x) => x.id === quoting.body.id)
    expect(got?.quote).toEqual({ kind: 'message', id: m.id, who: '王磊', text: RECALLED_QUOTE })
    const again = await w.asLi.post(`/api/groups/${w.g.id}/messages`, {
      body: '再引',
      clientId: 'client-quote-2',
      quote: { kind: 'message', id: m.id },
    })
    expect(again.status).toBe(409)
  })

  it('is refused after 24 hours with an explicit code', async () => {
    const w = await world()
    const old = await w.say('昨天的话', { ago: 25 * HOUR })
    const res = await recall(w.asWang, old.id)
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'recall_expired', message: '超过 24 小时，无法撤回' })
    expect((await recall(w.asWang, (await w.say('刚好', { ago: 23 * HOUR })).id)).status).toBe(200)
  })

  it('only the author can recall their own user messages', async () => {
    const w = await world()
    const m = await w.say('我的')
    expect((await recall(w.asLi, m.id)).status).toBe(403)
    expect((await recall(w.asOutsider, m.id)).status).toBe(404)
    expect((await recall(w.asWang, '00000000-0000-0000-0000-000000000000')).status).toBe(404)
    // The bot owner still cannot recall the bot's reply; events are nobody's.
    expect((await recall(w.asWang, (await w.say('回复', { botId: w.bot.id })).id)).status).toBe(403)
    expect((await recall(w.asWang, (await w.say('王磊 加入了群', { kind: 'event' })).id)).status).toBe(403)
  })

  it('keeps the recalled content out of search and the group list preview', async () => {
    const w = await world()
    const m = await w.say('退款机密')
    expect((await search(w.asLi, '退款机密')).length).toBe(1)
    await recall(w.asWang, m.id)
    expect(await search(w.asLi, '退款机密')).toEqual([])
    const last = async (as: W['asWang']) =>
      (await as.get<GroupDto[]>('/api/groups')).body.find((g) => g.id === w.g.id)?.last
    expect(await last(w.asLi)).toBe('王磊 撤回了一条消息')
    expect(await last(w.asWang)).toBe('你撤回了一条消息')
  })

  it('keeps the run it triggered but leaves it out of agent context and the aiws tools', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const secret = await w.say('机密方案 @小王的 Claude', { meta: { mentions: [w.bot.id] } })
    await triggerRuns(t.ctx, secret)
    const first = await d.next()
    expect(first.prompt.text).toContain('机密方案')
    await recall(w.asWang, secret.id)
    const [run] = await t.db.select().from(runs)
    expect(run?.status).toBe('running')

    await w.say('公开信息', { userId: w.li.id })
    const call = async (name: string, args: unknown) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${run!.id}/tools/${name}`,
        headers: { authorization: `Bearer ${w.token}` },
        payload: { arguments: args },
      })
      return res.json<ToolCallRes>().text
    }
    const listed = await call('list_messages', {})
    expect(listed).toContain('公开信息')
    expect(listed).not.toContain(`#${secret.seq} `)
    expect(await call('search_messages', { query: '机密' })).toContain('没有命中')
    expect(await call('get_run', { run: run!.id })).not.toContain('机密')

    // A later turn of another bot sees the rest of the conversation, not the recalled message.
    const { machine, token } = await t.seed.machine(w.li.id)
    const codex = await t.seed.bot({ ownerId: w.li.id, name: '老李的 Codex', machineId: machine.id })
    await t.db.insert(groupBots).values({ groupId: w.g.id, botId: codex.id })
    const d2 = await daemon(token)
    await triggerRuns(
      t.ctx,
      await w.say('@老李的 Codex 看看', { userId: w.li.id, meta: { mentions: [codex.id] } }),
    )
    const start = await d2.next()
    expect(start.prompt.context.map((c) => c.body)).toEqual(['公开信息'])
  })

  it('voids the runs it triggered that have not started yet', async () => {
    const w = await world()
    const m = await w.say('@小王的 Claude 做这个', { meta: { mentions: [w.bot.id] } })
    await triggerRuns(t.ctx, m)
    const [waiting] = await t.db.select().from(runs)
    expect(waiting?.status).toBe('offline_wait')
    await recall(w.asWang, m.id)
    const [run] = await t.db.select().from(runs)
    expect(run).toMatchObject({ status: 'expired', step: '触发消息已撤回，已作废' })
    expect(run?.endedAt).not.toBeNull()
  })
})

describe('delete (删除，仅自己隐藏)', () => {
  it('hides the message for the author only, across reloads, at any age', async () => {
    const w = await world()
    const m = await w.say('删掉这条', { ago: 30 * 24 * HOUR })
    const wangEvents = events(t, w.wang.id)
    const liEvents = events(t, w.li.id)
    expect((await hide(w.asWang, m.id)).status).toBe(204)
    expect(wangEvents).toEqual([{ t: 'message.hidden', groupId: w.g.id, messageId: m.id }])
    expect(liEvents).toEqual([])

    expect((await timeline(w.asWang, w)).map((x) => x.id)).not.toContain(m.id)
    expect((await timeline(w.asLi, w)).find((x) => x.id === m.id)?.body).toBe('删掉这条')
    expect(await search(w.asWang, '删掉这条')).toEqual([])
    expect((await search(w.asLi, '删掉这条')).length).toBe(1)
    // Idempotent.
    expect((await hide(w.asWang, m.id)).status).toBe(204)
  })

  it('only the author can delete their own user messages', async () => {
    const w = await world()
    const m = await w.say('我的')
    expect((await hide(w.asLi, m.id)).status).toBe(403)
    expect((await hide(w.asOutsider, m.id)).status).toBe(404)
    expect((await hide(w.asWang, (await w.say('回复', { botId: w.bot.id })).id)).status).toBe(403)
  })
})
