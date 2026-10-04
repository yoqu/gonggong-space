import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYNC_FILE_MAX_BYTES, type SyncChangesRes, type SyncEntry, syncRootText } from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groups, syncHead, syncReplicas, syncVersions } from '../src/db/schema.js'
import { blobPath, purgeSyncBlobs } from '../src/modules/sync/blobs.js'
import { submitSync } from '../src/modules/sync/store.js'
import { createTestApp, type TestApp } from './support/app.js'
import { change, sha, syncWorld } from './support/sync.js'

let t: TestApp
let w: Awaited<ReturnType<typeof syncWorld>>
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
  w = await syncWorld(t)
})
afterEach(() => t.close())

const submitA = (m: ReturnType<typeof w.msg>) => submitSync(t.ctx, w.A.machine.id, m)
const head = async () =>
  (
    await t.db
      .select({ path: syncHead.path, hash: syncHead.hash, exec: syncHead.exec })
      .from(syncHead)
      .where(eq(syncHead.groupId, w.g.id))
      .orderBy(asc(syncHead.path))
  ).map((e) => ({ ...e }))

/** v1 with readme.md = "hello" and src/a.ts = "a1". */
async function init() {
  const res = await submitA(
    w.msg(w.a.id, [await change(w, 'readme.md', 'hello'), await change(w, 'src/a.ts', 'a1')], {
      kind: 'init',
    }),
  )
  expect(res).toEqual({ outcome: 'accepted', version: 1 })
}

