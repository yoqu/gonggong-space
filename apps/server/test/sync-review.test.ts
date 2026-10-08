import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type DaemonToServer,
  type RunStart,
  type RunSyncDone,
  type ServerToDaemon,
  type SyncEntry,
  type SyncStatusDto,
  syncRootText,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import {
  groupBots,
  groupRepos,
  groups,
  machines,
  messages,
  notifications,
  runs,
  syncConflicts,
  syncHead,
  syncReplicas,
  syncVersions,
} from '../src/db/schema.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { stopRuns } from '../src/modules/runs/stop.js'
import { blobPath, blobQuota, purgeSyncBlobs } from '../src/modules/sync/blobs.js'
import { publishSync } from '../src/modules/sync/status.js'
import { runSyncStart, submitSync } from '../src/modules/sync/store.js'
import { expireSwitches } from '../src/modules/sync/switch.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'
import { change, sha, syncWorld } from './support/sync.js'

// Review fixes of force sync (docs/plan/强制同步-开发计划.md): retention, stuck switches, lost replicas, cleanup, limits.

type K = 'A' | 'B'
type Init = Extract<ServerToDaemon, { t: 'sync.init' }>
let t: TestApp
let w: Awaited<ReturnType<typeof syncWorld>>
let sent: Record<K, ServerToDaemon[]>
let conns: Record<K, DaemonConn>
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
  w = await syncWorld(t)
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
  (await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, botId)))[0]!
const group = async () => (await t.db.select().from(groups).where(eq(groups.id, w.g.id)))[0]!
const runRow = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
const events = async () =>
  (await t.db.select().from(messages).where(eq(messages.kind, 'event'))).map((m) => m.body)
const openNotes = async (type: string) =>
  t.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.type, type), isNull(notifications.resolvedAt)))
const root = (files: Record<string, string>) =>
  sha(
    Object.entries(files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([p, c]) => `${p}\0-\0${sha(c)}\n`)
      .join(''),
  )

async function submit(k: K, m: ReturnType<typeof w.msg>) {
  from(k, m)
  return vi.waitFor(() => {
    const r = sent[k].find((x) => x.t === 'sync.result' && x.submitId === m.submitId)
    if (r?.t !== 'sync.result') throw new Error('no result yet')
    return r.result
  })
}

async function queue(botId: string, o: { handoffs?: { botId: string; task: string }[] } = {}) {
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
      handoffs: o.handoffs ?? [],
    })
    .returning()
  await schedule(t.ctx, botId)
  return run!.id
}
const starts = (k: K, runId?: string) =>
  sent[k].filter((m): m is RunStart => m.t === 'run.start' && (!runId || m.runId === runId))

const done = (
  k: K,
  runId: string,
  sync: RunSyncDone | null,
  outcome: 'completed' | 'interrupted' | 'failed' = 'completed',
) =>
  from(k, {
    t: 'run.done',
    runId,
    outcome,
    reply: '',
    filesChanged: 1,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
    sync,
  })

const state = (k: K, botId: string, s: 'drift' | 'held' | 'lost' | 'error', files: string[] = []) =>
  from(k, {
    t: 'sync.state',
    groupId: w.g.id,
    botId,
    state: s,
    files,
    total: files.length,
    reason: null,
    reasonI18n: null,
  })

/** v1 a.txt=x by a, v2 a.txt=y by a; b's edit on top of v1 is held. */
async function heldOnB(content = 'z') {
  if (!(await t.db.select().from(syncVersions)).length) {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'y', 'x')], { baseVersion: 1 }))
  }
  const m = w.msg(w.b.id, [await change(w, 'a.txt', content, 'x')], { baseVersion: 1 })
  expect((await submit('B', m)).outcome).toBe('conflict')
  state('B', w.b.id, 'held', ['a.txt'])
  return vi.waitFor(async () => {
    const [c] = await t.db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.submitId, m.submitId), isNull(syncConflicts.resolvedAt)))
    if (!c) throw new Error('not held yet')
    return c
  })
}

