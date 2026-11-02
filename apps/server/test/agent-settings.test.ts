import { Writable } from 'node:stream'
import {
  type BotDto,
  type DaemonBotDto,
  type MessageDto,
  PROTOCOL_VERSION,
  type ProviderStoreView,
  type RunDetailDto,
  type RunSettingsSnapshot,
  type ServerToDaemon,
} from '@gonggong/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
let log: string
afterEach(() => t.close())

async function world() {
  log = ''
  const logStream = new Writable({
    write(chunk, _enc, done) {
      log += String(chunk)
      done()
    },
  })
  t = await createTestApp({ logStream })
  const owner = await t.seed.user({ name: '王磊' })
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: owner.id, name: 'cx', agentKind: 'codex', machineId: machine.id })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const owners = client(t, await t.seed.cookie(owner.id))
  const admins = client(t, await t.seed.cookie(admin.id))
  return { owner, machine, token, bot, codex, group, owners, admins }
}
type World = Awaited<ReturnType<typeof world>>

type Msg = Record<string, unknown> & { t: string; requestId: string }

async function daemon(w: World, features: string[] = []) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token: w.token,
    daemonVersion: '0.9.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: [],
    features,
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  await expect.poll(() => t.ctx.hub.isOnline(w.machine.id)).toBe(true)
  return { send, next: <T = Msg>() => box.next<T>(), close: () => ws.close() }
}

const say = (w: World) =>
  w.owners.post<MessageDto>(`/api/groups/${w.group.id}/messages`, {
    body: '@cc 构建',
    clientId: crypto.randomUUID(),
  })

async function runStart(d: Awaited<ReturnType<typeof daemon>>) {
  const m = await d.next<ServerToDaemon>()
  if (m.t !== 'run.start') throw new Error(`unexpected ${m.t}`)
  return m
}

describe('bot agent settings', () => {
  it('the owner replaces the overrides; they show on the bot, the daemon list and run.start', async () => {
    const w = await world()
    const url = `/api/bots/${w.bot.id}`
    expect((await w.owners.get<BotDto>(url)).body.agentSettings).toEqual({})
    const set = { language: 'english', thinking: 'false', attribution: 'none' }
    const res = await w.owners.patch<BotDto>(url, { agentSettings: set })
    expect([res.status, res.body.agentSettings]).toEqual([200, set])
    const replaced = await w.owners.patch<BotDto>(url, { agentSettings: { language: '中文' } })
    expect(replaced.body.agentSettings).toEqual({ language: '中文' })
    // Untouched by updates that leave it out.
    expect((await w.owners.patch<BotDto>(url, { name: 'cc' })).body.agentSettings).toEqual({
      language: '中文',
    })

    const list = await t.app.inject({
      url: '/api/daemon/bots',
      headers: { authorization: `Bearer ${w.token}` },
    })
    const mine = list.json<DaemonBotDto[]>().find((b) => b.id === w.bot.id)
    expect(mine?.agentSettings).toEqual({ language: '中文' })

    const d = await daemon(w)
    await say(w)
    expect((await runStart(d)).bot.agentSettings).toEqual({ language: '中文' })
  })

  it('only the owner may change them', async () => {
    const w = await world()
    const res = await w.admins.patch<{ message: string }>(`/api/bots/${w.bot.id}`, {
      agentSettings: { language: 'english' },
    })
    expect([res.status, res.body.message]).toEqual([403, 'Agent 设置只有 Bot 主人能修改'])
  })

  it("accepts only the bot's agent kind's overridable fields with valid values", async () => {
    const w = await world()
    const bad: [string, Record<string, string>][] = [
      [w.bot.id, { contextWindow: '200000' }],
      [w.bot.id, { gitInstructions: 'false' }],
      [w.bot.id, { nope: 'x' }],
      [w.bot.id, { thinking: 'yes' }],
      [w.bot.id, { attribution: 'all' }],
      [w.bot.id, { language: 'x'.repeat(65) }],
      [w.bot.id, { language: '' }],
      [w.bot.id, { language: '   ' }],
      [w.codex.id, { language: 'english' }],
    ]
    for (const [id, agentSettings] of bad) {
      const res = await w.owners.patch(`/api/bots/${id}`, { agentSettings })
      expect(res.status, JSON.stringify(agentSettings)).toBe(400)
    }
    const ok = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, {
      agentSettings: { language: 'x'.repeat(64) },
    })
    expect(ok.status).toBe(200)
    expect((await w.owners.patch<BotDto>(`/api/bots/${w.codex.id}`, { agentSettings: {} })).status).toBe(200)
  })
})

