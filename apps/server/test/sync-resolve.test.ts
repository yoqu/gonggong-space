import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DaemonToServer,
  MessageDto,
  RunStart,
  RunSyncDone,
  ServerToDaemon,
  SyncConflictDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import { groupMembers, messages, notifications, runs, syncConflicts, syncReplicas } from '../src/db/schema.js'
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
  for (const k of ['A', 'B'] as const) t.ctx.hub.register(w[k].machine.id, conns[k])
})
afterEach(() => t.close())

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

const state = (k: 'A' | 'B', botId: string, s: 'drift' | 'held', files: string[]) =>
  from(k, { t: 'sync.state', groupId: w.g.id, botId, state: s, files, total: files.length, reason: null })

const replica = async (botId: string) =>
  (await t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, botId)))[0]!

const issueIs = (botId: string, issue: string | null) =>
  vi.waitFor(async () => expect((await replica(botId)).issue).toBe(issue))

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

const runRow = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
const starts = (k: 'A' | 'B', runId?: string) =>
  sent[k].filter((m): m is RunStart => m.t === 'run.start' && (!runId || m.runId === runId))
const actions = (k: 'A' | 'B') => sent[k].filter((m) => m.t === 'sync.action')

const done = (k: 'A' | 'B', runId: string, sync: RunSyncDone | null, outcome = 'completed' as const) =>
  from(k, {
    t: 'run.done',
    runId,
    outcome,
    reply: '',
    filesChanged: 0,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: null,
    git: null,
    patch: null,
    appendsApplied: 0,
    sync,
  })

/** v1 a.txt=x by a, v2 a.txt=y by a; b's edit z on top of v1 is held. */
async function heldOnB() {
  await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
  await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'y', 'x')], { baseVersion: 1 }))
  const m = w.msg(w.b.id, [await change(w, 'a.txt', 'z', 'x'), await change(w, 'b.txt', 'b')], {
    baseVersion: 1,
  })
  expect((await submit('B', m)).outcome).toBe('conflict')
  state('B', w.b.id, 'held', ['a.txt'])
  const li = client(t, await t.seed.cookie(w.li.id))
  return vi.waitFor(async () => {
    const res = await li.get<SyncConflictDto[]>(`/api/groups/${w.g.id}/sync/conflicts`)
    expect(res.body).toHaveLength(1)
    return res.body[0]!
  })
}

describe('runs wait while a replica has local edits or a held conflict (F11, F12)', () => {
  it('queues with a reason and dispatches once a matching applied clears the issue', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    state('A', w.a.id, 'drift', ['a.txt'])
    await issueIs(w.a.id, 'drift')
    const id = await queue(w.a.id)
    expect(await runRow(id)).toMatchObject({ status: 'queued', step: '等待处理本地改动' })
    expect(starts('A', id)).toEqual([])

    from('A', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.a.id,
      version: 1,
      rootHash: root({ 'a.txt': 'x' }),
    })
    await vi.waitFor(() => expect(starts('A', id)).toHaveLength(1))
  })

  it('a held replica shows its own reason; the other bots of the group keep running', async () => {
    await heldOnB()
    const id = await queue(w.b.id)
    expect(await runRow(id)).toMatchObject({ status: 'queued', step: '等待处理同步冲突' })
    const other = await queue(w.a.id)
    expect(starts('A', other)).toHaveLength(1)
  })

  it('a turn the daemon found drift before is queued again instead of failing, and the replica pauses', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    const id = await queue(w.a.id)
    expect(starts('A', id)).toHaveLength(1)
    done('A', id, { outcome: 'waiting', issue: 'drift' }, 'failed' as never)
    await vi.waitFor(async () =>
      expect(await runRow(id)).toMatchObject({ status: 'queued', step: '等待处理本地改动', startedAt: null }),
    )
    expect((await replica(w.a.id)).issue).toBe('drift')
    expect(starts('A', id)).toHaveLength(1)

    from('A', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.a.id,
      version: 1,
      rootHash: root({ 'a.txt': 'x' }),
    })
    await vi.waitFor(() => expect(starts('A', id)).toHaveLength(2))
  })

  it('after clearing, a replica that missed versions while paused is told the head', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    state('B', w.b.id, 'drift', ['b.txt'])
    await issueIs(w.b.id, 'drift')
    await submit('A', w.msg(w.a.id, [await change(w, 'c.txt', 'c')], { baseVersion: 1 }))
    expect(sent.B.filter((m) => m.t === 'sync.available' && m.version === 2)).toEqual([])
    from('B', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.b.id,
      version: 1,
      rootHash: root({ 'a.txt': 'x' }),
    })
    await vi.waitFor(() =>
      expect(sent.B).toContainEqual({ t: 'sync.available', groupId: w.g.id, version: 2 }),
    )
  })
})

