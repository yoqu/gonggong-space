import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DaemonToServer,
  RunDto,
  RunStart,
  ServerToDaemon,
  SyncPreviewDto,
  SyncStatusDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import {
  groupBots,
  groupMembers,
  groupRepos,
  groups,
  messages,
  runs,
  syncReplicas,
  syncVersions,
} from '../src/db/schema.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { blobPath, purgeSyncBlobs } from '../src/modules/sync/blobs.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'
import { change, sha, syncWorld } from './support/sync.js'

type Init = Extract<ServerToDaemon, { t: 'sync.init' }>
type K = 'A' | 'B'

let t: TestApp
let w: Awaited<ReturnType<typeof syncWorld>>
let repoId: string
let sent: Record<K, ServerToDaemon[]>
let conns: Record<K, DaemonConn>
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
/** syncWorld as a partition group with a repo, every managed clone ready, no replica joined. */
beforeEach(async () => {
  t = await createTestApp()
  w = await syncWorld(t)
  await t.db.delete(syncReplicas)
  await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
  const [repo] = await t.db
    .insert(groupRepos)
    .values({ groupId: w.g.id, url: 'git@github.com:acme/pay.git', baseBranch: 'main' })
    .returning()
  repoId = repo!.id
  await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, w.g.id))
  sent = { A: [], B: [] }
  conns = {
    A: { send: (m) => void sent.A.push(m), close() {} },
    B: { send: (m) => void sent.B.push(m), close() {} },
  }
})
afterEach(() => t.close())

const connect = (k: K) => t.ctx.hub.register(w[k].machine.id, conns[k], ['sync'])
const from = (k: K, m: Exclude<DaemonToServer, { t: 'hello' | 'heartbeat' }>) =>
  t.ctx.hub.emit('message', w[k].machine.id, m)
const inits = (k: K) => sent[k].filter((m): m is Init => m.t === 'sync.init')
const api = async (userId: string) => client(t, await t.seed.cookie(userId))
const url = (path = '') => `/api/groups/${w.g.id}/sync${path}`
const replica = async (botId: string) =>
  (await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, botId)))[0]
const group = async () => (await t.db.select().from(groups).where(eq(groups.id, w.g.id)))[0]!
const status = async () => (await (await api(w.wang.id)).get<SyncStatusDto>(url())).body
const events = async () =>
  (await t.db.select().from(messages).where(eq(messages.kind, 'event'))).map((m) => m.body)

async function submit(k: K, m: ReturnType<typeof w.msg>) {
  from(k, m)
  return vi.waitFor(() => {
    const r = sent[k].find((x) => x.t === 'sync.result' && x.submitId === m.submitId)
    if (r?.t !== 'sync.result') throw new Error('no result yet')
    return r.result
  })
}

const init = (botId: string, role: Init['role'], force = false): Init => ({
  t: 'sync.init',
  groupId: w.g.id,
  botId,
  role,
  force,
  repoId: role === 'leave' ? null : repoId,
})

/** Switches with `a` as the base and lets its daemon submit its tree as v1. */
async function switchOn() {
  connect('A')
  connect('B')
  expect((await (await api(w.wang.id)).post(url('/enable'), { baseBotId: w.a.id })).status).toBe(200)
  await vi.waitFor(() => expect(inits('A')).toEqual([init(w.a.id, 'base')]))
  const tree = [await change(w, 'a.txt', 'x')]
  expect(await submit('A', w.msg(w.a.id, tree, { kind: 'init' }))).toEqual({
    outcome: 'accepted',
    version: 1,
  })
  from('A', { t: 'sync.applied', groupId: w.g.id, botId: w.a.id, version: 1, rootHash: root1 })
}
const root1 = sha(`a.txt\0-\0${sha('x')}\n`)

/** A queued run of `botId`, dispatched if it can be. */
async function trigger(botId: string) {
  const [m] = await t.db
    .insert(messages)
    .values({ groupId: w.g.id, kind: 'user', authorUserId: w.wang.id, body: '@bot go' })
    .returning()
  const [run] = await t.db
    .insert(runs)
    .values({
      groupId: w.g.id,
      botId,
      triggerMessageId: m!.id,
      triggerUserId: w.wang.id,
      originUserId: w.wang.id,
      status: 'queued',
    })
    .returning()
  await schedule(t.ctx, botId)
  return run!.id
}
const runRow = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
const startOf = (k: K, runId: string) =>
  sent[k].find((m): m is RunStart => m.t === 'run.start' && m.runId === runId)

