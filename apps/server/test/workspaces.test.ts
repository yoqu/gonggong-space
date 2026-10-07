import {
  type BotDto,
  type DirListingDto,
  type GroupBotStateDto,
  type GroupDto,
  PROTOCOL_VERSION,
  type TimelineDto,
  type WebEvent,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bots, groupBots, groupRepos, messages, runs } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { requestCd } from '../src/modules/workspaces/cd.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { bareRepo } from './support/git.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

type Msg = Record<string, unknown> & {
  t: string
  requestId?: string
  path?: string | null
  repo?: { id: string; url: string }
}

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
  const close = async () => {
    ws.close()
    await box.closed
    await until(async () => !t.ctx.hub.isOnline(machineOf.get(token)!))
  }
  return {
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: () => box.next<Msg>(),
    close,
  }
}
const machineOf = new Map<string, string>()

async function until(check: () => Promise<boolean> | boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const git = { branch: 'main', ahead: 0, behind: 0, dirty: false, workspace: 'managed' as const }
const reply = (req: Msg, o: Record<string, unknown> = {}) => ({
  t: 'workspace.state',
  groupId: req.groupId,
  botId: req.botId,
  requestId: req.requestId,
  state: 'ready',
  path: `/h/workspaces/${req.groupId}/${req.botId}/${req.repo?.id ?? '_empty'}`,
  git,
  error: null,
  ...o,
})

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const a = await t.seed.machine(alice.id)
  const b = await t.seed.machine(bob.id)
  machineOf.set(a.token, a.machine.id)
  machineOf.set(b.token, b.machine.id)
  const bot = await t.seed.bot({ ownerId: alice.id, name: '小王的 Claude', machineId: a.machine.id })
  const bobBot = await t.seed.bot({ ownerId: bob.id, name: '陈晨的 Codex', machineId: b.machine.id })
  const asAlice = client(t, await t.seed.cookie(alice.id))
  const asBob = client(t, await t.seed.cookie(bob.id))
  const repo = bareRepo()
  const createGroup = async (o: { repo?: boolean; botIds?: string[] } = {}) =>
    (
      await asAlice.post<GroupDto>('/api/groups', {
        name: '仓库协作',
        kind: 'group',
        botIds: o.botIds ?? [bot.id],
        repo: o.repo === false ? null : { url: repo.url, branch: 'main' },
      })
    ).body
  const states = async (groupId: string) =>
    (await asAlice.get<GroupBotStateDto[]>(`/api/groups/${groupId}/bot-states`)).body
  const stateOf = async (groupId: string, botId = bot.id) =>
    (await states(groupId)).find((s) => s.botId === botId)!
  const bodies = async (groupId: string) =>
    (await asAlice.get<TimelineDto>(`/api/groups/${groupId}/timeline`)).body.messages.map((m) => m.body)
  const repoOf = async (groupId: string) =>
    (await t.db.select().from(groupRepos).where(eq(groupRepos.groupId, groupId)))[0]!
  return { alice, bob, a, b, bot, bobBot, asAlice, asBob, repo, createGroup, states, stateOf, bodies, repoOf }
}

/** The managed clone requested when the bot joined a repo group. */
async function joinEnsure(d: Awaited<ReturnType<typeof daemon>>, groupId: string) {
  const req = await d.next()
  expect(req).toMatchObject({ t: 'workspace.ensure', groupId })
  return req
}

describe('joining a repo-less group without a default workspace', () => {
  it('leaves the bot unbound until its owner picks one, asking the daemon nothing', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ repo: false })
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'unbound', workspace: 'managed', path: null })
    expect(await w.bodies(g.id)).toContain('小王的 Claude 加入 · 等待 王磊 绑定工作区')
    const late = Promise.race([d.next(), new Promise((r) => setTimeout(() => r('quiet'), 300))])
    expect(await late).toBe('quiet')
  })
})

