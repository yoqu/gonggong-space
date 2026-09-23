import { PROTOCOL_VERSION, type RunStart } from '@aiws/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bots, groups, messages, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

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
  return {
    next: () => box.next<RunStart>(),
    done: (runId: string, reply: string, o: Record<string, unknown> = {}) =>
      ws.send(
        JSON.stringify({
          t: 'run.done',
          runId,
          outcome: 'completed',
          reply,
          filesChanged: 0,
          usage: null,
          sessionId: null,
          newSessionReason: null,
          error: null,
          git: null,
          patch: null,
          appendsApplied: 0,
          ...o,
        }),
      ),
  }
}

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const carol = await t.seed.user({ name: '张杰' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = (name: string, o: Record<string, unknown> = {}) =>
    t.seed.bot({ ownerId: owner.id, name, machineId: machine.id, ...o })
  const a = await bot('接力 A')
  const b = await bot('接力 B')
  const group = await t.seed.group({
    createdBy: owner.id,
    memberIds: [bob.id, carol.id],
    botIds: [a.id, b.id],
  })
  const say = async (userId: string, body: string, mentions: string[]) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: userId, body, meta: { mentions } })
      .returning()
    await triggerRuns(t.ctx, m!)
    return m!
  }
  const allRuns = () => t.db.select().from(runs).orderBy(asc(runs.queuedAt), asc(runs.hop))
  return { owner, bob, carol, machine, token, bot, a, b, group, say, allRuns }
}

/** Waits until the run table satisfies `pred` (chain hops are created asynchronously by the engine). */
async function until<T>(read: () => Promise<T>, pred: (v: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const v = await read()
    if (pred(v)) return v
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('condition not reached')
}

describe('trigger scope', () => {
  it('applies all / list / self, always lets the owner in, and forces list on full tier', async () => {
    const w = await world()
    const all = await w.bot('全员')
    const list = await w.bot('名单', { triggerScope: 'list', triggerList: [w.bob.id] })
    const self = await w.bot('本人', { triggerScope: 'self' })
    const full = await w.bot('满档', { tier: 'full', triggerScope: 'all', triggerList: [w.bob.id] })
    const group = await t.seed.group({
      createdBy: w.owner.id,
      memberIds: [w.bob.id, w.carol.id],
      botIds: [all.id, list.id, self.id, full.id],
    })
    const statusOf = async (userId: string) => {
      const [m] = await t.db
        .insert(messages)
        .values({
          groupId: group.id,
          kind: 'user',
          authorUserId: userId,
          body: 'x',
          meta: { mentions: [all.id, list.id, self.id, full.id] },
        })
        .returning()
      await triggerRuns(t.ctx, m!)
      const rows = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m!.id))
      const by = (id: string) => rows.find((r) => r.botId === id)!
      return {
        all: by(all.id).status,
        list: by(list.id).status,
        self: by(self.id).status,
        full: by(full.id).status,
        steps: rows.filter((r) => r.status === 'forbidden').map((r) => r.step),
      }
    }
    const allowed = ['queued', 'offline_wait']
    const owner = await statusOf(w.owner.id)
    expect([owner.all, owner.list, owner.self, owner.full].every((s) => allowed.includes(s))).toBe(true)

    const bob = await statusOf(w.bob.id)
    expect(allowed).toContain(bob.all)
    expect(allowed).toContain(bob.list)
    expect(allowed).toContain(bob.full)
    expect(bob.self).toBe('forbidden')
    expect(bob.steps).toEqual(['该 bot 仅允许主人触发，未启动运行'])

    const carol = await statusOf(w.carol.id)
    expect(allowed).toContain(carol.all)
    expect([carol.list, carol.self, carol.full]).toEqual(['forbidden', 'forbidden', 'forbidden'])
    expect(carol.steps.sort()).toEqual(
      [
        '该 bot 仅允许主人触发，未启动运行',
        '该 bot 仅允许指定名单触发，未启动运行',
        '该 bot 仅允许指定名单触发，未启动运行',
      ].sort(),
    )
  })

  it('fans a human message out to every mentioned bot at hop 1, dispatched in parallel', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await w.say(w.bob.id, '@接力 A @接力 B 一起', [w.a.id, w.b.id])
    const starts = [await d.next(), await d.next()]
    expect(starts.map((s) => s.bot.id).sort()).toEqual([w.a.id, w.b.id].sort())
    const rows = await w.allRuns()
    expect(rows.map((r) => [r.hop, r.status, r.parentRunId])).toEqual([
      [1, 'running', null],
      [1, 'running', null],
    ])
  })
})