const done = (k: K, runId: string) =>
  from(k, {
    t: 'run.done',
    runId,
    outcome: 'completed',
    reply: '好了',
    filesChanged: 0,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
    sync: null,
  })

describe('switch to force: preconditions and preview', () => {
  it('needs a group admin, a bound repo and a ready managed base bot whose machine is online', async () => {
    connect('A')
    const li = await api(w.li.id)
    expect((await li.post(url('/enable'), { baseBotId: w.a.id })).status).toBe(403)
    const wang = await api(w.wang.id)
    const fails = async (botId: string) => {
      const res = await wang.post<{ message: string }>(url('/enable'), { baseBotId: botId })
      expect(res.status).toBe(400)
      return res.body.message
    }
    expect(await fails(w.b.id)).toBe('基准 Bot 所在机器离线')
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/tmp/x' })
      .where(eq(groupBots.botId, w.c.id))
    expect(await fails(w.c.id)).toBe('基准 Bot 使用本机目录，不能作为基准')
    await t.db.delete(groupRepos)
    expect(await fails(w.a.id)).toBe('群未绑定仓库，不能切换为强制同步')
    expect((await group()).mode).toBe('partition')
    expect(inits('A')).toEqual([])
  })

  it('previews each bot: aligns, sits out with a local directory or known uncommitted changes, aligns later offline', async () => {
    connect('A')
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/tmp/x' })
      .where(eq(groupBots.botId, w.c.id))
    await t.db
      .update(groupBots)
      .set({ gitStatus: { branch: 'main', ahead: 0, behind: 0, dirty: true, workspace: 'managed' } })
      .where(eq(groupBots.botId, w.a.id))
    const res = await (await api(w.li.id)).get<SyncPreviewDto>(url('/preview'))
    const byName = (b: { botName: string }, c: { botName: string }) => b.botName.localeCompare(c.botName)
    expect(res.body.bots.sort(byName)).toEqual(
      [
        {
          botId: w.a.id,
          botName: '小王的 Claude',
          machineName: 'wang-mac',
          plan: 'excluded',
          reason: 'dirty',
          canBase: true,
        },
        {
          botId: w.b.id,
          botName: '老李的 Codex',
          machineName: 'li-pc',
          plan: 'align',
          reason: 'offline',
          canBase: false,
        },
        {
          botId: w.c.id,
          botName: '小王的 Codex',
          machineName: 'wang-mac',
          plan: 'excluded',
          reason: 'cd',
          canBase: false,
        },
      ].sort(byName),
    )
  })
})

