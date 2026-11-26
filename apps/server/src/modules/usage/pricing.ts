import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { USAGE_DEFAULT_SENTINEL, type UsageModelUnitPriceDto } from '@gonggong/protocol'
import { dataDir } from '../attachments/service.js'

export interface PricingTier {
  above: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h?: number
}

export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h?: number
  tiers?: PricingTier[]
}

export interface PricingModelEntry {
  name: string
  canonical?: string
  released?: string
  cost: ModelPrice
}

export interface PricingProviderEntry {
  name: string
  api?: string
  models: Record<string, PricingModelEntry>
}

export interface PricingSnapshotFx {
  usdToCny: number
  syncedAt: string | null
  source: string
}

export interface PricingSnapshot {
  source: string
  syncedAt: string | null
  providerCount: number
  modelCount: number
  fx?: PricingSnapshotFx
  providers: Record<string, PricingProviderEntry>
}

export interface MatchedModelPrice {
  price: ModelPrice
  provider: string
  matchedId: string
  displayName: string
  aliasMatched: boolean
}

const MAKER_CATALOGS = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'moonshotai',
  'moonshotai-cn',
  'alibaba',
  'alibaba-cn',
  'zhipuai',
  'zai',
  'xai',
  'minimax',
  'minimax-cn',
  'xiaomi',
  'mistral',
  'cohere',
  'meta',
  'stepfun',
  'stepfun-ai',
  'perplexity',
] as const

const RESELLER_CATALOGS = [
  'openrouter',
  'amazon-bedrock',
  'google-vertex',
  'google-vertex-anthropic',
  'togetherai',
  'fireworks-ai',
  'groq',
  'cerebras',
  'github-copilot',
  'vercel',
  'azure',
  'azure-cognitive-services',
  'deepinfra',
  'baseten',
  'opencode',
  'opencode-go',
  'novita-ai',
  'nebius',
  'siliconflow',
  'siliconflow-cn',
  'volcengine',
  'tencent-tokenhub',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
] as const

const MEMBERSHIP_CATALOGS = new Set([
  'kimi-code-plan-global',
  'kimi-code-plan-cn',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'xiaomi-token-plan-ams',
])

const KIMI_CODE_ALIASES: Record<string, string> = {
  k3: 'kimi-k3',
  'k3-256k': 'kimi-k3',
  'kimi-for-coding-highspeed': 'kimi-k2.7-code-highspeed',
}

const BEDROCK_GEOS = ['global.', 'us.', 'us-gov.', 'eu.', 'apac.', 'jp.', 'au.', 'ca.', 'in.'] as const
const RELAY_PREFIXES = ['claude-'] as const
const CHANNEL_PREFIX = /^[a-z]{2,24}-/
const GROK_WINDOW = /^((?:.*\/)?grok-[0-9][^/@]*)@[0-9]+k?$/
const GROK_EFFORT = /^((?:.*\/)?grok-[0-9][^/]*?)-(?:minimal|low|medium|high|xhigh|extra-high)$/
const DATED_SUFFIX = /-(?:20\d{6}(?:-v\d+(?::\d+)?)?|v\d+(?::\d+)?)$/
const BEDROCK_VENDOR = /^[a-z]+\./

const CLAUDE_SHORT_ALIASES: Record<string, string> = {
  opus: 'claude-opus-',
  'claude-opus': 'claude-opus-',
  sonnet: 'claude-sonnet-',
  'claude-sonnet': 'claude-sonnet-',
  haiku: 'claude-haiku-',
  'claude-haiku': 'claude-haiku-',
}

export const isMembershipCatalog = (pid: string) =>
  MEMBERSHIP_CATALOGS.has(pid) || pid.endsWith('-plan') || pid.includes('-plan-')

export function bareID(id: string): string {
  const lower = id.trim().toLowerCase()
  const idx = lower.lastIndexOf('/')
  return idx >= 0 ? lower.slice(idx + 1) : lower
}

export function dashed(id: string): string {
  return id.replace(/\./g, '-')
}

export function unprofiled(b: string): string | null {
  for (const geo of BEDROCK_GEOS) {
    if (b.startsWith(geo)) {
      const rest = b.slice(geo.length)
      if (rest.includes('.')) return rest
    }
  }
  return null
}

