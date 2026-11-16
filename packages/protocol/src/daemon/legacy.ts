import { z } from 'zod'
import { AGENT_KINDS, agentMeta, agentTakes } from '../agents.js'
import { AgentKind } from '../common.js'
import type { AgentState, ApiProtocol, RuntimeState } from './agent-state.js'
import {
  CcSwitchCandidate,
  ModelMap,
  PRESET_ID,
  PresetGroup,
  type ProviderEndpoint,
  type ProviderInput,
  type ProviderPreset,
  ProviderSource,
  ProviderStoreView,
  type ProviderView,
  ToolKind,
} from './agent-tools.js'

/*
 * What daemons before `agentState` / `protocolProviders` speak (docs/plan/Agent管理重构-施工设计.md §4): the server
 * turns their answers into the new shapes and writes to them in theirs, so the web only ever sees the new ones.
 */

/** tools.result of a daemon without `agentState`: Node and the agents in one list. */
export const LegacyToolStatus = z.object({
  kind: ToolKind,
  installed: z.boolean(),
  version: z.string().nullable(),
  latest: z.string().nullable(),
  managed: z.boolean(),
  path: z.string().nullable(),
  upgradeCommand: z.string().nullable().optional(),
  installCommand: z.string().nullable().optional(),
})
export type LegacyToolStatus = z.infer<typeof LegacyToolStatus>

/** One preset per (agent, id): a vendor serving two protocols came as two copies. */
export const LegacyProviderPreset = z.object({
  id: z.string().regex(PRESET_ID),
  agent: AgentKind,
  name: z.string().min(1).max(60),
  group: PresetGroup.default('global'),
  websiteUrl: z.string().nullable().default(null),
  apiKeyUrl: z.string().nullable().default(null),
  baseUrl: z.string(),
  apiKeyField: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  models: ModelMap.nullable().default(null),
  modelOptions: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  wireApi: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
  modelContext: z.record(z.string(), z.number().int()).default({}),
})
export type LegacyProviderPreset = z.infer<typeof LegacyProviderPreset>

/** A provider bound to one agent. */
export const LegacyProviderView = z.object({
  id: z.string(),
  agent: AgentKind,
  name: z.string(),
  presetId: z.string().nullable(),
  revision: z.number().int(),
  configDir: z.string().nullable().optional(),
  executablePath: z.string().nullable().optional(),
  baseUrl: z.string(),
  apiKey: z.string(),
  apiKeyField: z.string().nullable(),
  model: z.string().nullable(),
  models: ModelMap.nullable(),
  env: z.record(z.string(), z.string()),
  proxy: z.string().nullable(),
  args: z.array(z.string()).default([]),
  wireApi: z.string().nullable(),
  effort: z.string().nullable(),
  source: ProviderSource.nullable(),
})
export type LegacyProviderView = z.infer<typeof LegacyProviderView>

/** Machine defaults are bare provider ids (no model). */
export const LegacyProviderStoreView = ProviderStoreView.extend({
  machine: z.partialRecord(AgentKind, z.string()),
  providers: z.array(LegacyProviderView),
})
export type LegacyProviderStoreView = z.infer<typeof LegacyProviderStoreView>