describe('switch to force: flow', () => {
  it('sends base to the base bot, then align to every other managed replica once v1 is in', async () => {
    connect('A')
    connect('B')
    await (await api(w.wang.id)).post(url('/enable'), { baseBotId: w.a.id })
    expect((await group()).mode).toBe('force')
    expect((await status()).switching).toBe(true)
    await vi.waitFor(() => expect(inits('A')).toEqual([init(w.a.id, 'base')]))
    expect(inits('B')).toEqual([])

    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await vi.waitFor(() => {
      expect(inits('B')).toEqual([init(w.b.id, 'align')])
      expect(inits('A')).toEqual([init(w.a.id, 'base'), init(w.c.id, 'align')])
    })
    expect((await replica(w.a.id))?.joinedAt).not.toBeNull()
    expect(await events()).toContain('王磊 将同步模式切换为强制同步，基准 Bot：小王的 Claude')
    const s = await status()
    expect(s.switching).toBe(false)
    expect(s.replicas.find((r) => r.botId === w.b.id)?.state).toBe('syncing')

    from('B', { t: 'sync.applied', groupId: w.g.id, botId: w.b.id, version: 1, rootHash: root1 })
    await vi.waitFor(async () => expect((await replica(w.b.id))?.joinedAt).not.toBeNull())
    expect((await replica(w.b.id))?.pending).toBeNull()
  })

  it('the base tree replaces the head of an earlier force period as the next version', async () => {
    await switchOn()
    await (await api(w.wang.id)).post(url('/disable'))
    await vi.waitFor(() => expect(inits('A').filter((m) => m.role === 'leave')).toHaveLength(2))
    sent.A.length = 0
    await (await api(w.wang.id)).post(url('/enable'), { baseBotId: w.a.id })
    await vi.waitFor(() => expect(inits('A')).toEqual([init(w.a.id, 'base')]))
    const tree = [await change(w, 'b.txt', 'y')]
    expect(await submit('A', w.msg(w.a.id, tree, { kind: 'init' }))).toEqual({
      outcome: 'accepted',
      version: 2,
    })
    const res = await t.app.inject({ url: `/api/daemon/sync/${w.g.id}/changes?from=0`, headers: w.auth() })
    expect(res.json().entries.map((e: { path: string }) => e.path)).toEqual(['b.txt'])
  })

  it('leaves a /cd bot out: no sync.init, shown as not participating', async () => {
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/tmp/x' })
      .where(eq(groupBots.botId, w.c.id))
    await switchOn()
    await vi.waitFor(() => expect(inits('B')).toHaveLength(1))
    expect(inits('A').map((m) => m.botId)).toEqual([w.a.id])
    const c = (await status()).replicas.find((r) => r.botId === w.c.id)
    expect(c).toMatchObject({ state: 'excluded', workspace: 'cd' })
  })

  it('a replica reporting uncommitted changes is left out, then joins discarding them', async () => {
    await switchOn()
    await vi.waitFor(() => expect(inits('B')).toHaveLength(1))
    from('B', {
      t: 'sync.state',
      groupId: w.g.id,
      botId: w.b.id,
      state: 'dirty',
      files: ['wip.txt'],
      total: 1,
      reason: null,
      reasonI18n: null,
    })
    await vi.waitFor(async () => expect((await replica(w.b.id))?.issue).toBe('dirty'))
    expect((await status()).replicas.find((r) => r.botId === w.b.id)).toMatchObject({
      state: 'excluded',
      issue: 'dirty',
      files: ['wip.txt'],
    })
    // A sync.available goes to joined replicas only.
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'y', 'x')], { baseVersion: 1 }))
    expect(sent.B.filter((m) => m.t === 'sync.available')).toEqual([])

    const outsider = await t.seed.user({ name: '张三' })
    await t.db.insert(groupMembers).values({ groupId: w.g.id, userId: outsider.id })
    const join = (userId: string) =>
      api(userId).then((c) => c.post(url(`/replicas/${w.b.id}/join`), { force: true }))
    expect((await join(outsider.id)).status).toBe(403)
    expect((await join(w.li.id)).status).toBe(200)
    await vi.waitFor(() => expect(inits('B').at(-1)).toEqual(init(w.b.id, 'align', true)))
    expect((await join(w.li.id)).status).toBe(200)
    expect(inits('B')).toHaveLength(2)
  })

  it('a newly added bot with a managed workspace aligns once its clone is ready', async () => {
    await switchOn()
    const d = await t.seed.bot({ ownerId: w.li.id, name: '老李的 Gemini', machineId: w.B.machine.id })
    expect((await (await api(w.wang.id)).post(`/api/groups/${w.g.id}/bots`, { botId: d.id })).status).toBe(
      200,
    )
    const ensure = await vi.waitFor(() => {
      const m = sent.B.find((x) => x.t === 'workspace.ensure' && x.botId === d.id)
      if (m?.t !== 'workspace.ensure') throw new Error('no ensure yet')
      return m
    })
    from('B', {
      t: 'workspace.state',
      groupId: w.g.id,
      botId: d.id,
      requestId: ensure.requestId,
      state: 'ready',
      path: '/ws/d',
      git: null,
      error: null,
      reason: null,
      remotes: [],
    })
    await vi.waitFor(() => expect(inits('B')).toContainEqual(init(d.id, 'align')))
  })

  it('a removed bot leaves: its machine is told to forget the replica', async () => {
    await switchOn()
    await vi.waitFor(() => expect(inits('B')).toHaveLength(1))
    expect((await (await api(w.wang.id)).del(`/api/groups/${w.g.id}/bots/${w.b.id}`)).status).toBe(200)
    expect(inits('B').at(-1)).toEqual(init(w.b.id, 'leave'))
    expect(await replica(w.b.id)).toMatchObject({ joinedAt: null, pending: null })
  })

  it('a base that cannot submit its tree fails the switch back to partition', async () => {
    connect('A')
    await (await api(w.wang.id)).post(url('/enable'), { baseBotId: w.a.id })
    from('A', {
      t: 'sync.state',
      groupId: w.g.id,
      botId: w.a.id,
      state: 'error',
      files: ['CON'],
      total: 1,
      reason: 'Windows 保留名',
      reasonI18n: null,
    })
    await vi.waitFor(async () => expect((await group()).mode).toBe('partition'))
    // The event is posted after the mode commits.
    await vi.waitFor(async () =>
      expect(await events()).toContain('切换为强制同步失败，仍为分区模式：Windows 保留名'),
    )
  })
})

