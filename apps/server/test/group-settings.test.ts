import type { GroupDto, GroupNoticeDto, GroupParams, MessageDto, TimelineDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, groupMembers, groups, messages, runs, systemParams } from '../src/db/schema.js'
import { timeoutMin } from '../src/modules/approvals/service.js'
import { triggerChain } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine } = await t.seed.machine(wang.id)
  const { machine: liMachine } = await t.seed.machine(li.id)
  const wangBot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const liBot = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: liMachine.id })
  const g = await t.seed.group({
    createdBy: wang.id,
    name: '支付',
    memberIds: [li.id, zhao.id],
    botIds: [wangBot.id, liBot.id],
  })
  return {
    wang,
    li,
    zhao,
    wangBot,
    liBot,
    g,
    as: {
      wang: client(t, await t.seed.cookie(wang.id)),
      li: client(t, await t.seed.cookie(li.id)),
      zhao: client(t, await t.seed.cookie(zhao.id)),
      outsider: client(t, await t.seed.cookie(outsider.id)),
    },
  }
}

type World = Awaited<ReturnType<typeof world>>

/** A waiting (queued) run of `botId`, so stopping it needs no daemon. */
async function queuedRun(w: World, botId: string, status = 'queued') {
  const [m] = await t.db
    .insert(messages)
    .values({ groupId: w.g.id, kind: 'user', authorUserId: w.wang.id, body: '@Bot 干活' })
    .returning()
  const [r] = await t.db
    .insert(runs)
    .values({
      groupId: w.g.id,
      botId,
      triggerMessageId: m!.id,
      triggerUserId: w.wang.id,
      originUserId: w.wang.id,
      status,
    })
    .returning()
  return r!
}

const runStatus = async (id: string) =>
  (await t.db.select({ s: runs.status }).from(runs).where(eq(runs.id, id)))[0]?.s

const adminAudit = async (action: string) =>
  t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.category, 'admin'), eq(auditLogs.action, action)))

const bodies = async (c: World['as']['wang'], groupId: string) =>
  (await c.get<TimelineDto>(`/api/groups/${groupId}/timeline`)).body.messages.map((m) => m.body)

describe('name and notice', () => {
  it('admin renames and sets the notice; members see it; audited', async () => {
    const w = await world()
    const liEvents = events(t, w.li.id)
    const res = await w.as.wang.patch<GroupDto>(`/api/groups/${w.g.id}`, {
      name: '  支付服务重构 ',
      notice: '每个 Bot 独立分支，走 PR',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: '支付服务重构', notice: '每个 Bot 独立分支，走 PR' })
    expect(liEvents).toContainEqual({
      t: 'group.updated',
      group: expect.objectContaining({ name: '支付服务重构', notice: '每个 Bot 独立分支，走 PR' }),
    })
    expect(await bodies(w.as.li, w.g.id)).toContain('王磊 修改了群名称与公告')
    const [row] = await adminAudit('group.update')
    expect(row).toMatchObject({ actorUserId: w.wang.id, groupId: w.g.id })
    expect(row?.detail).toMatchObject({ name: '支付服务重构', notice: '每个 Bot 独立分支，走 PR' })
  })

  it('rejects non-admins, non-members and an empty name', async () => {
    const w = await world()
    expect((await w.as.li.patch(`/api/groups/${w.g.id}`, { name: 'x' })).status).toBe(403)
    expect((await w.as.outsider.patch(`/api/groups/${w.g.id}`, { name: 'x' })).status).toBe(404)
    expect((await w.as.wang.patch(`/api/groups/${w.g.id}`, { name: '   ' })).status).toBe(400)
  })
})