describe('relay chain', () => {
  it('relays bot → bot up to chainMaxHops, then leaves the @ as plain text', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const human = await w.say(w.bob.id, '@接力 A 开始', [w.a.id])
    let replied = 0
    for (const expected of [w.a, w.b, w.a]) {
      const start = await d.next()
      expect(start.bot.id).toBe(expected.id)
      if (replied) expect(start.prompt.triggeredBy).toBe(expected === w.a ? '接力 B' : '接力 A')
      d.done(start.runId, expected === w.a ? '@接力 B 继续' : '@接力 A 继续')
      replied += 1
    }
    const rows = await until(w.allRuns, (r) => r.length === 3 && r[2]!.status === 'completed')
    await new Promise((r) => setTimeout(r, 100))
    expect(await w.allRuns()).toHaveLength(3)
    expect(rows.map((r) => [r.botId, r.hop, r.triggerUserId, r.originUserId])).toEqual([
      [w.a.id, 1, w.bob.id, w.bob.id],
      [w.b.id, 2, null, w.bob.id],
      [w.a.id, 3, null, w.bob.id],
    ])
    expect(rows[0]!.triggerMessageId).toBe(human.id)
    expect(rows[1]!.parentRunId).toBe(rows[0]!.id)
    expect(rows[2]!.parentRunId).toBe(rows[1]!.id)
    const [trigger] = await t.db.select().from(messages).where(eq(messages.id, rows[1]!.triggerMessageId))
    expect(trigger).toMatchObject({ kind: 'bot', authorBotId: w.a.id, runId: rows[0]!.id })
  })

  it('honours the group chainMaxHops param and relays a fan-out reply to both bots at hop + 1', async () => {
    const w = await world()
    const c = await w.bot('接力 C')
    const group = await t.seed.group({ createdBy: w.owner.id, botIds: [w.a.id, w.b.id, c.id] })
    await t.db
      .update(groups)
      .set({ params: { chainMaxHops: 2 } })
      .where(eq(groups.id, group.id))
    const d = await daemon(w.token)
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: w.owner.id,
        body: '@接力 A',
        meta: { mentions: [w.a.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const first = await d.next()
    d.done(first.runId, '@接力 B 和 @接力 C 分头做，@接力 A 是我自己')
    const hop2 = [await d.next(), await d.next()]
    expect(hop2.map((s) => s.bot.id).sort()).toEqual([w.b.id, c.id].sort())
    for (const s of hop2) d.done(s.runId, '@接力 A 回来')
    const all = () => t.db.select().from(runs).where(eq(runs.groupId, group.id))
    const rows = await until(all, (r) => r.filter((x) => x.status === 'completed').length === 3)
    await new Promise((r) => setTimeout(r, 100))
    expect((await all()).length).toBe(3)
    expect(rows.map((r) => r.hop).sort()).toEqual([1, 2, 2])
  })

  it('authorizes every hop against the chain initiator', async () => {
    const w = await world()
    const { b } = w
    await t.db.update(bots).set({ triggerScope: 'self' }).where(eq(bots.id, b.id))
    const d = await daemon(w.token)
    await w.say(w.bob.id, '@接力 A 再来', [w.a.id])
    const start = await d.next()
    d.done(start.runId, '@接力 B 继续')
    const rows = await until(w.allRuns, (r) => r.length === 2)
    expect(rows[1]).toMatchObject({
      botId: b.id,
      hop: 2,
      status: 'forbidden',
      step: '该 bot 仅允许主人触发，未启动运行',
      originUserId: w.bob.id,
    })
  })

  it('does not relay from interrupted or failed runs', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await w.say(w.bob.id, '@接力 A', [w.a.id])
    const s1 = await d.next()
    d.done(s1.runId, '@接力 B 半截', { outcome: 'interrupted' })
    await w.say(w.bob.id, '@接力 A', [w.a.id])
    const s2 = await d.next()
    d.done(s2.runId, '@接力 B 出错', { outcome: 'failed', error: 'boom' })
    const rows = await until(w.allRuns, (r) => r.length === 2 && r.every((x) => x.status === 'interrupted'))
    await new Promise((r) => setTimeout(r, 100))
    expect(await w.allRuns()).toHaveLength(rows.length)
  })
})
