import type {
  AdminSchedulesDto,
  GroupSchedulesDto,
  RunStart,
  ScheduleDto,
  SchedulePreviewDto,
} from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  auditLogs,
  groupBots,
  groupMembers,
  messages,
  notifications,
  runs,
  schedules,
} from '../src/db/schema.js'
import { fireDue, settleSchedule } from '../src/modules/schedules/engine.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
let clock = new Date('2026-10-05T00:30:00Z')
beforeEach(async () => {
  clock = new Date('2026-10-05T00:30:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

const TZ = 'Asia/Shanghai'
const daily9 = { name: '日报', prompt: '汇总昨天的 PR', cron: '0 9 * * *', timezone: TZ }

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const { machine } = await t.seed.machine(wang.id)
  const other = await t.seed.machine(li.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: li.id, name: 'Codex', machineId: other.machine.id })
  const group = await t.seed.group({
    createdBy: wang.id,
    memberIds: [li.id, zhao.id],
    botIds: [claude.id, codex.id],
  })
  await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, group.id))
  const cookies = {
    wang: await t.seed.cookie(wang.id),
    li: await t.seed.cookie(li.id),
    zhao: await t.seed.cookie(zhao.id),
  }
  const online = (machineId: string) => t.ctx.hub.register(machineId, { send() {}, close() {} })
  const req = async <T>(who: keyof typeof cookies, method: string, url: string, payload?: unknown) => {
    const res = await t.app.inject({
      method: method as 'GET',
      url,
      headers: { cookie: cookies[who] },
      ...(payload !== undefined && { payload: payload as object }),
    })
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T }
  }
  const create = (who: keyof typeof cookies, body: object) =>
    req<ScheduleDto>(who, 'POST', `/api/groups/${group.id}/schedules`, body)
  const list = async (who: keyof typeof cookies = 'wang') =>
    (await req<GroupSchedulesDto>(who, 'GET', `/api/groups/${group.id}/schedules`)).body.schedules
  const groupMessages = () =>
    t.db.select().from(messages).where(eq(messages.groupId, group.id)).orderBy(asc(messages.seq))
  return {
    wang,
    li,
    zhao,
    machine,
    other,
    claude,
    codex,
    group,
    online,
    req,
    create,
    list,
    groupMessages,
  }
}

