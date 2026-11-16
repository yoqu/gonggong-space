import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AgentState,
  agentStatesFromLegacy,
  canUse,
  DaemonToServer,
  endpointFor,
  LegacyProviderPreset,
  LegacyProviderStoreView,
  LegacyToolStatus,
  normalizeCandidate,
  normalizePresets,
  normalizeStoreView,
  ProviderInput,
  ProviderPreset,
  ProviderStoreView,
  type ProviderView,
  presetsFromLegacy,
  presetsToLegacy,
  providerInputToLegacy,
  ServerToDaemon,
  storeViewFromLegacy,
} from '../src/index.js'

const read = (dir: string, file: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', dir, file), 'utf8'))
const legacy = (file: string) => read('fixtures-legacy', file)
const current = (file: string) => read('fixtures', file)

const legacyView = () => LegacyProviderStoreView.parse(legacy('d2s.providers.result.json').view)
const legacyPresets = () =>
  LegacyProviderPreset.array().parse(legacy('d2s.providers.result.presets.json').presets)

describe('old-daemon fixtures still parse as wire messages', () => {
  for (const file of readdirSync(join(import.meta.dirname, '../fixtures-legacy'))) {
    it(file, () => {
      const raw = legacy(file)
      const msg = (file.startsWith('d2s.') ? DaemonToServer : ServerToDaemon).parse(raw)
      expect(msg.t).toBe(raw.t)
    })
  }
})

describe('fixtures/ hold only the new formats', () => {
  it('provider views', () => {
    for (const f of ['d2s.providers.result.json', 'd2s.ccswitch.result.apply.json']) {
      expect(ProviderStoreView.safeParse(current(f).view).success).toBe(true)
      expect(LegacyProviderStoreView.safeParse(current(f).view).success).toBe(false)
    }
  })

  it('presets', () => {
    for (const [f, k] of [
      ['d2s.providers.result.presets.json', 'presets'],
      ['s2d.presets.sync.json', 'presets'],
    ] as const) {
      expect(ProviderPreset.array().safeParse(current(f)[k]).success).toBe(true)
      expect(LegacyProviderPreset.array().safeParse(current(f)[k]).success).toBe(false)
    }
  })

  it('provider inputs carry no agent', () => {
    for (const f of [
      's2d.providers.cmd.save.json',
      's2d.providers.cmd.save.args.json',
      's2d.providers.cmd.local-profile.json',
    ]) {
      const { provider } = current(f)
      expect(provider.agent).toBeUndefined()
      expect(ProviderInput.parse(provider)).toEqual(provider)
    }
  })

  it('tools.result reports the runtime and agents, not tools', () => {
    const raw = current('d2s.tools.result.json')
    expect(raw.tools).toBeUndefined()
    const msg = DaemonToServer.parse(raw)
    expect(msg.t === 'tools.result' && msg.tools).toEqual([])
  })
})

describe('AgentState', () => {
  it('reads what older daemons report as AgentInfo', () => {
    const [claude, codex] = AgentState.array().parse(legacy('d2s.agents.update.json').agents)
    expect(claude).toEqual({
      kind: 'claude',
      available: true,
      version: '2.1.4',
      path: '/opt/homebrew/bin/claude',
      minVersion: '2.0.0',
      catalog: null,
      latest: null,
      managed: false,
      upgradeCommand: null,
      installCommand: null,
    })
    expect(codex?.minVersion).toBeNull()
  })
})

describe('agentStatesFromLegacy', () => {
  const tools = () => LegacyToolStatus.array().parse(legacy('d2s.tools.result.json').tools)
  const reported = () => AgentState.array().parse(current('d2s.agents.update.json').agents)

  it('splits Node off as the runtime', () => {
    expect(agentStatesFromLegacy(tools(), reported()).node).toEqual({
      installed: true,
      version: '24.2.0',
      latest: '24.3.0',
      managed: true,
      path: '/Users/wl/.gonggong/runtime/current/bin/node',
    })
    expect(agentStatesFromLegacy([], []).node).toBeNull()
  })

  it('keeps detection and catalog from the report and install facts from tools', () => {
    const { agents } = agentStatesFromLegacy(tools(), reported())
    expect(agents.map((a) => a.kind)).toEqual(['claude', 'codex', 'gemini', 'pi', 'deepseek'])
    const claude = agents.find((a) => a.kind === 'claude')
    expect(claude).toMatchObject({
      available: true,
      version: '2.1.4',
      path: '/opt/homebrew/bin/claude',
      minVersion: '2.0.0',
      latest: '2.1.285',
      managed: true,
      upgradeCommand: null,
    })
    expect(claude?.catalog?.current).toBe('sonnet')
    expect(agents.find((a) => a.kind === 'codex')).toMatchObject({
      available: false,
      latest: '0.41.0',
      upgradeCommand: 'brew upgrade codex',
    })
  })

  it('takes detection from tools for agents the daemon did not report', () => {
    const { agents } = agentStatesFromLegacy(tools(), reported())
    expect(agents.find((a) => a.kind === 'pi')).toEqual({
      kind: 'pi',
      available: true,
      version: '1.5.2',
      path: '/Users/wl/.gonggong/tools/bin/pi',
      minVersion: null,
      catalog: null,
      latest: '1.5.2',
      managed: true,
      upgradeCommand: null,
      installCommand: null,
    })
    expect(agents.find((a) => a.kind === 'deepseek')).toMatchObject({
      available: false,
      latest: '0.2.2-rc.1',
    })
  })

  it('keeps reported agents tools did not list', () => {
    const only = AgentState.parse({
      kind: 'codebuddy',
      available: true,
      version: '1.0.0',
      path: '/bin/codebuddy',
    })
    expect(agentStatesFromLegacy([], [only]).agents).toEqual([only])
  })
})

describe('storeViewFromLegacy', () => {
  it('turns each provider into one endpoint of its agent first protocol, kept to that agent', () => {
    const v = storeViewFromLegacy(legacyView())
    const byId = Object.fromEntries(v.providers.map((p) => [p.id, p]))
    expect(byId['kimi-coding-1a2b']).toEqual({
      id: 'kimi-coding-1a2b',
      name: 'Kimi For Coding',
      presetId: 'kimi-coding',
      revision: 2,
      apiKey: '****abcd',
      proxy: 'http://user:****@10.0.0.2:3128',
      source: { kind: 'cc-switch', id: 'd1f0' },
      agents: ['claude'],
      endpoints: [
        {
          protocol: 'anthropic',
          baseUrl: 'https://api.kimi.com/coding/',
          apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
          wireApi: null,
          model: 'kimi-for-coding',
          models: { haiku: 'kimi-for-coding', sonnet: 'kimi-for-coding' },
          effort: null,
          env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144', GITHUB_TOKEN: '****wxyz' },
          args: [],
          configDir: null,
          executablePath: null,
          modelOptions: [],
        },
      ],
    })
    expect(byId['kimi-coding-77e1']?.endpoints[0]).toMatchObject({ protocol: 'openai', wireApi: 'responses' })
    expect(byId['deepseek-5e6f']).toMatchObject({
      agents: ['deepseek'],
      endpoints: [{ protocol: 'anthropic' }],
    })
    expect(byId['work-claude-0a1b']?.endpoints[0]).toMatchObject({
      configDir: '/Users/wl/.claude-work',
      executablePath: '/Users/wl/bin/claude-work',
      args: ['--settings ~/.claude/team.json'],
    })
  })

  it('drops providers of agents that take none (pi keeps its own login)', () => {
    expect(storeViewFromLegacy(legacyView()).providers.map((p) => p.id)).not.toContain('pi-3c4d')
  })

  it('wraps machine defaults without a model and keeps the rest as is', () => {
    const old = legacyView()
    const v = storeViewFromLegacy(old)
    expect(v.machine).toEqual({
      claude: { provider: 'kimi-coding-1a2b', model: null },
      codex: { provider: 'kimi-coding-77e1', model: null },
      deepseek: { provider: 'official', model: null },
    })
    expect(v.bots).toEqual(old.bots)
    expect(v.sessions).toEqual(old.sessions)
    expect(v.official).toEqual(old.official)
    expect(v.agentSettings).toEqual(old.agentSettings)
    expect(v.cli).toEqual(old.cli)
    expect(ProviderStoreView.parse(v)).toEqual(v)
  })
})

describe('normalizeStoreView', () => {
  it('converts an old daemon view', () => {
    const old = legacyView()
    expect(normalizeStoreView(old)).toEqual(storeViewFromLegacy(old))
  })

  it('passes a new view through', () => {
    const v = ProviderStoreView.parse(current('d2s.providers.result.json').view)
    expect(normalizeStoreView(v)).toBe(v)
  })

  it('takes what providers.result parsed, either format', () => {
    for (const raw of [legacy('d2s.providers.result.json'), current('d2s.providers.result.json')]) {
      const msg = DaemonToServer.parse(raw)
      if (msg.t !== 'providers.result' || !msg.view) throw new Error('no view')
      expect(ProviderStoreView.parse(normalizeStoreView(msg.view)).providers.length).toBeGreaterThan(0)
    }
  })
})

describe('canUse / endpointFor', () => {
  const view = () => ProviderStoreView.parse(current('d2s.providers.result.json').view)
  const get = (v: { providers: ProviderView[] }, id: string) => {
    const p = v.providers.find((x) => x.id === id)
    if (!p) throw new Error(id)
    return p
  }

  it('fits every agent that speaks one of its protocols', () => {
    const kimi = get(view(), 'kimi-coding-1a2b')
    expect(canUse(kimi, 'claude')).toBe(true)
    expect(canUse(kimi, 'deepseek')).toBe(true)
    expect(canUse(kimi, 'codex')).toBe(true)
    expect(canUse(kimi, 'gemini')).toBe(false)
    expect(canUse(kimi, 'pi')).toBe(false)
    expect(endpointFor(kimi, 'codex')?.baseUrl).toBe('https://api.kimi.com/coding/v1')
    expect(endpointFor(kimi, 'gemini')).toBeUndefined()
  })

  it('gives a local Claude profile to Claude Code only', () => {
    const profile = get(view(), 'work-claude-0a1b')
    expect(canUse(profile, 'claude')).toBe(true)
    expect(canUse(profile, 'deepseek')).toBe(false)
  })

  it('keeps an old daemon provider to its own agent', () => {
    const v = storeViewFromLegacy(legacyView())
    expect(canUse(get(v, 'kimi-coding-1a2b'), 'claude')).toBe(true)
    expect(canUse(get(v, 'kimi-coding-1a2b'), 'deepseek')).toBe(false)
    expect(canUse(get(v, 'deepseek-5e6f'), 'deepseek')).toBe(true)
    expect(canUse(get(v, 'deepseek-5e6f'), 'claude')).toBe(false)
  })
})

describe('presetsFromLegacy', () => {
  it('merges the per-agent copies of a vendor into one preset with an endpoint per protocol', () => {
    const presets = presetsFromLegacy(legacyPresets())
    expect(presets.map((p) => p.id)).toEqual(['kimi-coding', 'deepseek', 'zhipu', 'openrouter'])
    const byId = Object.fromEntries(presets.map((p) => [p.id, p]))
    expect(byId['kimi-coding']).toMatchObject({
      name: 'Kimi For Coding',
      group: 'cn',
      websiteUrl: 'https://www.kimi.com/code/',
      // the claude copy has none: the codex one fills it in
      apiKeyUrl: 'https://www.kimi.com/code/',
    })
    expect(byId['kimi-coding']?.endpoints).toEqual([
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.kimi.com/coding/',
        apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
        wireApi: null,
        model: 'kimi-for-coding',
        models: { haiku: 'kimi-for-coding', sonnet: 'kimi-for-coding', opus: 'kimi-for-coding' },
        modelOptions: ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3', 'k3-256k'],
        env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144' },
        effort: null,
        modelContext: { 'kimi-for-coding': 262144 },
      },
      {
        protocol: 'openai',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKeyField: null,
        wireApi: 'responses',
        model: 'kimi-for-coding',
        models: null,
        modelOptions: ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3', 'k3-256k'],
        env: {},
        effort: 'high',
        modelContext: {},
      },
    ])
    expect(byId.openrouter?.endpoints.map((e) => e.protocol)).toEqual(['anthropic', 'openai', 'gemini'])
  })

  it('keeps the first copy when two agents share a protocol (DeepSeek for Claude Code and DeepSeek Harness)', () => {
    const deepseek = presetsFromLegacy(legacyPresets()).find((p) => p.id === 'deepseek')
    expect(deepseek?.endpoints.map((e) => [e.protocol, e.baseUrl, e.model])).toEqual([
      ['anthropic', 'https://api.deepseek.com/anthropic', 'deepseek-v4-pro'],
      ['openai', 'https://api.deepseek.com', 'deepseek-flash'],
    ])
  })

  it('drops presets of agents that take no provider', () => {
    const pi = LegacyProviderPreset.parse({
      id: 'pi-x',
      agent: 'pi',
      name: 'X',
      baseUrl: 'https://x.example',
    })
    expect(presetsFromLegacy([pi])).toEqual([])
  })

  it('output is a valid preset list', () => {
    const presets = presetsFromLegacy(legacyPresets())
    expect(ProviderPreset.array().parse(presets)).toEqual(presets)
  })
})

