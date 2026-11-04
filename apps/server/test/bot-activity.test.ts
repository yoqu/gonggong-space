import type { BotPlaceDto, BotRecentDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MIN = 60_000

describe('GET /api/bots/:id/activity', () => {
  it('lists where the bot works, its turn in flight first, then by last run', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
    const idle = await t.seed.group({ createdBy: wang.id, name: '官网改版', botIds: [bot.id] })
    const busy = await t.seed.group({ createdBy: wang.id, name: '支付服务重构', botIds: [bot.id] })
    const fresh = await t.seed.group({ createdBy: wang.id, name: '新群', botIds: [bot.id] })
    const left = await t.seed.group({ createdBy: wang.id, name: '已移出', botIds: [bot.id] })
    await t.db
      .update(groupBots)
      .set({ workspacePath: '/Users/wang/pay', workspaceState: 'ready', extraDirs: ['/Users/wang/docs'] })
      .where(and(eq(groupBots.groupId, busy.id), eq(groupBots.botId, bot.id)))
    await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.groupId, left.id))
    const [m1] = await t.db.insert(messages).values({ groupId: idle.id, kind: 'user', body: 'x' }).returning()
    const [m2] = await t.db.insert(messages).values({ groupId: busy.id, kind: 'user', body: 'x' }).returning()
    const now = Date.now()
    const run = (m: typeof m1, status: string, ago: number, step = '') => ({
      groupId: m!.groupId,
      botId: bot.id,
      triggerMessageId: m!.id,
      originUserId: wang.id,
      status,
      step,
      queuedAt: new Date(now - ago * MIN),
      startedAt: new Date(now - ago * MIN),
    })
    const [, live] = await t.db
      .insert(runs)
      .values([run(m1, 'completed', 1), run(m2, 'running', 5, '编辑 src/pay.ts'), run(m2, 'completed', 30)])
      .returning()

    const res = await client(t, await t.seed.cookie(wang.id)).get<BotPlaceDto[]>(
      `/api/bots/${bot.id}/activity`,
    )
    expect(res.status).toBe(200)
    expect(res.body.map((p) => p.groupName)).toEqual(['支付服务重构', '官网改版', '新群'])
    expect(res.body[0]).toMatchObject({
      groupId: busy.id,
      groupKind: 'group',
      workspacePath: '/Users/wang/pay',
      dirs: ['/Users/wang/docs'],
      run: { id: live!.id, status: 'running', step: '编辑 src/pay.ts' },
    })
    expect(res.body[1]).toMatchObject({ run: null, workspacePath: null })
    expect(res.body[1]!.lastRunAt).toBeTruthy()
    expect(res.body[2]).toMatchObject({ groupId: fresh.id, lastRunAt: null })
  })

  it('is for the owner and sysadmins only', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const li = await t.seed.user({ name: '李建国' })
    const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
    const bot = await t.seed.bot({ ownerId: wang.id })
    const path = `/api/bots/${bot.id}/activity`
    expect((await client(t, await t.seed.cookie(li.id)).get(path)).status).toBe(403)
    expect((await client(t, await t.seed.cookie(admin.id)).get(path)).status).toBe(200)
  })
})

describe('GET /api/bots/recent', () => {
  it('lists my bots by their last run, newest first, without bots never run or other owners', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const li = await t.seed.user({ name: '李建国' })
    const old = await t.seed.bot({ ownerId: wang.id, name: '旧 Bot' })
    const hot = await t.seed.bot({ ownerId: wang.id, name: '常用 Bot' })
    await t.seed.bot({ ownerId: wang.id, name: '没用过' })
    const theirs = await t.seed.bot({ ownerId: li.id, name: '李的 Bot' })
    const g = await t.seed.group({
      createdBy: wang.id,
      memberIds: [li.id],
      botIds: [old.id, hot.id, theirs.id],
    })
    const other = await t.seed.group({ createdBy: wang.id, botIds: [old.id] })
    const [m] = await t.db.insert(messages).values({ groupId: g.id, kind: 'user', body: 'x' }).returning()
    const [m2] = await t.db
      .insert(messages)
      .values({ groupId: other.id, kind: 'user', body: 'x' })
      .returning()
    const now = Date.now()
    const run = (msg: typeof m, botId: string, ago: number) => ({
      groupId: msg!.groupId,
      botId,
      triggerMessageId: msg!.id,
      originUserId: wang.id,
      status: 'completed',
      startedAt: new Date(now - ago * MIN),
    })
    await t.db
      .insert(runs)
      .values([run(m, old.id, 60), run(m2, old.id, 30), run(m, hot.id, 1), run(m, theirs.id, 0)])

    const res = await client(t, await t.seed.cookie(wang.id)).get<BotRecentDto[]>('/api/bots/recent')
    expect(res.status).toBe(200)
    expect(res.body.map((r) => r.botId)).toEqual([hot.id, old.id])
    expect(new Date(res.body[1]!.lastUsedAt).getTime()).toBe(now - 30 * MIN)
  })
})
