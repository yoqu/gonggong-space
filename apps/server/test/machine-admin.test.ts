import { PROTOCOL_VERSION } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
afterEach(() => t.close())
beforeEach(async () => {
  t = await createTestApp()
})

type Msg = Record<string, unknown> & { t: string; requestId: string }

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function world(features = ['machineAdmin']) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.9.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
      features,
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  await until(() => t.ctx.hub.isOnline(machine.id))
  return {
    machine,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    next: () => box.next<Msg>(),
    send: (m: unknown) => ws.send(JSON.stringify(m)),
  }
}

describe('我的机器管理: logs and workspaces through the daemon', () => {
  it("relays the owner's log request and answers with the daemon's masked lines", async () => {
    const w = await world()
    const pending = w.asWang.get(`/api/machines/${w.machine.id}/logs?level=warn&limit=50`)
    const ask = await w.next()
    expect(ask).toMatchObject({ t: 'logs.get', level: 'warn', limit: 50 })
    const lines = [{ level: 'warn', text: '10:23:01 WARN  tunnel retry' }]
    w.send({ t: 'logs.result', requestId: ask.requestId, lines, error: null })
    expect(await pending).toEqual({ status: 200, body: { lines } })

    expect((await w.asLi.get(`/api/machines/${w.machine.id}/logs`)).status).toBe(403)
  })

  it('lists workspaces and deletes one, reporting what the daemon refused', async () => {
    const w = await world()
    const entry = {
      groupId: 'g',
      groupName: null,
      dm: false,
      botId: 'b',
      botName: null,
      kind: 'managed',
      path: '/h/.gonggong/workspaces/g/b/_empty',
      size: 1024,
      state: 'removed',
    }
    const listing = w.asWang.get(`/api/machines/${w.machine.id}/workspaces`)
    const list = await w.next()
    w.send({ t: 'workspaces.result', requestId: list.requestId, entries: [entry], error: null })
    // An older daemon sends none of the 空间 fields; they come back null.
    expect(await listing).toEqual({
      status: 200,
      body: { entries: [{ ...entry, lastUsedAt: null, changes: null }], disk: null },
    })

    const target = { groupId: 'g', botId: 'b', path: entry.path }
    const refused = w.asWang.post<{ message: string }>(
      `/api/machines/${w.machine.id}/workspaces/delete`,
      target,
    )
    const first = await w.next()
    expect(first).toMatchObject({ t: 'workspace.delete', ...target })
    w.send({
      t: 'workspace.delete.result',
      requestId: first.requestId,
      error: '只能删除已移出或未使用的托管工作区',
    })
    expect(await refused).toMatchObject({
      status: 400,
      body: { message: '只能删除已移出或未使用的托管工作区' },
    })

    const deleting = w.asWang.post(`/api/machines/${w.machine.id}/workspaces/delete`, target)
    const second = await w.next()
    w.send({ t: 'workspace.delete.result', requestId: second.requestId, error: null })
    expect((await deleting).status).toBe(204)
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'workspace.delete'))
    expect(log?.detail).toMatchObject({ machineId: w.machine.id, ...target })
  })

  it("passes the daemon's last use, unpushed work and disk through", async () => {
    const w = await world(['machineAdmin', 'storageAdmin'])
    const entry = {
      groupId: 'g',
      groupName: '退款',
      dm: false,
      botId: 'b',
      botName: '小王',
      kind: 'managed',
      path: '/h/.gonggong/workspaces/g/b/refund',
      size: 4096,
      state: 'idle',
      lastUsedAt: 1_700_000_000_000,
      changes: { uncommitted: 2, unpushed: 1 },
    }
    const disk = { free: 10_000, total: 50_000 }
    const listing = w.asWang.get(`/api/machines/${w.machine.id}/workspaces`)
    const list = await w.next()
    w.send({ t: 'workspaces.result', requestId: list.requestId, entries: [entry], disk, error: null })
    expect(await listing).toEqual({ status: 200, body: { entries: [entry], disk } })
  })

  it('slims a workspace with git gc and records it, only on daemons that can', async () => {
    const w = await world(['machineAdmin', 'storageAdmin'])
    const target = { groupId: 'g', botId: 'b', path: '/h/.gonggong/workspaces/g/b/refund' }
    const refused = w.asWang.post<{ message: string }>(`/api/machines/${w.machine.id}/workspaces/gc`, target)
    const first = await w.next()
    expect(first).toMatchObject({ t: 'workspace.gc', ...target })
    w.send({
      t: 'workspace.gc.result',
      requestId: first.requestId,
      before: 0,
      after: 0,
      error: '工作区正在运行',
    })
    expect(await refused).toMatchObject({ status: 400, body: { message: '工作区正在运行' } })

    const gc = w.asWang.post(`/api/machines/${w.machine.id}/workspaces/gc`, target)
    const second = await w.next()
    w.send({ t: 'workspace.gc.result', requestId: second.requestId, before: 9000, after: 3000, error: null })
    expect(await gc).toEqual({ status: 200, body: { before: 9000, after: 3000 } })
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'workspace.gc'))
    expect(log?.detail).toMatchObject({ machineId: w.machine.id, ...target, before: 9000, after: 3000 })

    expect((await w.asLi.post(`/api/machines/${w.machine.id}/workspaces/gc`, target)).status).toBe(403)
    const old = await world()
    const res = await old.asWang.post<{ message: string }>(
      `/api/machines/${old.machine.id}/workspaces/gc`,
      target,
    )
    expect(res).toMatchObject({ status: 409, body: { message: '请先升级该机器的 daemon' } })
  })

  it('asks for a daemon upgrade when the machine cannot answer', async () => {
    const w = await world([])
    const res = await w.asWang.get<{ message: string }>(`/api/machines/${w.machine.id}/workspaces`)
    expect(res).toMatchObject({ status: 409, body: { message: '请先升级该机器的 daemon' } })
  })
})
