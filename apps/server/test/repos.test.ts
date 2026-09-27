import {
  type GroupBotStateDto,
  type GroupDto,
  type NotificationDto,
  PROTOCOL_VERSION,
  type RepoDto,
  type RepoProbeRes,
  type TimelineDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groupRepos, notifications, runs } from '../src/db/schema.js'
import { backfillRepos } from '../src/modules/repos/service.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

type Msg = Record<string, unknown> & { t: string; requestId: string; groupId?: string; botId?: string }

async function until(check: () => Promise<boolean> | boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
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
  return { send: (m: unknown) => ws.send(JSON.stringify(m)), next: () => box.next<Msg>() }
}

const URL = 'ssh://git@git.corp:2222/team/Pay.git'
const probeOk = (req: Msg, o: Record<string, unknown> = {}) => ({
  t: 'repo.probe.result',
  requestId: req.requestId,
  ok: true,
  reason: null,
  usedUrl: 'https://git.corp/team/Pay.git',
  defaultBranch: 'main',
  branches: ['dev', 'main'],
  detail: null,
  ...o,
})

async function world() {
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })
  const a = await t.seed.machine(alice.id)
  const b = await t.seed.machine(bob.id)
  const claude = await t.seed.bot({ ownerId: alice.id, name: '小王的 Claude', machineId: a.machine.id })
  const codex = await t.seed.bot({ ownerId: alice.id, name: '小王的 Codex', machineId: a.machine.id })
  const bobBot = await t.seed.bot({ ownerId: bob.id, name: '陈晨的 Codex', machineId: b.machine.id })
  const asAlice = client(t, await t.seed.cookie(alice.id))
  const asBob = client(t, await t.seed.cookie(bob.id))
  const createGroup = async (o: { url?: string; branch?: string; botIds?: string[] } = {}) =>
    asAlice.post<GroupDto>('/api/groups', {
      name: '支付',
      kind: 'group',
      memberIds: [bob.id],
      botIds: o.botIds ?? [],
      repo: { url: o.url ?? URL, branch: o.branch ?? 'main' },
    })
  return { alice, bob, a, b, claude, codex, bobBot, asAlice, asBob, createGroup }
}

describe('POST /api/repos/probe', () => {
  it('asks each machine once per owner protocol and reports offline machines without asking', async () => {
    const w = await world()
    await w.asAlice.patch('/api/me', { gitProtocol: 'https' })
    const d = await daemon(w.a.token)
    const pending = w.asAlice.post<RepoProbeRes>('/api/repos/probe', {
      url: URL,
      branch: 'main',
      botIds: [w.claude.id, w.codex.id, w.bobBot.id],
    })
    const req = await d.next()
    expect(req).toMatchObject({ t: 'repo.probe', url: URL, branch: 'main', protocol: 'https' })
    d.send(probeOk(req))
    const res = (await pending).body
    expect(res.defaultBranch).toBe('main')
    expect(res.branches).toEqual(['dev', 'main'])
    expect(res.results).toEqual(
      expect.arrayContaining([
        {
          botId: w.claude.id,
          ok: true,
          reason: null,
          usedUrl: 'https://git.corp/team/Pay.git',
          detail: null,
        },
        { botId: w.codex.id, ok: true, reason: null, usedUrl: 'https://git.corp/team/Pay.git', detail: null },
        { botId: w.bobBot.id, ok: false, reason: 'offline', usedUrl: null, detail: null },
      ]),
    )
    const quiet = Promise.race([d.next(), new Promise((r) => setTimeout(() => r('quiet'), 200))])
    expect(await quiet).toBe('quiet')
  })

  it('uses the caller’s own bots when none are given, and rejects malformed addresses', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const pending = w.asAlice.post<RepoProbeRes>('/api/repos/probe', { url: URL, branch: '' })
    const req = await d.next()
    expect(req).toMatchObject({ branch: 'main', protocol: 'auto' })
    d.send(probeOk(req))
    expect((await pending).body.results.map((r) => r.botId).sort()).toEqual([w.claude.id, w.codex.id].sort())
    expect((await w.asAlice.post('/api/repos/probe', { url: 'ftp://x', branch: 'main' })).status).toBe(400)
    expect(
      (await w.asAlice.post('/api/repos/probe', { url: URL, branch: 'main', botIds: ['x'] })).status,
    ).toBe(404)
  })

  it('blocks binding a branch the repo was just found to lack, but not unreachable bots', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const pending = w.asAlice.post<RepoProbeRes>('/api/repos/probe', { url: URL, branch: 'nope' })
    const req = await d.next()
    d.send(probeOk(req, { ok: false, reason: 'branch_missing', detail: '分支 nope 不存在' }))
    expect((await pending).body.results[0]).toMatchObject({ ok: false, reason: 'branch_missing' })
    const blocked = await w.createGroup({ branch: 'nope' })
    expect(blocked.status).toBe(400)
    expect(blocked.body).toMatchObject({ message: '分支 nope 不存在，换一个基准分支' })
    expect((await w.createGroup({ branch: 'main' })).status).toBe(200)
  })
})