describe('notice removal, hiding and history', () => {
  const notice = (w: World, text: string) =>
    w.as.wang.patch<GroupDto>(`/api/groups/${w.g.id}`, { notice: text })
  const history = async (c: World['as']['wang'], id: string) =>
    (await c.get<GroupNoticeDto[]>(`/api/groups/${id}/notices`)).body

  it('keeps every published notice; members read the history newest first', async () => {
    const w = await world()
    await notice(w, '第一版')
    await notice(w, '第二版')
    const list = await history(w.as.zhao, w.g.id)
    expect(list.map((n) => [n.body, n.authorName, n.removedAt])).toEqual([
      ['第二版', '王磊', null],
      ['第一版', '王磊', expect.any(String)],
    ])
    expect((await w.as.outsider.get(`/api/groups/${w.g.id}/notices`)).status).toBe(404)
  })

  it('admin removes the notice for everyone; history keeps it; audited', async () => {
    const w = await world()
    await notice(w, '走 PR')
    const liEvents = events(t, w.li.id)
    expect((await w.as.li.del(`/api/groups/${w.g.id}/notice`)).status).toBe(403)
    const res = await w.as.wang.del<GroupDto>(`/api/groups/${w.g.id}/notice`)
    expect(res.status).toBe(200)
    expect(res.body.notice).toBe('')
    expect(liEvents).toContainEqual({ t: 'group.updated', group: expect.objectContaining({ notice: '' }) })
    expect(await bodies(w.as.li, w.g.id)).toContain('王磊 移除了群公告')
    expect((await history(w.as.li, w.g.id))[0]).toMatchObject({
      body: '走 PR',
      removedAt: expect.any(String),
    })
    expect(await adminAudit('group.notice.remove')).toHaveLength(1)
  })

  it('a member hides the notice only for themselves until a new one is published', async () => {
    const w = await world()
    await notice(w, '走 PR')
    const hidden = await w.as.li.put<GroupDto>(`/api/groups/${w.g.id}/prefs`, { noticeHidden: true })
    expect(hidden.body).toMatchObject({ notice: '走 PR', noticeHidden: true })
    expect((await w.as.zhao.get<GroupDto[]>('/api/groups')).body[0]?.noticeHidden).toBe(false)
    expect((await notice(w, '新公告')).body.noticeHidden).toBe(false)
    expect((await w.as.li.get<GroupDto[]>('/api/groups')).body[0]).toMatchObject({
      notice: '新公告',
      noticeHidden: false,
    })
    await w.as.li.put(`/api/groups/${w.g.id}/prefs`, { noticeHidden: true })
    const shown = await w.as.li.put<GroupDto>(`/api/groups/${w.g.id}/prefs`, { noticeHidden: false })
    expect(shown.body.noticeHidden).toBe(false)
  })
})

describe('group params', () => {
  it('defaults to the spec values; members read, only admins write', async () => {
    const w = await world()
    const got = await w.as.zhao.get<GroupParams>(`/api/groups/${w.g.id}/params`)
    expect(got.body).toEqual({ approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 })
    const put = { approvalTimeoutMin: 10, chainMaxHops: 1, offlineWaitMin: 5 }
    expect((await w.as.li.put(`/api/groups/${w.g.id}/params`, put)).status).toBe(403)
    expect((await w.as.outsider.get(`/api/groups/${w.g.id}/params`)).status).toBe(404)
    const res = await w.as.wang.put<GroupParams>(`/api/groups/${w.g.id}/params`, put)
    expect(res.body).toEqual(put)
    expect((await w.as.li.get<GroupParams>(`/api/groups/${w.g.id}/params`)).body).toEqual(put)
    const [row] = await adminAudit('group.params')
    expect(row?.detail).toMatchObject(put)
  })

  it('falls back to system params when set', async () => {
    const w = await world()
    await t.db.insert(systemParams).values([
      { key: 'chainMaxHops', value: 5 },
      { key: 'offlineWaitMin', value: 45 },
    ])
    const got = await w.as.wang.get<GroupParams>(`/api/groups/${w.g.id}/params`)
    expect(got.body).toEqual({ approvalTimeoutMin: 30, chainMaxHops: 5, offlineWaitMin: 45 })
  })

  it('validates ranges', async () => {
    const w = await world()
    const url = `/api/groups/${w.g.id}/params`
    const ok = { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 }
    expect((await w.as.wang.put(url, { ...ok, chainMaxHops: 0 })).status).toBe(400)
    expect((await w.as.wang.put(url, { ...ok, chainMaxHops: 11 })).status).toBe(400)
    expect((await w.as.wang.put(url, { ...ok, approvalTimeoutMin: 1.5 })).status).toBe(400)
    expect((await w.as.wang.put(url, { chainMaxHops: 2 })).status).toBe(400)
  })

  it('drives scheduling: approval timeout and chain length', async () => {
    const w = await world()
    await w.as.wang.put(`/api/groups/${w.g.id}/params`, {
      approvalTimeoutMin: 12,
      chainMaxHops: 1,
      offlineWaitMin: 30,
    })
    const [group] = await t.db.select().from(groups).where(eq(groups.id, w.g.id))
    expect(await timeoutMin(t.ctx, group!)).toBe(12)

    const parent = await queuedRun(w, w.wangBot.id, 'completed')
    const [reply] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'bot', authorBotId: w.wangBot.id, body: '@老李的 Codex 接着写测试' })
      .returning()
    const dto = { id: reply!.id, body: reply!.body } as MessageDto
    const count = async () => (await t.db.select().from(runs).where(eq(runs.groupId, w.g.id))).length
    await triggerChain(t.ctx, parent, dto)
    expect(await count()).toBe(1)

    await w.as.wang.put(`/api/groups/${w.g.id}/params`, {
      approvalTimeoutMin: 12,
      chainMaxHops: 2,
      offlineWaitMin: 30,
    })
    await triggerChain(t.ctx, parent, dto)
    expect(await count()).toBe(2)
  })
})