describe('blobs', () => {
  it('stores sealed content addressed by its sha256 and serves the plaintext, gzip accepted', async () => {
    expect((await w.put('hello world')).statusCode).toBe(204)
    expect((await w.put('zipped', { gzip: true })).statusCode).toBe(204)
    const disk = readFileSync(
      join(process.env.GONGGONG_DATA_DIR as string, 'sync', w.g.id, sha('hello world')),
    )
    expect(disk.includes(Buffer.from('hello world'))).toBe(false)
    for (const s of ['hello world', 'zipped']) {
      const res = await t.app.inject({ url: `/api/daemon/sync/${w.g.id}/blobs/${sha(s)}`, headers: w.auth() })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe(s)
    }
  })

  it('rejects content whose hash differs, and keeps nothing', async () => {
    const res = await w.put('evil', { hash: sha('good') })
    expect(res.statusCode).toBe(400)
    const get = await t.app.inject({
      url: `/api/daemon/sync/${w.g.id}/blobs/${sha('good')}`,
      headers: w.auth(),
    })
    expect(get.statusCode).toBe(404)
  })

  it('rejects files over the size limit', async () => {
    const big = Buffer.alloc(SYNC_FILE_MAX_BYTES + 1)
    expect((await w.put(big)).statusCode).toBe(400)
  }, 30_000)

  it('lists the missing hashes', async () => {
    await w.put('have')
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/sync/${w.g.id}/blobs/missing`,
      headers: w.auth(),
      payload: { hashes: [sha('have'), sha('lack')] },
    })
    expect(res.json()).toEqual({ missing: [sha('lack')] })
  })

  it('only machines hosting a bot of a force group may touch its blobs', async () => {
    const stranger = await t.seed.machine(w.outsider.id)
    expect((await w.put('x', { token: stranger.token })).statusCode).toBe(403)
    expect((await w.put('x', { token: w.B.token })).statusCode).toBe(204)
    await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.botId, w.b.id))
    const get = await t.app.inject({
      url: `/api/daemon/sync/${w.g.id}/blobs/${sha('x')}`,
      headers: w.auth(w.B.token),
    })
    expect(get.statusCode).toBe(403)
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
    expect((await w.put('y')).statusCode).toBe(403)
    expect((await t.app.inject({ url: `/api/daemon/sync/${w.g.id}/blobs/${sha('x')}` })).statusCode).toBe(401)
  })
})

describe('submit (§3.2 compare-and-swap)', () => {
  it('init creates v1 whose root hash is the sha256 of syncRootText over the head', async () => {
    await init()
    const entries = await head()
    expect(entries).toEqual([
      { path: 'readme.md', hash: sha('hello'), exec: false },
      { path: 'src/a.ts', hash: sha('a1'), exec: false },
    ])
    const [v] = await t.db.select().from(syncVersions).where(eq(syncVersions.groupId, w.g.id))
    expect(v).toMatchObject({ version: 1, tags: ['init'], files: 2, authorKind: 'bot', authorId: w.a.id })
    expect(v!.rootHash).toBe(sha(syncRootText(entries)))
  })

  it('takes concurrent disjoint changes as consecutive versions', async () => {
    await init()
    const c1 = await change(w, 'readme.md', 'hello2', 'hello')
    const c2 = await change(w, 'src/b.ts', 'b1')
    const [r1, r2] = await Promise.all([
      submitA(w.msg(w.a.id, [c1], { baseVersion: 1 })),
      submitSync(t.ctx, w.B.machine.id, w.msg(w.b.id, [c2], { baseVersion: 1 })),
    ])
    expect([r1, r2].map((r) => (r.outcome === 'accepted' ? r.version : 0)).sort()).toEqual([2, 3])
    expect((await head()).map((e) => e.path)).toEqual(['readme.md', 'src/a.ts', 'src/b.ts'])
  })

  it('refuses a change to a file someone else changed, writing nothing', async () => {
    await init()
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')], { baseVersion: 1 }))
    const res = await submitSync(
      t.ctx,
      w.B.machine.id,
      w.msg(w.b.id, [await change(w, 'src/a.ts', 'a3', 'a1'), await change(w, 'new.ts', 'n')], {
        baseVersion: 1,
      }),
    )
    expect(res).toEqual({
      outcome: 'conflict',
      headVersion: 2,
      conflicts: [{ path: 'src/a.ts', hash: sha('a2'), exec: false }],
    })
    expect((await head()).map((e) => e.path)).toEqual(['readme.md', 'src/a.ts'])
    const [r] = await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, w.b.id))
    expect(r!.lastConflict).toMatchObject({ headVersion: 2, baseVersion: 1 })
  })

  it('passes a change identical to the head, without a new version when nothing else changed', async () => {
    await init()
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')], { baseVersion: 1 }))
    const same = await submitSync(
      t.ctx,
      w.B.machine.id,
      w.msg(w.b.id, [await change(w, 'src/a.ts', 'a2', 'a1')], { baseVersion: 1 }),
    )
    expect(same).toEqual({ outcome: 'accepted', version: 2 })
    const plus = await submitSync(
      t.ctx,
      w.B.machine.id,
      w.msg(w.b.id, [await change(w, 'src/a.ts', 'a2', 'a1'), await change(w, 'x.ts', 'x')], {
        baseVersion: 1,
      }),
    )
    expect(plus).toEqual({ outcome: 'accepted', version: 3 })
    const [v3] = await t.db
      .select()
      .from(syncVersions)
      .where(and(eq(syncVersions.groupId, w.g.id), eq(syncVersions.version, 3)))
    expect(v3!.files).toBe(1)
  })

  it('refuses deleting a file someone modified; deleting an already deleted file passes', async () => {
    await init()
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')], { baseVersion: 1 }))
    const del = await submitSync(
      t.ctx,
      w.B.machine.id,
      w.msg(w.b.id, [await change(w, 'src/a.ts', null, 'a1')], { baseVersion: 1 }),
    )
    expect(del.outcome).toBe('conflict')
    expect(await submitA(w.msg(w.a.id, [await change(w, 'readme.md', null, 'hello')]))).toEqual({
      outcome: 'accepted',
      version: 3,
    })
    const again = await submitSync(
      t.ctx,
      w.B.machine.id,
      w.msg(w.b.id, [await change(w, 'readme.md', null, 'hello')], { baseVersion: 1 }),
    )
    expect(again).toEqual({ outcome: 'accepted', version: 3 })
  })

  it('refuses a file where the head has a directory and the other way round', async () => {
    await init()
    const asFile = await submitA(w.msg(w.a.id, [await change(w, 'src', 'oops')], { baseVersion: 1 }))
    expect(asFile).toEqual({
      outcome: 'conflict',
      headVersion: 1,
      conflicts: [{ path: 'src', hash: null, exec: false }],
    })
    const asDir = await submitA(w.msg(w.a.id, [await change(w, 'readme.md/x', 'oops')], { baseVersion: 1 }))
    expect(asDir.outcome).toBe('conflict')
    const replaced = await submitA(
      w.msg(w.a.id, [await change(w, 'src/a.ts', null, 'a1'), await change(w, 'src', 'file now')], {
        baseVersion: 1,
      }),
    )
    expect(replaced).toEqual({ outcome: 'accepted', version: 2 })
  })

  it('returns the same result for a resubmitted submitId', async () => {
    await init()
    const m = w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')], { baseVersion: 1 })
    expect(await submitA(m)).toEqual({ outcome: 'accepted', version: 2 })
    expect(await submitA(m)).toEqual({ outcome: 'accepted', version: 2 })
    expect(await t.db.select().from(syncVersions).where(eq(syncVersions.groupId, w.g.id))).toHaveLength(2)
  })

  it('a switch base larger than one insert batch replaces the head whole, and its resubmit answers the same', async () => {
    await init()
    await t.db.update(syncReplicas).set({ pending: 'base' }).where(eq(syncReplicas.botId, w.a.id))
    for (const s of ['x', 'y']) await w.put(s)
    const tree = Array.from({ length: 12_001 }, (_, i) => ({
      path: `big/${Math.floor(i / 500)}/f${i}.txt`,
      hash: sha(i % 2 ? 'x' : 'y'),
      baseHash: null,
      exec: i % 7 === 0,
    }))
    const m = w.msg(w.a.id, tree, { kind: 'init' })
    expect(await submitA(m)).toEqual({ outcome: 'accepted', version: 2 })
    expect(await submitA(m)).toEqual({ outcome: 'accepted', version: 2 })
    const entries = await head()
    expect(entries).toHaveLength(12_001)
    expect(entries.some((e) => e.path === 'readme.md')).toBe(false)
    const [v] = await t.db
      .select()
      .from(syncVersions)
      .where(and(eq(syncVersions.groupId, w.g.id), eq(syncVersions.version, 2)))
    expect(v).toMatchObject({ files: 12_003, tags: ['init'] })
    expect(v!.rootHash).toBe(sha(syncRootText(tree)))
    const res = await t.app.inject({ url: `/api/daemon/sync/${w.g.id}/changes?from=1`, headers: w.auth() })
    expect((res.json() as SyncChangesRes).entries).toHaveLength(12_003)
  }, 30_000)

  it('rejects changes whose blobs were not uploaded', async () => {
    const res = await submitA(w.msg(w.a.id, [{ path: 'a', hash: sha('never'), baseHash: null, exec: false }]))
    expect(res).toEqual({ outcome: 'rejected', reason: 'blobs_missing' })
  })

  it('rejects replicas that do not take part', async () => {
    const bad = (machineId: string, botId: string) => submitSync(t.ctx, machineId, w.msg(botId, []))
    expect(await bad(w.B.machine.id, w.a.id)).toEqual({ outcome: 'rejected', reason: 'not_participating' })
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/x' })
      .where(and(eq(groupBots.groupId, w.g.id), eq(groupBots.botId, w.c.id)))
    expect(await bad(w.A.machine.id, w.c.id)).toEqual({ outcome: 'rejected', reason: 'not_participating' })
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
    expect(await bad(w.A.machine.id, w.a.id)).toEqual({ outcome: 'rejected', reason: 'not_participating' })
  })

  it('tags versions by kind and auto merge; a local change is authored by the bot owner', async () => {
    await init()
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')], { merged: true, kind: 'run' }))
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a3', 'a2')], { kind: 'local' }))
    const vs = await t.db
      .select()
      .from(syncVersions)
      .where(eq(syncVersions.groupId, w.g.id))
      .orderBy(asc(syncVersions.version))
    expect(vs.map((v) => v.tags)).toEqual([['init'], ['auto_merge'], ['local']])
    expect(vs[2]).toMatchObject({ authorKind: 'user', authorId: w.wang.id })
  })
})

describe('GET /api/daemon/sync/:groupId/changes', () => {
  const changes = async (from: number) => {
    const res = await t.app.inject({
      url: `/api/daemon/sync/${w.g.id}/changes?from=${from}`,
      headers: w.auth(),
    })
    return res.json<SyncChangesRes>()
  }
  const e = (path: string, content: string | null, exec = false): SyncEntry => ({
    path,
    hash: content === null ? null : sha(content),
    exec,
  })

  it('lists the latest entry per path changed after `from`; from=0 is the whole head', async () => {
    await init()
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')]))
    await submitA(
      w.msg(w.a.id, [await change(w, 'src/a.ts', 'a3', 'a2'), await change(w, 'readme.md', null, 'hello')]),
    )
    await submitA(w.msg(w.a.id, [await change(w, 'run.sh', 'echo', null, true)]))
    expect(await changes(0)).toEqual({
      headVersion: 4,
      entries: [e('run.sh', 'echo', true), e('src/a.ts', 'a3')],
    })
    expect(await changes(1)).toEqual({
      headVersion: 4,
      entries: [e('readme.md', null), e('run.sh', 'echo', true), e('src/a.ts', 'a3')],
    })
    expect(await changes(3)).toEqual({ headVersion: 4, entries: [e('run.sh', 'echo', true)] })
    expect(await changes(4)).toEqual({ headVersion: 4, entries: [] })
  })
})

describe('blob retention (F16)', () => {
  it('keeps blobs of the head, of recent versions and fresh uploads; drops the rest', async () => {
    await init()
    await submitA(w.msg(w.a.id, [await change(w, 'src/a.ts', 'a2', 'a1')]))
    await w.put('stale upload')
    await w.put('fresh upload')
    const old = new Date(Date.now() - 2 * 86_400_000)
    for (const s of ['hello', 'a1', 'a2', 'stale upload']) utimesSync(blobPath(w.g.id, sha(s)), old, old)
    await t.db.update(syncVersions).set({ createdAt: new Date(Date.now() - 31 * 86_400_000) })
    await purgeSyncBlobs(t.ctx)
    const kept = (s: string) => existsSync(blobPath(w.g.id, sha(s)))
    expect(['hello', 'a1', 'a2', 'stale upload', 'fresh upload'].map(kept)).toEqual([
      true,
      false,
      true,
      false,
      true,
    ])
  })
})
