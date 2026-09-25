import type { DaemonWorkspaceDto, ServerToDaemon } from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, bots, groupBots, groupRepos, groups, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const other = await t.seed.machine(li.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: other.machine.id })
  const pay = await t.seed.group({ createdBy: wang.id, name: '支付服务重构', botIds: [claude.id, codex.id] })
  const [repo] = await t.db
    .insert(groupRepos)
    .values({ groupId: pay.id, url: 'git@example.com:team/pay.git', baseBranch: 'main' })
    .returning()
  const data = await t.seed.group({ createdBy: wang.id, name: '数据平台', botIds: [claude.id] })
  await t.db
    .insert(groupRepos)
    .values({ groupId: data.id, url: 'git@example.com:team/etl.git', baseBranch: 'main' })
  await t.db
    .update(groupBots)
    .set({ workspaceKind: 'cd', cdPath: '/Users/wang/code/etl', workspaceState: 'ready' })
    .where(eq(groupBots.groupId, data.id))
  const old = await t.seed.group({ createdBy: wang.id, name: '旧版后台', botIds: [claude.id] })
  await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.groupId, old.id))
  const dm = await t.seed.group({ createdBy: wang.id, kind: 'dm', name: 'dm', botIds: [claude.id] })
  const auth = (tk = token) => ({ authorization: `Bearer ${tk}` })
  return { wang, machine, token, other, claude, codex, pay, repo: repo!, data, old, dm, auth }
}

describe('GET /api/daemon/workspaces', () => {
  it("lists this machine's (group, bot) pairs with names, kind, repo, removed and running flags", async () => {
    const w = await world()
    const [msg] = await t.db
      .insert(messages)
      .values({ groupId: w.pay.id, kind: 'user', authorUserId: w.wang.id, body: '@小王的 Claude hi' })
      .returning()
    await t.db.insert(runs).values({
      groupId: w.pay.id,
      botId: w.claude.id,
      triggerMessageId: msg!.id,
      originUserId: w.wang.id,
      status: 'awaiting_approval',
    })
    const res = await t.app.inject({ url: '/api/daemon/workspaces', headers: w.auth() })
    expect(res.statusCode).toBe(200)
    const list = res.json<DaemonWorkspaceDto[]>()
    const by = (g: string) => list.find((x) => x.groupId === g)
    expect(list).toHaveLength(4)
    expect(by(w.pay.id)).toEqual({
      groupId: w.pay.id,
      groupName: '支付服务重构',
      groupKind: 'group',
      botId: w.claude.id,
      botName: '小王的 Claude',
      kind: 'managed',
      cdPath: null,
      repoId: w.repo.id,
      removed: false,
      running: true,
    })
    expect(by(w.data.id)).toMatchObject({
      kind: 'cd',
      cdPath: '/Users/wang/code/etl',
      removed: false,
      running: false,
    })
    expect(by(w.old.id)).toMatchObject({ removed: true, repoId: null })
    expect(by(w.dm.id)).toMatchObject({ groupKind: 'dm', removed: false })
  })

  it('archived groups and deleted bots count as removed', async () => {
    const w = await world()
    await t.db.update(groups).set({ archivedAt: new Date() }).where(eq(groups.id, w.pay.id))
    await t.db.update(bots).set({ deletedAt: new Date() }).where(eq(bots.id, w.claude.id))
    const list = (await t.app.inject({ url: '/api/daemon/workspaces', headers: w.auth() })).json<
      DaemonWorkspaceDto[]
    >()
    expect(list.every((x) => x.removed)).toBe(true)
  })

  it('requires a valid machine token', async () => {
    const w = await world()
    expect((await t.app.inject({ url: '/api/daemon/workspaces' })).statusCode).toBe(401)
    const cookie = await t.seed.cookie(w.wang.id)
    expect((await t.app.inject({ url: '/api/daemon/workspaces', headers: { cookie } })).statusCode).toBe(401)
    const other = await t.app.inject({ url: '/api/daemon/workspaces', headers: w.auth(w.other.token) })
    expect(other.json<DaemonWorkspaceDto[]>().map((x) => x.botName)).toEqual(['老李的 Codex'])
  })
})

describe('POST /api/daemon/workspaces/:groupId/:botId/reset-cd', () => {
  it('asks the daemon to go back to the managed clone and posts the /cd --reset event', async () => {
    const w = await world()
    const sent: ServerToDaemon[] = []
    t.ctx.hub.register(w.machine.id, { send: (m) => sent.push(m), close() {} })
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/workspaces/${w.data.id}/${w.claude.id}/reset-cd`,
      headers: w.auth(),
    })
    expect(res.statusCode).toBe(204)
    expect(sent.filter((m) => m.t === 'workspace.cd')).toEqual([
      expect.objectContaining({ t: 'workspace.cd', groupId: w.data.id, botId: w.claude.id, path: null }),
    ])
    const events = await t.db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.groupId, w.data.id), eq(messages.kind, 'event')))
      .orderBy(asc(messages.seq))
    expect(events.map((e) => e.body)).toEqual(['已请求 小王的 Claude 使用托管工作区，等待本机确认…'])
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'command.cd'))
    expect(log).toMatchObject({
      actorUserId: w.wang.id,
      groupId: w.data.id,
      detail: { botId: w.claude.id, path: null },
    })
  })

  it("rejects pairs that are not /cd bound, removed, or another machine's", async () => {
    const w = await world()
    t.ctx.hub.register(w.machine.id, { send() {}, close() {} })
    const post = (g: string, b: string, tk = w.token) =>
      t.app.inject({ method: 'POST', url: `/api/daemon/workspaces/${g}/${b}/reset-cd`, headers: w.auth(tk) })
    expect((await post(w.pay.id, w.claude.id)).json()).toMatchObject({ error: 'conflict' })
    expect((await post(w.old.id, w.claude.id)).statusCode).toBe(404)
    expect((await post(w.pay.id, w.codex.id)).statusCode).toBe(404)
    expect((await post(w.data.id, w.claude.id, w.other.token)).statusCode).toBe(404)
  })
})
