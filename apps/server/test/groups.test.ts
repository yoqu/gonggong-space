import type { GroupDto, TimelineDto } from '@aiws/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, groupRepos } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { bareRepo } from './support/git.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function people() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const { machine } = await t.seed.machine(wang.id)
  const { machine: liMachine } = await t.seed.machine(li.id)
  const wangBot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const liBot = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: liMachine.id })
  return {
    wang,
    li,
    zhao,
    wangBot,
    liBot,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asZhao: client(t, await t.seed.cookie(zhao.id)),
  }
}

const bodies = async (c: ReturnType<typeof client>, groupId: string) =>
  (await c.get<TimelineDto>(`/api/groups/${groupId}/timeline`)).body.messages.map((m) => m.body)

describe('create group', () => {
  it('makes the creator admin, auto-joins bot owners and posts event messages', async () => {
    const p = await people()
    const wangEvents = events(t, p.wang.id)
    const liEvents = events(t, p.li.id)
    const res = await p.asWang.post<GroupDto>('/api/groups', {
      name: '退款 v2 迁移',
      kind: 'group',
      memberIds: [p.zhao.id],
      botIds: [p.wangBot.id, p.liBot.id],
      repo: { url: 'git@git.corp:team/refund.git', branch: 'main' },
    })
    expect(res.status).toBe(200)
    const g = res.body
    expect(g).toMatchObject({ name: '退款 v2 迁移', kind: 'group', mode: 'partition', unread: 0 })
    expect(g.repo).toEqual({ url: 'git@git.corp:team/refund.git', branch: 'main' })
    expect(new Set(g.botIds)).toEqual(new Set([p.wangBot.id, p.liBot.id]))
    expect(g.members).toEqual(
      expect.arrayContaining([
        { userId: p.wang.id, name: '王磊', isAdmin: true },
        { userId: p.zhao.id, name: '赵敏', isAdmin: false },
        { userId: p.li.id, name: '李建国', isAdmin: false },
      ]),
    )
    expect(g.members).toHaveLength(3)
    const [repo] = await t.db.select().from(groupRepos).where(eq(groupRepos.groupId, g.id))
    expect(repo).toMatchObject({ url: 'git@git.corp:team/refund.git', baseBranch: 'main' })

    expect(await bodies(p.asWang, g.id)).toEqual([
      '王磊 创建了群 · 成为群管理员 · 邀请 赵敏、李建国',
      '群绑定仓库 git@git.corp:team/refund.git · 基准分支 main · 分区模式',
      '小王的 Claude 加入 · 等待 王磊 绑定工作区',
      '老李的 Codex 加入 · 等待 李建国 绑定工作区',
    ])
    expect(wangEvents).toContainEqual({ t: 'group.updated', group: expect.objectContaining({ id: g.id }) })
    expect(liEvents).toContainEqual({ t: 'group.updated', group: expect.objectContaining({ id: g.id }) })
  })

  it('creates a repo-less DM with only the creator and their own bots', async () => {
    const p = await people()
    t.ctx.hub.register(p.wangBot.machineId!, { send() {}, close() {} })
    const res = await p.asWang.post<GroupDto>('/api/groups', {
      name: '脚本实验',
      kind: 'dm',
      botIds: [p.wangBot.id],
    })
    expect(res.status).toBe(200)
    expect(res.body.members).toEqual([{ userId: p.wang.id, name: '王磊', isAdmin: true }])
    expect(res.body.repo).toBeNull()
    expect(await bodies(p.asWang, res.body.id)).toEqual([
      '王磊 创建了私聊 · 仅你和你的 bot',
      '未绑定仓库 · 各 bot 使用主人绑定的目录，仅分区模式',
      '小王的 Claude 加入 · 等待 王磊 绑定工作区',
    ])
  })

  it('rejects a DM with someone else’s bot or other members', async () => {
    const p = await people()
    const other = await p.asWang.post('/api/groups', { name: 'x', kind: 'dm', botIds: [p.liBot.id] })
    expect(other.status).toBe(403)
    const withMember = await p.asWang.post('/api/groups', { name: 'x', kind: 'dm', memberIds: [p.li.id] })
    expect(withMember.status).toBe(400)
  })

  it('rejects deleted or unknown bots, unknown users and malformed repos', async () => {
    const p = await people()
    const gone = await t.seed.bot({ ownerId: p.wang.id, deletedAt: new Date() })
    for (const body of [
      { name: 'x', kind: 'group', botIds: [gone.id] },
      { name: 'x', kind: 'group', botIds: ['00000000-0000-0000-0000-000000000000'] },
      { name: 'x', kind: 'group', memberIds: ['00000000-0000-0000-0000-000000000000'] },
      { name: 'x', kind: 'group', repo: { url: 'not a url', branch: 'main' } },
      { name: '', kind: 'group' },
    ])
      expect((await p.asWang.post('/api/groups', body)).status).toBe(400)
  })

  it('accepts a pending bot', async () => {
    const p = await people()
    const pending = await t.seed.bot({ ownerId: p.zhao.id, name: '待绑定 bot' })
    const res = await p.asWang.post<GroupDto>('/api/groups', {
      name: 'x',
      kind: 'group',
      botIds: [pending.id],
    })
    expect(res.status).toBe(200)
    expect(res.body.members.map((m) => m.userId)).toContain(p.zhao.id)
  })

  it('requires login', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { name: 'x', kind: 'group' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('reading groups', () => {
  it('lists only my groups with unread, lastSeq and last line', async () => {
    const p = await people()
    const mine = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id], name: 'A' })
    await t.seed.group({ createdBy: p.zhao.id, name: 'B' })
    await p.asLi.post(`/api/groups/${mine.id}/messages`, { body: '第一条', clientId: 'client-0001' })
    await p.asLi.post(`/api/groups/${mine.id}/messages`, { body: '第二条\n换行', clientId: 'client-0002' })
    await p.asWang.post(`/api/groups/${mine.id}/messages`, { body: '我自己的', clientId: 'client-0003' })

    const wangList = (await p.asWang.get<GroupDto[]>('/api/groups')).body
    expect(wangList.map((g) => g.name)).toEqual(['A'])
    expect(wangList[0]).toMatchObject({ unread: 2, last: '王磊：我自己的' })
    expect((await p.asLi.get<GroupDto[]>('/api/groups')).body[0]).toMatchObject({ unread: 1 })

    const tl = (await p.asWang.get<TimelineDto>(`/api/groups/${mine.id}/timeline`)).body
    const lastSeq = tl.messages.at(-1)!.seq
    expect(wangList[0]!.lastSeq).toBe(lastSeq)

    const wangEvents = events(t, p.wang.id)
    expect((await p.asWang.post(`/api/groups/${mine.id}/read`, { seq: lastSeq })).status).toBe(200)
    expect((await p.asWang.get<GroupDto[]>('/api/groups')).body[0]!.unread).toBe(0)
    expect(wangEvents).toEqual([{ t: 'group.updated', group: expect.objectContaining({ unread: 0 }) }])
  })

  it('never moves the read cursor backwards', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id] })
    await p.asLi.post(`/api/groups/${g.id}/messages`, { body: 'a', clientId: 'client-0001' })
    await p.asWang.post(`/api/groups/${g.id}/read`, {})
    await p.asWang.post(`/api/groups/${g.id}/read`, { seq: 0 })
    expect((await p.asWang.get<GroupDto>(`/api/groups/${g.id}`)).body.unread).toBe(0)
  })

  it('hides groups from non-members', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id })
    expect((await p.asZhao.get(`/api/groups/${g.id}`)).status).toBe(404)
    expect((await p.asZhao.get(`/api/groups/${g.id}/timeline`)).status).toBe(404)
    expect((await p.asZhao.post(`/api/groups/${g.id}/read`, {})).status).toBe(404)
    expect((await p.asZhao.get('/api/groups/not-a-uuid')).status).toBe(404)
  })

  it('validates repo address format', async () => {
    const p = await people()
    const ok = await p.asWang.post('/api/groups/validate-repo', { url: bareRepo().url, branch: 'main' })
    expect(ok.body).toMatchObject({ ok: true })
    const bad = await p.asWang.post('/api/groups/validate-repo', { url: 'ftp://x', branch: 'main' })
    expect(bad.body).toMatchObject({ ok: false })
    const noBranch = await p.asWang.post('/api/groups/validate-repo', { url: 'git@a:b.git', branch: 'a b' })
    expect(noBranch.body).toMatchObject({ ok: false })
  })
})

