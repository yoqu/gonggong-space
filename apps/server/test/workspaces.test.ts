import {
  type GroupBotStateDto,
  type GroupDto,
  PROTOCOL_VERSION,
  type TimelineDto,
  type ValidateRepoRes,
  type WebEvent,
} from '@aiws/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groupRepos, messages, runs } from '../src/db/schema.js'
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

type Msg = Record<string, unknown> & { t: string; requestId?: string; repo?: { id: string; url: string } }

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

describe('validate-repo', () => {
  it('checks reachability and branch with git ls-remote', async () => {
    const w = await world()
    const check = async (url: string, branch: string) =>
      (await w.asAlice.post<ValidateRepoRes>('/api/groups/validate-repo', { url, branch })).body
    expect(await check(w.repo.url, 'main')).toEqual({
      ok: true,
      message: `仓库可访问 · 分支 main 存在 · 最新提交 ${w.repo.head}`,
    })
    expect(await check(w.repo.url, 'dev')).toEqual({ ok: false, message: '仓库可访问，但分支 dev 不存在' })
    expect(await check('file:///nonexistent/aiws.git', 'main')).toEqual({
      ok: false,
      message: '无法访问该仓库，检查地址与权限',
    })
    expect((await check('ftp://x', 'main')).ok).toBe(false)
    expect((await check(w.repo.url, '-x')).ok).toBe(false)
  })
})