export const LegacyProviderInput = z.object({
  id: z.string().optional(),
  agent: AgentKind,
  presetId: z.string().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  configDir: z.string().trim().min(1).max(4096).optional(),
  executablePath: z.string().trim().max(4096).optional(),
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  apiKeyField: z.enum(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']).optional(),
  model: z.string().trim().max(128).optional(),
  models: ModelMap.optional(),
  env: z.record(z.string(), z.string()).optional(),
  proxy: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
  args: z.array(z.string()).optional(),
  effort: z.string().max(32).optional(),
})
export type LegacyProviderInput = z.infer<typeof LegacyProviderInput>

export const LegacyCcSwitchCandidate = CcSwitchCandidate.omit({ protocol: true })
export type LegacyCcSwitchCandidate = z.infer<typeof LegacyCcSwitchCandidate>

// An old provider or preset spoke the protocol its agent was built for: the first one it takes.
const protocolOf = (agent: AgentKind): ApiProtocol | undefined => agentMeta(agent).protocols[0]

/**
 * The machine's agents from an old tools.result and its hello / agents.update report: detection and catalog from the
 * report, install facts from tools.
 */
export function agentStatesFromLegacy(
  tools: LegacyToolStatus[],
  reported: AgentState[],
): { node: RuntimeState | null; agents: AgentState[] } {
  const node = tools.find((t) => t.kind === 'node')
  const agents = AGENT_KINDS.flatMap((kind): AgentState[] => {
    const t = tools.find((x) => x.kind === kind)
    const r = reported.find((x) => x.kind === kind)
    if (!t) return r ? [r] : []
    const detected = r ?? {
      kind,
      available: t.installed,
      version: t.version,
      path: t.path,
      minVersion: null,
      catalog: null,
    }
    return [
      {
        ...detected,
        latest: t.latest,
        managed: t.managed,
        upgradeCommand: t.upgradeCommand ?? null,
        installCommand: t.installCommand ?? null,
      },
    ]
  })
  return {
    node: node
      ? {
          installed: node.installed,
          version: node.version,
          latest: node.latest,
          managed: node.managed,
          path: node.path,
        }
      : null,
    agents,
  }
}

/**
 * Each old provider becomes one endpoint, kept to its agent (`agents`): another agent on the same protocol would get
 * settings tuned for this one. Providers of agents without a protocol (own login) are dropped, as the migration does.
 */
export const storeViewFromLegacy = (v: LegacyProviderStoreView): ProviderStoreView => ({
  ...v,
  machine: Object.fromEntries(
    Object.entries(v.machine).map(([k, provider]) => [k, { provider, model: null }]),
  ),
  providers: v.providers.flatMap((p): ProviderView[] => {
    const protocol = protocolOf(p.agent)
    if (!protocol) return []
    const endpoint: ProviderEndpoint = {
      protocol,
      baseUrl: p.baseUrl,
      apiKeyField: p.apiKeyField,
      wireApi: p.wireApi,
      model: p.model,
      models: p.models,
      effort: p.effort,
      env: p.env,
      args: p.args,
      configDir: p.configDir ?? null,
      executablePath: p.executablePath ?? null,
      modelOptions: [],
    }
    const { id, name, presetId, revision, apiKey, proxy, source } = p
    return [{ id, name, presetId, revision, apiKey, proxy, source, endpoints: [endpoint], agents: [p.agent] }]
  }),
})

const isLegacyView = (v: ProviderStoreView | LegacyProviderStoreView): v is LegacyProviderStoreView =>
  Object.values(v.machine).some((d) => typeof d === 'string') || v.providers.some((p) => !('endpoints' in p))

/** A providers.result / ccswitch.result view from any daemon, in the new shape. */
export const normalizeStoreView = (v: ProviderStoreView | LegacyProviderStoreView): ProviderStoreView =>
  isLegacyView(v) ? storeViewFromLegacy(v) : v

/** Copies of one vendor merge into a preset with an endpoint per protocol; the first copy of a protocol wins. */
export function presetsFromLegacy(list: LegacyProviderPreset[]): ProviderPreset[] {
  const out = new Map<string, ProviderPreset>()
  for (const { id, agent, name, group, websiteUrl, apiKeyUrl, ...endpoint } of list) {
    const protocol = protocolOf(agent)
    if (!protocol) continue
    let vendor = out.get(id)
    if (!vendor) {
      vendor = { id, name, group, websiteUrl: null, apiKeyUrl: null, endpoints: [] }
      out.set(id, vendor)
    }
    vendor.websiteUrl ??= websiteUrl
    vendor.apiKeyUrl ??= apiKeyUrl
    if (!vendor.endpoints.some((e) => e.protocol === protocol))
      vendor.endpoints.push({ protocol, ...endpoint })
  }
  return [...out.values()]
}

/** Each endpoint as a copy for every agent that speaks its protocol. */
export const presetsToLegacy = (list: ProviderPreset[]): LegacyProviderPreset[] =>
  list.flatMap(({ endpoints, ...vendor }) =>
    endpoints.flatMap(({ protocol, ...endpoint }) =>
      AGENT_KINDS.filter((agent) => agentTakes(agent, protocol)).map((agent) => ({
        ...vendor,
        agent,
        ...endpoint,
      })),
    ),
  )

const isLegacyPreset = (p: ProviderPreset | LegacyProviderPreset): p is LegacyProviderPreset => 'agent' in p

/** Presets from any daemon or plugin, in the new shape. */
export const normalizePresets = (list: (ProviderPreset | LegacyProviderPreset)[]): ProviderPreset[] => [
  ...presetsFromLegacy(list.filter(isLegacyPreset)),
  ...list.filter((p): p is ProviderPreset => !isLegacyPreset(p)),
]

/** A ccswitch.result row from any daemon: old ones only read the agent's own protocol. */
export const normalizeCandidate = (c: CcSwitchCandidate | LegacyCcSwitchCandidate): CcSwitchCandidate => {
  if ('protocol' in c) return c
  const protocol = protocolOf(c.agent)
  if (!protocol) throw new Error(`${c.agent} takes no provider`)
  return { ...c, protocol }
}

/**
 * A save for an old daemon, as a provider of `agent`. It holds one endpoint per provider, so more than one, removing
 * protocols or an endpoint `agent` does not speak cannot be written; the server refuses those before calling this.
 */
export function providerInputToLegacy(
  { endpoints = [], removeProtocols = [], ...provider }: ProviderInput,
  agent: AgentKind,
): LegacyProviderInput {
  if (endpoints.length > 1 || removeProtocols.length > 0) {
    throw new Error('an older daemon keeps one protocol per provider')
  }
  const [endpoint] = endpoints
  if (!endpoint) return { ...provider, agent }
  const { protocol, ...rest } = endpoint
  if (!agentTakes(agent, protocol)) throw new Error(`${agent} does not speak ${protocol}`)
  return { ...provider, agent, ...rest }
}