describe('repo history', () => {
  it('records bound repos team-wide without credentials, the caller’s first', async () => {
    const w = await world()
    await w.createGroup({ url: 'https://oauth2:s3cret@git.corp/team/Pay.git' })
    await w.asBob.post('/api/groups', {
      name: '官网',
      kind: 'group',
      repo: { url: 'git@github.com:acme/Site.git', branch: 'master' },
    })
    const mine = (await w.asAlice.get<RepoDto[]>('/api/repos')).body
    expect(mine.map((r) => [r.key, r.mine])).toEqual([
      ['git.corp/team/pay', true],
      ['github.com/acme/site', false],
    ])
    expect(mine[0]).toMatchObject({
      url: 'https://git.corp/team/Pay.git',
      name: 'Pay',
      lastBranch: 'main',
      groups: 1,
    })
    const timeline = (
      await w.asAlice.get<TimelineDto>(
        `/api/groups/${(await w.asAlice.get<GroupDto[]>('/api/groups')).body[0]!.id}/timeline`,
      )
    ).body
    expect(timeline.messages.map((m) => m.body).join('\n')).not.toContain('s3cret')

    // Same repo over ssh on another port: one entry.
    await w.createGroup({ url: URL })
    const again = (await w.asAlice.get<RepoDto[]>('/api/repos?q=pay')).body
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ groups: 2, url: URL })
    expect((await w.asAlice.get<RepoDto[]>('/api/repos?q=site')).body.map((r) => r.name)).toEqual(['Site'])
  })

  it('lets only sysadmins or the sole user hide a repo; using it again brings it back', async () => {
    const w = await world()
    await w.createGroup()
    const [repo] = (await w.asAlice.get<RepoDto[]>('/api/repos')).body
    expect((await w.asBob.del(`/api/repos/${repo!.id}`)).status).toBe(403)
    expect((await w.asAlice.del(`/api/repos/${repo!.id}`)).status).toBe(204)
    expect((await w.asAlice.get<RepoDto[]>('/api/repos')).body).toEqual([])
    await w.createGroup()
    expect((await w.asAlice.get<RepoDto[]>('/api/repos')).body).toHaveLength(1)
  })

  it('backfills repos of groups bound before the history existed', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.alice.id })
    await t.db
      .insert(groupRepos)
      .values({ groupId: g.id, url: 'git@git.corp:ops/infra.git', baseBranch: 'main' })
    await backfillRepos(t.ctx)
    await backfillRepos(t.ctx)
    expect((await w.asAlice.get<RepoDto[]>('/api/repos')).body.map((r) => [r.key, r.mine])).toEqual([
      ['git.corp/ops/infra', false],
    ])
  })

  it('remembers where a /cd directory holds the repo and suggests it to its owner only', async () => {
    const w = await world()
    const d = await daemon(w.a.token)
    const g = (await w.createGroup({ botIds: [w.claude.id] })).body
    await w.asAlice.put(`/api/groups/${g.id}/bots/${w.claude.id}/workspace`, { path: '/Users/w/code/pay' })
    const req = await d.next()
    expect(req).toMatchObject({ t: 'workspace.cd', path: '/Users/w/code/pay', repo: { protocol: 'auto' } })
    d.send({
      t: 'workspace.state',
      groupId: g.id,
      botId: w.claude.id,
      requestId: req.requestId,
      state: 'ready',
      path: '/Users/w/code/pay',
      git: null,
      error: null,
      remotes: ['https://git.corp/team/pay'],
    })
    const paths = async (as: typeof w.asAlice) => (await as.get(`/api/groups/${g.id}/local-paths`)).body
    await until(async () => JSON.stringify(await paths(w.asAlice)) !== '[]')
    expect(await paths(w.asAlice)).toEqual([{ machineId: w.a.machine.id, path: '/Users/w/code/pay' }])
    expect(await paths(w.asBob)).toEqual([])
    const [repo] = (await w.asAlice.get<RepoDto[]>('/api/repos')).body
    expect(repo!.localPaths).toEqual([{ machineId: w.a.machine.id, path: '/Users/w/code/pay' }])
  })
})