describe('presetsToLegacy', () => {
  it('gives each endpoint to every agent speaking its protocol', () => {
    const [acme] = ProviderPreset.array().parse(current('s2d.presets.sync.json').presets)
    if (!acme) throw new Error('no preset')
    const out = presetsToLegacy([acme])
    expect(out.map((p) => p.agent)).toEqual(['claude', 'deepseek'])
    expect(out[0]).toEqual({
      id: 'acme',
      agent: 'claude',
      name: 'Acme',
      group: 'cn',
      websiteUrl: 'https://acme.example.com',
      apiKeyUrl: null,
      baseUrl: 'https://api.acme.example.com/anthropic',
      apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
      model: 'acme-1',
      models: null,
      modelOptions: ['acme-1', 'acme-2'],
      env: {},
      wireApi: null,
      effort: null,
      modelContext: { 'acme-1': 200000 },
    })
    expect(LegacyProviderPreset.array().parse(out)).toEqual(out)
  })

  it('round-trips the built-in presets but the vendor links the copies now share', () => {
    const sorted = (list: LegacyProviderPreset[]) =>
      list
        .filter((p) => p.agent !== 'deepseek')
        .map(({ websiteUrl: _, apiKeyUrl: __, ...rest }) => rest)
        .sort((a, b) => `${a.id}/${a.agent}`.localeCompare(`${b.id}/${b.agent}`))
    const old = legacyPresets()
    expect(sorted(presetsToLegacy(presetsFromLegacy(old)))).toEqual(sorted(old))
  })
})

