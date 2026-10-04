import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DaemonToServer,
  ServerToDaemon,
  SyncConflictDto,
  SyncStatusDto,
  SyncVersionDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import { groupBots, syncConflicts, syncReplicas, syncVersions } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'
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
  for (const k of ['A', 'B'] as const) t.ctx.hub.register(w[k].machine.id, conns[k], ['sync'])
})
afterEach(() => t.close())

type D2S = Extract<DaemonToServer, { t: 'sync.submit' | 'sync.applied' | 'sync.state' }>
const from = (k: 'A' | 'B', m: D2S) => t.ctx.hub.emit('message', w[k].machine.id, m)

async function submit(k: 'A' | 'B', m: ReturnType<typeof w.msg>) {
  from(k, m)
  return vi.waitFor(() => {
    const r = sent[k].find((x) => x.t === 'sync.result' && x.submitId === m.submitId)
    if (r?.t !== 'sync.result') throw new Error('no result yet')
    return r.result
  })
}

async function applied(k: 'A' | 'B', botId: string, version: number, rootHash: string) {
  from(k, { t: 'sync.applied', groupId: w.g.id, botId, version, rootHash })
  await vi.waitFor(async () => {
    const [r] = await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, botId))
    if (r?.version !== version) throw new Error('not yet')
  })
}

const status = async (cookie?: string) => {
  const res = await client(t, cookie ?? (await t.seed.cookie(w.wang.id))).get<SyncStatusDto>(
    `/api/groups/${w.g.id}/sync`,
  )
  return res
}
const rootOf = async (version: number) =>
  (await t.db.select().from(syncVersions).where(eq(syncVersions.version, version)))[0]!.rootHash

describe('sync engine', () => {
  it('answers sync.submit and tells every other replica machine, not the submitter alone', async () => {
    const res = await submit('B', w.msg(w.b.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    expect(res).toEqual({ outcome: 'accepted', version: 1 })
    await vi.waitFor(() =>
      expect(sent.A).toContainEqual({ t: 'sync.available', groupId: w.g.id, version: 1 }),
    )
    expect(sent.B.filter((m) => m.t === 'sync.available')).toEqual([])
  })

  it('a machine whose only replica submitted gets no sync.available; a shared machine still does', async () => {
    await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.botId, w.c.id))
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await vi.waitFor(() =>
      expect(sent.B).toContainEqual({ t: 'sync.available', groupId: w.g.id, version: 1 }),
    )
    expect(sent.A.filter((m) => m.t === 'sync.available')).toEqual([])
  })

  it('pushes group.sync to members on every change', async () => {
    const got: WebEvent[] = events(t, w.li.id)
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await vi.waitFor(() => expect(got.some((e) => e.t === 'group.sync' && e.headVersion === 1)).toBe(true))
  })
})

describe('applied and status', () => {
  it('a replica at head with the head root hash is consistent; a mismatch is flagged', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await applied('A', w.a.id, 1, await rootOf(1))
    await applied('B', w.b.id, 1, sha('wrong'))
    const { status: code, body } = await status()
    expect(code).toBe(200)
    const by = (id: string) => body.replicas.find((r) => r.botId === id)!
    expect(body).toMatchObject({ groupId: w.g.id, headVersion: 1, consistent: 1, total: 3 })
    expect(by(w.a.id)).toMatchObject({
      botName: '小王的 Claude',
      machineName: 'wang-mac',
      version: 1,
      state: 'consistent',
    })
    expect(by(w.b.id)).toMatchObject({ state: 'drift', version: 1 })
    expect(by(w.b.id).reason).toContain('v1')
    expect(by(w.c.id)).toMatchObject({ state: 'syncing', version: null })
  })

  it('derives behind, offline, excluded, drift and conflict', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await applied('A', w.a.id, 1, await rootOf(1))
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'y', 'x')], { baseVersion: 1 }))
    await t.db
      .update(syncVersions)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(syncVersions.version, 2))
    from('B', {
      t: 'sync.state',
      groupId: w.g.id,
      botId: w.b.id,
      state: 'drift',
      files: ['a.txt'],
      total: 1,
      reason: null,
    })
    await vi.waitFor(async () => {
      const [r] = await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, w.b.id))
      expect(r?.issue).toBe('drift')
    })
    let body = (await status()).body
    const by = (id: string) => body.replicas.find((r) => r.botId === id)!
    expect(by(w.a.id).state).toBe('behind')
    expect(by(w.b.id)).toMatchObject({ state: 'drift', files: ['a.txt'] })

    from('A', {
      t: 'sync.state',
      groupId: w.g.id,
      botId: w.c.id,
      state: 'dirty',
      files: ['x'],
      total: 1,
      reason: null,
    })
    await vi.waitFor(async () => {
      const [r] = await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, w.c.id))
      expect(r?.issue).toBe('dirty')
    })
    t.ctx.hub.unregister(w.B.machine.id, conns.B)
    body = (await status()).body
    expect(by(w.c.id).state).toBe('excluded')
    expect(by(w.b.id).state).toBe('offline')
    expect(body.total).toBe(2)
  })

  it('a held report turns the last conflict into an open conflict, cleared by a matching applied', async () => {
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
    const li = client(t, await t.seed.cookie(w.li.id))
    const list = await vi.waitFor(async () => {
      const res = await li.get<SyncConflictDto[]>(`/api/groups/${w.g.id}/sync/conflicts`)
      expect(res.body).toHaveLength(1)
      return res.body
    })
    expect(list[0]).toMatchObject({
      botId: w.b.id,
      versionBase: 1,
      headVersion: 2,
      files: [{ path: 'a.txt', binary: false, mineHash: sha('z'), theirsHash: sha('y'), baseHash: sha('x') }],
    })
    expect((await status()).body.replicas.find((r) => r.botId === w.b.id)!.state).toBe('conflict')
    await applied('B', w.b.id, 2, await rootOf(2))
    const [row] = await t.db.select().from(syncConflicts)
    expect(row!.resolvedAt).not.toBeNull()
    expect((await li.get<SyncConflictDto[]>(`/api/groups/${w.g.id}/sync/conflicts`)).body).toEqual([])
  })
})

describe('web routes', () => {
  it('lists versions newest first with author names and paging', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'y', 'x')], { kind: 'local' }))
    await submit('A', w.msg(w.a.id, [await change(w, 'b.txt', 'b')]))
    const api = client(t, await t.seed.cookie(w.li.id))
    const all = await api.get<SyncVersionDto[]>(`/api/groups/${w.g.id}/sync/versions`)
    expect(all.body.map((v) => v.version)).toEqual([3, 2, 1])
    expect(all.body[1]).toMatchObject({
      author: { kind: 'user', id: w.wang.id, name: '王磊' },
      tags: ['local'],
      files: 1,
    })
    expect(all.body[2]!.author).toEqual({ kind: 'bot', id: w.a.id, name: '小王的 Claude' })
    const page = await api.get<SyncVersionDto[]>(`/api/groups/${w.g.id}/sync/versions?before=3&limit=1`)
    expect(page.body.map((v) => v.version)).toEqual([2])
  })

  it('is for group members only', async () => {
    const res = await status(await t.seed.cookie(w.outsider.id))
    expect(res.status).toBe(404)
  })
})