describe('schedules REST', () => {
  it('a member creates a task: it is live at once, announced by a card and listed', async () => {
    const w = await world()
    const res = await w.create('li', { ...daily9, botIds: [w.codex.id, w.claude.id] })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      name: '日报',
      cron: '0 9 * * *',
      botIds: [w.codex.id, w.claude.id],
      enabled: true,
      ownerId: w.li.id,
      ownerName: '李建国',
      createdByBotId: null,
      nextRunAt: '2026-10-05T01:00:00.000Z',
      canManage: true,
    })
    const [card] = (await w.groupMessages()).filter((m) => (m.meta as { schedule?: string }).schedule)
    expect(card).toMatchObject({ kind: 'event', body: '李建国 创建了定时任务「日报」' })
    expect(await w.list('zhao')).toMatchObject([{ id: res.body.id, canManage: false }])
    expect(await w.list('wang')).toMatchObject([{ id: res.body.id, canManage: true }])
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'schedule.create'))
    expect(log).toMatchObject({ category: 'schedule', actorUserId: w.li.id, groupId: w.group.id })
  })

  it('refuses bad timings, bots outside the group, non-members and a 21st task', async () => {
    const w = await world()
    const bot = { botIds: [w.claude.id] }
    expect((await w.create('wang', { ...daily9, ...bot, cron: 'every day' })).status).toBe(400)
    expect((await w.create('wang', { ...daily9, ...bot, cron: '*/2 * * * *' })).status).toBe(400)
    expect(
      (await w.create('wang', { ...daily9, ...bot, cron: undefined, runAt: '2026-10-05T00:00:00Z' })).status,
    ).toBe(400)
    const stray = await t.seed.bot({ ownerId: w.wang.id, name: 'stray', machineId: w.machine.id })
    expect((await w.create('wang', { ...daily9, botIds: [stray.id] })).status).toBe(400)
    const outsider = await t.seed.user()
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/groups/${w.group.id}/schedules`,
      headers: { cookie: await t.seed.cookie(outsider.id) },
      payload: { ...daily9, ...bot },
    })
    expect(res.statusCode).toBe(404)
    for (let i = 0; i < 20; i++) expect((await w.create('wang', { ...daily9, ...bot })).status).toBe(200)
    expect((await w.create('wang', { ...daily9, ...bot })).status).toBe(400)
  })

  it('the owner or a group admin pauses, resumes, edits and deletes; others may not', async () => {
    const w = await world()
    const { body: s } = await w.create('li', { ...daily9, botIds: [w.codex.id] })
    const url = `/api/schedules/${s.id}`
    expect((await w.req('zhao', 'PATCH', url, { enabled: false })).status).toBe(403)
    const paused = await w.req<ScheduleDto>('li', 'PATCH', url, { enabled: false })
    expect(paused.body).toMatchObject({ enabled: false, nextRunAt: null, pausedReason: null })
    clock = new Date('2026-10-05T02:00:00Z')
    const resumed = await w.req<ScheduleDto>('wang', 'PATCH', url, { enabled: true, cron: '30 18 * * 1-5' })
    expect(resumed.body).toMatchObject({
      enabled: true,
      cron: '30 18 * * 1-5',
      nextRunAt: '2026-10-05T10:30:00.000Z',
    })
    const once = await w.req<ScheduleDto>('li', 'PATCH', url, { runAt: '2026-10-06T01:00:00Z' })
    expect(once.body).toMatchObject({
      cron: null,
      runAt: '2026-10-06T01:00:00.000Z',
      nextRunAt: '2026-10-06T01:00:00.000Z',
    })
    expect((await w.req('zhao', 'DELETE', url)).status).toBe(403)
    expect((await w.req('li', 'DELETE', url)).status).toBe(204)
    expect(await w.list()).toEqual([])
    expect((await w.req('li', 'PATCH', url, { enabled: true })).status).toBe(404)
  })

  it('previews the next firings of a timing', async () => {
    const w = await world()
    const ok = await w.req<SchedulePreviewDto>('zhao', 'POST', '/api/schedules/preview', {
      cron: '0 9 * * 1-5',
      timezone: TZ,
    })
    expect(ok.body).toEqual({
      error: null,
      next: ['2026-10-05T01:00:00.000Z', '2026-10-06T01:00:00.000Z', '2026-10-07T01:00:00.000Z'],
    })
    const bad = await w.req<SchedulePreviewDto>('zhao', 'POST', '/api/schedules/preview', {
      cron: '* * * * *',
      timezone: TZ,
    })
    expect(bad.body).toEqual({ error: { key: '执行间隔不能小于 {n} 分钟', params: { n: 5 } }, next: [] })
  })
})

describe('schedule engine', () => {
  it('fires a due task once, in its owner name, @-ing the first available bot', async () => {
    const w = await world()
    w.online(w.machine.id)
    w.online(w.other.machine.id)
    const { body: s } = await w.create('li', { ...daily9, botIds: [w.codex.id, w.claude.id] })
    expect(await fireDue(t.ctx)).toBe(0)
    clock = new Date('2026-10-05T01:00:10Z')
    await Promise.all([fireDue(t.ctx), fireDue(t.ctx)])
    await fireDue(t.ctx)
    const fired = (await w.groupMessages()).filter((m) => (m.meta as { scheduleOf?: string }).scheduleOf)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({
      kind: 'user',
      authorUserId: w.li.id,
      body: '@Codex 汇总昨天的 PR',
      meta: { mentions: [w.codex.id], scheduleOf: s.id },
    })
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, fired[0]!.id))
    expect(run).toMatchObject({ botId: w.codex.id, originUserId: w.li.id })
    expect((await w.list())[0]).toMatchObject({
      lastRunId: run!.id,
      lastBotId: w.codex.id,
      lastFiredAt: clock.toISOString(),
      nextRunAt: '2026-10-06T01:00:00.000Z',
    })
  })

  it('tells the bot which scheduled task started its turn', async () => {
    const w = await world()
    const sent: RunStart[] = []
    t.ctx.hub.register(w.machine.id, { send: (m) => void (m.t === 'run.start' && sent.push(m)), close() {} })
    const { body: s } = await w.create('wang', { ...daily9, botIds: [w.claude.id] })
    clock = new Date('2026-10-05T01:00:00Z')
    await fireDue(t.ctx)
    expect(sent[0]?.prompt.text).toBe('@Claude 汇总昨天的 PR')
    expect(sent[0]?.prompt.context.at(-1)).toMatchObject({
      author: '共工空间',
      body: `本轮由定时任务「日报」（id ${s.id}）触发。任务不再需要时，可用 gonggong 的 schedule_delete 删除它。`,
    })
  })

  it('passes over offline and busy bots, and skips when none is online', async () => {
    const w = await world()
    const { body: s } = await w.create('wang', { ...daily9, botIds: [w.codex.id, w.claude.id] })
    const fire = async (at: string) => {
      clock = new Date(at)
      await fireDue(t.ctx)
      const [last] = await t.db.select().from(schedules).where(eq(schedules.id, s.id))
      await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.botId, w.claude.id))
      await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.botId, w.codex.id))
      return last!
    }
    expect((await fire('2026-10-05T01:00:00Z')).lastBotId).toBeNull()
    const events = (await w.groupMessages()).filter((m) => m.kind === 'event').map((m) => m.body)
    expect(events).toContain('定时任务「日报」的候选 Bot 都不可用（Codex、Claude），本次跳过')

    w.online(w.machine.id)
    expect((await fire('2026-10-06T01:00:00Z')).lastBotId).toBe(w.claude.id)

    w.online(w.other.machine.id)
    const trigger = (await w.groupMessages())[0]!
    await t.db.insert(runs).values({
      groupId: w.group.id,
      botId: w.codex.id,
      triggerMessageId: trigger.id,
      originUserId: w.wang.id,
      status: 'running',
    })
    clock = new Date('2026-10-07T01:00:00Z')
    await fireDue(t.ctx)
    const [last] = await t.db.select().from(schedules).where(eq(schedules.id, s.id))
    expect(last!.lastBotId).toBe(w.claude.id)
  })

  it('skips a firing while the previous run is still going', async () => {
    const w = await world()
    w.online(w.machine.id)
    await w.create('wang', { ...daily9, botIds: [w.claude.id] })
    clock = new Date('2026-10-05T01:00:00Z')
    await fireDue(t.ctx)
    clock = new Date('2026-10-06T01:00:00Z')
    await fireDue(t.ctx)
    const bodies = (await w.groupMessages()).map((m) => m.body)
    expect(bodies.filter((b) => b === '@Claude 汇总昨天的 PR')).toHaveLength(1)
    expect(bodies).toContain('定时任务「日报」上次尚未结束，本次跳过')
  })

  it('a one-off task turns itself off after firing; one missed by over a day is dropped', async () => {
    const w = await world()
    w.online(w.machine.id)
    const once = {
      name: '提醒',
      prompt: '检查发布',
      runAt: '2026-10-05T01:00:00Z',
      timezone: TZ,
      botIds: [w.claude.id],
    }
    const { body: a } = await w.create('wang', once)
    const { body: b } = await w.create('wang', { ...once, runAt: '2026-10-05T02:00:00Z' })
    clock = new Date('2026-10-05T01:00:00Z')
    await fireDue(t.ctx)
    expect((await w.list()).find((s) => s.id === a.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: { key: '仅一次的任务已执行' },
    })
    clock = new Date('2026-10-06T03:00:00Z')
    await fireDue(t.ctx)
    expect((await w.list()).find((s) => s.id === b.id)).toMatchObject({
      enabled: false,
      pausedReason: { key: '错过执行时间超过 24 小时' },
    })
    expect((await w.groupMessages()).filter((m) => m.body === '@Claude 检查发布')).toHaveLength(1)
  })

  it('turns a task off after three failed runs in a row and tells its owner', async () => {
    const w = await world()
    w.online(w.machine.id)
    const { body: s } = await w.create('li', { ...daily9, botIds: [w.claude.id] })
    const fireAndEnd = async (day: number, status: string) => {
      clock = new Date(`2026-10-0${day}T01:00:00Z`)
      await fireDue(t.ctx)
      const [row] = await t.db.select().from(schedules).where(eq(schedules.id, s.id))
      const [run] = await t.db.update(runs).set({ status }).where(eq(runs.id, row!.lastRunId!)).returning()
      await settleSchedule(t.ctx, run!)
    }
    await fireAndEnd(5, 'interrupted')
    await fireAndEnd(6, 'completed')
    await fireAndEnd(7, 'interrupted')
    await fireAndEnd(8, 'interrupted')
    expect((await w.list())[0]).toMatchObject({ enabled: true, failStreak: 2 })
    await fireAndEnd(9, 'interrupted')
    expect((await w.list())[0]).toMatchObject({
      id: s.id,
      enabled: false,
      nextRunAt: null,
      failStreak: 3,
      pausedReason: { key: '连续 {n} 次失败', params: { n: 3 } },
    })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.li.id))
    expect(note).toMatchObject({ type: 'schedule_paused', payload: { scheduleId: s.id, name: '日报' } })
  })

  it('turns a task off when its bots or its owner left the group', async () => {
    const w = await world()
    w.online(w.machine.id)
    const { body: a } = await w.create('wang', { ...daily9, botIds: [w.claude.id] })
    const { body: b } = await w.create('li', { ...daily9, botIds: [w.codex.id] })
    await t.db
      .update(groupBots)
      .set({ removedAt: clock })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.claude.id)))
    await t.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, w.group.id), eq(groupMembers.userId, w.li.id)))
    clock = new Date('2026-10-05T01:00:00Z')
    await fireDue(t.ctx)
    const all = await w.list()
    expect(all.find((s) => s.id === a.id)?.pausedReason).toEqual({ key: '候选 Bot 都已不在群内' })
    expect(all.find((s) => s.id === b.id)?.pausedReason).toEqual({ key: '主人已不在群内' })
    expect((await w.groupMessages()).some((m) => m.kind === 'user')).toBe(false)
  })
})

describe('schedules admin', () => {
  it('sysadmins see every task with totals and may pause or delete them', async () => {
    const w = await world()
    const root = await t.seed.user({ role: 'sysadmin', name: '管理员' })
    const cookie = await t.seed.cookie(root.id)
    const { body: s } = await w.create('li', { ...daily9, botIds: [w.codex.id, w.claude.id] })
    const get = (c: string) =>
      t.app.inject({ method: 'GET', url: '/api/admin/schedules', headers: { cookie: c } })
    expect((await get(await t.seed.cookie(w.wang.id))).statusCode).toBe(403)
    const res = (await get(cookie)).json<AdminSchedulesDto>()
    expect(res.schedules).toMatchObject([
      {
        id: s.id,
        groupName: w.group.name,
        groupKind: 'group',
        teamName: '默认团队',
        botNames: ['Codex', 'Claude'],
      },
    ])
    expect(res.stats).toEqual({ enabled: 1, fired24h: 0, failed24h: 0, autoPaused: 0 })
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/schedules/${s.id}`,
      headers: { cookie },
      payload: { enabled: false },
    })
    expect(patch.json<ScheduleDto>()).toMatchObject({ enabled: false })
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/schedules/${s.id}`,
      headers: { cookie },
    })
    expect(del.statusCode).toBe(204)
    expect((await get(cookie)).json<AdminSchedulesDto>().schedules).toEqual([])
  })
})