/** Strips trailing `[1m]`, `[200k]`, `[1.5m]` window markers. */
export function unmarked(b: string): string {
  if (!b.endsWith(']')) return b
  const open = b.lastIndexOf('[')
  if (open <= 0) return b
  const mark = b.slice(open + 1, -1)
  if (!/^\d+(?:\.\d+)?[km]$/.test(mark)) return b
  return b.slice(0, open)
}

const cutAt = (s: string, ch: string) => {
  const i = s.indexOf(ch)
  return i > 0 ? s.slice(0, i) : s
}

/** Applies Anthropic's 2x input 1-hour cache write rule when absent on Claude models. */
export function applyAnthropicOneHour(id: string, p: ModelPrice): ModelPrice {
  if (!id.toLowerCase().includes('claude') || p.cacheWrite <= 0) return p
  const cacheWrite1h = p.cacheWrite1h && p.cacheWrite1h > 0 ? p.cacheWrite1h : 2 * p.input
  const tiers = p.tiers?.map((t) => ({
    ...t,
    cacheWrite1h: t.cacheWrite1h && t.cacheWrite1h > 0 ? t.cacheWrite1h : 2 * t.input,
  }))
  return { ...p, cacheWrite1h, ...(tiers ? { tiers } : {}) }
}

export function samePrice(a: ModelPrice, b: ModelPrice): boolean {
  if (
    a.input !== b.input ||
    a.output !== b.output ||
    a.cacheRead !== b.cacheRead ||
    a.cacheWrite !== b.cacheWrite ||
    (a.cacheWrite1h ?? 0) !== (b.cacheWrite1h ?? 0)
  )
    return false
  const ta = a.tiers ?? []
  const tb = b.tiers ?? []
  if (ta.length !== tb.length) return false
  return ta.every(
    (x, i) =>
      x.above === tb[i]?.above &&
      x.input === tb[i]?.input &&
      x.output === tb[i]?.output &&
      x.cacheRead === tb[i]?.cacheRead &&
      x.cacheWrite === tb[i]?.cacheWrite &&
      (x.cacheWrite1h ?? 0) === (tb[i]?.cacheWrite1h ?? 0),
  )
}

const isZeroPrice = (p: ModelPrice) =>
  p.input === 0 && p.output === 0 && p.cacheRead === 0 && p.cacheWrite === 0

/** Computes USD cost with Magpie context-tier selection and optional 1h cache write split. */
export function computeCostUsd(
  price: ModelPrice,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
  cacheWrite1h = 0,
): number {
  const safe1h = Math.min(Math.max(cacheWrite1h, 0), Math.max(cacheWrite, 0))
  const promptTokens = input + cacheRead + cacheWrite
  let flat = {
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
    cacheWrite1h: price.cacheWrite1h ?? 0,
  }
  if (price.tiers) {
    for (const tier of price.tiers) {
      if (promptTokens > tier.above) {
        flat = {
          input: tier.input,
          output: tier.output,
          cacheRead: tier.cacheRead,
          cacheWrite: tier.cacheWrite,
          cacheWrite1h: tier.cacheWrite1h ?? 0,
        }
      }
    }
  }
  const oneHourRate = flat.cacheWrite1h > 0 ? flat.cacheWrite1h : flat.cacheWrite
  return (
    (input * flat.input +
      output * flat.output +
      cacheRead * flat.cacheRead +
      (cacheWrite - safe1h) * flat.cacheWrite +
      safe1h * oneHourRate) /
    1e6
  )
}

export function isOfficialAnthropic(model: string | null, provider: string | null): boolean {
  if (provider !== null && provider.trim() !== '' && provider.trim().toLowerCase() !== 'anthropic') {
    return false
  }
  if (!model) return false
  const b = bareID(model)
  return b.startsWith('claude-') || b in CLAUDE_SHORT_ALIASES
}

export function toUnitPriceDto(matched: MatchedModelPrice): UsageModelUnitPriceDto {
  return {
    input: matched.price.input,
    output: matched.price.output,
    cacheRead: matched.price.cacheRead,
    cacheWrite: matched.price.cacheWrite,
    provider: matched.provider,
    matchedId: matched.matchedId,
    ...(matched.aliasMatched ? { aliasMatched: true } : {}),
  }
}

// ── Snapshot Loading & Indexing ─────────────────────────────────────────────
interface IndexedCatalog {
  snapshot: PricingSnapshot
  orderedProviders: string[]
  providerLookup: Map<string, string>
  knownBare: Set<string>
  knownCanonical: Set<string>
  claudeAliases: Map<string, MatchedModelPrice>
}

