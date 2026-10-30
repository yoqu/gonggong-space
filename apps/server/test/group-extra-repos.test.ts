import { type GroupDto, PROTOCOL_VERSION, type ServerToDaemon } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groupRepos, groups, messages } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'git@git.corp:pay/pay-server.git'
const WEB = 'https://git.corp/pay/pay-web.git'

async function world() {
  const admin = await t.seed.user({ name: '陈晨' })
  const owner = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const group = await t.seed.group({ createdBy: admin.id, memberIds: [owner.id], botIds: [bot.id] })
  const [main] = await t.db
    .insert(groupRepos)
    .values({ groupId: group.id, url: MAIN, baseBranch: 'main' })
    .returning()
  await t.db
    .update(groupBots)
    .set({ workspaceState: 'ready', sessionId: 'sess-1' })
    .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
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
  const admins = client(t, await t.seed.cookie(admin.id))
  const owners = client(t, await t.seed.cookie(owner.id))
  const add = (c: typeof admins, url: string, branch = 'main') =>
    c.post<GroupDto>(`/api/groups/${group.id}/repos`, { url, branch })
  const next = async <T extends ServerToDaemon['t']>(kind: T) => {
    const m = await box.next<ServerToDaemon>()
    if (m.t !== kind) throw new Error(`expected ${kind}, got ${m.t}`)
    return m as Extract<ServerToDaemon, { t: T }>
  }
  const session = async () =>
    (
      await t.db
        .select({ sessionId: groupBots.sessionId, reason: groupBots.newSessionReason })
        .from(groupBots)
        .where(eq(groupBots.groupId, group.id))
    )[0]
  const trigger = async () => {
    await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, group.id))
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: owner.id,
        body: '@cc 改',
        meta: { mentions: [bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    return next('run.start')
  }
  return { admin, owner, bot, group, main: main!, admins, owners, add, next, session, trigger }
}

describe('extra repos of a group', () => {
  it('an admin adds one: bots clone it beside the main repo, start new sessions and get it at run start', async () => {
    const w = await world()
    expect((await w.add(w.owners, WEB)).status).toBe(403)
    const res = await w.add(w.admins, WEB, 'develop')
    expect(res.status).toBe(200)
    const [extra] = res.body.extraRepos ?? []
    expect(res.body.repo).toEqual({ url: MAIN, branch: 'main' })
    expect(extra).toEqual({ id: expect.any(String), url: WEB, branch: 'develop' })

    const ensure = await w.next('workspace.ensure')
    expect(ensure.repo).toMatchObject({ id: w.main.id, url: MAIN })
    expect(ensure.extraRepos).toEqual([{ id: extra!.id, url: WEB, branch: 'develop', protocol: 'auto' }])
    expect(await w.session()).toEqual({ sessionId: null, reason: 'config_changed' })
    const events = await t.db.select().from(messages).where(eq(messages.groupId, w.group.id))
    expect(events.map((m) => m.body)).toContain(
      '陈晨 添加了附加仓库 https://git.corp/pay/pay-web.git · 默认分支 develop',
    )

    const start = await w.trigger()
    expect(start.workspace.repo?.id).toBe(w.main.id)
    expect(start.workspace.extraRepos).toEqual([
      { id: extra!.id, url: WEB, branch: 'develop', protocol: 'auto' },
    ])
    expect(start.bot.systemPrompt).toContain(
      '- pay-web：https://git.corp/pay/pay-web.git（默认分支 develop）',
    )
  })

  it('refuses duplicates, groups without a main repo and force-sync groups; the main repo cannot be unbound first', async () => {
    const w = await world()
    expect((await w.add(w.admins, 'git@git.corp:pay/pay-server')).status).toBe(409)
    expect((await w.add(w.admins, WEB)).status).toBe(200)
    expect((await w.add(w.admins, 'https://git.corp/pay/pay-web')).status).toBe(409)
    const unbind = await w.admins.patch(`/api/groups/${w.group.id}/repo`, { url: '', branch: '' })
    expect(unbind.status).toBe(409)
    // Rebinding the main repo to an extra one is refused too.
    const swap = await w.admins.patch(`/api/groups/${w.group.id}/repo`, { url: WEB, branch: 'main' })
    expect(swap.status).toBe(409)

    await t.db.update(groups).set({ mode: 'force' }).where(eq(groups.id, w.group.id))
    expect((await w.add(w.admins, 'https://git.corp/pay/pay-sdk.git')).status).toBe(409)
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.group.id))
    await t.db.delete(groupRepos).where(eq(groupRepos.groupId, w.group.id))
    expect((await w.add(w.admins, 'https://git.corp/pay/pay-sdk.git')).status).toBe(409)
  })

  it('a branch change replaces the repo with a new clone; removing it leaves the main repo alone', async () => {
    const w = await world()
    const added = (await w.add(w.admins, WEB)).body.extraRepos![0]!
    await w.next('workspace.ensure')
    const changed = await w.admins.patch<GroupDto>(`/api/groups/${w.group.id}/repos/${added.id}`, {
      branch: 'develop',
    })
    expect(changed.status).toBe(200)
    const [now] = changed.body.extraRepos!
    expect(now).toEqual({ id: expect.any(String), url: WEB, branch: 'develop' })
    expect(now!.id).not.toBe(added.id)
    expect((await w.next('workspace.ensure')).extraRepos?.map((r) => r.id)).toEqual([now!.id])

    expect((await w.admins.del(`/api/groups/${w.group.id}/repos/${w.main.id}`)).status).toBe(404)
    const removed = await w.admins.del<GroupDto>(`/api/groups/${w.group.id}/repos/${now!.id}`)
    expect(removed.status).toBe(200)
    expect(removed.body.extraRepos).toEqual([])
    expect(removed.body.repo).toEqual({ url: MAIN, branch: 'main' })
    expect((await w.next('workspace.ensure')).extraRepos).toEqual([])
  })
})