describe('joining a repo group', () => {
  it('clones the managed workspace on join, ignoring the default workspace', async () => {
    const w = await world()
    await t.db.update(bots).set({ defaultWorkspace: '/src/pay' }).where(eq(bots.id, w.bot.id))
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    const req = await d.next()
    const repo = await w.repoOf(g.id)
    expect(req).toMatchObject({
      t: 'workspace.ensure',
      groupId: g.id,
      botId: w.bot.id,
      repo: { id: repo.id, url: w.repo.url, branch: 'main' },
    })
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'cloning', workspace: 'managed' })
    expect(await w.bodies(g.id)).toContain('小王的 Claude 加入 · 使用托管工作区，等待本机克隆…')
    d.send(reply(req, { state: 'cloning', git: null, path: null }))
    d.send(reply(req))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    expect(await w.stateOf(g.id)).toEqual({
      botId: w.bot.id,
      workspace: 'managed',
      state: 'ready',
      path: `/h/workspaces/${g.id}/${w.bot.id}/${repo.id}`,
      git,
      error: null,
      reason: null,
      tier: null,
      model: null,
      effort: null,
      context: null,
    })
    await until(async () => (await w.bodies(g.id)).includes('小王的 Claude · daemon 已 clone 到托管工作区'))
  })

  it('waits for an offline daemon and clones once it comes online', async () => {
    const w = await world()
    const g = await w.createGroup()
    expect(await w.bodies(g.id)).toContain('小王的 Claude 加入 · daemon 离线，上线后克隆托管工作区')
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'pending', workspace: 'managed' })
    const d = await daemon(w.a.token)
    d.send(reply(await joinEnsure(d, g.id)))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
  })

  it('passes a confirmed binding outside the group repo on to the daemon', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    await joinEnsure(d, g.id)
    const url = `/api/groups/${g.id}/bots/${w.bot.id}/workspace`
    expect((await w.asAlice.put(url, { path: '/src/other' })).status).toBe(204)
    expect(await d.next()).toMatchObject({ t: 'workspace.cd', path: '/src/other', force: false })
    expect((await w.asAlice.put(url, { path: '/src/other', force: true })).status).toBe(204)
    expect(await d.next()).toMatchObject({ t: 'workspace.cd', path: '/src/other', force: true })
  })

  it('only lets the bot owner bind, and only while the machine is online', async () => {
    const w = await world()
    const g = await w.createGroup()
    await w.asAlice.post(`/api/groups/${g.id}/members`, { userId: w.bob.id })
    const url = `/api/groups/${g.id}/bots/${w.bot.id}/workspace`
    expect((await w.asBob.put(url, { path: '/src/x' })).status).toBe(403)
    expect((await w.asAlice.put(url, { path: 'relative' })).status).toBe(400)
    const offline = await w.asAlice.put<{ message: string }>(url, { path: '/src/x' })
    expect([offline.status, offline.body.message]).toEqual([409, '小王的 Claude 离线，无法绑定工作区'])
  })
})