describe('personal prefs', () => {
  it('mute / pin / fold are per user', async () => {
    const w = await world()
    const res = await w.as.li.put<GroupDto>(`/api/groups/${w.g.id}/prefs`, { pinned: true, muted: true })
    expect(res.body).toMatchObject({ pinned: true, muted: true, foldRuns: false })
    await w.as.li.put(`/api/groups/${w.g.id}/prefs`, { foldRuns: true })
    const li = (await w.as.li.get<GroupDto>(`/api/groups/${w.g.id}`)).body
    expect(li).toMatchObject({ pinned: true, muted: true, foldRuns: true })
    const wang = (await w.as.wang.get<GroupDto>(`/api/groups/${w.g.id}`)).body
    expect(wang).toMatchObject({ pinned: false, muted: false, foldRuns: false })
    expect((await w.as.outsider.put(`/api/groups/${w.g.id}/prefs`, { pinned: true })).status).toBe(404)
    expect((await w.as.li.put(`/api/groups/${w.g.id}/prefs`, { pinned: 'yes' })).status).toBe(400)
  })
})

describe('admins', () => {
  it('admins appoint and revoke admins; the last admin stays', async () => {
    const w = await world()
    const url = (id: string) => `/api/groups/${w.g.id}/admins/${id}`
    expect((await w.as.li.post(url(w.zhao.id))).status).toBe(403)
    expect((await w.as.wang.post(url(w.wangBot.id))).status).toBe(404)
    const res = await w.as.wang.post<GroupDto>(url(w.li.id))
    expect(res.body.members.find((m) => m.userId === w.li.id)?.isAdmin).toBe(true)
    expect((await adminAudit('group.admin.grant'))[0]?.detail).toMatchObject({ userId: w.li.id })

    // Li, now admin, revokes Wang; then Li is the last admin and cannot step down.
    expect((await w.as.li.del(url(w.wang.id))).status).toBe(200)
    const last = await w.as.li.del<{ message: string }>(url(w.li.id))
    expect(last.status).toBe(409)
    expect((await adminAudit('group.admin.revoke'))[0]?.detail).toMatchObject({ userId: w.wang.id })
    expect(await bodies(w.as.li, w.g.id)).toEqual(
      expect.arrayContaining(['王磊 将 李建国 设为群管理员', '李建国 取消了 王磊 的群管理员']),
    )
  })
})

