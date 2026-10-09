import { Writable } from 'node:stream'
import {
  type AdminMachineDto,
  type AgentCatalog,
  type BotDto,
  type GroupProviderStateDto,
  type MachineDto,
  PROTOCOL_VERSION,
  type ProviderSavedDto,
  type ProviderStoreView,
  type ToolOpDto,
  type ToolsStateDto,
  type WebEvent,
} from '@gonggong/protocol'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

const KEY = 'sk-live-TEST-9f8e7d6c5b4a3210'
const NAME = 'Kimi 私有网关'
const BASE_URL = 'https://llm.private-gw.example/anthropic'

let t: TestApp
let log: string
afterEach(() => t.close())

async function start() {
  log = ''
  const logStream = new Writable({
    write(chunk, _enc, done) {
      log += String(chunk)
      done()
    },
  })
  t = await createTestApp({ logStream })
}

type Msg = Record<string, unknown> & { t: string; requestId: string }

async function until(check: () => Promise<boolean> | boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function daemon(
  token: string,
  machineId: string,
  features = ['tools', 'providers'],
  catalog: AgentCatalog | null = null,
) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const agents = [
    {
      kind: 'claude',
      available: true,
      version: '2.1.0',
      path: '/x/claude',
      latest: '2.1.285',
      managed: true,
      catalog,
    },
  ]
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.9.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents,
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

const view = (o: Partial<ProviderStoreView> = {}): ProviderStoreView => ({
  machine: {},
  official: {},
  bots: {},
  providers: [],
  sessions: [],
  ...o,
})
const masked = {
  id: 'kimi-1a2b',
  agent: 'claude' as const,
  name: NAME,
  presetId: null,
  revision: 1,
  baseUrl: BASE_URL,
  apiKey: '****3210',
  apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
  model: null,
  models: null,
  env: {},
  proxy: null,
  wireApi: null,
  effort: null,
  source: null,
}

async function world() {
  await start()
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const a = await t.seed.machine(wang.id)
  const b = await t.seed.machine(li.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: a.machine.id })
  const liBot = await t.seed.bot({
    ownerId: li.id,
    name: '老李的 Codex',
    agentKind: 'codex',
    machineId: b.machine.id,
  })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id, liBot.id] })
  return {
    wang,
    li,
    a,
    b,
    bot,
    liBot,
    group,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
  }
}