let cachedIndex: IndexedCatalog | null = null
let testOverride: PricingSnapshot | null = null

export const pricingCachePath = () => join(dataDir(), 'models-dev-pricing.json')
const bundledSnapshotPath = new URL('./models-dev-pricing.json', import.meta.url)

function readSnapshotFile(path: string | URL): PricingSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PricingSnapshot
    if (parsed && typeof parsed === 'object' && parsed.providers && typeof parsed.providers === 'object') {
      return parsed
    }
  } catch {
    // Missing or unreadable snapshot falls back to bundled copy.
  }
  return null
}

function loadActiveSnapshot(): PricingSnapshot {
  if (testOverride) return testOverride
  const bundled = readSnapshotFile(bundledSnapshotPath)
  const disk = readSnapshotFile(pricingCachePath())
  if (disk && (!bundled || (disk.syncedAt ?? '') > (bundled.syncedAt ?? ''))) return disk
  if (bundled) return bundled
  return {
    source: 'https://models.dev/api.json',
    syncedAt: null,
    providerCount: 0,
    modelCount: 0,
    providers: {},
  }
}

function buildIndex(snapshot: PricingSnapshot): IndexedCatalog {
  const allPids = Object.keys(snapshot.providers).filter((pid) => !isMembershipCatalog(pid))
  const seen = new Set<string>()
  const orderedProviders: string[] = []
  for (const pid of [...MAKER_CATALOGS, ...RESELLER_CATALOGS, ...allPids.sort()]) {
    if (snapshot.providers[pid] && !isMembershipCatalog(pid) && !seen.has(pid)) {
      seen.add(pid)
      orderedProviders.push(pid)
    }
  }

  const providerLookup = new Map<string, string>()
  const knownBare = new Set<string>()
  const knownCanonical = new Set<string>()

  for (const pid of orderedProviders) {
    const p = snapshot.providers[pid]
    if (!p) continue
    providerLookup.set(pid.toLowerCase(), pid)
    if (p.name) providerLookup.set(p.name.trim().toLowerCase(), pid)
    for (const [mid, entry] of Object.entries(p.models)) {
      if (!entry?.cost || isZeroPrice(entry.cost)) continue
      knownBare.add(bareID(mid))
      if (entry.canonical) knownCanonical.add(bareID(entry.canonical))
    }
  }

  // Pre-resolve Claude short aliases (opus/sonnet/haiku) to newest Anthropic entry.
  const claudeAliases = new Map<string, MatchedModelPrice>()
  const anthropic = snapshot.providers.anthropic
  if (anthropic) {
    for (const [alias, prefix] of Object.entries(CLAUDE_SHORT_ALIASES)) {
      let best: { id: string; released: string; entry: PricingModelEntry } | null = null
      for (const [mid, entry] of Object.entries(anthropic.models)) {
        const lower = mid.toLowerCase()
        if (!lower.startsWith(prefix) || !entry?.cost || isZeroPrice(entry.cost)) continue
        const rel = entry.released ?? ''
        if (!best || rel > best.released || (rel === best.released && mid > best.id)) {
          best = { id: mid, released: rel, entry }
        }
      }
      if (best) {
        claudeAliases.set(alias, {
          price: applyAnthropicOneHour(best.id, best.entry.cost),
          provider: 'anthropic',
          matchedId: best.id,
          displayName: best.entry.name || best.id,
          aliasMatched: true,
        })
      }
    }
  }

  return { snapshot, orderedProviders, providerLookup, knownBare, knownCanonical, claudeAliases }
}

export function getPricingIndex(): IndexedCatalog {
  if (!cachedIndex) cachedIndex = buildIndex(loadActiveSnapshot())
  return cachedIndex
}

export function resetPricingCache(): void {
  cachedIndex = null
}

export function setPricingSnapshotForTest(snapshot: PricingSnapshot | null): void {
  testOverride = snapshot
  cachedIndex = null
}