describe('provisioning', () => {
  it('asks the online daemon to clone on group creation and reports the result', async () => {
    const w = await world()
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
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'cloning', error: null })

    d.send(reply(req, { state: 'cloning', git: null, path: null }))
    d.send(reply(req))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    expect(await w.stateOf(g.id)).toEqual({
      botId: w.bot.id,
      workspace: 'managed',
      state: 'ready',
      git,
      error: null,
    })
    const [row] = await t.db.select().from(groupBots).where(eq(groupBots.groupId, g.id))
    expect(row!.workspacePath).toBe(`/h/workspaces/${g.id}/${w.bot.id}/${repo.id}`)
    await until(async () =>
      (await w.bodies(g.id)).includes('小王的 Claude 加入 · daemon 已 clone 到托管工作区'),
    )
    expect((await w.bodies(g.id)).filter((b) => b.startsWith('小王的 Claude'))).toHaveLength(1)
  })

  it('reports clone failures once, retries when the owner reconnects', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    d.send(reply(await d.next(), { state: 'failed', git: null, error: 'Permission denied' }))
    await until(async () => (await w.stateOf(g.id)).state === 'failed')
    expect((await w.stateOf(g.id)).error).toBe('Permission denied')
    await d.close()

    const again = await daemon(w.a.token)
    const retry = await again.next()
    expect(retry).toMatchObject({ t: 'workspace.ensure', botId: w.bot.id })
    again.send(reply(retry, { state: 'failed', git: null, error: 'Permission denied' }))
    await until(async () => (await w.stateOf(g.id)).state === 'failed')
    expect((await w.bodies(g.id)).filter((b) => b.includes('工作区创建失败'))).toEqual([
      '小王的 Claude 工作区创建失败：Permission denied',
    ])
  })

  it('waits for an offline daemon, clones once it comes online, and not again after', async () => {
    const w = await world()
    const g = await w.createGroup()
    expect(await w.bodies(g.id)).toContain('小王的 Claude 加入 · daemon 离线，上线后创建工作区')
    expect((await w.stateOf(g.id)).state).toBe('pending')

    const d = await daemon(w.a.token)
    const req = await d.next()
    expect(req).toMatchObject({ t: 'workspace.ensure', groupId: g.id, botId: w.bot.id })
    d.send(reply(req))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    await until(async () => (await w.bodies(g.id)).includes('小王的 Claude · daemon 已 clone 到托管工作区'))
    await d.close()

    const again = await daemon(w.a.token)
    again.send({ t: 'heartbeat' })
    const late = Promise.race([again.next(), new Promise((r) => setTimeout(() => r('quiet'), 300))])
    expect(await late).toBe('quiet')
  })

  it('makes repo-less workspaces ready without asking the daemon', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ repo: false })
    expect((await w.stateOf(g.id)).state).toBe('ready')
    const late = Promise.race([d.next(), new Promise((r) => setTimeout(() => r('quiet'), 300))])
    expect(await late).toBe('quiet')
  })

  it('ensures a bot added later', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ botIds: [] })
    await w.asAlice.post(`/api/groups/${g.id}/bots`, { botId: w.bot.id })
    expect(await d.next()).toMatchObject({ t: 'workspace.ensure', groupId: g.id, botId: w.bot.id })
  })

  it('ignores states from machines that do not own the bot and stale or unknown requests', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const intruder = await daemon(w.b.token)
    const g = await w.createGroup()
    const req = await d.next()
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

  it('replaces the repo and rebuilds every bot workspace, dropping stale replies', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    const first = await d.next()
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
    const rebuild = await d.next()
    expect(rebuild).toMatchObject({ t: 'workspace.ensure', repo: { id: now.id, url: other.url } })
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'cloning', workspace: 'managed', git: null })
    const [row] = await t.db.select().from(groupBots).where(eq(groupBots.groupId, g.id))
    expect(row).toMatchObject({ cdPath: null, sessionId: null })

    d.send(reply(first))
    await new Promise((r) => setTimeout(r, 200))
    expect((await w.stateOf(g.id)).state).toBe('cloning')
    d.send(reply(rebuild))
    await until(async () => (await w.stateOf(g.id)).state === 'ready')
    expect(await w.bodies(g.id)).toContain(
      `群更换仓库 ${other.url} · 基准分支 main · 重建所有 bot 的托管工作区`,
    )
  })

  it('binds a repo to a repo-less group', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup({ repo: false })
    await w.asAlice.patch(`/api/groups/${g.id}/repo`, { url: w.repo.url, branch: 'main' })
    expect(await d.next()).toMatchObject({ t: 'workspace.ensure', repo: { url: w.repo.url } })
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
    d.send(reply(await d.next()))
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
    await said('小王的 Claude /cd 失败：remote 与群仓库不一致（x）')
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'ready', workspace: 'managed', error: null })

    await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: '/src/clone' })
    d.send(reply(await d.next(), { path: '/src/clone', git: { ...git, workspace: 'cd' } }))
    await said('✓ 小王的 Claude 已绑定到 /src/clone（/cd 绑定）')
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'ready', workspace: 'cd' })
    const [row] = await t.db.select().from(groupBots).where(eq(groupBots.groupId, g.id))
    expect(row).toMatchObject({ cdPath: '/src/clone', workspacePath: '/src/clone' })

    await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: null })
    const backReq = await d.next()
    expect(backReq).toMatchObject({ t: 'workspace.cd', path: null })
    d.send(reply(backReq, { state: 'cloning', path: null, git: null }))
    d.send(reply(backReq))
    await said('✓ 小王的 Claude 已恢复托管工作区')
    expect(await w.stateOf(g.id)).toMatchObject({ state: 'ready', workspace: 'managed' })
    expect((await w.bodies(g.id)).filter((b) => b.includes('/cd') || b.includes('恢复托管'))).toHaveLength(3)
  })

  it('returns false when the owner is offline or the group has no repo', async () => {
    const w = await world()
    const g = await w.createGroup()
    expect(await requestCd(t.ctx, { groupId: g.id, botId: w.bot.id, path: '/x' })).toBe(false)
    await daemon(w.a.token)
    const plain = await w.createGroup({ repo: false })
    expect(await requestCd(t.ctx, { groupId: plain.id, botId: w.bot.id, path: '/x' })).toBe(false)
  })
})

describe('scheduling', () => {
  it('holds runs of a repo group until the workspace is ready', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = await w.createGroup()
    const req = await d.next()
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
})