describe('leaving', () => {
  it('removes me and my bots, stops their runs and tells me', async () => {
    const w = await world()
    const liEvents = events(t, w.li.id)
    const liRun = await queuedRun(w, w.liBot.id)
    const wangRun = await queuedRun(w, w.wangBot.id)
    const res = await w.as.li.post(`/api/groups/${w.g.id}/leave`)
    expect(res.status).toBe(200)
    expect(liEvents).toContainEqual({ t: 'group.removed', groupId: w.g.id })
    expect(await runStatus(liRun.id)).toBe('interrupted')
    expect(await runStatus(wangRun.id)).toBe('queued')
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, w.g.id), eq(groupBots.botId, w.liBot.id)))
    expect(gb?.removedAt).not.toBeNull()
    const g = (await w.as.wang.get<GroupDto>(`/api/groups/${w.g.id}`)).body
    expect(g.members.map((m) => m.userId)).not.toContain(w.li.id)
    expect(g.botIds).toEqual([w.wangBot.id])
    expect(await bodies(w.as.wang, w.g.id)).toEqual(
      expect.arrayContaining(['老李的 Codex 被移出 · 工作区保留', '李建国 退出了群']),
    )
    expect((await w.as.li.get(`/api/groups/${w.g.id}`)).status).toBe(404)
  })

  it('blocks the only admin until a successor is appointed', async () => {
    const w = await world()
    const res = await w.as.wang.post<{ message: string }>(`/api/groups/${w.g.id}/leave`)
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。')
    await w.as.wang.post(`/api/groups/${w.g.id}/admins/${w.zhao.id}`)
    expect((await w.as.wang.post(`/api/groups/${w.g.id}/leave`)).status).toBe(200)
  })

  it('a DM cannot be left, only deleted', async () => {
    const w = await world()
    const dm = await t.seed.group({ createdBy: w.wang.id, kind: 'dm' })
    expect((await w.as.wang.post(`/api/groups/${dm.id}/leave`)).status).toBe(400)
  })

  it('removing a member also stops their bots’ runs', async () => {
    const w = await world()
    const liRun = await queuedRun(w, w.liBot.id)
    expect((await w.as.wang.del(`/api/groups/${w.g.id}/members/${w.li.id}`)).status).toBe(200)
    expect(await runStatus(liRun.id)).toBe('interrupted')
  })
})

describe('dissolving', () => {
  it('archives the group, stops unfinished runs, keeps messages and tells every member', async () => {
    const w = await world()
    const seen = [events(t, w.wang.id), events(t, w.li.id), events(t, w.zhao.id)]
    const run1 = await queuedRun(w, w.liBot.id)
    const run2 = await queuedRun(w, w.wangBot.id, 'offline_wait')
    expect((await w.as.li.post(`/api/groups/${w.g.id}/dissolve`)).status).toBe(403)
    expect((await w.as.wang.post(`/api/groups/${w.g.id}/dissolve`)).status).toBe(200)
    for (const e of seen) expect(e).toContainEqual({ t: 'group.removed', groupId: w.g.id })
    expect(await runStatus(run1.id)).toBe('interrupted')
    expect(await runStatus(run2.id)).toBe('interrupted')
    const [g] = await t.db.select().from(groups).where(eq(groups.id, w.g.id))
    expect(g?.archivedAt).not.toBeNull()
    expect((await t.db.select().from(messages).where(eq(messages.groupId, w.g.id))).length).toBeGreaterThan(0)
    expect(await t.db.select().from(groupMembers).where(eq(groupMembers.groupId, w.g.id))).toHaveLength(3)
    expect((await w.as.wang.get<GroupDto[]>('/api/groups')).body).toEqual([])
    expect((await w.as.wang.get(`/api/groups/${w.g.id}`)).status).toBe(404)
    expect((await adminAudit('group.dissolve'))[0]).toMatchObject({ actorUserId: w.wang.id, groupId: w.g.id })
  })

  it('deletes a DM the same way', async () => {
    const w = await world()
    const dm = await t.seed.group({ createdBy: w.wang.id, kind: 'dm' })
    expect((await w.as.wang.post(`/api/groups/${dm.id}/dissolve`)).status).toBe(200)
    expect((await w.as.wang.get(`/api/groups/${dm.id}`)).status).toBe(404)
  })
})
