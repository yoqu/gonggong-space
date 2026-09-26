import type { UsageDayDto, UsageRowDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const DAY = 86_400_000

async function world() {
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const claude = await t.seed.bot({ ownerId: alice.id, name: '小王的 Claude' })
  const codex = await t.seed.bot({ ownerId: bob.id, name: '陈晨的 Codex', agentKind: 'codex' })
  const g1 = await t.seed.group({ createdBy: alice.id, name: '支付服务重构', memberIds: [bob.id] })
  const g2 = await t.seed.group({ createdBy: bob.id, name: '官网改版' })
  const [m1] = await t.db.insert(messages).values({ groupId: g1.id, kind: 'user', body: 'x' }).returning()
  const [m2] = await t.db.insert(messages).values({ groupId: g2.id, kind: 'user', body: 'x' }).returning()
  const now = Date.now()
  const run = (o: {
    bot: string
    origin: string
    msg: typeof m1
    tokens?: number | null
    daysAgo?: number
    status?: string
  }) => ({
    groupId: o.msg!.groupId,
    botId: o.bot,
    triggerMessageId: o.msg!.id,
    originUserId: o.origin,
    triggerUserId: o.origin,
    status: o.status ?? 'completed',
    usage: o.tokens === undefined ? null : o.tokens === null ? {} : { totalTokens: o.tokens },
    queuedAt: new Date(now - (o.daysAgo ?? 0) * DAY),
    startedAt: o.status === 'forbidden' ? null : new Date(now - (o.daysAgo ?? 0) * DAY),
  })
  await t.db
    .insert(runs)
    .values([
      run({ bot: claude.id, origin: alice.id, msg: m1, tokens: 1000 }),
      run({ bot: claude.id, origin: bob.id, msg: m1, tokens: 500 }),
      run({ bot: claude.id, origin: bob.id, msg: m1, tokens: 200, daysAgo: 10 }),
      run({ bot: claude.id, origin: alice.id, msg: m1, tokens: 9999, daysAgo: 40 }),
      run({ bot: claude.id, origin: bob.id, msg: m1, status: 'forbidden' }),
      run({ bot: codex.id, origin: bob.id, msg: m2 }),
      run({ bot: codex.id, origin: bob.id, msg: m2, tokens: null }),
    ])
  return { admin, alice, bob, claude, codex, g1, g2 }
}

const get = async (t: TestApp, userId: string, query: string) =>
  client(t, await t.seed.cookie(userId)).get<UsageRowDto[]>(`/api/usage?${query}`)

describe('usage', () => {
  it('aggregates the last 30 days by bot, trigger user and group for sysadmins', async () => {
    const w = await world()
    const byBot = await get(t, w.admin.id, 'by=bot')
    expect(byBot.status).toBe(200)
    expect(byBot.body).toEqual([
      { key: w.claude.id, name: '小王的 Claude', runs: 3, totalTokens: 1700, unreported: 0 },
      { key: w.codex.id, name: '陈晨的 Codex', runs: 2, totalTokens: 0, unreported: 2 },
    ])
    expect((await get(t, w.admin.id, 'by=user')).body).toEqual([
      { key: w.alice.id, name: '王磊', runs: 1, totalTokens: 1000, unreported: 0 },
      { key: w.bob.id, name: '陈晨', runs: 4, totalTokens: 700, unreported: 2 },
    ])
    expect((await get(t, w.admin.id, 'by=group&days=7')).body).toEqual([
      { key: w.g1.id, name: '支付服务重构', runs: 2, totalTokens: 1500, unreported: 0 },
      { key: w.g2.id, name: '官网改版', runs: 2, totalTokens: 0, unreported: 2 },
    ])
  })

  it('lets a bot owner see who used their bot, and only their bots', async () => {
    const w = await world()
    const own = await get(t, w.alice.id, `by=user&days=7&botId=${w.claude.id}`)
    expect(own.body).toEqual([
      { key: w.alice.id, name: '王磊', runs: 1, totalTokens: 1000, unreported: 0 },
      { key: w.bob.id, name: '陈晨', runs: 1, totalTokens: 500, unreported: 0 },
    ])
    expect((await get(t, w.bob.id, `by=user&botId=${w.claude.id}`)).status).toBe(403)
    expect((await get(t, w.bob.id, 'by=user&botId=not-a-uuid')).status).toBe(403)
    const mine = await get(t, w.bob.id, 'by=bot')
    expect(mine.body.map((r) => r.name)).toEqual(['陈晨的 Codex'])
    expect((await get(t, w.admin.id, `by=bot&botId=${w.codex.id}`)).body).toHaveLength(1)
  })
})

const localDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)

describe('daily usage', () => {
  const daily = async (userId: string, query: string) =>
    client(t, await t.seed.cookie(userId)).get<UsageDayDto[]>(`/api/usage/daily?${query}`)

  it('returns one bucket per local day, oldest first, zero-filled', async () => {
    const w = await world()
    const res = await daily(w.admin.id, 'days=30&tz=Asia/Shanghai')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(30)
    const now = new Date()
    const tenDaysAgo = localDay(new Date(now.getTime() - 10 * DAY), 'Asia/Shanghai')
    expect(res.body.at(-1)).toEqual({
      day: localDay(now, 'Asia/Shanghai'),
      runs: 4,
      totalTokens: 1500,
      unreported: 2,
    })
    expect(res.body.find((d) => d.day === tenDaysAgo)).toEqual({
      day: tenDaysAgo,
      runs: 1,
      totalTokens: 200,
      unreported: 0,
    })
    expect(res.body.reduce((n, d) => n + d.totalTokens, 0)).toBe(1700)
    expect(res.body.map((d) => d.day)).toEqual(res.body.map((d) => d.day).sort())
  })

  it('scopes members to their own bots and rejects unknown time zones', async () => {
    const w = await world()
    const mine = await daily(w.bob.id, 'days=60')
    expect(mine.body).toHaveLength(60)
    expect(mine.body.reduce((n, d) => n + d.runs, 0)).toBe(2)
    expect((await daily(w.admin.id, 'days=60')).body.reduce((n, d) => n + d.totalTokens, 0)).toBe(11_699)
    expect((await daily(w.bob.id, `botId=${w.claude.id}`)).status).toBe(403)
    expect((await daily(w.admin.id, 'tz=Mars/Base')).status).toBe(400)
  })
})