describe('blob retention (F16)', () => {
  const old = new Date(Date.now() - 2 * 86_400_000)
  const age = (s: string) => utimesSync(blobPath(w.g.id, sha(s)), old, old)
  const kept = (s: string) => existsSync(blobPath(w.g.id, sha(s)))
  const daysAgo = (version: number, days: number) =>
    t.db
      .update(syncVersions)
      .set({ createdAt: new Date(Date.now() - days * 86_400_000) })
      .where(eq(syncVersions.version, version))

  it('keeps content that was live within 30 days: the head and what a recent version overwrote', async () => {
    const A = w.A.machine.id
    await submitSync(
      t.ctx,
      A,
      w.msg(w.a.id, [await change(w, 'a', 'h1'), await change(w, 'b', 'b1')], { kind: 'init' }),
    )
    await submitSync(t.ctx, A, w.msg(w.a.id, [await change(w, 'a', 'h2', 'h1')], { baseVersion: 1 }))
    await submitSync(t.ctx, A, w.msg(w.a.id, [await change(w, 'a', 'h3', 'h2')], { baseVersion: 2 }))
    await daysAgo(1, 60)
    await daysAgo(2, 40)
    await daysAgo(3, 10)
    for (const s of ['h1', 'h2', 'h3', 'b1']) age(s)
    await purgeSyncBlobs(t.ctx)
    expect(['h1', 'h2', 'h3', 'b1'].map(kept)).toEqual([false, true, true, true])
  })

  it('keeps every side of a refused submit and of an open conflict', async () => {
    const lc = { hash: sha('lc'), baseHash: sha('lcb') }
    await t.db
      .update(syncReplicas)
      .set({
        lastConflict: {
          submitId: crypto.randomUUID(),
          baseVersion: 0,
          headVersion: 0,
          changes: [{ path: 'p', exec: false, ...lc }],
          conflicts: [{ path: 'p', hash: sha('lch'), exec: false }],
        },
      })
      .where(eq(syncReplicas.botId, w.a.id))
    await t.db.insert(syncConflicts).values({
      groupId: w.g.id,
      botId: w.b.id,
      submitId: crypto.randomUUID(),
      baseVersion: 0,
      headVersion: 0,
      changes: [{ path: 'q', hash: sha('ch'), baseHash: sha('chb'), exec: false }],
      conflicts: [{ path: 'q', hash: sha('cc'), exec: false }],
    })
    const all = ['lc', 'lcb', 'lch', 'ch', 'chb', 'cc', 'gone']
    for (const s of all) {
      await w.put(s)
      age(s)
    }
    await purgeSyncBlobs(t.ctx)
    expect(all.map(kept)).toEqual([true, true, true, true, true, true, false])
  })

  it('an upload or missing check hitting an existing blob makes it fresh again', async () => {
    await w.put('dup')
    await w.put('asked')
    age('dup')
    age('asked')
    expect((await w.put('dup')).statusCode).toBe(204)
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/sync/${w.g.id}/blobs/missing`,
      headers: w.auth(),
      payload: { hashes: [sha('asked')] },
    })
    expect(res.json()).toEqual({ missing: [] })
    const fresh = (s: string) => Date.now() - statSync(blobPath(w.g.id, sha(s))).mtimeMs < 60_000
    expect([fresh('dup'), fresh('asked')]).toEqual([true, true])
    await purgeSyncBlobs(t.ctx)
    expect([kept('dup'), kept('asked')]).toEqual([true, true])
  })

  it('one entry it cannot delete does not stop the sweep', async () => {
    await w.put('stale')
    age('stale')
    const dir = join(blobPath(w.g.id, sha('stale')), '..', `${'0'.repeat(63)}x`)
    mkdirSync(join(dir, 'inner'), { recursive: true })
    utimesSync(dir, old, old)
    await purgeSyncBlobs(t.ctx)
    expect(kept('stale')).toBe(false)
    rmSync(dir, { recursive: true })
  })
})

describe('the mode switch cannot get stuck (§3.5)', () => {
  async function partition() {
    await t.db.delete(syncReplicas)
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
    await t.db.insert(groupRepos).values({
      groupId: w.g.id,
      url: 'git@github.com:acme/pay.git',
      baseBranch: 'main',
    })
    connect('A')
    connect('B')
  }
  const enable = async () =>
    expect((await (await api(w.wang.id)).post(url('/enable'), { baseBotId: w.b.id })).status).toBe(200)
  async function switching() {
    await partition()
    await enable()
    await vi.waitFor(() => expect(inits('B').map((m) => m.role)).toEqual(['base']))
  }
  /** Moves the switch's timestamps `min` minutes into the past. */
  async function ago(min: number, keys: ('at' | 'sentAt')[]) {
    const g = await group()
    const past = new Date(Date.now() - min * 60_000).toISOString()
    await t.db
      .update(groups)
      .set({ syncSwitch: { ...g.syncSwitch!, ...Object.fromEntries(keys.map((k) => [k, past])) } })
      .where(eq(groups.id, w.g.id))
  }
  /** The base is still in a partition-mode turn when the switch starts. */
  async function busySwitch() {
    await partition()
    const runId = await queue(w.b.id)
    await vi.waitFor(() => expect(starts('B', runId)).toHaveLength(1))
    await enable()
    expect(inits('B')).toEqual([])
    expect((await group()).syncSwitch?.sentAt).toBeUndefined()
    return runId
  }

  it('the base bot removed from the group fails the switch back to partition', async () => {
    await switching()
    expect((await (await api(w.wang.id)).del(`/api/groups/${w.g.id}/bots/${w.b.id}`)).status).toBe(200)
    await vi.waitFor(async () => expect((await group()).mode).toBe('partition'))
    expect((await group()).syncSwitch).toBeNull()
    expect((await events()).some((e) => e.startsWith('切换为强制同步失败'))).toBe(true)
  })

  it('the base bot deleted fails the switch too', async () => {
    await switching()
    expect((await (await api(w.li.id)).del(`/api/bots/${w.b.id}`)).status).toBe(204)
    await vi.waitFor(async () => expect((await group()).mode).toBe('partition'))
  })

  it('a base that does not submit its tree within 10 minutes of its sync.init fails the switch', async () => {
    await switching()
    expect((await group()).syncSwitch?.sentAt).toBeTruthy()
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('force')
    await ago(11, ['at', 'sentAt'])
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('partition')
    expect(await events()).toContain('基准 Bot 未能在 10 分钟内完成首版，已退回分区模式')
    // A late tree is not taken.
    const late = await submit('B', w.msg(w.b.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    expect(late).toEqual({ outcome: 'rejected', reason: 'not_participating' })
  })

  it('the 10 minutes start when the base sync.init is sent, not while the base finishes its turn', async () => {
    const runId = await busySwitch()
    await ago(30, ['at'])
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('force')
    done('B', runId, null)
    await vi.waitFor(() => expect(inits('B').map((m) => m.role)).toEqual(['base']))
    expect((await group()).syncSwitch?.sentAt).toBeTruthy()
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('force')
    await ago(11, ['sentAt'])
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('partition')
  })

  it('a base machine offline for 10 minutes before its sync.init fails the switch', async () => {
    await busySwitch()
    t.ctx.hub.unregister(w.B.machine.id, conns.B)
    const offlineFor = (min: number) =>
      t.db
        .update(machines)
        .set({ lastSeenAt: new Date(Date.now() - min * 60_000) })
        .where(eq(machines.id, w.B.machine.id))
    await ago(30, ['at'])
    await offlineFor(2)
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('force')
    await offlineFor(11)
    await expireSwitches(t.ctx)
    expect((await group()).mode).toBe('partition')
    expect(await events()).toContain('切换为强制同步失败，仍为分区模式：基准 Bot 所在机器离线超过 10 分钟')
  })
})

describe('replica realignment', () => {
  it('a joined replica whose daemon lost its sync state aligns again', async () => {
    connect('A')
    connect('B')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    from('B', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.b.id,
      version: 1,
      rootHash: root({ 'a.txt': 'x' }),
    })
    await vi.waitFor(async () => expect((await replica(w.b.id)).version).toBe(1))
    state('B', w.b.id, 'lost')
    await vi.waitFor(async () =>
      expect(await replica(w.b.id)).toMatchObject({
        pending: 'align',
        joinedAt: null,
        version: null,
        issue: null,
      }),
    )
    await vi.waitFor(() => expect(inits('B').map((m) => m.role)).toEqual(['align']))
  })

  it('an aligning replica whose tree does not match is flagged and its turns go on', async () => {
    connect('A')
    connect('B')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await t.db
      .update(syncReplicas)
      .set({ joinedAt: null, pending: 'align' })
      .where(eq(syncReplicas.botId, w.b.id))
    const id = await queue(w.b.id)
    expect((await runRow(id)).step).toBe('等待同步对齐')
    await vi.waitFor(() => expect(inits('B')).toHaveLength(1))
    from('B', { t: 'sync.applied', groupId: w.g.id, botId: w.b.id, version: 1, rootHash: sha('wrong') })
    await vi.waitFor(() => expect(starts('B', id)).toHaveLength(1))
    expect(await replica(w.b.id)).toMatchObject({ pending: null, issue: 'error' })
  })
})

describe('turns and runs', () => {
  it('a stopped turn reported as waiting ends instead of going back to the queue', async () => {
    connect('A')
    const id = await queue(w.a.id)
    expect(starts('A', id)).toHaveLength(1)
    await stopRuns(t.ctx, { groupId: w.g.id, runId: id }, { id: w.wang.id, name: '王磊' })
    done('A', id, { outcome: 'waiting', issue: 'drift' }, 'interrupted')
    await vi.waitFor(async () => expect((await runRow(id)).status).toBe('interrupted'))
  })

  it('a requeued turn keeps why it waits on its card', async () => {
    connect('A')
    const id = await queue(w.a.id)
    done('A', id, { outcome: 'waiting', issue: 'held' })
    await vi.waitFor(async () => expect((await runRow(id)).status).toBe('queued'))
    expect((await runRow(id)).sync).toEqual({ outcome: 'waiting', issue: 'held' })
  })

  it('the context hint only counts turns since the replica joined (this force period)', async () => {
    connect('A')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    const prev = await queue(w.a.id)
    done('A', prev, { outcome: 'accepted', version: 1, merged: false })
    await vi.waitFor(async () => expect((await runRow(prev)).status).toBe('completed'))
    expect((await runSyncStart(t.db, w.g.id, w.a.id))?.lastVersion).toBe(1)
    await t.db
      .update(syncReplicas)
      .set({ joinedAt: new Date(Date.now() + 1000) })
      .where(eq(syncReplicas.botId, w.a.id))
    expect((await runSyncStart(t.db, w.g.id, w.a.id))?.lastVersion).toBeNull()
  })

  it('a relay hop after a hop whose submit failed is told so', async () => {
    connect('A')
    connect('B')
    const first = await queue(w.a.id, { handoffs: [{ botId: w.b.id, task: '接着做' }] })
    const sync = {
      outcome: 'error',
      reason: '上传同步内容失败：offline',
      reasonI18n: { key: '上传同步内容失败：{e}', params: { e: 'offline' } },
    } as const
    done('A', first, sync)
    const hop = await vi.waitFor(() => {
      const s = starts('B')[0]
      if (!s) throw new Error('no hop yet')
      return s
    })
    expect(hop.prompt.context.map((c) => c.body).join('\n')).toContain('were not synced')
    expect((await runRow(first)).sync).toEqual(sync)
  })
})

describe('conflict and notification cleanup', () => {
  it('a newer held change settles the older one and its notifications', async () => {
    connect('A')
    connect('B')
    const first = await heldOnB('z')
    await vi.waitFor(async () => expect((await openNotes('sync_conflict')).length).toBeGreaterThan(0))
    const second = await heldOnB('q')
    expect(second.id).not.toBe(first.id)
    await vi.waitFor(async () => {
      const open = await openNotes('sync_conflict')
      expect(open.length).toBeGreaterThan(0)
      expect(open.every((n) => (n.payload as { conflictId: string }).conflictId === second.id)).toBe(true)
    })
  })

  it('switching back to partition closes open conflicts and their notifications', async () => {
    connect('A')
    connect('B')
    await heldOnB()
    state('A', w.a.id, 'drift', ['q.txt'])
    await vi.waitFor(async () => expect(await openNotes('sync_drift')).toHaveLength(1))
    expect((await (await api(w.wang.id)).post(url('/disable'))).status).toBe(200)
    expect(await t.db.select().from(syncConflicts).where(isNull(syncConflicts.resolvedAt))).toEqual([])
    expect([...(await openNotes('sync_conflict')), ...(await openNotes('sync_drift'))]).toEqual([])
  })

  it('a bot leaving the group closes its conflicts and notifications', async () => {
    connect('A')
    connect('B')
    await heldOnB()
    await vi.waitFor(async () => expect((await openNotes('sync_conflict')).length).toBeGreaterThan(0))
    expect((await (await api(w.wang.id)).del(`/api/groups/${w.g.id}/bots/${w.b.id}`)).status).toBe(200)
    expect(await t.db.select().from(syncConflicts).where(isNull(syncConflicts.resolvedAt))).toEqual([])
    expect(await openNotes('sync_conflict')).toEqual([])
  })

  it('keep / discard of a stopped force turn is refused once the replica no longer syncs', async () => {
    connect('A')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    const id = await queue(w.a.id)
    await stopRuns(t.ctx, { groupId: w.g.id, runId: id }, { id: w.wang.id, name: '王磊' })
    done('A', id, { outcome: 'stopped', files: 2 }, 'interrupted')
    await vi.waitFor(async () => expect((await runRow(id)).interrupt).toBe('pending'))
    const wang = await api(w.wang.id)
    expect((await wang.post(url('/disable'))).status).toBe(200)
    sent.A.length = 0
    const res = await wang.post<{ message: string }>(`/api/runs/${id}/interrupt`, { choice: 'keep' })
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('该 Bot 已不在强制同步中，本轮改动留在工作区')
    expect(sent.A.filter((m) => m.t === 'sync.action')).toEqual([])
  })
})

describe('leave reaches offline machines', () => {
  it('switching back while a machine is offline tells it to leave once it connects', async () => {
    connect('A')
    expect((await (await api(w.wang.id)).post(url('/disable'))).status).toBe(200)
    expect((await replica(w.b.id)).pending).toBe('leave')
    expect((await replica(w.a.id)).pending).toBeNull()
    connect('B')
    await vi.waitFor(() =>
      expect(inits('B')).toEqual([
        { t: 'sync.init', groupId: w.g.id, botId: w.b.id, role: 'leave', force: false, repoId: null },
      ]),
    )
    await vi.waitFor(async () => expect((await replica(w.b.id)).pending).toBeNull())
    expect(sent.B.filter((m) => m.t === 'sync.available')).toEqual([])
  })

  it('a bot removed while its machine is offline is told to leave on connect', async () => {
    expect((await (await api(w.wang.id)).del(`/api/groups/${w.g.id}/bots/${w.b.id}`)).status).toBe(200)
    connect('B')
    await vi.waitFor(() => expect(inits('B').map((m) => [m.botId, m.role])).toEqual([[w.b.id, 'leave']]))
  })

  it('a connecting machine is not told the head of an archived group', async () => {
    connect('A')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await t.db.update(groups).set({ archivedAt: new Date() }).where(eq(groups.id, w.g.id))
    connect('B')
    await new Promise((r) => setTimeout(r, 100))
    expect(sent.B.filter((m) => m.t === 'sync.available')).toEqual([])
  })
})

describe('status', () => {
  it('a replica still syncing when the 60 s window ends is pushed as behind', async () => {
    connect('A')
    connect('B')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await t.db.update(syncVersions).set({ createdAt: new Date(Date.now() - 59_800) })
    const pushed: SyncStatusDto[] = []
    const publish = t.ctx.bus.publish.bind(t.ctx.bus)
    vi.spyOn(t.ctx.bus, 'publish').mockImplementation((to, e) => {
      if (e.t === 'group.sync') pushed.push(e)
      return publish(to, e)
    })
    await publishSync(t.ctx, w.g.id)
    expect(pushed.at(-1)?.replicas.find((r) => r.botId === w.b.id)?.state).toBe('syncing')
    await vi.waitFor(() =>
      expect(pushed.at(-1)?.replicas.find((r) => r.botId === w.b.id)?.state).toBe('behind'),
    )
  })

  it('a failed replica shows as error, not as local edits', async () => {
    connect('B')
    state('B', w.b.id, 'error', ['CON'])
    await vi.waitFor(async () => expect((await replica(w.b.id)).issue).toBe('error'))
    const s = (await (await api(w.wang.id)).get<SyncStatusDto>(url())).body
    expect(s.replicas.find((r) => r.botId === w.b.id)?.state).toBe('error')
  })
})

describe('limits and access', () => {
  it('a group over its storage quota refuses new uploads with 413', async () => {
    const quota = blobQuota.bytes
    try {
      blobQuota.bytes = 300
      expect((await w.put('a'.repeat(100))).statusCode).toBe(204)
      expect((await w.put('b'.repeat(500))).statusCode).toBe(413)
      expect((await w.put('a'.repeat(100))).statusCode).toBe(204)
    } finally {
      blobQuota.bytes = quota
    }
  })

  it('blobs are only for machines hosting a managed replica that syncs or is aligning', async () => {
    const get = (token: string) =>
      t.app.inject({ url: `/api/daemon/sync/${w.g.id}/blobs/${sha('x')}`, headers: w.auth(token) })
    await w.put('x')
    await t.db
      .update(syncReplicas)
      .set({ joinedAt: null, issue: 'dirty' })
      .where(eq(syncReplicas.botId, w.b.id))
    expect((await get(w.B.token)).statusCode).toBe(403)
    await t.db.update(syncReplicas).set({ pending: 'align' }).where(eq(syncReplicas.botId, w.b.id))
    expect((await get(w.B.token)).statusCode).toBe(200)
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/tmp/x' })
      .where(eq(groupBots.botId, w.b.id))
    expect((await get(w.B.token)).statusCode).toBe(403)
  })
})

describe('compare-and-swap on changed paths only', () => {
  it('LIKE wildcards in a new path do not collide with unrelated directories', async () => {
    const A = w.A.machine.id
    await submitSync(t.ctx, A, w.msg(w.a.id, [await change(w, 'aXb/c', 'c')], { kind: 'init' }))
    expect(
      await submitSync(t.ctx, A, w.msg(w.a.id, [await change(w, 'a_b', 'f')], { baseVersion: 1 })),
    ).toEqual({ outcome: 'accepted', version: 2 })
    expect(
      (await submitSync(t.ctx, A, w.msg(w.a.id, [await change(w, 'aXb', 'g')], { baseVersion: 2 }))).outcome,
    ).toBe('conflict')
    expect(
      (await submitSync(t.ctx, A, w.msg(w.a.id, [await change(w, 'a_b/d', 'g')], { baseVersion: 2 })))
        .outcome,
    ).toBe('conflict')
  })

  it('the root hash covers the whole head in UTF-8 byte order', async () => {
    const A = w.A.machine.id
    await submitSync(
      t.ctx,
      A,
      w.msg(w.a.id, [await change(w, 'é', '1'), await change(w, 'Z/x', '2')], { kind: 'init' }),
    )
    await submitSync(
      t.ctx,
      A,
      w.msg(w.a.id, [await change(w, 'a', '3'), await change(w, 'B', '4')], { baseVersion: 1 }),
    )
    const head = (await t.db.select().from(syncHead).where(eq(syncHead.groupId, w.g.id))).map(
      (r): SyncEntry => ({ path: r.path, hash: r.hash, exec: r.exec }),
    )
    const [v2] = await t.db.select().from(syncVersions).where(eq(syncVersions.version, 2))
    expect(v2?.rootHash).toBe(sha(syncRootText(head)))
  })
})