describe('normalizePresets', () => {
  it('converts old ones and keeps new ones', () => {
    const fresh = ProviderPreset.array().parse(current('s2d.presets.sync.json').presets)
    const out = normalizePresets([...legacyPresets(), ...fresh])
    expect(out.map((p) => p.id)).toEqual(['kimi-coding', 'deepseek', 'zhipu', 'openrouter', 'acme'])
    expect(normalizePresets(fresh)).toEqual(fresh)
  })
})

describe('normalizeCandidate', () => {
  const candidates = (raw: unknown) => {
    const msg = DaemonToServer.parse(raw)
    if (msg.t !== 'ccswitch.result') throw new Error(msg.t)
    return msg.candidates.map(normalizeCandidate)
  }

  it('gives an old row its agent protocol and keeps a new one', () => {
    const [old] = candidates(legacy('d2s.ccswitch.result.json'))
    expect(old).toMatchObject({ key: 'claude:d1f0', agent: 'claude', protocol: 'anthropic' })
    expect(candidates(current('d2s.ccswitch.result.json'))).toEqual(
      current('d2s.ccswitch.result.json').candidates,
    )
  })
})

describe('providerInputToLegacy', () => {
  it('flattens a single endpoint for the given agent', () => {
    const input = ProviderInput.parse({
      presetId: 'kimi-coding',
      apiKey: 'sk-test-0123456789abcd',
      proxy: 'http://127.0.0.1:7890',
      endpoints: [{ protocol: 'anthropic', model: 'kimi-for-coding', env: { ENABLE_TOOL_SEARCH: '1' } }],
    })
    expect(providerInputToLegacy(input, 'claude')).toEqual({
      agent: 'claude',
      presetId: 'kimi-coding',
      apiKey: 'sk-test-0123456789abcd',
      proxy: 'http://127.0.0.1:7890',
      model: 'kimi-for-coding',
      env: { ENABLE_TOOL_SEARCH: '1' },
    })
  })

  it('reproduces the old local-profile save from its new form', () => {
    const f = 's2d.providers.cmd.local-profile.json'
    expect(providerInputToLegacy(ProviderInput.parse(current(f).provider), 'claude')).toEqual(
      legacy(f).provider,
    )
  })

  it('edits only the provider fields when no endpoint is given', () => {
    expect(providerInputToLegacy({ id: 'zhipu-9c8d', name: '智谱' }, 'codex')).toEqual({
      id: 'zhipu-9c8d',
      agent: 'codex',
      name: '智谱',
    })
  })

  it('refuses what an old daemon cannot store', () => {
    const two = ProviderInput.parse(current('s2d.providers.cmd.save.json').provider)
    expect(() => providerInputToLegacy(two, 'claude')).toThrow()
    expect(() => providerInputToLegacy({ endpoints: [{ protocol: 'openai' }] }, 'claude')).toThrow()
    expect(() => providerInputToLegacy({ removeProtocols: ['openai'] }, 'codex')).toThrow()
  })
})
