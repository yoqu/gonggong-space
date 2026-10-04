import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DaemonToServer,
  RunStart,
  RunSyncDone,
  ServerToDaemon,
  SyncConflictDto,
  SyncPreviewDto,
  SyncStatusDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import { bots, groups, messages, notifications, runs, syncReplicas } from '../src/db/schema.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { stopRuns } from '../src/modules/runs/stop.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'
import { change, sha, syncWorld } from './support/sync.js'

// S7 (docs/plan/强制同步-开发计划.md F21, F22) and the leftovers of S4–S8.

type K = 'A' | 'B'
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
  sent = { A: [], B: [] }
  conns = {
    A: { send: (m) => void sent.A.push(m), close() {} },
    B: { send: (m) => void sent.B.push(m), close() {} },
  }
})
afterEach(() => t.close())

const connect = (k: K, features = ['sync']) => t.ctx.hub.register(w[k].machine.id, conns[k], features)
const from = (k: K, m: Exclude<DaemonToServer, { t: 'hello' | 'heartbeat' }>) =>
  t.ctx.hub.emit('message', w[k].machine.id, m)

async function submit(k: K, m: ReturnType<typeof w.msg>) {
  from(k, m)
  return vi.waitFor(() => {
    const r = sent[k].find((x) => x.t === 'sync.result' && x.submitId === m.submitId)
    if (r?.t !== 'sync.result') throw new Error('no result yet')
    return r.result
  })
}

const replica = async (botId: string) =>
  (await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, botId)))[0]!
const runRow = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
const starts = (k: K, runId?: string) =>
  sent[k].filter((m): m is RunStart => m.t === 'run.start' && (!runId || m.runId === runId))
const actions = (k: K) => sent[k].filter((m) => m.t === 'sync.action')
const root = (files: Record<string, string>) =>
  sha(
    Object.entries(files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([p, c]) => `${p}\0-\0${sha(c)}\n`)
      .join(''),
  )

async function queue(botId: string) {
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
    filesChanged: 2,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
    sync,
  })

describe('/stop in a force group (F21)', () => {
  async function stopped(first = true) {
    if (first) {
      connect('A')
      await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    }
    const id = await queue(w.a.id)
    expect(starts('A', id)).toHaveLength(1)
    await stopRuns(t.ctx, { groupId: w.g.id, runId: id }, { id: w.wang.id, name: '王磊' })
    done('A', id, { outcome: 'stopped', files: 2 }, 'interrupted')
    await vi.waitFor(async () => expect((await runRow(id)).status).toBe('interrupted'))
    return id
  }

  it('leaves the keep/discard choice to the initiator and pauses the replica like local edits', async () => {
    const id = await stopped()
    expect(await runRow(id)).toMatchObject({
      interrupt: 'pending',
      step: '王磊 执行了 /stop · 强制同步：已改的 2 个文件待处理，未提交',
      sync: { outcome: 'stopped', files: 2 },
    })
    expect(await replica(w.a.id)).toMatchObject({ issue: 'drift', total: 2 })
    // No local-edits notice: the choice is on the run card.
    expect(await t.db.select().from(notifications).where(eq(notifications.type, 'sync_drift'))).toEqual([])
    const next = await queue(w.a.id)
    expect(await runRow(next)).toMatchObject({ status: 'queued', step: '等待处理本地改动' })
  })

  it('保留 submits the changes on the machine; 丢弃 rolls them back there', async () => {
    const id = await stopped()
    const api = client(t, await t.seed.cookie(w.wang.id))
    expect((await api.post(`/api/runs/${id}/interrupt`, { choice: 'keep' })).status).toBe(200)
    expect(actions('A')).toEqual([
      { t: 'sync.action', groupId: w.g.id, botId: w.a.id, action: { kind: 'drift', choice: 'submit' } },
    ])
    expect((await runRow(id)).interrupt).toBe('kept')

    // The daemon submitted and caught up: the replica is settled.
    from('A', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.a.id,
      version: 1,
      rootHash: root({ 'a.txt': 'x' }),
    })
    await vi.waitFor(async () => expect((await replica(w.a.id)).issue).toBeNull())
    const again = await stopped(false)
    expect((await api.post(`/api/runs/${again}/interrupt`, { choice: 'discard' })).status).toBe(200)
    expect(actions('A').at(-1)).toEqual({
      t: 'sync.action',
      groupId: w.g.id,
      botId: w.a.id,
      action: { kind: 'drift', choice: 'discard' },
    })
    expect((await runRow(again)).interrupt).toBe('discarded')
  })

  it('is refused while the machine is offline, leaving the choice open', async () => {
    const id = await stopped()
    t.ctx.hub.unregister(w.A.machine.id, conns.A)
    const res = await client(t, await t.seed.cookie(w.wang.id)).post(`/api/runs/${id}/interrupt`, {
      choice: 'keep',
    })
    expect(res.status).toBe(409)
    expect((await runRow(id)).interrupt).toBe('pending')
  })
})

