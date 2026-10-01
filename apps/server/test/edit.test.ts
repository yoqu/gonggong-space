import type { MessageDto, RunStart, ServerToDaemon, TimelineDto } from '@gonggong/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groupRepos, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
let clock: Date
beforeEach(async () => {
  clock = new Date('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

const HOUR = 3600_000

async function world(o: { online?: boolean } = {}) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: machine.id })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id, codex.id] })
  await t.db
    .insert(groupRepos)
    .values({ groupId: g.id, url: 'git@example.com:team/pay.git', baseBranch: 'main' })
  await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, g.id))
  const sent: ServerToDaemon[] = []
  if (o.online !== false)
    t.ctx.hub.register(machine.id, { send: (m: ServerToDaemon) => sent.push(m), close() {} })
  const as = {
    wang: client(t, await t.seed.cookie(wang.id)),
    li: client(t, await t.seed.cookie(li.id)),
    outsider: client(t, await t.seed.cookie(outsider.id)),
  }
  let n = 0
  const say = async (body: string, c = as.wang) => {
    const res = await c.post<MessageDto>(`/api/groups/${g.id}/messages`, {
      body,
      clientId: `edit-msg-${++n}`,
    })
    clock = new Date(clock.getTime() + 1000)
    return res.body
  }
  const edit = (id: string, body: string, c = as.wang) =>
    c.patch<MessageDto & { error?: string; message?: string }>(`/api/messages/${id}`, { body })
  const runsOf = () => t.db.select().from(runs).orderBy(asc(runs.queuedAt))
  const done = (runId: string) =>
    t.ctx.hub.emit('message', machine.id, {
      t: 'run.done',
      runId,
      outcome: 'interrupted',
      reply: '',
      filesChanged: 0,
      usage: null,
      sessionId: 'sess-1',
      newSessionReason: null,
      error: null,
      git: null,
      patch: null,
      appendsApplied: 0,
    } as never)
  const starts = () => sent.filter((m): m is RunStart => m.t === 'run.start')
  return { wang, li, g, claude, codex, as, say, edit, runsOf, done, sent, starts }
}

describe('edit (编辑)', () => {
  it('rewrites the body, marks it edited, tells every member and updates quotes of it', async () => {
    const w = await world()
    const m = await w.say('原来的话')
    const quoting = await w.as.li.post<MessageDto>(`/api/groups/${w.g.id}/messages`, {
      body: '收到',
      clientId: 'quote-msg-1',
      quote: { kind: 'message', id: m.id },
    })
    const liEvents = events(t, w.li.id)
    clock = new Date(clock.getTime() + 60_000)

    const res = await w.edit(m.id, '改过的话')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: m.id, body: '改过的话', editedAt: clock.toISOString() })
    expect(liEvents).toContainEqual({ t: 'message.edited', message: expect.objectContaining({ id: m.id }) })

    const timeline = (await w.as.li.get<TimelineDto>(`/api/groups/${w.g.id}/timeline`)).body.messages
    expect(timeline.find((x) => x.id === m.id)).toMatchObject({
      body: '改过的话',
      editedAt: clock.toISOString(),
    })
    expect(timeline.find((x) => x.id === quoting.body.id)?.quote?.text).toBe('改过的话')
  })

  it('only the author edits their own, unrecalled user message within 24 hours', async () => {
    const w = await world({ online: false })
    const m = await w.say('我的')
    expect((await w.edit(m.id, 'x', w.as.li)).status).toBe(403)
    expect((await w.edit(m.id, 'x', w.as.outsider)).status).toBe(404)
    expect((await w.edit(m.id, '   ')).status).toBe(400)
    const [reply] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'bot', authorBotId: w.claude.id, body: '回复' })
      .returning()
    expect((await w.edit(reply!.id, 'x')).status).toBe(403)
    await w.as.wang.post(`/api/messages/${m.id}/recall`)
    expect((await w.edit(m.id, 'x')).body).toMatchObject({ error: 'conflict' })
    const [old] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'user', authorUserId: w.wang.id, body: '昨天的话' })
      .returning()
    clock = new Date(old!.createdAt.getTime() + 25 * HOUR)
    expect((await w.edit(old!.id, 'x')).body).toMatchObject({ error: 'edit_expired' })
  })

  it('refuses changing whom the message mentions', async () => {
    const w = await world({ online: false })
    const m = await w.say('@小王的 Claude 做这个')
    const res = await w.edit(m.id, '@老李的 Codex 做这个')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('编辑不能修改 @ 的对象')
    expect((await w.edit(m.id, '做这个')).status).toBe(400)
    expect((await w.edit(m.id, '@小王的 Claude 改做那个')).status).toBe(200)
  })

  it('refuses commands', async () => {
    const w = await world({ online: false })
    const m = await w.say('/stop')
    expect((await w.edit(m.id, '/stop @小王的 Claude')).status).toBe(400)
  })

  it('a waiting run picks the edited text up when it starts', async () => {
    const w = await world()
    await w.say('@小王的 Claude 做 A')
    const m = await w.say('@小王的 Claude 做 C')
    const [first, waiting] = await w.runsOf()
    expect(waiting?.status).toBe('queued')
    await w.edit(m.id, '@小王的 Claude 做 D')
    expect(w.sent.filter((s) => s.t === 'run.cancel')).toEqual([])
    expect(await w.runsOf()).toHaveLength(2)
    w.done(first!.id)
    for (let i = 0; i < 200 && w.starts().length < 2; i++) await new Promise((r) => setTimeout(r, 10))
    expect(w.starts()[1]).toMatchObject({ runId: waiting!.id })
    expect(w.starts()[1]?.prompt.text).toContain('做 D')
  })

  it('stops a started run and reruns the bot with the edited text', async () => {
    const w = await world()
    const m = await w.say('@小王的 Claude 做 A')
    const [first] = await w.runsOf()
    expect(first?.status).toBe('running')
    expect(w.starts()[0]?.prompt.text).toContain('做 A')

    await w.edit(m.id, '@小王的 Claude 做 B')
    expect(w.sent.filter((s) => s.t === 'run.cancel')).toEqual([{ t: 'run.cancel', runId: first!.id }])
    const [old, rerun] = await w.runsOf()
    expect(old).toMatchObject({ id: first!.id, step: '消息已编辑，已重新运行', stoppedBy: w.wang.id })
    expect(rerun).toMatchObject({ triggerMessageId: m.id, botId: w.claude.id, status: 'queued' })

    w.done(first!.id)
    for (let i = 0; i < 200 && w.starts().length < 2; i++) await new Promise((r) => setTimeout(r, 10))
    expect(w.starts()[1]).toMatchObject({ runId: rerun!.id })
    expect(w.starts()[1]?.prompt.text).toContain('做 B')
    const [ended] = await t.db.select().from(runs).where(eq(runs.id, first!.id))
    expect(ended).toMatchObject({ status: 'interrupted', step: '消息已编辑，已重新运行' })
  })

  it('does not rerun finished runs', async () => {
    const w = await world()
    const m = await w.say('@小王的 Claude 做 A')
    const [first] = await w.runsOf()
    await t.db.update(runs).set({ status: 'completed', endedAt: clock }).where(eq(runs.id, first!.id))
    await w.edit(m.id, '@小王的 Claude 做 B')
    expect(await w.runsOf()).toHaveLength(1)
    expect(w.sent.filter((s) => s.t === 'run.cancel')).toEqual([])
  })
})