describe('machine agent settings', () => {
  it('are relayed to the machine for its owner only, kept nowhere server-side', async () => {
    const w = await world()
    const url = `/api/machines/${w.machine.id}/agent-settings`
    const body = {
      agent: 'claude',
      values: { language: 'klingon-xyz', bashTimeout: '600000' },
      inheritCli: false,
    }
    const offline = await w.owners.put<{ message: string }>(url, body)
    expect([offline.status, offline.body.message]).toEqual([409, '机器离线'])
    expect((await w.admins.put(url, body)).status).toBe(403)
    const old = await daemon(w, ['providers'])
    const stale = await w.owners.put<{ message: string }>(url, body)
    expect([stale.status, stale.body.message]).toEqual([409, '请先升级该机器的 daemon 才能使用 Agent 设置'])
    old.close()
    await expect.poll(() => t.ctx.hub.isOnline(w.machine.id)).toBe(false)
    const d = await daemon(w, ['providers', 'agentSettings'])
    expect((await w.owners.put(url, { agent: 'claude', values: {} })).status).toBe(400)

    const pending = w.owners.put<ProviderStoreView>(url, body)
    const cmd = await d.next()
    expect(cmd).toMatchObject({
      t: 'providers.cmd',
      action: 'agentSettings',
      agent: 'claude',
      agentSettings: { values: body.values, inheritCli: false },
    })
    const view: ProviderStoreView = {
      machine: {},
      official: {},
      bots: {},
      providers: [],
      agentSettings: { claude: { values: body.values, inheritCli: false } },
      cli: {},
      sessions: [],
    }
    d.send({ t: 'providers.result', requestId: cmd.requestId, ok: true, error: null, view })
    expect(await pending).toEqual({ status: 200, body: view })

    const trail = await t.db.select().from(auditLogs)
    expect(trail.map((r) => [r.action, r.detail])).toEqual([
      ['machine.providers.agentSettings', { machineId: w.machine.id }],
    ])
    expect(log).toContain('/agent-settings')
    expect(log).not.toContain('klingon-xyz')
  })
})

describe("official login's command-line arguments", () => {
  it('are relayed to a daemon that knows them, refused before an upgrade, and never logged', async () => {
    const w = await world()
    const url = `/api/machines/${w.machine.id}/providers/official`
    const body = { agent: 'claude', proxy: '', args: ['--settings ~/secret-team.json', '--debug'] }
    const old = await daemon(w, ['providers'])
    const stale = await w.owners.put<{ message: string }>(url, body)
    expect([stale.status, stale.body.message]).toEqual([409, '请先升级该机器的 daemon 才能使用命令行参数'])
    old.close()
    await expect.poll(() => t.ctx.hub.isOnline(w.machine.id)).toBe(false)
    const d = await daemon(w, ['providers', 'claudeArgs'])

    const pending = w.owners.put<ProviderStoreView>(url, body)
    const cmd = await d.next()
    expect(cmd).toMatchObject({
      t: 'providers.cmd',
      action: 'official',
      agent: 'claude',
      official: { args: body.args },
    })
    const official = { claude: { env: {}, proxy: null } }
    const view = { machine: {}, official, bots: {}, providers: [], agentSettings: {}, cli: {}, sessions: [] }
    d.send({ t: 'providers.result', requestId: cmd.requestId, ok: true, error: null, view })
    // An older daemon's view without them reads as none.
    expect((await pending).body.official.claude).toEqual({ env: {}, proxy: null, args: [] })
    expect(log).not.toContain('secret-team')
  })
})

describe('run settings snapshot', () => {
  it('stores what session.config reported and returns it with the run detail', async () => {
    const w = await world()
    const d = await daemon(w)
    await say(w)
    const first = await runStart(d)
    const detail = async (id: string) => (await w.owners.get<RunDetailDto>(`/api/runs/${id}`)).body
    expect((await detail(first.runId)).settings).toBeNull()

    const settings: RunSettingsSnapshot = {
      provider: 'kimi-1a2b',
      contextWindow: 262144,
      autoCompactWindow: 200000,
      inheritCli: true,
      fromCli: ['language', 'ANTHROPIC_MODEL'],
      fromBot: ['thinking'],
    }
    d.send({ t: 'session.config', runId: first.runId, model: 'opus', effort: null, settings })
    await expect.poll(async () => (await detail(first.runId)).settings).toEqual(settings)
    // A later report without settings (codex / an older daemon) leaves none.
    d.send({ t: 'session.config', runId: first.runId, model: 'opus', effort: 'high' })
    await expect.poll(async () => (await detail(first.runId)).run.effort).toBe('high')
    expect((await detail(first.runId)).settings).toBeNull()
  })
})