describe('membership management', () => {
  it('admin adds a member; non-admins cannot', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id] })
    expect((await p.asLi.post(`/api/groups/${g.id}/members`, { userId: p.zhao.id })).status).toBe(403)
    const zhaoEvents = events(t, p.zhao.id)
    const res = await p.asWang.post<GroupDto>(`/api/groups/${g.id}/members`, { userId: p.zhao.id })
    expect(res.status).toBe(200)
    expect(res.body.members.map((m) => m.userId)).toContain(p.zhao.id)
    expect(zhaoEvents).toContainEqual({ t: 'group.updated', group: expect.objectContaining({ id: g.id }) })
    expect((await bodies(p.asZhao, g.id)).at(-1)).toBe('王磊 邀请 赵敏 加入群')
    expect((await p.asWang.post(`/api/groups/${g.id}/members`, { userId: p.zhao.id })).status).toBe(200)
  })

  it('removing a member also removes their bots and tells them', async () => {
    const p = await people()
    const g = await t.seed.group({
      createdBy: p.wang.id,
      memberIds: [p.li.id],
      botIds: [p.wangBot.id, p.liBot.id],
    })
    const liEvents = events(t, p.li.id)
    const res = await p.asWang.del<GroupDto>(`/api/groups/${g.id}/members/${p.li.id}`)
    expect(res.status).toBe(200)
    expect(res.body.members.map((m) => m.userId)).toEqual([p.wang.id])
    expect(res.body.botIds).toEqual([p.wangBot.id])
    const [row] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, g.id), eq(groupBots.botId, p.liBot.id)))
    expect(row?.removedAt).not.toBeNull()
    expect(liEvents).toEqual([{ t: 'group.removed', groupId: g.id }])
    expect((await p.asLi.get(`/api/groups/${g.id}`)).status).toBe(404)
    expect((await bodies(p.asWang, g.id)).slice(-2)).toEqual([
      '老李的 Codex 被移出 · 工作区保留',
      '王磊 将 李建国 移出群',
    ])
  })

  it('the last admin cannot be removed', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id, memberIds: [p.li.id] })
    expect((await p.asWang.del(`/api/groups/${g.id}/members/${p.wang.id}`)).status).toBe(409)
  })

  it('adding a bot auto-joins its owner; removing keeps the workspace row', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id })
    const liEvents = events(t, p.li.id)
    const added = await p.asWang.post<GroupDto>(`/api/groups/${g.id}/bots`, { botId: p.liBot.id })
    expect(added.status).toBe(200)
    expect(added.body.botIds).toEqual([p.liBot.id])
    expect(added.body.members.map((m) => m.userId)).toContain(p.li.id)
    expect(liEvents).toContainEqual({ t: 'group.updated', group: expect.objectContaining({ id: g.id }) })

    const removed = await p.asWang.del<GroupDto>(`/api/groups/${g.id}/bots/${p.liBot.id}`)
    expect(removed.body.botIds).toEqual([])
    expect(removed.body.members.map((m) => m.userId)).toContain(p.li.id)
    const rows = await t.db.select().from(groupBots).where(eq(groupBots.groupId, g.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.removedAt).not.toBeNull()

    const again = await p.asWang.post<GroupDto>(`/api/groups/${g.id}/bots`, { botId: p.liBot.id })
    expect(again.body.botIds).toEqual([p.liBot.id])
  })

  it('a DM only accepts the creator’s own bots and no other members', async () => {
    const p = await people()
    const dm = await t.seed.group({ createdBy: p.wang.id, kind: 'dm' })
    expect((await p.asWang.post(`/api/groups/${dm.id}/bots`, { botId: p.liBot.id })).status).toBe(403)
    expect((await p.asWang.post(`/api/groups/${dm.id}/members`, { userId: p.li.id })).status).toBe(400)
    expect((await p.asWang.post(`/api/groups/${dm.id}/bots`, { botId: p.wangBot.id })).status).toBe(200)
  })

  it('audits every admin action', async () => {
    const p = await people()
    const g = (
      await p.asWang.post<GroupDto>('/api/groups', { name: 'g', kind: 'group', memberIds: [], botIds: [] })
    ).body
    await p.asWang.post(`/api/groups/${g.id}/members`, { userId: p.zhao.id })
    await p.asWang.post(`/api/groups/${g.id}/bots`, { botId: p.liBot.id })
    await p.asWang.del(`/api/groups/${g.id}/bots/${p.liBot.id}`)
    await p.asWang.del(`/api/groups/${g.id}/members/${p.zhao.id}`)
    await p.asWang.patch(`/api/groups/${g.id}/repo`, { url: 'git@git.corp:team/refund.git', branch: 'main' })
    const rows = await t.db.select().from(auditLogs).orderBy(asc(auditLogs.id))
    expect(rows.map((r) => [r.category, r.action, r.actorUserId, r.groupId])).toEqual(
      [
        'group.member.add',
        'group.bot.add',
        'group.bot.remove',
        'group.member.remove',
        'group.repo.change',
      ].map((a) => ['admin', a, p.wang.id, g.id]),
    )
    expect(rows.map((r) => r.detail)).toEqual([
      { userId: p.zhao.id, name: '赵敏' },
      { botId: p.liBot.id, name: '老李的 Codex' },
      { botId: p.liBot.id, name: '老李的 Codex' },
      { userId: p.zhao.id, name: '赵敏' },
      { url: 'git@git.corp:team/refund.git', branch: 'main', previous: null },
    ])
  })

  it('non-members get not_found on management routes', async () => {
    const p = await people()
    const g = await t.seed.group({ createdBy: p.wang.id })
    expect((await p.asZhao.post(`/api/groups/${g.id}/bots`, { botId: p.liBot.id })).status).toBe(404)
    expect((await p.asZhao.del(`/api/groups/${g.id}/members/${p.wang.id}`)).status).toBe(404)
  })
})