describe('turns during the switch', () => {
  it('a running turn finishes in partition mode before the base snapshot; new triggers wait for the switch', async () => {
    connect('A')
    connect('B')
    const running = await trigger(w.a.id)
    await vi.waitFor(() => expect(startOf('A', running)?.sync).toBeNull())
    await (await api(w.wang.id)).post(url('/enable'), { baseBotId: w.a.id })
    await new Promise((r) => setTimeout(r, 50))
    expect(inits('A')).toEqual([])

    const held = await trigger(w.b.id)
    expect(await runRow(held)).toMatchObject({ status: 'queued', step: '等待切换为强制同步' })

    done('A', running)
    await vi.waitFor(() => expect(inits('A')).toEqual([init(w.a.id, 'base')]))
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await vi.waitFor(async () => expect((await runRow(held)).step).toBe('等待同步对齐'))
    expect(startOf('B', held)).toBeUndefined()

    from('B', { t: 'sync.applied', groupId: w.g.id, botId: w.b.id, version: 1, rootHash: root1 })
    await vi.waitFor(() => expect(startOf('B', held)?.sync).toMatchObject({ headVersion: 1 }))
    const timeline = await (await api(w.wang.id)).get<{ runs: RunDto[] }>(`/api/groups/${w.g.id}/timeline`)
    expect(timeline.body.runs.find((r) => r.id === held)?.status).toBe('running')
  })
})

describe('switch back to partition', () => {
  it('tells every replica to leave, archives the group sync data and announces it', async () => {
    await switchOn()
    await vi.waitFor(() => expect(inits('B')).toHaveLength(1))
    expect((await (await api(w.li.id)).post(url('/disable'))).status).toBe(403)
    expect((await (await api(w.wang.id)).post(url('/disable'))).status).toBe(200)
    const g = await group()
    expect(g.mode).toBe('partition')
    expect(g.syncArchivedAt).not.toBeNull()
    expect(
      inits('A')
        .filter((m) => m.role === 'leave')
        .map((m) => m.botId)
        .sort(),
    ).toEqual([w.a.id, w.c.id].sort())
    expect(inits('B').at(-1)).toEqual(init(w.b.id, 'leave'))
    expect(await events()).toContain('王磊 将同步模式切回分区模式，各 Bot 保留当前文件')
    expect((await replica(w.a.id))?.joinedAt).toBeNull()
  })

  it('purges an archive older than 30 days, keeps a fresh one', async () => {
    await switchOn()
    await (await api(w.wang.id)).post(url('/disable'))
    await purgeSyncBlobs(t.ctx)
    expect(await t.db.select().from(syncVersions).where(eq(syncVersions.groupId, w.g.id))).toHaveLength(1)
    await t.db
      .update(groups)
      .set({ syncArchivedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(groups.id, w.g.id))
    expect(existsSync(blobPath(w.g.id, sha('x')))).toBe(true)
    await purgeSyncBlobs(t.ctx)
    expect(existsSync(blobPath(w.g.id, sha('x')))).toBe(false)
    expect(await t.db.select().from(syncVersions).where(eq(syncVersions.groupId, w.g.id))).toEqual([])
    expect(await t.db.select().from(syncReplicas).where(eq(syncReplicas.groupId, w.g.id))).toEqual([])
    expect((await group()).syncArchivedAt).toBeNull()
  })

  it('a force group cannot change its repo', async () => {
    await switchOn()
    const res = await (await api(w.wang.id)).patch<{ message: string }>(`/api/groups/${w.g.id}/repo`, {
      url: 'git@github.com:acme/other.git',
      branch: 'main',
    })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('强制同步群不能更换仓库，请先切回分区模式')
    const [repo] = await t.db
      .select()
      .from(groupRepos)
      .where(and(eq(groupRepos.groupId, w.g.id)))
    expect(repo?.id).toBe(repoId)
  })
})
