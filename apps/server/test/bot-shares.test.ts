import type { BotDto, GroupDto, TimelineDto, UsageRowDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, messages, notifications, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function people() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const admin = await t.seed.user({ name: '陈晨', role: 'sysadmin' })
  const outsider = await t.seed.user({ name: '外人', teamId: null })
  const { machine } = await t.seed.machine(wang.id)
  // Only the owner may trigger it in groups, and it has a private default directory.
  const bot = await t.seed.bot({
    ownerId: wang.id,
    name: '小王的 Claude',
    machineId: machine.id,
    triggerScope: 'self',
    defaultWorkspace: '/Users/wang/secret',
  })
  return {
    wang,
    li,
    zhao,
    admin,
    outsider,
    bot,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asZhao: client(t, await t.seed.cookie(zhao.id)),
    asAdmin: client(t, await t.seed.cookie(admin.id)),
  }
}

type People = Awaited<ReturnType<typeof people>>

const share = (p: People, userIds: string[], as = p.asWang) =>
  as.put<BotDto & { error?: string }>(`/api/bots/${p.bot.id}/shares`, { userIds })

const dmWith = (c: People['asLi'], botId: string) =>
  c.post<GroupDto & { error?: string }>('/api/groups', { name: 'x', kind: 'dm', botIds: [botId] })

const bodies = async (c: People['asLi'], groupId: string) =>
  (await c.get<TimelineDto>(`/api/groups/${groupId}/timeline`)).body.messages.map((m) => m.body)

async function say(groupId: string, userId: string, botId: string) {
  const [m] = await t.db
    .insert(messages)
    .values({
      groupId,
      kind: 'user',
      authorUserId: userId,
      body: '@小王的 Claude 看看',
      meta: { mentions: [botId] },
    })
    .returning()
  await triggerRuns(t.ctx, m!)
  return t.db.select().from(runs).where(eq(runs.triggerMessageId, m!.id))
}

describe('sharing a bot', () => {
  it('lets the owner share with team members, who are notified once', async () => {
    const p = await people()
    const res = await share(p, [p.li.id, p.zhao.id])
    expect(res.status).toBe(200)
    expect(res.body.sharedWith.sort()).toEqual([p.li.id, p.zhao.id].sort())
    expect((await share(p, [p.li.id, p.zhao.id])).status).toBe(200)
    const sent = await t.db.select().from(notifications).where(eq(notifications.type, 'bot_shared'))
    expect(sent.map((n) => n.userId).sort()).toEqual([p.li.id, p.zhao.id].sort())
    expect(sent[0]?.payload).toMatchObject({ botId: p.bot.id, botName: '小王的 Claude', byName: '王磊' })
    const listed = await p.asLi.get<BotDto[]>('/api/bots')
    expect(listed.body.find((b) => b.id === p.bot.id)?.sharedWith).toHaveLength(2)
  })

  it('is the owner’s or a sysadmin’s call, for members of the bot’s team other than the owner', async () => {
    const p = await people()
    expect((await share(p, [p.zhao.id], p.asLi)).status).toBe(403)
    expect((await share(p, [p.wang.id])).status).toBe(400)
    expect((await share(p, [p.outsider.id])).status).toBe(400)
    expect((await share(p, ['nope'])).status).toBe(400)
    expect((await share(p, [p.li.id], p.asAdmin)).status).toBe(200)
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.share'))
    expect(audits.map((a) => a.detail)).toEqual([
      expect.objectContaining({ botId: p.bot.id, added: [p.li.id], removed: [] }),
    ])
  })
})