describe('agent tools and providers relayed to the machine', () => {
  it('only the owner of an online machine with a new enough daemon may use them', async () => {
    const w = await world()
    const url = `/api/machines/${w.a.machine.id}/providers`
    const offline = await w.asWang.get<{ message: string }>(url)
    expect([offline.status, offline.body.message]).toEqual([409, '机器离线'])
    expect((await w.asLi.get(url)).status).toBe(403)
    expect((await w.asWang.get('/api/machines/00000000-0000-4000-8000-000000000000/tools')).status).toBe(404)

    const old = await daemon(w.a.token, w.a.machine.id, [])
    for (const path of ['providers', 'tools', 'ccswitch']) {
      const res = await w.asWang.get<{ message: string }>(`/api/machines/${w.a.machine.id}/${path}`)
      expect([res.status, res.body.message]).toEqual([409, '请先升级该机器的 daemon'])
    }
    await old.close()
    await daemon(w.a.token, w.a.machine.id)
    const noCc = await w.asWang.get<{ message: string }>(`/api/machines/${w.a.machine.id}/ccswitch`)
    expect([noCc.status, noCc.body.message]).toEqual([409, '这台机器上没有 CC Switch'])
    const [mine] = (await w.asWang.get<MachineDto[]>('/api/machines')).body
    expect(mine?.features).toEqual(['tools', 'providers'])
  })

  it('relays provider commands and answers with the masked view, keeping nothing server-side', async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id)
    const base = `/api/machines/${w.a.machine.id}/providers`

    const pending = w.asWang.post<ProviderSavedDto>(base, {
      agent: 'claude',
      name: NAME,
      baseUrl: BASE_URL,
      apiKey: KEY,
      setDefault: true,
    })
    const save = await d.next()
    expect(save).toMatchObject({
      t: 'providers.cmd',
      action: 'save',
      setDefault: true,
      provider: { agent: 'claude', name: NAME, baseUrl: BASE_URL, apiKey: KEY },
    })
    const saved = view({ machine: { claude: masked.id }, providers: [masked] })
    d.send({
      t: 'providers.result',
      requestId: save.requestId,
      ok: true,
      error: null,
      view: saved,
      id: masked.id,
    })
    const res = await pending
    expect(res).toEqual({ status: 200, body: { id: masked.id, view: saved } })
    expect(JSON.stringify(res.body)).not.toContain(KEY)

    const edit = w.asWang.put<ProviderSavedDto>(`${base}/${masked.id}`, {
      agent: 'claude',
      apiKey: `${KEY}-2`,
    })
    const editCmd = await d.next()
    expect(editCmd).toMatchObject({ action: 'save', provider: { id: masked.id, apiKey: `${KEY}-2` } })
    d.send({
      t: 'providers.result',
      requestId: editCmd.requestId,
      ok: false,
      error: `供应商 ${masked.id} 不存在`,
    })
    expect(await edit).toMatchObject({ status: 400, body: { message: `供应商 ${masked.id} 不存在` } })

    const list = w.asWang.get<ProviderStoreView>(base)
    const listCmd = await d.next()
    expect(listCmd).toMatchObject({ action: 'list' })
    d.send({ t: 'providers.result', requestId: listCmd.requestId, ok: true, error: null, view: saved })
    expect((await list).body).toEqual(saved)

    const def = w.asWang.put<ProviderStoreView>(`${base}/default`, { agent: 'claude', choice: 'official' })
    const useCmd = await d.next()
    expect(useCmd).toMatchObject({ action: 'use', agent: 'claude', choice: 'official' })
    expect(useCmd.botId).toBeUndefined()
    d.send({ t: 'providers.result', requestId: useCmd.requestId, ok: true, error: null, view: view() })
    expect((await def).status).toBe(200)

    const official = { env: { DISABLE_TELEMETRY: '1' }, proxy: 'http://127.0.0.1:7890' }
    const off = w.asWang.put<ProviderStoreView>(`${base}/official`, { agent: 'codex', ...official })
    const offCmd = await d.next()
    expect(offCmd).toMatchObject({ action: 'official', agent: 'codex', official })
    const offView = view({ official: { codex: official } })
    d.send({ t: 'providers.result', requestId: offCmd.requestId, ok: true, error: null, view: offView })
    expect((await off).body).toEqual(offView)

    const link = `ccswitch://v1/import?resource=provider&app=claude&name=x&endpoint=${BASE_URL}&apiKey=${KEY}`
    const imp = w.asWang.post<ProviderSavedDto>(`${base}/import-link`, { link })
    const impCmd = await d.next()
    expect(impCmd).toMatchObject({ action: 'importLink', link, setDefault: false })
    d.send({
      t: 'providers.result',
      requestId: impCmd.requestId,
      ok: true,
      error: null,
      view: saved,
      id: masked.id,
    })
    expect((await imp).body.id).toBe(masked.id)

    // A body that fails to parse is refused without quoting it.
    const broken = await t.app.inject({
      method: 'POST',
      url: base,
      headers: { cookie: await t.seed.cookie(w.wang.id), 'content-type': 'application/json' },
      payload: `{"agent":"claude","apiKey":"${KEY}"`,
    })
    expect(broken.statusCode).toBe(400)
    expect(broken.body).not.toContain(KEY)

    // Nothing of the provider reached the database: no column for it (git_accounts are git hosts), no row
    // mentioning it.
    const columns = await t.db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name <> 'git_accounts' and (column_name ilike '%provider%'
        or column_name ilike '%api_key%' or column_name ilike '%base_url%' or column_name ilike '%mirror%')`)
    expect([...columns]).toEqual([])
    const tables = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    for (const { table_name } of tables) {
      const rows = await t.db.execute(
        sql`select row_to_json(x)::text as j from ${sql.identifier(table_name)} x`,
      )
      const dump = rows.map((r) => (r as { j: string }).j).join('\n')
      for (const secret of [KEY, NAME, BASE_URL]) expect(dump, table_name).not.toContain(secret)
    }
    const trail = await t.db.select().from(auditLogs)
    expect(trail.map((r) => [r.action, r.detail])).toEqual([
      ['machine.providers.save', { machineId: w.a.machine.id }],
      ['machine.providers.default', { machineId: w.a.machine.id }],
      ['machine.providers.official', { machineId: w.a.machine.id }],
      ['machine.providers.import', { machineId: w.a.machine.id }],
    ])
    // Nor the log.
    expect(log).toContain('/providers')
    for (const secret of [KEY, NAME, BASE_URL]) expect(log).not.toContain(secret)
  })

  it('previews and applies a CC Switch import on machines that have it', async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id, ['tools', 'providers', 'ccSwitch'])
    const base = `/api/machines/${w.a.machine.id}/ccswitch`
    const candidate = {
      key: 'claude:d1',
      agent: 'claude',
      name: NAME,
      baseUrl: BASE_URL,
      apiKey: '****3210',
      model: null,
      current: true,
      existing: null,
    }
    const preview = w.asWang.get(base)
    const read = await d.next()
    expect(read).toMatchObject({ t: 'ccswitch.read' })
    d.send({
      t: 'ccswitch.result',
      requestId: read.requestId,
      ok: true,
      error: null,
      candidates: [candidate],
      imported: [],
    })
    expect((await preview).body).toEqual({ candidates: [candidate] })

    const apply = w.asWang.post(`${base}/apply`, { keys: ['claude:d1'], setDefault: true })
    const cmd = await d.next()
    expect(cmd).toMatchObject({ t: 'ccswitch.apply', keys: ['claude:d1'], setDefault: true })
    const v = view({ providers: [masked] })
    d.send({
      t: 'ccswitch.result',
      requestId: cmd.requestId,
      ok: true,
      error: null,
      candidates: [],
      imported: [masked.id],
      view: v,
    })
    expect((await apply).body).toEqual({ imported: [masked.id], view: v })
  })

  it("sets a bot's provider only for the owner of both the bot and its machine", async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id)
    const url = `/api/bots/${w.bot.id}/provider`
    const pending = w.asWang.put<ProviderStoreView>(url, { choice: 'inherit' })
    const cmd = await d.next()
    expect(cmd).toMatchObject({
      t: 'providers.cmd',
      action: 'use',
      agent: 'claude',
      botId: w.bot.id,
      choice: 'inherit',
    })
    d.send({ t: 'providers.result', requestId: cmd.requestId, ok: true, error: null, view: view() })
    expect((await pending).status).toBe(200)
    expect((await w.asLi.put(url, { choice: 'official' })).status).toBe(403)

    // Bot owner without the machine (bound elsewhere) cannot.
    const borrowed = await t.seed.bot({ ownerId: w.wang.id, machineId: w.b.machine.id })
    expect((await w.asWang.put(`/api/bots/${borrowed.id}/provider`, { choice: 'official' })).status).toBe(403)
    const [trail] = await t.db.select().from(auditLogs)
    expect([trail?.action, trail?.detail]).toEqual([
      'bot.provider',
      { machineId: w.a.machine.id, botId: w.bot.id },
    ])
  })

  it("checks a bot's model against the catalog of the provider its machine would use", async () => {
    const w = await world()
    const high = { value: 'high', name: '高' }
    const official: AgentCatalog = {
      models: [{ value: 'opus', name: 'Opus', efforts: [high], effort: 'high' }],
      current: 'opus',
      efforts: [high],
      effort: 'high',
    }
    const kimi: AgentCatalog = {
      models: [{ value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null }],
      current: 'kimi-for-coding',
      efforts: [],
      effort: null,
    }
    const url = `/api/bots/${w.bot.id}`
    const d = await daemon(w.a.token, w.a.machine.id, ['tools', 'providers'], official)
    const answered = async <T>(pending: Promise<T>, catalog: AgentCatalog) => {
      const cmd = await d.next()
      expect(cmd).toMatchObject({
        t: 'providers.cmd',
        action: 'botCatalog',
        agent: 'claude',
        botId: w.bot.id,
      })
      d.send({ t: 'providers.result', requestId: cmd.requestId, ok: true, error: null, catalog })
      return pending
    }

    expect((await answered(w.asWang.patch(url, { model: 'kimi-for-coding' }), kimi)).status).toBe(200)
    const bogus = await answered(w.asWang.patch<{ message: string }>(url, { model: 'opus' }), kimi)
    expect([bogus.status, bogus.body.message]).toEqual([400, '不支持的模型：opus'])
    const effort = await answered(w.asWang.patch<{ message: string }>(url, { effort: 'high' }), kimi)
    expect([effort.status, effort.body.message]).toEqual([400, '该模型不支持推理强度：high'])
    const group = `/api/groups/${w.group.id}/bots/${w.bot.id}/config`
    const groupPick = { model: 'kimi-for-coding', effort: null }
    expect((await answered(w.asWang.put(group, groupPick), kimi)).status).toBe(204)
    expect((await answered(w.asWang.patch(url, { model: 'opus', effort: 'high' }), official)).status).toBe(
      200,
    )

    // Daemons without providers, and offline machines, are checked against the catalog they reported.
    await d.close()
    expect((await w.asWang.patch(url, { model: 'kimi-for-coding' })).status).toBe(400)
    await daemon(w.a.token, w.a.machine.id, [], official)
    expect((await w.asWang.patch(url, { model: 'kimi-for-coding' })).status).toBe(400)
    expect((await w.asWang.patch(url, { model: 'opus' })).status).toBe(200)
  })

  it('creates a bot on the provider its owner picks, checking the model against that provider', async () => {
    const w = await world()
    const official: AgentCatalog = {
      models: [{ value: 'opus', name: 'Opus', efforts: [], effort: null }],
      current: 'opus',
      efforts: [],
      effort: null,
    }
    const kimi: AgentCatalog = {
      models: [{ value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null }],
      current: 'kimi-for-coding',
      efforts: [],
      effort: null,
    }
    const d = await daemon(w.a.token, w.a.machine.id, ['tools', 'providers'], official)
    const catalogUrl = `/api/machines/${w.a.machine.id}/catalog?agent=claude&provider=${masked.id}`
    const answerCatalog = async () => {
      const cmd = await d.next()
      expect(cmd).toMatchObject({ t: 'providers.cmd', action: 'catalog', id: masked.id })
      d.send({ t: 'providers.result', requestId: cmd.requestId, ok: true, error: null, catalog: kimi })
    }

    const read = w.asWang.get<{ catalog: AgentCatalog | null }>(catalogUrl)
    await answerCatalog()
    expect((await read).body).toEqual({ catalog: kimi })
    const officialUrl = `/api/machines/${w.a.machine.id}/catalog?agent=claude&provider=official`
    expect((await w.asWang.get(officialUrl)).body).toEqual({ catalog: official })
    expect((await w.asLi.get(catalogUrl)).status).toBe(403)

    const req = {
      name: '小王的 Kimi',
      ownerId: w.wang.id,
      agentKind: 'claude',
      machineId: w.a.machine.id,
      provider: masked.id,
    }
    const bogus = w.asWang.post<{ message: string }>('/api/bots', { ...req, model: 'opus' })
    await answerCatalog()
    expect([(await bogus).status, (await bogus).body.message]).toEqual([400, '不支持的模型：opus'])

    const created = w.asWang.post<BotDto>('/api/bots', { ...req, model: 'kimi-for-coding' })
    await answerCatalog()
    const use = await d.next()
    expect(use).toMatchObject({ t: 'providers.cmd', action: 'use', agent: 'claude', choice: masked.id })
    d.send({ t: 'providers.result', requestId: use.requestId, ok: true, error: null, view: view() })
    const bot = await created
    expect([bot.status, bot.body.id, bot.body.model]).toEqual([200, use.botId, 'kimi-for-coding'])

    // Only on the creator's own machine, for their own bot.
    const admin = client(t, await t.seed.cookie((await t.seed.user({ name: '管理员', role: 'sysadmin' })).id))
    const forOther = await admin.post('/api/bots', { ...req, name: '代建的 Kimi' })
    expect(forOther.status).toBe(403)
  })

  it("lets the bot's group members read the catalog of its new sessions, live and never stored", async () => {
    const w = await world()
    const official: AgentCatalog = {
      models: [{ value: 'opus', name: 'Opus', efforts: [], effort: null }],
      current: 'opus',
      efforts: [],
      effort: null,
    }
    const kimi: AgentCatalog = {
      models: [{ value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null }],
      current: 'kimi-for-coding',
      efforts: [],
      effort: null,
    }
    const url = `/api/bots/${w.bot.id}/catalog`
    const stranger = client(t, await t.seed.cookie((await t.seed.user({ name: '外人' })).id))
    expect((await stranger.get(url)).status).toBe(403)

    const d = await daemon(w.a.token, w.a.machine.id, ['tools', 'providers'], official)
    const pending = w.asLi.get<{ catalog: AgentCatalog | null }>(url)
    const cmd = await d.next()
    expect(cmd).toMatchObject({ t: 'providers.cmd', action: 'botCatalog', agent: 'claude', botId: w.bot.id })
    d.send({ t: 'providers.result', requestId: cmd.requestId, ok: true, error: null, catalog: kimi })
    expect((await pending).body).toEqual({ catalog: kimi })
    const [bot] = (await w.asLi.get<BotDto[]>('/api/bots')).body.filter((b) => b.id === w.bot.id)
    expect(bot?.catalog).toEqual(official)

    // Without providers (or offline) it is what the machine reported.
    await d.close()
    await daemon(w.a.token, w.a.machine.id, [], official)
    expect((await w.asWang.get(url)).body).toEqual({ catalog: official })
  })

  it('starts installs at once and streams their progress and result to the owner only', async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id)
    const wangSees = events(t, w.wang.id)
    const liSees = events(t, w.li.id)
    const base = `/api/machines/${w.a.machine.id}/tools`

    expect((await w.asWang.post(`${base}/claude/install`, { version: '1.0; rm -rf /' })).status).toBe(400)
    expect((await w.asWang.post(`${base}/python/install`, {})).status).toBe(400)

    const started = await w.asWang.post<ToolOpDto>(`${base}/claude/install`, { version: '2.1.285' })
    const { opId } = started.body
    const cmd = await d.next()
    expect(cmd).toEqual({
      t: 'tools.cmd',
      requestId: opId,
      action: 'install',
      kind: 'claude',
      version: '2.1.285',
    })
    d.send({ t: 'tools.progress', requestId: opId, line: 'added 3 packages' })
    const { tools, settings }: ToolsStateDto = {
      tools: [
        { kind: 'claude', installed: true, version: '2.1.285', latest: '2.1.285', managed: true, path: '/x' },
      ],
      settings: { mirror: { kind: 'npmmirror' } },
    }
    d.send({ t: 'tools.result', requestId: opId, ok: true, error: null, tools, settings })
    await until(() => wangSees.some((e) => e.t === 'machine.tools.result'))
    const mine = wangSees.filter((e) => e.t.startsWith('machine.tools'))
    expect(mine).toEqual([
      { t: 'machine.tools.progress', machineId: w.a.machine.id, opId, line: 'added 3 packages' },
      {
        t: 'machine.tools.result',
        machineId: w.a.machine.id,
        opId,
        ok: true,
        error: null,
        state: { tools, settings },
      },
    ] satisfies WebEvent[])
    expect(liSees.filter((e) => e.t.startsWith('machine.tools'))).toEqual([])
    await until(async () => (await t.db.select().from(auditLogs)).length === 1)
    const [trail] = await t.db.select().from(auditLogs)
    expect([trail?.action, trail?.detail]).toEqual([
      'machine.tools.install',
      { machineId: w.a.machine.id, kind: 'claude' },
    ])

    // Upgrade cut short by the machine going offline.
    const up = await w.asWang.post<ToolOpDto>(`${base}/codex/upgrade`)
    expect(await d.next()).toMatchObject({ action: 'upgrade', kind: 'codex', requestId: up.body.opId })
    await d.close()
    await until(() => wangSees.some((e) => e.t === 'machine.tools.result' && e.opId === up.body.opId))
    expect(wangSees.filter((e) => e.t === 'machine.tools.result').at(-1)).toMatchObject({
      ok: false,
      error: '机器离线',
      state: null,
    })

    const d2 = await daemon(w.a.token, w.a.machine.id)
    const status = w.asWang.get<ToolsStateDto>(base)
    const st = await d2.next()
    expect(st).toMatchObject({ action: 'status' })
    d2.send({ t: 'tools.result', requestId: st.requestId, ok: true, error: null, tools, settings })
    expect((await status).body).toEqual({ tools, settings })

    const set = w.asWang.put<ToolsStateDto>(`${base}/settings`, {
      mirror: { kind: 'custom', registry: 'ftp://x', node: 'https://n' },
    })
    expect((await set).status).toBe(400)
  })

  it('keeps the provider banner state in memory per machine and pushes it to group members', async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id)
    const seen = events(t, w.li.id)
    const banners = () => seen.filter((e) => e.t === 'group.providerState')
    const url = `/api/groups/${w.group.id}/provider-state`
    const item = { groupId: w.group.id, botId: w.bot.id, session: '官方登录', effective: NAME }
    // A bot of another machine is not this daemon's to report.
    const foreign = { ...item, botId: w.liBot.id }
    d.send({ t: 'bots.providerState', items: [item, foreign] })
    await until(() => banners().length === 1)
    const expected = { items: [{ botId: w.bot.id, session: '官方登录', effective: NAME }] }
    expect(banners()).toEqual([{ t: 'group.providerState', groupId: w.group.id, ...expected }])
    expect((await w.asLi.get<GroupProviderStateDto>(url)).body).toEqual(expected)
    const stranger = await t.seed.user()
    expect((await client(t, await t.seed.cookie(stranger.id)).get(url)).status).toBe(404)

    await d.close()
    await until(() => banners().length === 2)
    expect(banners()[1]).toEqual({ t: 'group.providerState', groupId: w.group.id, items: [] })
    expect((await w.asLi.get<GroupProviderStateDto>(url)).body).toEqual({ items: [] })
    const dump = (await t.db.execute(sql`select row_to_json(g)::text as j from group_bots g`))
      .map(String)
      .join()
    expect(dump).not.toContain(NAME)
  })

  it('reports latest and managed agent versions to the admin', async () => {
    const w = await world()
    const admin = await t.seed.user({ role: 'sysadmin' })
    await daemon(w.a.token, w.a.machine.id)
    const rows = (
      await client(t, await t.seed.cookie(admin.id)).get<AdminMachineDto[]>('/api/admin/machines')
    ).body
    expect(rows.find((m) => m.id === w.a.machine.id)?.agents[0]).toMatchObject({
      latest: '2.1.285',
      managed: true,
    })
  })

  it('times out a silent daemon', async () => {
    const w = await world()
    await daemon(w.a.token, w.a.machine.id)
    const res = await t.ctx.hub.request(
      w.a.machine.id,
      { t: 'ccswitch.read', requestId: 'x' },
      'ccswitch.result',
      50,
    )
    expect(res).toBeUndefined()
    expect(
      await t.ctx.hub.request(
        w.b.machine.id,
        { t: 'ccswitch.read', requestId: 'y' },
        'ccswitch.result',
        5000,
      ),
    ).toBeUndefined()
  })
})