function resolveProviderHint(idx: IndexedCatalog, provider: string | null | undefined): string | null {
  if (!provider) return null
  const lower = provider.trim().toLowerCase()
  if (!lower || isMembershipCatalog(lower)) return null
  const exact = idx.providerLookup.get(lower)
  if (exact) return exact
  // Common display name substrings
  for (const [alias, pid] of [
    ['openrouter', 'openrouter'],
    ['bedrock', 'amazon-bedrock'],
    ['vertex', 'google-vertex'],
    ['anthropic', 'anthropic'],
    ['openai', 'openai'],
    ['deepseek', 'deepseek'],
    ['moonshot', 'moonshotai'],
    ['kimi', 'moonshotai'],
    ['zhipu', 'zhipuai'],
    ['bigmodel', 'zhipuai'],
    ['z.ai', 'zai'],
    ['alibaba', 'alibaba'],
    ['dashscope', 'alibaba'],
    ['qwen', 'alibaba'],
    ['minimax', 'minimax'],
    ['xiaomi', 'xiaomi'],
    ['google', 'google'],
    ['gemini', 'google'],
    ['together', 'togetherai'],
    ['fireworks', 'fireworks-ai'],
    ['siliconflow', 'siliconflow'],
    ['volcengine', 'volcengine'],
    ['vercel', 'vercel'],
    ['azure', 'azure'],
    ['groq', 'groq'],
    ['xai', 'xai'],
    ['mistral', 'mistral'],
  ] as const) {
    if (lower.includes(alias) && idx.snapshot.providers[pid]) return pid
  }
  return null
}

function isKnownBare(idx: IndexedCatalog, b: string): boolean {
  if (idx.knownBare.has(b) || idx.knownCanonical.has(b)) return true
  const unprof = unprofiled(b)
  if (unprof && (idx.knownBare.has(unprof) || idx.knownCanonical.has(unprof))) return true
  const paren = cutAt(b, '(')
  if (paren !== b && idx.knownBare.has(paren)) return true
  const colon = cutAt(b, ':')
  if (colon !== b && idx.knownBare.has(colon)) return true
  return false
}

function renamedModel(idx: IndexedCatalog, b: string): string | null {
  if (isKnownBare(idx, b)) return null
  const stripped = unmarked(b)
  if (stripped !== b && isKnownBare(idx, stripped)) return stripped
  for (const pre of RELAY_PREFIXES) {
    if (stripped.startsWith(pre)) {
      const rest = stripped.slice(pre.length)
      if (/\d/.test(rest) && isKnownBare(idx, rest)) return rest
    }
  }
  const m = CHANNEL_PREFIX.exec(stripped)
  if (m) {
    const rest = stripped.slice(m[0].length)
    if (/\d/.test(rest) && isKnownBare(idx, rest)) return rest
  }
  return null
}