describe('a shared bot in a direct chat', () => {
  it('can be DMed by those it is shared with only, titled with its owner', async () => {
    const p = await people()
    expect((await dmWith(p.asLi, p.bot.id)).status).toBe(403)
    await share(p, [p.li.id])
    const res = await dmWith(p.asLi, p.bot.id)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('小王的 Claude · 王磊')
    expect(res.body.members.map((m) => m.userId)).toEqual([p.li.id])
    expect(await bodies(p.asLi, res.body.id)).toEqual([
      '李建国 创建了私聊 · 使用 王磊 共享的 Bot',
      '未绑定仓库 · 各 Bot 使用主人绑定的目录，仅分区模式',
      '小王的 Claude 加入 · 使用独立的托管工作区',
    ])
    expect((await dmWith(p.asZhao, p.bot.id)).status).toBe(403)
    // Pulling it into a group stays the owner's (or a group admin's) decision.
    const g = await t.seed.group({ createdBy: p.zhao.id, memberIds: [p.li.id] })
    expect((await p.asLi.post(`/api/groups/${g.id}/bots`, { botId: p.bot.id })).status).toBe(403)
  })

  it('works in a managed workspace of the chat, never the owner’s default directory', async () => {
    const p = await people()
    await share(p, [p.li.id])
    const dm = (await dmWith(p.asLi, p.bot.id)).body
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, dm.id), eq(groupBots.botId, p.bot.id)))
    expect(gb).toMatchObject({ workspaceKind: 'managed', cdPath: null, workspaceState: 'ready' })
  })

  it('adds a shared bot to an existing DM without its owner joining', async () => {
    const p = await people()
    await share(p, [p.li.id])
    const dm = await t.seed.group({ createdBy: p.li.id, kind: 'dm' })
    const res = await p.asLi.post<GroupDto>(`/api/groups/${dm.id}/bots`, { botId: p.bot.id })
    expect(res.status).toBe(200)
    expect(res.body.members.map((m) => m.userId)).toEqual([p.li.id])
    expect(res.body.botIds).toEqual([p.bot.id])
  })

  it('runs for the person it is shared with even when only its owner may trigger it in groups', async () => {
    const p = await people()
    await share(p, [p.li.id])
    const dm = (await dmWith(p.asLi, p.bot.id)).body
    const [run] = await say(dm.id, p.li.id, p.bot.id)
    // The owner's machine is offline: it waits instead of being refused.
    expect(run?.status).toBe('offline_wait')
    const g = await t.seed.group({ createdBy: p.li.id, memberIds: [p.wang.id], botIds: [p.bot.id] })
    const [refused] = await say(g.id, p.li.id, p.bot.id)
    expect(refused?.status).toBe('forbidden')
  })

  it('turns the DM read-only when unshared, stopping its runs, and back when shared again', async () => {
    const p = await people()
    await share(p, [p.li.id, p.zhao.id])
    const dm = (await dmWith(p.asLi, p.bot.id)).body
    const [run] = await say(dm.id, p.li.id, p.bot.id)

    expect((await share(p, [p.zhao.id])).body.sharedWith).toEqual([p.zhao.id])
    const view = await p.asLi.get<GroupDto>(`/api/groups/${dm.id}`)
    expect(view.body.botIds).toEqual([])
    expect(view.body.name).toBe('小王的 Claude · 王磊')
    const [stopped] = await t.db.select().from(runs).where(eq(runs.id, run!.id))
    expect(stopped?.status).toBe('interrupted')
    expect(await bodies(p.asLi, dm.id)).toContain('王磊 取消了 小王的 Claude 的共享 · 私聊转为只读')
    expect(await say(dm.id, p.li.id, p.bot.id)).toEqual([])
    expect((await dmWith(p.asLi, p.bot.id)).status).toBe(403)

    await share(p, [p.zhao.id, p.li.id])
    expect((await p.asLi.get<GroupDto>(`/api/groups/${dm.id}`)).body.botIds).toEqual([p.bot.id])
    expect((await bodies(p.asLi, dm.id)).at(-1)).toBe('王磊 重新共享了 小王的 Claude')
    expect((await say(dm.id, p.li.id, p.bot.id))[0]?.status).toBe('offline_wait')
  })

  it('shows the person it is shared with their own usage of it only', async () => {
    const p = await people()
    await share(p, [p.li.id])
    const dm = (await dmWith(p.asLi, p.bot.id)).body
    await say(dm.id, p.li.id, p.bot.id)
    const own = await t.seed.group({ createdBy: p.wang.id, botIds: [p.bot.id] })
    await say(own.id, p.wang.id, p.bot.id)
    await t.db.update(runs).set({ startedAt: new Date() })
    const usage = await p.asLi.get<UsageRowDto[]>(`/api/usage?by=user&days=30&botId=${p.bot.id}`)
    expect(usage.status).toBe(200)
    expect(usage.body.map((r) => [r.name, r.runs])).toEqual([['李建国', 1]])
    expect((await p.asZhao.get(`/api/usage?by=user&days=30&botId=${p.bot.id}`)).status).toBe(403)
    expect(
      (await p.asWang.get<UsageRowDto[]>(`/api/usage?by=user&days=30&botId=${p.bot.id}`)).body,
    ).toHaveLength(2)
  })
})