describe('local edits (F12)', () => {
  it("tells the bot's owner once, not on every repeated report", async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    state('B', w.b.id, 'drift', ['a.txt', 'b.txt'])
    state('B', w.b.id, 'drift', ['a.txt', 'b.txt'])
    await issueIs(w.b.id, 'drift')
    await new Promise((r) => setTimeout(r, 50))
    const rows = await t.db.select().from(notifications).where(eq(notifications.type, 'sync_drift'))
    expect(rows.map((r) => r.userId)).toEqual([w.li.id])
    expect(rows[0]!.payload).toMatchObject({
      groupId: w.g.id,
      botId: w.b.id,
      botName: '老李的 Codex',
      files: 2,
    })
  })

  it('submit / discard go to the machine, for the owner or a group admin only', async () => {
    state('B', w.b.id, 'drift', ['a.txt'])
    await issueIs(w.b.id, 'drift')
    const url = `/api/groups/${w.g.id}/sync/replicas/${w.b.id}/drift`
    const zhang = await t.seed.user({ name: '张三' })
    await t.db.insert(groupMembers).values({ groupId: w.g.id, userId: zhang.id })
    expect((await client(t, await t.seed.cookie(zhang.id)).post(url, { choice: 'submit' })).status).toBe(403)
    expect((await client(t, await t.seed.cookie(w.outsider.id)).post(url, { choice: 'submit' })).status).toBe(
      404,
    )
    expect(actions('B')).toEqual([])

    expect((await client(t, await t.seed.cookie(w.li.id)).post(url, { choice: 'submit' })).status).toBe(200)
    expect((await client(t, await t.seed.cookie(w.wang.id)).post(url, { choice: 'discard' })).status).toBe(
      200,
    )
    expect(actions('B')).toEqual([
      { t: 'sync.action', groupId: w.g.id, botId: w.b.id, action: { kind: 'drift', choice: 'submit' } },
      { t: 'sync.action', groupId: w.g.id, botId: w.b.id, action: { kind: 'drift', choice: 'discard' } },
    ])
  })

  it('is refused when the replica has no local edits or its machine is offline', async () => {
    const api = client(t, await t.seed.cookie(w.li.id))
    const url = `/api/groups/${w.g.id}/sync/replicas/${w.b.id}/drift`
    expect((await api.post(url, { choice: 'submit' })).status).toBe(409)
    state('B', w.b.id, 'drift', ['a.txt'])
    await issueIs(w.b.id, 'drift')
    t.ctx.hub.unregister(w.B.machine.id, conns.B)
    expect((await api.post(url, { choice: 'submit' })).status).toBe(409)
  })
})

