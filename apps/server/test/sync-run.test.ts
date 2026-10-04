import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type DaemonToServer,
  type RunDto,
  type RunStart,
  type RunSyncDone,
  type ServerToDaemon,
  SYNC_CHANGED_MAX,
  type SyncStatusDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import { groupBots, groups, messages, runs } from '../src/db/schema.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'
import { change, sha, syncWorld } from './support/sync.js'

let t: TestApp
let w: Awaited<ReturnType<typeof syncWorld>>
let sent: Record<'A' | 'B', ServerToDaemon[]>
let conns: Record<'A' | 'B', DaemonConn>
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

const connect = (k: 'A' | 'B') => t.ctx.hub.register(w[k].machine.id, conns[k])
const from = (k: 'A' | 'B', m: Exclude<DaemonToServer, { t: 'hello' | 'heartbeat' }>) =>
  t.ctx.hub.emit('message', w[k].machine.id, m)

async function submit(k: 'A' | 'B', m: ReturnType<typeof w.msg>) {
  from(k, m)
  return vi.waitFor(() => {
    const r = sent[k].find((x) => x.t === 'sync.result' && x.submitId === m.submitId)
    if (r?.t !== 'sync.result') throw new Error('no result yet')
    return r.result
  })
}

/** Queues a run of `botId` in the group and dispatches it; returns its run.start. */
async function dispatch(
  k: 'A' | 'B',
  botId: string,
  o: { handoffs?: { botId: string; task: string }[] } = {},
) {
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
  return vi.waitFor(() => {
    const s = sent[k].find((x): x is RunStart => x.t === 'run.start' && x.runId === run!.id)
    if (!s) throw new Error('no run.start yet')
    return s
  })
}

const done = (k: 'A' | 'B', runId: string, sync: RunSyncDone | null) =>
  from(k, {
    t: 'run.done',
    runId,
    outcome: 'completed',
    reply: '好了',
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

const runRow = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!

describe('run.start sync', () => {
  it('carries the head for a managed replica of a force group, with no hint on its first turn', async () => {
    connect('A')
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    const start = await dispatch('A', w.a.id)
    expect(start.sync).toEqual({ headVersion: 1, lastVersion: null, changed: [], changedTotal: 0 })
  })

  it('lists what changed since the version the previous turn ended at, capped', async () => {
    connect('A')
    connect('B')
    await submit('B', w.msg(w.b.id, [await change(w, 'base.txt', 'x')], { kind: 'init' }))
    const first = await dispatch('A', w.a.id)
    done('A', first.runId, { outcome: 'accepted', version: 1, merged: false })
    await vi.waitFor(async () => expect((await runRow(first.runId)).status).toBe('completed'))

    const many = await Promise.all(
      Array.from({ length: SYNC_CHANGED_MAX + 3 }, (_, i) =>
        change(w, `f${String(i).padStart(2, '0')}`, `v${i}`),
      ),
    )
    await submit('B', w.msg(w.b.id, many.slice(0, 10), { baseVersion: 1 }))
    await submit('B', w.msg(w.b.id, many.slice(10), { baseVersion: 2 }))
    const next = await dispatch('A', w.a.id)
    expect(next.sync).toEqual({
      headVersion: 3,
      lastVersion: 1,
      changed: many.slice(0, SYNC_CHANGED_MAX).map((c) => c.path),
      changedTotal: SYNC_CHANGED_MAX + 3,
    })
  })

  it('is null in a partition group and for a /cd workspace', async () => {
    connect('A')
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/tmp/x', workspaceState: 'ready' })
      .where(eq(groupBots.botId, w.c.id))
    expect((await dispatch('A', w.c.id)).sync).toBeNull()
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
    expect((await dispatch('A', w.a.id)).sync).toBeNull()
  })
})

describe('run.done sync', () => {
  it('is stored on the run and shown on its card', async () => {
    connect('A')
    const start = await dispatch('A', w.a.id)
    done('A', start.runId, { outcome: 'held', files: 2 })
    await vi.waitFor(async () => expect((await runRow(start.runId)).status).toBe('completed'))
    expect((await runRow(start.runId)).sync).toEqual({ outcome: 'held', files: 2 })
    const runsRes = await client(t, await t.seed.cookie(w.wang.id)).get<{ runs: RunDto[] }>(
      `/api/groups/${w.g.id}/timeline`,
    )
    expect(runsRes.body.runs.find((r) => r.id === start.runId)?.sync).toEqual({ outcome: 'held', files: 2 })
  })

  it('a relay hop starts only once the previous hop reported run.done, i.e. after its submit settled (F10)', async () => {
    connect('A')
    connect('B')
    const first = await dispatch('A', w.a.id, { handoffs: [{ botId: w.b.id, task: '接着做' }] })
    await new Promise((r) => setTimeout(r, 100))
    expect(sent.B.filter((m) => m.t === 'run.start')).toEqual([])

    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'run', runId: first.runId }))
    done('A', first.runId, { outcome: 'accepted', version: 1, merged: false })
    const hop = await vi.waitFor(() => {
      const s = sent.B.find((m): m is RunStart => m.t === 'run.start')
      if (!s) throw new Error('no hop yet')
      return s
    })
    expect(hop.sync).toMatchObject({ headVersion: 1 })
  })
})

describe('sync round across replicas', () => {
  it('a reconnecting machine is told the head of each force group it hosts', async () => {
    connect('B')
    await submit('B', w.msg(w.b.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    connect('A')
    await vi.waitFor(() =>
      expect(sent.A).toContainEqual({ t: 'sync.available', groupId: w.g.id, version: 1 }),
    )
  })

  it('submit → available → applied leaves both replicas consistent', async () => {
    await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.botId, w.c.id))
    connect('A')
    connect('B')
    const x = await change(w, 'a.txt', 'x')
    expect(await submit('B', w.msg(w.b.id, [x], { kind: 'init' }))).toEqual({
      outcome: 'accepted',
      version: 1,
    })
    const root1 = sha(`a.txt\0-\0${sha('x')}\n`)
    from('B', { t: 'sync.applied', groupId: w.g.id, botId: w.b.id, version: 1, rootHash: root1 })
    await vi.waitFor(() =>
      expect(sent.A).toContainEqual({ t: 'sync.available', groupId: w.g.id, version: 1 }),
    )
    from('A', { t: 'sync.applied', groupId: w.g.id, botId: w.a.id, version: 1, rootHash: root1 })

    const y = await change(w, 'b.txt', 'y')
    expect(await submit('A', w.msg(w.a.id, [y], { baseVersion: 1 }))).toEqual({
      outcome: 'accepted',
      version: 2,
    })
    const root2 = sha(`a.txt\0-\0${sha('x')}\nb.txt\0-\0${sha('y')}\n`)
    from('A', { t: 'sync.applied', groupId: w.g.id, botId: w.a.id, version: 2, rootHash: root2 })
    await vi.waitFor(() =>
      expect(sent.B).toContainEqual({ t: 'sync.available', groupId: w.g.id, version: 2 }),
    )
    from('B', { t: 'sync.applied', groupId: w.g.id, botId: w.b.id, version: 2, rootHash: root2 })

    await vi.waitFor(async () => {
      const s = await client(t, await t.seed.cookie(w.wang.id)).get<SyncStatusDto>(
        `/api/groups/${w.g.id}/sync`,
      )
      expect(s.body).toMatchObject({ headVersion: 2, consistent: 2, total: 2 })
    })
  })
})
