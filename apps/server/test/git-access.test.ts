import { Writable } from 'node:stream'
import { type DiagCheck, type GitAccessTest, type GitAccessView, PROTOCOL_VERSION } from '@gonggong/protocol'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const TOKEN = 'glpat-TEST-1a2b3c4d5e6f7a8b'

let t: TestApp
let log: string
afterEach(() => t.close())

type Msg = Record<string, unknown> & { t: string; requestId: string }

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function world() {
  log = ''
  const logStream = new Writable({
    write(chunk, _enc, done) {
      log += String(chunk)
      done()
    },
  })
  t = await createTestApp({ logStream })
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const a = await t.seed.machine(wang.id)
  return {
    a,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
  }
}

async function daemon(token: string, machineId: string, features: string[]) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.9.0',
      machine: { name: 'gg-server-1', os: 'linux', arch: 'x86_64' },
      agents: [],
      features,
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  await until(() => t.ctx.hub.isOnline(machineId))
  return {
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: () => box.next<Msg>(),
    close: async () => {
      ws.close()
      await box.closed
      await until(() => !t.ctx.hub.isOnline(machineId))
    },
  }
}

const view = (o: Partial<GitAccessView> = {}): GitAccessView => ({
  sshKeys: [],
  tokens: [],
  helper: null,
  knownHosts: [],
  ...o,
})

describe("a machine's git access, relayed to its daemon", () => {
  it('is for the owner of an online machine whose daemon has it', async () => {
    const w = await world()
    const url = `/api/machines/${w.a.machine.id}/git-access`
    expect((await w.asWang.get<{ message: string }>(url)).body.message).toBe('机器离线')
    const old = await daemon(w.a.token, w.a.machine.id, [])
    const res = await w.asWang.get<{ message: string }>(url)
    expect([res.status, res.body.message]).toEqual([409, '请先升级该机器的 daemon'])
    const diag = await w.asWang.get<{ message: string }>(`/api/machines/${w.a.machine.id}/diag`)
    expect([diag.status, diag.body.message]).toEqual([409, '请先升级该机器的 daemon'])
    await old.close()
    await daemon(w.a.token, w.a.machine.id, ['gitAccess'])
    expect((await w.asLi.get(url)).status).toBe(403)
  })

  it('relays each action and keeps no token server-side', async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id, ['gitAccess'])
    const base = `/api/machines/${w.a.machine.id}/git-access`
    const answer = (cmd: Msg, o: Record<string, unknown> = {}) =>
      d.send({
        t: 'gitaccess.result',
        requestId: cmd.requestId,
        ok: true,
        error: null,
        view: view(),
        test: null,
        ...o,
      })

    const status = w.asWang.get<GitAccessView>(base)
    const statusCmd = await d.next()
    expect(statusCmd).toMatchObject({ t: 'gitaccess.cmd', action: 'status' })
    answer(statusCmd)
    expect((await status).body).toEqual(view())

    const key = {
      path: '/home/gg/.ssh/id_ed25519.pub',
      type: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      publicKey: 'ssh-ed25519 AAAA gonggong@gg-server-1',
      comment: 'gonggong@gg-server-1',
    }
    const gen = w.asWang.post<GitAccessView>(`${base}/ssh-key`, {})
    const genCmd = await d.next()
    expect(genCmd).toMatchObject({ action: 'genKey' })
    answer(genCmd, { view: view({ sshKeys: [key] }) })
    expect((await gen).body.sshKeys).toEqual([key])

    const save = w.asWang.put<GitAccessView>(`${base}/tokens`, {
      host: 'gitlab.example.com',
      username: 'wanglei',
      secret: TOKEN,
    })
    const saveCmd = await d.next()
    expect(saveCmd).toMatchObject({
      action: 'saveToken',
      token: { host: 'gitlab.example.com', username: 'wanglei', secret: TOKEN },
    })
    const tokens = [{ host: 'gitlab.example.com', username: 'wanglei', masked: 'glpa…' }]
    answer(saveCmd, { view: view({ tokens }) })
    const saved = await save
    expect(saved.body.tokens).toEqual(tokens)
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN)

    const bad = await w.asWang.put<{ message: string }>(`${base}/tokens`, {
      host: 'evil.com/x',
      username: 'u',
      secret: TOKEN,
    })
    expect([bad.status, bad.body.message]).toEqual([400, '主机名只能包含字母、数字、点、短横线和端口'])

    const test = w.asWang.post<GitAccessTest>(`${base}/test`, { url: 'git@github.com:acme/pay.git' })
    const testCmd = await d.next()
    expect(testCmd).toMatchObject({ action: 'test', url: 'git@github.com:acme/pay.git' })
    const result: GitAccessTest = {
      url: 'git@github.com:acme/pay.git',
      ok: false,
      reason: 'denied',
      detail: 'Permission denied (publickey).',
      hostKey: null,
    }
    answer(testCmd, { test: result })
    expect((await test).body).toEqual(result)

    const trust = w.asWang.post<GitAccessView>(`${base}/known-hosts`, { host: 'git.corp:2222' })
    const trustCmd = await d.next()
    expect(trustCmd).toMatchObject({ action: 'trustHost', host: 'git.corp:2222' })
    answer(trustCmd)
    expect((await trust).status).toBe(200)

    const remove = w.asWang.del<GitAccessView>(`${base}/tokens/gitlab.example.com`)
    const removeCmd = await d.next()
    expect(removeCmd).toMatchObject({ action: 'removeToken', host: 'gitlab.example.com' })
    d.send({
      t: 'gitaccess.result',
      requestId: removeCmd.requestId,
      ok: false,
      error: '主机名无效',
      view: view(),
      test: null,
    })
    expect(await remove).toMatchObject({ status: 400, body: { message: '主机名无效' } })

    const tables = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    for (const { table_name } of tables) {
      const rows = await t.db.execute(
        sql`select row_to_json(x)::text as j from ${sql.identifier(table_name)} x`,
      )
      expect(rows.map((r) => (r as { j: string }).j).join('\n'), table_name).not.toContain(TOKEN)
    }
    const trail = await t.db.select().from(auditLogs)
    expect(trail.map((r) => [r.action, r.detail])).toEqual([
      ['machine.git.key', { machineId: w.a.machine.id }],
      ['machine.git.token', { machineId: w.a.machine.id, host: 'gitlab.example.com' }],
      ['machine.git.trust', { machineId: w.a.machine.id, host: 'git.corp:2222' }],
    ])
    expect(log).toContain('/git-access/tokens')
    expect(log).not.toContain(TOKEN)
  })

  it("answers with the machine's self-checks", async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id, ['diag'])
    const pending = w.asWang.get<DiagCheck[]>(`/api/machines/${w.a.machine.id}/diag`)
    const cmd = await d.next()
    expect(cmd).toMatchObject({ t: 'diag.run' })
    const checks: DiagCheck[] = [{ kind: 'git', status: 'error', detail: 'SSH · Permission denied' }]
    d.send({ t: 'diag.result', requestId: cmd.requestId, checks })
    expect((await pending).body).toEqual(checks)
  })
})