function pricedByProviders(
  idx: IndexedCatalog,
  providers: string[],
  rawId: string,
  aliasMatched = false,
): MatchedModelPrice | null {
  const all = idx.snapshot.providers

  // 1. Exact key match
  for (const pid of providers) {
    const entry = all[pid]?.models[rawId]
    if (entry?.cost && !isZeroPrice(entry.cost)) {
      return {
        price: applyAnthropicOneHour(rawId, entry.cost),
        provider: pid,
        matchedId: rawId,
        displayName: entry.name || rawId,
        aliasMatched,
      }
    }
  }

  // 2. Bare ID (unprofiled, unmarked, Bedrock vendor-stripped, without (effort) / :tag)
  let b = unmarked(bareID(rawId))
  const unprof = unprofiled(b)
  if (unprof) b = unprof

  const vendorStripped = BEDROCK_VENDOR.test(b) ? b.replace(BEDROCK_VENDOR, '') : null
  const baseForms = vendorStripped ? [b, vendorStripped] : [b]
  const variants = [...new Set(baseForms.flatMap((v) => [v, cutAt(v, '('), cutAt(v, ':')]).filter(Boolean))]
  for (const want of variants) {
    for (const pid of providers) {
      const models = all[pid]?.models
      if (!models) continue
      const keys = Object.keys(models)
        .filter((k) => {
          const entry = models[k]
          return entry?.cost && !isZeroPrice(entry.cost) && bareID(k) === want
        })
        .sort()
      if (keys.length > 0) {
        const key = keys[0] as string
        const entry = models[key] as PricingModelEntry
        return {
          price: applyAnthropicOneHour(key, entry.cost),
          provider: pid,
          matchedId: key,
          displayName: entry.name || key,
          aliasMatched,
        }
      }
    }
  }

  // 3. Dot <-> dash normalization (4.6 <-> 4-6)
  const dashedWant = dashed(b)
  for (const pid of providers) {
    const models = all[pid]?.models
    if (!models) continue
    const keys = Object.keys(models)
      .filter((k) => {
        const entry = models[k]
        return entry?.cost && !isZeroPrice(entry.cost) && dashed(bareID(k)) === dashedWant
      })
      .sort()
    if (keys.length > 0) {
      const key = keys[0] as string
      const entry = models[key] as PricingModelEntry
      return {
        price: applyAnthropicOneHour(key, entry.cost),
        provider: pid,
        matchedId: key,
        displayName: entry.name || key,
        aliasMatched,
      }
    }
  }

  // 4. Canonical model ID on maker catalogs (agreeing prices only, Magpie canonicallyPriced)
  for (const matcher of [(c: string) => bareID(c) === b, (c: string) => dashed(bareID(c)) === dashedWant]) {
    for (const pid of providers) {
      const models = all[pid]?.models
      if (!models) continue
      let got: { key: string; entry: PricingModelEntry } | null = null
      let agree = true
      for (const [key, entry] of Object.entries(models)) {
        if (!entry?.canonical || !entry.cost || isZeroPrice(entry.cost)) continue
        const slash = entry.canonical.indexOf('/')
        if (slash <= 0) continue
        const maker = entry.canonical.slice(0, slash)
        if (maker.toLowerCase() !== pid.toLowerCase() || !matcher(entry.canonical)) continue
        if (got && !samePrice(got.entry.cost, entry.cost)) {
          agree = false
          break
        }
        got = { key, entry }
      }
      if (got && agree) {
        return {
          price: applyAnthropicOneHour(got.key, got.entry.cost),
          provider: pid,
          matchedId: got.key,
          displayName: got.entry.name || got.key,
          aliasMatched,
        }
      }
    }
  }

  // 5. Relay / channel prefix rename (claude-deepseek-v4.1-flash -> deepseek-v4.1-flash)
  const renamed = renamedModel(idx, b)
  if (renamed && renamed !== b) {
    return pricedByProviders(idx, providers, renamed, aliasMatched)
  }

  return null
}

/** Matches a concrete model ID (and optional provider hint) against the models.dev pricing index. */
export function matchModelPrice(
  model: string | null | undefined,
  provider?: string | null,
): MatchedModelPrice | null {
  if (!model) return null
  const trimmed = model.trim()
  if (
    !trimmed ||
    trimmed === 'default' ||
    trimmed === '<synthetic>' ||
    trimmed === USAGE_DEFAULT_SENTINEL ||
    trimmed.startsWith(`${USAGE_DEFAULT_SENTINEL}:`)
  ) {
    return null
  }

  const idx = getPricingIndex()
  const lower = trimmed.toLowerCase()

  // Claude short alias (opus / sonnet / haiku) -> newest Anthropic entry
  const bareLower = bareID(lower)
  const claudeAlias = idx.claudeAliases.get(bareLower)
  if (claudeAlias) return claudeAlias

  const hintPid = resolveProviderHint(idx, provider)

  // Build ordered candidate names (exact, Kimi Code aliases, codex-auto-review, Grok window/effort, dated suffix strip)
  const candidates: { id: string; alias: boolean }[] = [{ id: trimmed, alias: false }]
  if (lower === 'codex-auto-review') candidates.push({ id: 'gpt-5.6-luna', alias: true })
  const kimiTarget = KIMI_CODE_ALIASES[bareLower]
  if (kimiTarget) candidates.push({ id: kimiTarget, alias: true })
  const gw = GROK_WINDOW.exec(lower)
  if (gw?.[1]) candidates.push({ id: gw[1], alias: false })
  const ge = GROK_EFFORT.exec(lower)
  if (ge?.[1]) candidates.push({ id: ge[1], alias: false })
  const strippedDate = unmarked(bareLower).replace(DATED_SUFFIX, '')
  if (strippedDate && strippedDate !== unmarked(bareLower)) {
    candidates.push({ id: strippedDate, alias: true })
  }

  if (hintPid) {
    for (const c of candidates) {
      const hit = pricedByProviders(idx, [hintPid], c.id, c.alias)
      if (hit) return hit
    }
  }

  const fallbackProviders = hintPid ? idx.orderedProviders.filter((p) => p !== hintPid) : idx.orderedProviders
  for (const c of candidates) {
    const hit = pricedByProviders(idx, fallbackProviders, c.id, c.alias)
    if (hit) return hit
  }
  return null
}
