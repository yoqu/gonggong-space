#!/usr/bin/env node
/**
 * Fetches live model pricing from https://models.dev/api.json and live USD->CNY
 * FX rate from https://open.er-api.com/v6/latest/USD, distilling only priced
 * text/chat models into apps/server/src/modules/usage/models-dev-pricing.json.
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const DEFAULT_USD_TO_CNY = 7.2

const NON_TEXT_SUBSTRINGS = [
  'embed',
  '-tts',
  'image',
  'audio',
  '-live',
  'robotics',
  'computer-use',
  'deep-research',
  'transcribe',
  'realtime',
  'moderation',
  'whisper',
  'dall-e',
  'sora',
]

const MEMBERSHIP_CATALOGS = new Set([
  'kimi-code-plan-global',
  'kimi-code-plan-cn',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'xiaomi-token-plan-ams',
])

/** Curated makers and major gateways bundled in-repo (< 1 MiB); runtime sync caches all providers to dataDir. */
export const BUNDLED_PROVIDERS = new Set([
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
  'volcengine',
  'siliconflow',
  'siliconflow-cn',
  'tencent-tokenhub',
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
  'baseten',
  'deepinfra',
  'novita-ai',
  'nebius',
  'opencode',
  'opencode-go',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
])

const isMembershipCatalog = (pid) =>
  MEMBERSHIP_CATALOGS.has(pid) || pid.endsWith('-plan') || pid.includes('-plan-')

function isTextModel(id, model) {
  const out = model?.modalities?.output
  if (Array.isArray(out) && out.length > 0 && !out.includes('text')) return false
  const lower = String(id).toLowerCase()
  return !NON_TEXT_SUBSTRINGS.some((bad) => lower.includes(bad))
}

function normalizeCost(id, raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = Number(raw.input ?? 0)
  const output = Number(raw.output ?? 0)
  const cacheRead = Number(raw.cache_read ?? raw.cacheRead ?? 0)
  const cacheWrite = Number(raw.cache_write ?? raw.cacheWrite ?? 0)
  let cacheWrite1h = Number(raw.cache_write_1h ?? raw.cacheWrite1h ?? 0)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return null

  const isClaude = String(id).toLowerCase().includes('claude')
  if (isClaude && cacheWrite > 0 && cacheWrite1h <= 0) cacheWrite1h = 2 * input

  const tiers = []
  if (Array.isArray(raw.tiers)) {
    for (const t of raw.tiers) {
      if (!t || typeof t !== 'object') continue
      let above = Number(t.above ?? 0)
      if (t.tier && typeof t.tier === 'object') {
        if (t.tier.type && t.tier.type !== 'context') continue
        above = Number(t.tier.size ?? 0)
      }
      if (!Number.isFinite(above) || above <= 0) continue
      const tIn = t.input !== undefined && t.input !== null ? Number(t.input) : input
      const tOut = t.output !== undefined && t.output !== null ? Number(t.output) : output
      const tRead = t.cache_read !== undefined && t.cache_read !== null ? Number(t.cache_read) : cacheRead
      const tWrite =
        t.cache_write !== undefined && t.cache_write !== null ? Number(t.cache_write) : cacheWrite
      let tWrite1h =
        t.cache_write_1h !== undefined && t.cache_write_1h !== null ? Number(t.cache_write_1h) : 0
      if (isClaude && tWrite > 0 && tWrite1h <= 0) tWrite1h = 2 * tIn
      tiers.push({
        above,
        input: tIn,
        output: tOut,
        cacheRead: tRead,
        cacheWrite: tWrite,
        ...(tWrite1h > 0 ? { cacheWrite1h: tWrite1h } : {}),
      })
    }
    tiers.sort((a, b) => a.above - b.above)
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(cacheWrite1h > 0 ? { cacheWrite1h } : {}),
    ...(tiers.length > 0 ? { tiers } : {}),
  }
}

export function distillModelsDev(rawCatalog, syncedAt, fx, allowProviders = null) {
  const providers = {}
  let providerCount = 0
  let modelCount = 0

  for (const [pid, prov] of Object.entries(rawCatalog ?? {})) {
    if (!prov || typeof prov !== 'object' || isMembershipCatalog(pid)) continue
    if (allowProviders && !allowProviders.has(pid)) continue
    const rawModels = prov.models
    if (!rawModels || typeof rawModels !== 'object') continue
    const models = {}
    for (const [mid, m] of Object.entries(rawModels)) {
      if (!m || typeof m !== 'object') continue
      if (!isTextModel(mid, m)) continue
      const cost = normalizeCost(mid, m.cost)
      if (!cost) continue
      models[mid] = {
        name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : mid,
        ...(typeof m.canonical_model_id === 'string' && m.canonical_model_id.trim()
          ? { canonical: m.canonical_model_id.trim() }
          : {}),
        ...(typeof m.release_date === 'string' && m.release_date.trim()
          ? { released: m.release_date.trim() }
          : {}),
        cost,
      }
      modelCount++
    }
    if (Object.keys(models).length > 0) {
      providers[pid] = {
        name: typeof prov.name === 'string' ? prov.name : pid,
        ...(typeof prov.api === 'string' && prov.api ? { api: prov.api } : {}),
        models,
      }
      providerCount++
    }
  }

  return {
    source: MODELS_DEV_URL,
    syncedAt,
    providerCount,
    modelCount,
    fx,
    providers,
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'gonggong' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

async function main() {
  const syncedAt = new Date().toISOString()
  const [rawModels, fxResult] = await Promise.all([
    fetchJson(MODELS_DEV_URL),
    fetchJson(FX_URL).catch((err) => {
      console.warn('FX fetch failed, using fallback:', err.message)
      return null
    }),
  ])

  const cnyRate = Number(fxResult?.rates?.CNY)
  const fx =
    Number.isFinite(cnyRate) && cnyRate > 0
      ? { usdToCny: cnyRate, syncedAt, source: FX_URL }
      : { usdToCny: DEFAULT_USD_TO_CNY, syncedAt: null, source: 'fallback' }

  const snapshot = distillModelsDev(rawModels, syncedAt, fx, BUNDLED_PROVIDERS)
  const outPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../apps/server/src/modules/usage/models-dev-pricing.json',
  )
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(
    `Synced ${snapshot.modelCount} priced models across ${snapshot.providerCount} providers (1 USD = ¥${fx.usdToCny}) -> ${outPath}`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