describe('conflicts (F11)', () => {
  it('a held report posts a conflict card and tells the owner and the group admins', async () => {
    const c = await heldOnB()
    const card = await vi.waitFor(async () => {
      const [m] = await t.db
        .select()
        .from(messages)
        .where(and(eq(messages.groupId, w.g.id), eq(messages.kind, 'event')))
      if (!m) throw new Error('no card yet')
      return m
    })
    expect(card.body).toBe('@老李的 Codex 的改动与 v2 冲突：1 个文件')
    const res = await client(t, await t.seed.cookie(w.li.id)).get<{ messages: MessageDto[] }>(
      `/api/groups/${w.g.id}/timeline`,
    )
    expect(res.body.messages.find((m) => m.id === card.id)?.syncConflict).toEqual({ id: c.id, botId: w.b.id })
    const rows = await t.db.select().from(notifications).where(eq(notifications.type, 'sync_conflict'))
    expect(rows.map((r) => r.userId).sort()).toEqual([w.li.id, w.wang.id].sort())
    expect(rows[0]!.payload).toMatchObject({
      botName: '老李的 Codex',
      version: 2,
      files: 1,
      conflictId: c.id,
    })
  })

  it('held again resolves the previous conflict, so only the newest stays open', async () => {
    const first = await heldOnB()
    const m = w.msg(w.b.id, [await change(w, 'a.txt', 'z2', 'y')], { baseVersion: 1, kind: 'merge' })
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'w', 'y')], { baseVersion: 2 }))
    expect((await submit('B', m)).outcome).toBe('conflict')
    state('B', w.b.id, 'held', ['a.txt'])
    await vi.waitFor(async () => {
      const open = (await t.db.select().from(syncConflicts)).filter((r) => !r.resolvedAt)
      expect(open.map((r) => r.submitId)).toEqual([m.submitId])
    })
    expect(
      (await t.db.select().from(syncConflicts).where(eq(syncConflicts.id, first.id)))[0]!.resolvedAt,
    ).not.toBeNull()
  })

  it('keep mine / take theirs are forwarded to the machine; only the owner or an admin may decide', async () => {
    const c = await heldOnB()
    const url = `/api/groups/${w.g.id}/sync/conflicts/${c.id}/resolve`
    const zhang = await t.seed.user({ name: '张三' })
    await t.db.insert(groupMembers).values({ groupId: w.g.id, userId: zhang.id })
    const decisions = [{ path: 'a.txt', choice: 'mine' }]
    expect((await client(t, await t.seed.cookie(zhang.id)).post(url, { decisions })).status).toBe(403)
    expect(
      (
        await client(t, await t.seed.cookie(w.li.id)).post(url, {
          decisions: [{ path: 'x', choice: 'mine' }],
        })
      ).status,
    ).toBe(400)
    expect((await client(t, await t.seed.cookie(w.li.id)).post(url, { decisions })).status).toBe(200)
    expect(actions('B')).toEqual([
      { t: 'sync.action', groupId: w.g.id, botId: w.b.id, action: { kind: 'conflict', decisions } },
    ])
    expect(
      (await client(t, await t.seed.cookie(w.wang.id)).post(`${url.replace('/resolve', '/discard')}`)).status,
    ).toBe(200)
    expect(actions('B').at(-1)).toEqual({
      t: 'sync.action',
      groupId: w.g.id,
      botId: w.b.id,
      action: { kind: 'discard' },
    })
  })

  it('let the bot merge: a merge turn runs ahead of the waiting ones, carrying the decisions', async () => {
    const c = await heldOnB()
    const waiting = await queue(w.b.id)
    const decisions = [{ path: 'a.txt', choice: 'bot' }]
    const res = await client(t, await t.seed.cookie(w.wang.id)).post(
      `/api/groups/${w.g.id}/sync/conflicts/${c.id}/resolve`,
      { decisions },
    )
    expect(res.status).toBe(200)
    expect(actions('B')).toEqual([])
    const start = await vi.waitFor(() => {
      const s = starts('B').find((x) => x.runId !== waiting)
      if (!s) throw new Error('no merge turn yet')
      return s
    })
    expect(start.sync?.resolve).toEqual(decisions)
    expect(start.prompt.text).toContain('a.txt')
    expect(start.prompt.triggeredBy).toBe('王磊')
    expect(starts('B', waiting)).toEqual([])
    expect(
      (
        await client(t, await t.seed.cookie(w.wang.id)).post(
          `/api/groups/${w.g.id}/sync/conflicts/${c.id}/resolve`,
          {
            decisions,
          },
        )
      ).status,
    ).toBe(409)

    done('B', start.runId, { outcome: 'accepted', version: 3, merged: false })
    from('B', {
      t: 'sync.applied',
      groupId: w.g.id,
      botId: w.b.id,
      version: 2,
      rootHash: root({ 'a.txt': 'y' }),
    })
    await vi.waitFor(async () => {
      const [row] = await t.db.select().from(syncConflicts).where(eq(syncConflicts.id, c.id))
      expect(row!.resolvedAt).not.toBeNull()
    })
    await vi.waitFor(() => expect(starts('B', waiting)).toHaveLength(1))
  })

  it('a bot merge needs text on both sides', async () => {
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', 'x')], { kind: 'init' }))
    await submit('A', w.msg(w.a.id, [await change(w, 'a.txt', null, 'x')], { baseVersion: 1 }))
    const m = w.msg(w.b.id, [await change(w, 'a.txt', 'z', 'x')], { baseVersion: 1 })
    expect((await submit('B', m)).outcome).toBe('conflict')
    state('B', w.b.id, 'held', ['a.txt'])
    const api = client(t, await t.seed.cookie(w.li.id))
    const c = await vi.waitFor(async () => {
      const res = await api.get<SyncConflictDto[]>(`/api/groups/${w.g.id}/sync/conflicts`)
      expect(res.body).toHaveLength(1)
      return res.body[0]!
    })
    const res = await api.post(`/api/groups/${w.g.id}/sync/conflicts/${c.id}/resolve`, {
      decisions: [{ path: 'a.txt', choice: 'bot' }],
    })
    expect(res.status).toBe(400)
  })

  it('serves the three sides of a conflicting file as text to who may decide; binary is refused', async () => {
    const c = await heldOnB()
    const url = (hash: string) => `/api/groups/${w.g.id}/sync/conflicts/${c.id}/blobs/${hash}`
    const li = await t.seed.cookie(w.li.id)
    for (const [hash, text] of [
      [sha('z'), 'z'],
      [sha('y'), 'y'],
      [sha('x'), 'x'],
    ] as const) {
      const res = await t.app.inject({ method: 'GET', url: url(hash), headers: { cookie: li } })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe(text)
      expect(res.headers['content-type']).toContain('text/plain')
    }
    const other = await change(w, 'c.txt', 'unrelated')
    const miss = await t.app.inject({ method: 'GET', url: url(other.hash!), headers: { cookie: li } })
    expect(miss.statusCode).toBe(404)
    const outsider = await t.app.inject({
      method: 'GET',
      url: url(sha('z')),
      headers: { cookie: await t.seed.cookie(w.outsider.id) },
    })
    expect(outsider.statusCode).toBe(404)

    const bin = Buffer.from([0, 1, 2, 3])
    await w.put(bin)
    await t.db
      .update(syncConflicts)
      .set({
        changes: [{ path: 'a.txt', hash: sha(bin), exec: false, baseHash: sha('x') }],
      })
      .where(eq(syncConflicts.id, c.id))
    const res = await t.app.inject({ method: 'GET', url: url(sha(bin)), headers: { cookie: li } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('二进制文件')
  })
})
