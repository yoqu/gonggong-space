import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindCodes, messages, runEvents, runs, systemParams, webSessions } from '../src/db/schema.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { purgeExpiredLogins, purgeExpiredRuns, startRetention } from '../src/modules/runs/retention.js'
import { createTestApp, type TestApp } from './support/app.js'

const DAY = 86_400_000
let clock = new Date('2026-09-23T10:00:00Z')
let t: TestApp
beforeEach(async () => {
  clock = new Date('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

async function world() {
  const user = await t.seed.user()
  const { machine } = await t.seed.machine(user.id)
  const bot = await t.seed.bot({ ownerId: user.id, machineId: machine.id })
  const group = await t.seed.group({ createdBy: user.id, botIds: [bot.id] })
  const [m] = await t.db
    .insert(messages)
    .values({ groupId: group.id, kind: 'user', authorUserId: user.id, body: '@bot hi', meta: {} })
    .returning()
  /** A run that ended `daysAgo` days before the clock (null → still running), with one event and a patch. */
  const run = async (daysAgo: number | null) => {
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        triggerUserId: user.id,
        originUserId: user.id,
        status: daysAgo === null ? 'running' : 'completed',
        filesChanged: 1,
        patch: 'diff --git a/x b/x\n',
        patchRepos: [{ path: '', kind: 'root', branch: 'main', base: null, truncated: false }],
        startedAt: new Date(clock.getTime() - 60 * DAY),
        endedAt: daysAgo === null ? null : new Date(clock.getTime() - daysAgo * DAY),
      })
      .returning()
    await t.db.insert(runEvents).values({ runId: r!.id, kind: 'text', payload: { kind: 'text', delta: 'x' } })
    return r!
  }
  return { user, run }
}

const eventsOf = async (runId: string) =>
  (await t.db.select().from(runEvents).where(eq(runEvents.runId, runId))).length
const rowOf = async (runId: string) => (await t.db.select().from(runs).where(eq(runs.id, runId)))[0]!

describe('run retention', () => {
  it('purges the process of runs ended more than 30 days ago and keeps the card summary', async () => {
    const w = await world()
    const old = await w.run(31)
    const recent = await w.run(29)
    const live = await w.run(null)

    expect(await purgeExpiredRuns(t.ctx)).toBe(1)
    expect(await eventsOf(old.id)).toBe(0)
    expect(await rowOf(old.id)).toMatchObject({
      patch: null,
      patchRepos: [],
      purgedAt: clock,
      filesChanged: 1,
      status: 'completed',
    })
    for (const r of [recent, live]) {
      expect(await eventsOf(r.id)).toBe(1)
      expect(await rowOf(r.id)).toMatchObject({ patch: 'diff --git a/x b/x\n', purgedAt: null })
    }
    expect(await purgeExpiredRuns(t.ctx)).toBe(0)

    const res = await t.app.inject({
      url: `/api/runs/${old.id}`,
      headers: { cookie: await t.seed.cookie(w.user.id) },
    })
    expect(res.json()).toMatchObject({
      purged: true,
      patch: null,
      patchRepos: [],
      events: [],
      retentionDays: 30,
    })
  })

  it('purges in bounded batches, each its own transaction', async () => {
    const w = await world()
    const old = await Promise.all([31, 32, 33, 34, 35].map((d) => w.run(d)))
    const tx = vi.spyOn(t.ctx.db, 'transaction')
    expect(await purgeExpiredRuns(t.ctx, 2)).toBe(5)
    expect(tx).toHaveBeenCalledTimes(3)
    tx.mockRestore()
    for (const r of old) expect(await eventsOf(r.id)).toBe(0)
  })

  it('honours the runRetentionDays system parameter', async () => {
    const w = await world()
    const r = await w.run(8)
    await t.db.insert(systemParams).values({ key: 'runRetentionDays', value: 7 })
    forgetSysParams(t.db)
    expect(await purgeExpiredRuns(t.ctx)).toBe(1)
    expect((await rowOf(r.id)).purgedAt).toEqual(clock)
  })

  it('runs periodically as the clock moves on', async () => {
    const w = await world()
    const r = await w.run(20)
    const stop = startRetention(t.ctx, 10)
    try {
      await new Promise((ok) => setTimeout(ok, 50))
      expect(await eventsOf(r.id)).toBe(1)
      clock = new Date(clock.getTime() + 11 * DAY)
      await expect.poll(() => eventsOf(r.id)).toBe(0)
    } finally {
      await stop()
    }
  })
})

describe('login retention', () => {
  it('drops dead web sessions and bind codes a day past expiry', async () => {
    const user = await t.seed.user()
    const at = (days: number) => new Date(clock.getTime() + days * DAY)
    await t.db.insert(webSessions).values([
      { tokenHash: 'live', userId: user.id, expiresAt: at(1) },
      { tokenHash: 'expired', userId: user.id, expiresAt: at(-0.1) },
      { tokenHash: 'revoked', userId: user.id, expiresAt: at(1), revokedAt: at(-0.1) },
    ])
    await t.db.insert(bindCodes).values([
      { code: 'LIVE', userId: user.id, expiresAt: at(0.1) },
      // Kept a day past expiry so a late attempt still reads 已过期 rather than 无效.
      { code: 'JUST', userId: user.id, expiresAt: at(-0.5), usedAt: at(-0.6) },
      { code: 'OLD', userId: user.id, expiresAt: at(-1.1) },
      { code: 'USED', userId: user.id, expiresAt: at(-1.1), usedAt: at(-1.2) },
    ])

    await purgeExpiredLogins(t.ctx)
    const sessions = await t.db.select({ k: webSessions.tokenHash }).from(webSessions)
    expect(sessions.map((r) => r.k)).toEqual(['live'])
    const codes = await t.db.select({ k: bindCodes.code }).from(bindCodes)
    expect(codes.map((r) => r.k).sort()).toEqual(['JUST', 'LIVE'])
  })

  it('runs with the periodic retention sweep', async () => {
    const user = await t.seed.user()
    await t.db.insert(webSessions).values({ tokenHash: 'expired', userId: user.id, expiresAt: clock })
    const stop = startRetention(t.ctx, 60_000)
    try {
      await expect.poll(async () => (await t.db.select().from(webSessions)).length).toBe(0)
    } finally {
      await stop()
    }
  })
})