describe('default workspace', () => {
  const setDefault = (w: Awaited<ReturnType<typeof world>>, path: string) =>
    t.db.update(bots).set({ defaultWorkspace: path }).where(eq(bots.id, w.bot.id))

  it('binds a repo-less group to the default directory on join', async () => {
    const w = await world()
    await setDefault(w, '/src/notes')
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ repo: false })
    const req = await d.next()
    expect(req).toMatchObject({ t: 'workspace.cd', groupId: g.id, repo: null, path: '/src/notes' })
    d.send(reply(req, { path: '/src/notes', git: null }))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    expect(await w.stateOf(g.id)).toMatchObject({ workspace: 'cd', path: '/src/notes' })
    await until(async () =>
      (await w.bodies(g.id)).includes('小王的 Claude 加入 · 使用默认工作区 /src/notes（主人可改绑）'),
    )
  })

  it('waits for the owner when the default directory is refused', async () => {
    const w = await world()
    await setDefault(w, '/src/gone')
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ repo: false })
    const req = await d.next()
    expect(req).toMatchObject({ t: 'workspace.cd', path: '/src/gone', repo: null })
    d.send(reply(req, { state: 'failed', path: null, git: null, error: '目录不存在' }))
    await until(async () => (await w.stateOf(g.id)).state === 'unbound')
    expect(await w.stateOf(g.id)).toMatchObject({ workspace: 'managed', error: '目录不存在' })
    await until(async () =>
      (await w.bodies(g.id)).includes('小王的 Claude 默认工作区不可用：目录不存在，等待 王磊 绑定工作区'),
    )
  })

  it('waits for an offline daemon and binds the default once it comes online, not again after', async () => {
    const w = await world()
    await setDefault(w, '/src/notes')
    const g = await w.createGroup({ repo: false })
    expect(await w.bodies(g.id)).toContain('小王的 Claude 加入 · daemon 离线，上线后使用默认工作区')
    expect((await w.stateOf(g.id)).state).toBe('pending')

    const d = await daemon(w.a.token)
    const req = await d.next()
    expect(req).toMatchObject({ t: 'workspace.cd', path: '/src/notes' })
    d.send(reply(req, { path: '/src/notes', git: null }))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    await d.close()

    const again = await daemon(w.a.token)
    again.send({ t: 'heartbeat' })
    const late = Promise.race([again.next(), new Promise((r) => setTimeout(() => r('quiet'), 300))])
    expect(await late).toBe('quiet')
  })
})

describe('provisioning', () => {
  it('reports clone failures once, retries when the owner reconnects', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    d.send(reply(await joinEnsure(d, g.id), { state: 'failed', git: null, error: 'Permission denied' }))
    await until(async () => (await w.stateOf(g.id)).error === 'Permission denied')
    await d.close()

    const again = await daemon(w.a.token)
    const retry = await again.next()
    expect(retry).toMatchObject({ t: 'workspace.ensure', botId: w.bot.id })
    again.send(reply(retry, { state: 'failed', git: null, error: 'Permission denied' }))
    await until(async () => (await w.stateOf(g.id)).state === 'failed')
    expect((await w.bodies(g.id)).filter((b) => b.includes('Permission denied'))).toEqual([
      '小王的 Claude 工作区创建失败：Permission denied',
    ])
  })

  it('ignores states from machines that do not own the bot and stale or unknown requests', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const intruder = await daemon(w.b.token)
    const g = await w.createGroup()
    const req = await joinEnsure(d, g.id)
    intruder.send(reply(req))
    d.send(reply(req, { requestId: 'unknown' }))
    await new Promise((r) => setTimeout(r, 200))
    expect((await w.stateOf(g.id)).state).toBe('cloning')
  })
})