describe('submits', () => {
  it('a base version past the head is rejected', async () => {
    connect('A')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    expect(await submit('A', w.msg(w.a.id, [await change(w, 'b.txt', 'b')], { baseVersion: 2 }))).toEqual({
      outcome: 'rejected',
      reason: 'bad_base',
    })
  })
})

/** v1 a.txt=x, v2 a.txt=y by a; b's edit z on top of v1 is held. */
async function heldOnB() {
  connect('A')
  connect('B')
  await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
  await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'y', 'x')], { baseVersion: 1 }))
  const m = w.msg(w.b.id, [await change(w, 'a.txt', 'z', 'x')], { baseVersion: 1 })
  expect((await submit('B', m)).outcome).toBe('conflict')
  from('B', {
    t: 'sync.state',
    groupId: w.g.id,
    botId: w.b.id,
    state: 'held',
    files: ['a.txt'],
    total: 1,
    reason: null,
  })
  return vi.waitFor(async () => {
    const res = await client(t, await t.seed.cookie(w.li.id)).get<SyncConflictDto[]>(
      `/api/groups/${w.g.id}/sync/conflicts`,
    )
    expect(res.body).toHaveLength(1)
    return res.body[0]!
  })
}

describe('conflicts', () => {
  it("the merge turn runs whatever the bot's trigger scope: the decider is already authorized", async () => {
    await t.db.update(bots).set({ triggerScope: 'self' }).where(eq(bots.id, w.b.id))
    const c = await heldOnB()
    const res = await client(t, await t.seed.cookie(w.wang.id)).post(
      `/api/groups/${w.g.id}/sync/conflicts/${c.id}/resolve`,
      { decisions: [{ path: 'a.txt', choice: 'bot' }] },
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(starts('B')).toHaveLength(1))
  })

  it('settling marks the conflict and local-edit notifications handled', async () => {
    await heldOnB()
    from('A', {
      t: 'sync.state',
      groupId: w.g.id,
      botId: w.a.id,
      state: 'drift',
      files: ['q.txt'],
      total: 1,
      reason: null,
    })
    await vi.waitFor(async () => {
      const rows = await t.db.select().from(notifications)
      expect(rows.filter((r) => r.type === 'sync_conflict')).toHaveLength(2)
      expect(rows.filter((r) => r.type === 'sync_drift')).toHaveLength(1)
    })
    from('B', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.b.id,
      version: 2,
      rootHash: root({ 'a.txt': 'y' }),
    })
    from('A', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.a.id,
      version: 2,
      rootHash: root({ 'a.txt': 'y' }),
    })
    await vi.waitFor(async () => {
      const rows = await t.db.select().from(notifications)
      expect(rows.filter((r) => !r.resolvedAt).map((r) => r.type)).toEqual([])
    })
  })
})

describe('daemons without sync (old versions)', () => {
  it('sit out with a reason, get no sync.init, and their runs go unsynced', async () => {
    connect('A')
    connect('B', [])
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await t.db
      .update(syncReplicas)
      .set({ joinedAt: null, pending: 'align' })
      .where(eq(syncReplicas.botId, w.b.id))
    const id = await queue(w.b.id)
    const start = starts('B', id)
    expect(start).toHaveLength(1)
    expect(start[0]!.sync).toBeNull()
    expect(sent.B.filter((m) => m.t === 'sync.init')).toEqual([])
    const status = await client(t, await t.seed.cookie(w.li.id)).get<SyncStatusDto>(
      `/api/groups/${w.g.id}/sync`,
    )
    expect(status.body.replicas.find((r) => r.botId === w.b.id)).toMatchObject({
      state: 'excluded',
      reason: 'daemon 版本过旧，请升级',
    })
  })

  it('cannot be the base of a switch', async () => {
    connect('B', [])
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
    const api = client(t, await t.seed.cookie(w.wang.id))
    const preview = await api.get<SyncPreviewDto>(`/api/groups/${w.g.id}/sync/preview`)
    expect(preview.body.bots.find((b) => b.botId === w.b.id)).toMatchObject({
      plan: 'excluded',
      reason: 'outdated',
      canBase: false,
    })
  })
})

describe('bot deletion', () => {
  it('resets the replica and tells its machine to forget the sync state', async () => {
    connect('A')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/bots/${w.c.id}`,
      headers: { cookie: await t.seed.cookie(w.wang.id) },
    })
    expect(res.statusCode).toBe(204)
    expect(await replica(w.c.id)).toMatchObject({ joinedAt: null, pending: null, issue: null })
    expect(sent.A).toContainEqual({
      t: 'sync.init',
      groupId: w.g.id,
      botId: w.c.id,
      role: 'leave',
      force: false,
      repoId: null,
    })
  })
})