async function pausedWorld() {
  const w = await world()
  const d = await daemon(w.a.token)
  const g = (await w.createGroup({ botIds: [w.claude.id] })).body
  await w.asAlice.put(`/api/groups/${g.id}/bots/${w.claude.id}/workspace`, { path: null })
  const req = await d.next()
  d.send({
    t: 'workspace.state',
    groupId: g.id,
    botId: w.claude.id,
    requestId: req.requestId,
    state: 'failed',
    path: null,
    git: null,
    error: 'clone 失败：Repository not found.',
    reason: 'denied',
  })
  const state = async () =>
    (await w.asAlice.get<GroupBotStateDto[]>(`/api/groups/${g.id}/bot-states`)).body[0]!
  await until(async () => (await state()).state === 'failed')
  return { ...w, d, g, state }
}

describe('bots whose machine cannot reach the repo', () => {
  const paused = pausedWorld

  it('are paused with the reason, not run when @-ed, and their owner is told once', async () => {
    const w = await paused()
    expect(await w.state()).toMatchObject({ state: 'failed', reason: 'denied' })
    expect(
      (
        await w.asBob.post(`/api/groups/${w.g.id}/messages`, {
          body: '@小王的 Claude 看下',
          clientId: 'client-01',
        })
      ).status,
    ).toBe(200)
    const bodies = async () =>
      (await w.asBob.get<TimelineDto>(`/api/groups/${w.g.id}/timeline`)).body.messages.map((m) => m.body)
    await until(async () => (await bodies()).some((b) => b.includes('无法访问仓库')))
    expect(await bodies()).toContain(
      '小王的 Claude 所在机器无法访问仓库（无权限或仓库不存在），本次未执行；王磊 配置后点「重新检查」',
    )
    expect(await t.db.select().from(runs)).toEqual([])
    const sent = await t.db.select().from(notifications).where(eq(notifications.userId, w.alice.id))
    expect(sent.map((n) => [n.type, (n.payload as NotificationDto['payload']).repo])).toEqual([
      ['repo_access', URL],
    ])
  })

  it('recheck clones again with the owner protocol; owner or admin only', async () => {
    const w = await paused()
    const carol = await t.seed.user({ name: '赵六' })
    await t.seed.group({ createdBy: carol.id })
    expect((await w.asBob.post(`/api/groups/${w.g.id}/bots/${w.claude.id}/recheck`)).status).toBe(403)
    await w.asAlice.patch('/api/me', { gitProtocol: 'ssh' })
    expect((await w.asAlice.post(`/api/groups/${w.g.id}/bots/${w.claude.id}/recheck`)).status).toBe(204)
    const req = await w.d.next()
    expect(req).toMatchObject({ t: 'workspace.ensure', repo: { url: URL, protocol: 'ssh' } })
    w.d.send({
      t: 'workspace.state',
      groupId: w.g.id,
      botId: w.claude.id,
      requestId: req.requestId,
      state: 'ready',
      path: '/h/x',
      git: null,
      error: null,
    })
    await until(async () => (await w.state()).state === 'ready')
    expect(await w.state()).toMatchObject({ reason: null, error: null })
  })
})

describe('rechecking a paused bot', () => {
  it('announces a failure that repeats on recheck only once', async () => {
    const w = await pausedWorld()
    expect((await w.asAlice.post(`/api/groups/${w.g.id}/bots/${w.claude.id}/recheck`)).status).toBe(204)
    const req = await w.d.next()
    const state = { t: 'workspace.state', groupId: w.g.id, botId: w.claude.id, requestId: req.requestId }
    w.d.send({ ...state, state: 'cloning', path: null, git: null, error: null })
    w.d.send({
      ...state,
      state: 'failed',
      path: null,
      git: null,
      error: 'clone 失败：Repository not found.',
      reason: 'denied',
    })
    await until(async () => (await w.state()).state === 'failed')
    const sent = await t.db.select().from(notifications).where(eq(notifications.userId, w.alice.id))
    expect(sent).toHaveLength(1)
  })

  it('is refused for bots that are not paused', async () => {
    const w = await pausedWorld()
    await t.db.update(groupBots).set({ workspaceState: 'ready', workspaceReason: null })
    const res = await w.asAlice.post(`/api/groups/${w.g.id}/bots/${w.claude.id}/recheck`)
    expect(res.status).toBe(409)
  })
})

describe('PATCH /api/me', () => {
  it('stores the git protocol preference', async () => {
    const w = await world()
    expect((await w.asAlice.patch('/api/me', { gitProtocol: 'https' })).body).toMatchObject({
      gitProtocol: 'https',
    })
    expect((await w.asAlice.get('/api/me')).body).toMatchObject({ gitProtocol: 'https' })
    expect((await w.asAlice.patch('/api/me', { gitProtocol: 'ftp' })).status).toBe(400)
  })
})