describe('rebinding the repo', () => {
  it('only admins may change it; unbinding is not allowed', async () => {
    const w = await world()
    const g = await w.createGroup()
    await w.asAlice.post(`/api/groups/${g.id}/members`, { userId: w.bob.id })
    expect((await w.asBob.patch(`/api/groups/${g.id}/repo`, { url: w.repo.url, branch: 'dev' })).status).toBe(
      403,
    )
    expect((await w.asAlice.patch(`/api/groups/${g.id}/repo`, { url: '', branch: 'main' })).status).toBe(400)
    expect(
      (await w.asAlice.patch(`/api/groups/${g.id}/repo`, { url: 'ftp://x', branch: 'main' })).status,
    ).toBe(400)
  })

  it('replaces the repo and re-clones every bot, dropping stale replies', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    const first = await joinEnsure(d, g.id)
    d.send(reply(first))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    await updateCd(g.id, w.bot.id)
    const old = await w.repoOf(g.id)

    const other = bareRepo()
    const res = await w.asAlice.patch<GroupDto>(`/api/groups/${g.id}/repo`, {
      url: other.url,
      branch: 'main',
    })
    expect(res.status).toBe(200)
    expect(res.body.repo).toEqual({ url: other.url, branch: 'main' })
    const now = await w.repoOf(g.id)
    expect(now.id).not.toBe(old.id)
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'cloning', workspace: 'managed', git: null })
    const [row] = await t.db.select().from(groupBots).where(eq(groupBots.groupId, g.id))
    expect(row).toMatchObject({ cdPath: null, sessionId: null })

    const rebuild = await joinEnsure(d, g.id)
    expect(rebuild).toMatchObject({ repo: { id: now.id, url: other.url } })
    d.send(reply(first))
    await new Promise((r) => setTimeout(r, 200))
    expect((await w.stateOf(g.id)).state).toBe('cloning')
    d.send(reply(rebuild))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    expect(await w.bodies(g.id)).toContain(`群更换仓库 ${other.url} · 基准分支 main · 各 Bot 重建托管工作区`)
  })

  it('binds a repo to a repo-less group, moving bots off their default workspace to a managed clone', async () => {
    const w = await world()
    await t.db.update(bots).set({ defaultWorkspace: '/src/pay' }).where(eq(bots.id, w.bot.id))
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ repo: false })
    d.send(reply(await d.next(), { path: '/src/pay', git: null }))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    await w.asAlice.patch(`/api/groups/${g.id}/repo`, { url: w.repo.url, branch: 'main' })
    expect(await joinEnsure(d, g.id)).toMatchObject({ repo: { url: w.repo.url } })
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'cloning', workspace: 'managed' })
    expect(await w.bodies(g.id)).toContain(`群绑定仓库 ${w.repo.url} · 基准分支 main · 分区模式`)
  })
})

async function updateCd(groupId: string, botId: string) {
  await t.db
    .update(groupBots)
    .set({ workspaceKind: 'cd', cdPath: '/elsewhere', sessionId: 's1' })
    .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
}

describe('/cd requests', () => {
  it('binds to a validated directory, keeps the workspace on refusal, and goes back to managed', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    d.send(reply(await joinEnsure(d, g.id)))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    const repo = await w.repoOf(g.id)
    const said = (text: string) => until(async () => (await w.bodies(g.id)).includes(text))

    expect(await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: '/tmp/foreign' })).toBe(true)
    const badReq = await d.next()
    expect(badReq).toMatchObject({
      t: 'workspace.cd',
      path: '/tmp/foreign',
      repo: { id: repo.id, url: w.repo.url, branch: 'main' },
    })
    d.send(reply(badReq, { state: 'failed', path: null, git: null, error: 'remote 与群仓库不一致（x）' }))
    await said('小王的 Claude 绑定工作区失败：remote 与群仓库不一致（x）')
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'ready', workspace: 'managed', error: null })

    await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: '/src/clone' })
    d.send(reply(await d.next(), { path: '/src/clone', git: { ...git, workspace: 'cd' } }))
    await said('✓ 小王的 Claude 已绑定到 /src/clone（本机目录）')
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'ready', workspace: 'cd' })
    const [row] = await t.db.select().from(groupBots).where(eq(groupBots.groupId, g.id))
    expect(row).toMatchObject({ cdPath: '/src/clone', workspacePath: '/src/clone' })

    await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: null })
    const backReq = await d.next()
    expect(backReq).toMatchObject({ t: 'workspace.cd', path: null })
    d.send(reply(backReq, { state: 'cloning', path: null, git: null }))
    d.send(reply(backReq))
    const managed = async () => (await w.bodies(g.id)).filter((b) => b === '✓ 小王的 Claude 已使用托管工作区')
    await until(async () => (await managed()).length === 1)
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'ready', workspace: 'managed' })
  })

  it('returns false when the owner is offline; repo-less groups send no repo', async () => {
    const w = await world()
    const g = await w.createGroup()
    expect(await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: '/x' })).toBe(false)
    const d = await daemon(w.a.token)
    await joinEnsure(d, g.id)
    const plain = await w.createGroup({ repo: false })
    expect(await requestCd(t.ctx, { groupId: plain.id, botId: w.bot.id, path: '/x' })).toBe(true)
    expect(await d.next()).toMatchObject({ t: 'workspace.cd', repo: null, path: '/x' })
  })
})

