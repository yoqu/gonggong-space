import {
  type AgentCatalog,
  type LegacyProviderStoreView,
  type MachineAgentsDto,
  PROTOCOL_VERSION,
  type ProviderPreset,
  type ProviderSavedDto,
  type ProviderStoreView,
  type ProviderView,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { bots } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

// docs/plan/Agent管理重构-施工设计.md §4: the server speaks vendors with protocol endpoints to new daemons and the
// one-agent providers of older ones, the web only ever seeing the new shapes.

const OLD = ['tools', 'providers']
const NEW = ['tools', 'providers', 'protocolProviders', 'agentState']
const UPGRADE = '请先升级该机器的客户端才能为一个供应商登记多种协议'

let t: TestApp
afterEach(() => t.close())

type Msg = Record<string, unknown> & { t: string; requestId: string }

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const view = (o: Partial<ProviderStoreView> = {}): ProviderStoreView => ({
  machine: {},
  official: {},
  bots: {},
  providers: [],
  agentSettings: {},
  cli: {},
  sessions: [],
  ...o,
})
const legacyView = (o: Partial<LegacyProviderStoreView> = {}): LegacyProviderStoreView => ({
  ...view(),
  machine: {},
  providers: [],
  ...o,
})
const legacyProvider = {
  id: 'kimi',
  agent: 'codex' as const,
  name: 'Kimi',
  presetId: 'kimi',
  revision: 2,
  baseUrl: 'https://api.kimi.example/v1',
  apiKey: '****abcd',
  apiKeyField: null,
  model: 'kimi-k2',
  models: null,
  env: {},
  proxy: null,
  args: [],
  wireApi: 'responses',
  effort: null,
  source: null,
}
const endpoint = {
  baseUrl: 'https://api.kimi.example/anthropic',
  apiKeyField: null,
  wireApi: null,
  model: null,
  models: null,
  effort: null,
  env: {},
  args: [],
  configDir: null,
  executablePath: null,
  modelOptions: [],
}
const kimi: ProviderView = {
  id: 'kimi',
  name: 'Kimi',
  presetId: 'kimi',
  revision: 3,
  apiKey: '****abcd',
  proxy: null,
  source: null,
  endpoints: [
    { protocol: 'anthropic', ...endpoint },
    { protocol: 'openai', ...endpoint, baseUrl: 'https://api.kimi.example/v1' },
  ],
}

async function world(features: string[]) {
  t = await createTestApp()
  const wang = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
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
      agents: [{ kind: 'claude', available: true, version: '2.1.0', path: '/x/claude', catalog: null }],
      features,
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  await until(() => t.ctx.hub.isOnline(machine.id))
  const next = () => box.next<Msg>()
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  /** Answers the next command with `res`, returning that command. */
  const answer = async (res: Record<string, unknown>, reply = 'providers.result') => {
    const cmd = await next()
    send({ t: reply, requestId: cmd.requestId, ok: true, error: null, ...res })
    return cmd
  }
  return {
    bot,
    base: `/api/machines/${machine.id}`,
    as: client(t, await t.seed.cookie(wang.id)),
    next,
    send,
    answer,
  }
}

describe('a daemon with protocolProviders and agentState', () => {
  it('passes its runtime and agents through', async () => {
    const w = await world(NEW)
    const state: MachineAgentsDto = {
      node: { installed: true, version: '24.1.0', latest: '24.1.0', managed: true, path: '/n' },
      agents: [
        {
          kind: 'gemini',
          available: false,
          version: null,
          path: null,
          minVersion: null,
          catalog: null,
          latest: '0.9.0',
          managed: false,
          upgradeCommand: null,
          installCommand: null,
        },
      ],
      settings: { mirror: { kind: 'npmmirror' } },
    }
    const pending = w.as.get<MachineAgentsDto>(`${w.base}/tools`)
    await w.answer({ ...state, tools: [] }, 'tools.result')
    expect((await pending).body).toEqual(state)
  })

  it('saves a vendor with several protocols and makes it the default of each agent asked', async () => {
    const w = await world(NEW)
    const body = {
      presetId: 'kimi',
      apiKey: 'sk-kimi',
      endpoints: [
        { protocol: 'anthropic', baseUrl: 'https://api.kimi.example/anthropic' },
        { protocol: 'openai', baseUrl: 'https://api.kimi.example/v1' },
      ],
      setDefault: ['claude', 'codex'],
    }
    const pending = w.as.post<ProviderSavedDto>(`${w.base}/providers`, body)
    const save = await w.answer({ view: view({ providers: [kimi] }), id: 'kimi' })
    expect(save).toMatchObject({
      action: 'save',
      provider: { presetId: 'kimi', apiKey: 'sk-kimi', endpoints: body.endpoints },
    })
    expect(save.provider).not.toHaveProperty('agent')
    expect(save.setDefault).toBeUndefined()
    const machine = { claude: { provider: 'kimi', model: null } }
    expect(await w.answer({ view: view({ machine, providers: [kimi] }) })).toMatchObject({
      action: 'use',
      agent: 'claude',
      choice: 'kimi',
    })
    const both = { ...machine, codex: { provider: 'kimi', model: null } }
    expect(await w.answer({ view: view({ machine: both, providers: [kimi] }) })).toMatchObject({
      action: 'use',
      agent: 'codex',
      choice: 'kimi',
    })
    expect((await pending).body).toEqual({ id: 'kimi', view: view({ machine: both, providers: [kimi] }) })

    // An edit goes straight to the daemon, dropping a protocol.
    const edit = w.as.put(`${w.base}/providers/kimi`, { removeProtocols: ['openai'] })
    expect(await w.answer({ view: view({ providers: [kimi] }), id: 'kimi' })).toMatchObject({
      action: 'save',
      provider: { id: 'kimi', removeProtocols: ['openai'] },
    })
    expect((await edit).status).toBe(200)
  })

  it('sets a machine default with its model and lists presets as they are', async () => {
    const w = await world(NEW)
    const pending = w.as.put(`${w.base}/providers/default`, {
      agent: 'claude',
      choice: 'kimi',
      model: 'kimi-k2',
    })
    expect(await w.answer({ view: view() })).toMatchObject({ action: 'use', model: 'kimi-k2' })
    expect((await pending).status).toBe(200)

    const preset: ProviderPreset = {
      id: 'kimi',
      name: 'Kimi',
      group: 'cn',
      websiteUrl: null,
      apiKeyUrl: null,
      endpoints: [
        {
          protocol: 'anthropic',
          baseUrl: 'https://api.kimi.example/anthropic',
          apiKeyField: null,
          wireApi: null,
          model: null,
          models: null,
          modelOptions: [],
          env: {},
          effort: null,
          modelContext: {},
        },
      ],
    }
    const presets = w.as.get<ProviderPreset[]>(`${w.base}/providers/presets`)
    await w.answer({ presets: [preset] })
    expect((await presets).body).toEqual([preset])
  })

  it("sets a bot's provider and model together, the model checked against that provider", async () => {
    const w = await world(NEW)
    const catalog: AgentCatalog = {
      models: [{ value: 'kimi-k2', name: 'kimi-k2', efforts: [], effort: null }],
      current: 'kimi-k2',
      efforts: [],
      effort: null,
    }
    const url = `/api/bots/${w.bot.id}/provider`
    const bogus = w.as.put<{ message: string }>(url, { choice: 'kimi', model: 'opus' })
    expect(await w.answer({ catalog })).toMatchObject({ action: 'catalog', agent: 'claude', id: 'kimi' })
    expect([(await bogus).status, (await bogus).body.message]).toEqual([400, '不支持的模型：opus'])

    const pending = w.as.put(url, { choice: 'kimi', model: 'kimi-k2' })
    await w.answer({ catalog })
    expect(await w.answer({ view: view({ bots: { [w.bot.id]: 'kimi' } }) })).toMatchObject({
      action: 'use',
      botId: w.bot.id,
      choice: 'kimi',
    })
    expect((await pending).status).toBe(200)
    const [row] = await t.db.select().from(bots).where(eq(bots.id, w.bot.id))
    expect([row?.model, row?.effort]).toEqual(['kimi-k2', null])
  })
})

describe('a daemon without protocolProviders', () => {
  it('gets one endpoint per provider, as the provider of one agent', async () => {
    const w = await world(OLD)
    const url = `${w.base}/providers`
    const two = {
      apiKey: 'sk',
      endpoints: [
        { protocol: 'anthropic', baseUrl: 'https://a.test/anthropic' },
        { protocol: 'openai', baseUrl: 'https://a.test/v1' },
      ],
    }
    for (const body of [two, { removeProtocols: ['openai'] }]) {
      const res = await w.as.post<{ message: string }>(url, { apiKey: 'sk', ...body })
      expect([res.status, res.body.message]).toEqual([409, UPGRADE])
    }
    const one = { apiKey: 'sk', endpoints: [{ protocol: 'anthropic', baseUrl: 'https://a.test/anthropic' }] }
    const wrong = await w.as.post<{ message: string }>(url, { ...one, agent: 'codex' })
    expect([wrong.status, wrong.body.message]).toEqual([400, 'Codex 不支持 anthropic 协议'])
    const many = await w.as.post<{ message: string }>(url, { ...one, setDefault: ['claude', 'deepseek'] })
    expect([many.status, many.body.message]).toEqual([
      409,
      '请先升级该机器的客户端才能把一个供应商设为多个 Agent 的默认',
    ])

    // The agent asked for, else the protocol's own one.
    const forDeepseek = w.as.post(url, { ...one, agent: 'deepseek', setDefault: ['deepseek'] })
    expect(await w.answer({ view: legacyView(), id: 'x' })).toMatchObject({
      action: 'save',
      setDefault: true,
      provider: { agent: 'deepseek', apiKey: 'sk', baseUrl: 'https://a.test/anthropic' },
    })
    expect((await forDeepseek).status).toBe(200)
    const forCodex = w.as.post(url, { apiKey: 'sk', endpoints: [{ protocol: 'openai', model: 'k2' }] })
    const cmd = await w.answer({ view: legacyView(), id: 'y' })
    expect(cmd).toMatchObject({ provider: { agent: 'codex', model: 'k2' }, setDefault: false })
    expect(cmd.provider).not.toHaveProperty('endpoints')
    expect((await forCodex).status).toBe(200)

    // An edit keeps the agent of the provider being edited.
    const edit = w.as.put(`${url}/kimi`, { apiKey: 'sk-2' })
    expect(await w.answer({ view: legacyView({ providers: [legacyProvider] }) })).toMatchObject({
      action: 'list',
    })
    expect(await w.answer({ view: legacyView({ providers: [legacyProvider] }), id: 'kimi' })).toMatchObject({
      action: 'save',
      provider: { id: 'kimi', agent: 'codex', apiKey: 'sk-2' },
    })
    expect((await edit).status).toBe(200)
    const gone = w.as.put<{ message: string }>(`${url}/nope`, { apiKey: 'sk-2' })
    await w.answer({ view: legacyView({ providers: [legacyProvider] }) })
    expect([(await gone).status, (await gone).body.message]).toEqual([404, '供应商不存在'])
  })

  it('refuses a model on the machine default and merges presets per vendor', async () => {
    const w = await world(OLD)
    const url = `${w.base}/providers/default`
    const refused = await w.as.put<{ message: string }>(url, { agent: 'codex', choice: 'kimi', model: 'k2' })
    expect([refused.status, refused.body.message]).toEqual([
      409,
      '请先升级该机器的客户端才能为机器默认指定模型',
    ])
    const pending = w.as.put<ProviderStoreView>(url, { agent: 'codex', choice: 'kimi', model: null })
    const use = await w.answer({
      view: legacyView({ machine: { codex: 'kimi' }, providers: [legacyProvider] }),
    })
    expect(use).not.toHaveProperty('model')
    expect((await pending).body.machine).toEqual({ codex: { provider: 'kimi', model: null } })

    const copy = {
      id: 'kimi',
      name: 'Kimi',
      group: 'cn',
      websiteUrl: null,
      apiKeyUrl: null,
      baseUrl: 'https://api.kimi.example/anthropic',
      apiKeyField: null,
      model: null,
      models: null,
      modelOptions: [],
      env: {},
      wireApi: null,
      effort: null,
      modelContext: {},
    }
    const presets = w.as.get<ProviderPreset[]>(`${w.base}/providers/presets`)
    await w.answer({
      presets: [
        { ...copy, agent: 'claude' },
        { ...copy, agent: 'codex', baseUrl: 'https://api.kimi.example/v1' },
      ],
    })
    const [only] = (await presets).body
    expect(only?.endpoints.map((e) => [e.protocol, e.baseUrl])).toEqual([
      ['anthropic', 'https://api.kimi.example/anthropic'],
      ['openai', 'https://api.kimi.example/v1'],
    ])
  })
})