describe('scheduling', () => {
  it('holds runs of a repo group until the workspace is ready', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    const req = await joinEnsure(d, g.id)
    d.send(reply(req, { state: 'cloning', git: null, path: null }))
    await until(async () => (await w.stateOf(g.id)).state === 'cloning')
    const seen: WebEvent[] = []
    t.ctx.bus.attach(w.alice.id, (e) => seen.push(e))
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: g.id,
        kind: 'user',
        authorUserId: w.alice.id,
        body: '@bot hi',
        meta: { mentions: [w.bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const [queued] = await t.db.select().from(runs).where(eq(runs.groupId, g.id))
    expect(queued).toMatchObject({ status: 'queued', step: '工作区准备中' })

    d.send(reply(req))
    const start = await d.next()
    expect(start).toMatchObject({ t: 'run.start', runId: queued!.id })
    await until(() => seen.some((e) => e.t === 'run.updated' && e.run.status === 'running'))
  })

  it('does not run an unbound bot and reminds its owner instead, without replay after binding', async () => {
    const w = await world()
    const g = await w.createGroup({ repo: false })
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: g.id,
        kind: 'user',
        authorUserId: w.alice.id,
        body: '@bot hi',
        meta: { mentions: [w.bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    expect(await t.db.select().from(runs).where(eq(runs.groupId, g.id))).toEqual([])
    expect(await w.bodies(g.id)).toContain(
      '小王的 Claude 还没有工作区，本次未执行；王磊 绑定工作区后重新发起即可',
    )
  })
})

describe('directory picker and default workspace', () => {
  const dirResult = (req: Msg, o: Record<string, unknown> = {}) => ({
    t: 'dir.result',
    requestId: req.requestId,
    path: req.path ?? '/Users/w',
    entries: [{ name: 'pay', git: true }],
    git: null,
    unusable: null,
    roots: ['/'],
    error: null,
    ...o,
  })

  it("lists a machine's directories for its owner only", async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const dirs = `/api/machines/${w.a.machine.id}/dirs`
    const pending = w.asAlice.get<DirListingDto>(`${dirs}?path=${encodeURIComponent('/src')}`)
    const req = await d.next()
    expect(req).toMatchObject({ t: 'dir.list', path: '/src' })
    d.send(dirResult(req))
    expect((await pending).body).toEqual({
      path: '/src',
      entries: [{ name: 'pay', git: true }],
      git: null,
      unusable: null,
      roots: ['/'],
    })

    const home = w.asAlice.get<DirListingDto>(dirs)
    const homeReq = await d.next()
    expect(homeReq).toMatchObject({ t: 'dir.list', path: null })
    d.send(dirResult(homeReq, { error: '目录不存在' }))
    expect(await home).toMatchObject({ status: 400, body: { message: '目录不存在' } })

    expect((await w.asBob.get(dirs)).status).toBe(403)
    const offline = await w.asBob.get<{ message: string }>(`/api/machines/${w.b.machine.id}/dirs`)
    expect([offline.status, offline.body.message]).toEqual([409, `${w.b.machine.name} 离线，无法浏览目录`])
  })

  it('stores the default workspace only after the daemon accepts it', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const url = `/api/bots/${w.bot.id}/default-workspace`

    const bad = w.asAlice.put(url, { path: '/' })
    d.send(dirResult(await d.next(), { path: '/', unusable: '目录范围过大，请选择具体的项目目录' }))
    expect(await bad).toMatchObject({ status: 400, body: { message: '目录范围过大，请选择具体的项目目录' } })

    const ok = w.asAlice.put<BotDto>(url, { path: '/src/pay' })
    d.send(dirResult(await d.next()))
    expect((await ok).body.defaultWorkspace).toBe('/src/pay')

    expect((await w.asAlice.put<BotDto>(url, { path: null })).body.defaultWorkspace).toBeNull()
    expect((await w.asBob.put(url, { path: '/src' })).status).toBe(403)
  })
})
