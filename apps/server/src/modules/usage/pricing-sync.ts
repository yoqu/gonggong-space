import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UsageFxStatusDto, UsagePricingStatusDto } from '@gonggong/protocol'
import { dataDir } from '../attachments/service.js'
import {
  getPricingIndex,
  isMembershipCatalog,
  type ModelPrice,
  type PricingModelEntry,
  type PricingProviderEntry,
  type PricingSnapshot,
  type PricingTier,
  pricingCachePath,
  resetPricingCache,
} from './pricing.js'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const PRICING_TTL_MS = 24 * 60 * 60 * 1000
const FX_TTL_MS = 12 * 60 * 60 * 1000
const FX_RETRY_MS = 10 * 60 * 1000
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

interface FxCache {
  usdToCny: number
  syncedAt: string | null
  source: string
}

let fxMem: FxCache | null = null
let fxFailedAt = 0
let inflightSync: Promise<UsagePricingStatusDto> | null = null
let fxUrlOverride: string | null = null
let modelsDevUrlOverride: string | null = null

const fxCachePath = () => join(dataDir(), 'fxrate.json')
const allowBackgroundSync = () =>
  process.env.NODE_ENV !== 'test' && !process.env.VITEST && process.env.GONGGONG_PRICING_SYNC !== '0'

export function setSyncUrlsForTest(opts: { modelsDev?: string | null; fx?: string | null }) {
  modelsDevUrlOverride = opts.modelsDev ?? null
  fxUrlOverride = opts.fx ?? null
}

export function resetPricingSyncStateForTest() {
  fxMem = null
  fxFailedAt = 0
  inflightSync = null
  modelsDevUrlOverride = null
  fxUrlOverride = null
  resetPricingCache()
}

function isStaleAt(syncedAt: string | null, ttlMs: number, now: Date): boolean {
  if (!syncedAt) return true
  const ts = Date.parse(syncedAt)
  return Number.isNaN(ts) || now.getTime() - ts >= ttlMs
}

async function readFxDisk(): Promise<FxCache | null> {
  try {
    const raw = JSON.parse(await readFile(fxCachePath(), 'utf8')) as Partial<FxCache>
    if (typeof raw.usdToCny === 'number' && Number.isFinite(raw.usdToCny) && raw.usdToCny > 0) {
      return {
        usdToCny: raw.usdToCny,
        syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : null,
        source: typeof raw.source === 'string' ? raw.source : FX_URL,
      }
    }
  } catch {
    // Missing or unreadable cache file.
  }
  return null
}

function resolveFxSnapshot(): FxCache {
  if (fxMem) return fxMem
  const snapFx = getPricingIndex().snapshot.fx
  if (snapFx && Number.isFinite(snapFx.usdToCny) && snapFx.usdToCny > 0) {
    return { usdToCny: snapFx.usdToCny, syncedAt: snapFx.syncedAt, source: snapFx.source }
  }
  return { usdToCny: DEFAULT_USD_TO_CNY, syncedAt: null, source: 'fallback' }
}

export function getActiveUsdToCny(): number {
  return resolveFxSnapshot().usdToCny
}

function buildFxStatus(fx: FxCache, now: Date): UsageFxStatusDto {
  return {
    usdToCny: fx.usdToCny,
    syncedAt: fx.syncedAt,
    source: fx.source,
    stale: isStaleAt(fx.syncedAt, FX_TTL_MS, now),
  }
}

function buildStatus(now: Date): UsagePricingStatusDto {
  const { snapshot } = getPricingIndex()
  const fx = buildFxStatus(resolveFxSnapshot(), now)
  return {
    source: snapshot.source || MODELS_DEV_URL,
    syncedAt: snapshot.syncedAt,
    providerCount: snapshot.providerCount,
    modelCount: snapshot.modelCount,
    stale: isStaleAt(snapshot.syncedAt, PRICING_TTL_MS, now),
    refreshing: inflightSync !== null,
    fx,
  }
}

/** Fast non-blocking status read; triggers background refresh if stale outside tests. */
export function getPricingStatus(now = new Date()): UsagePricingStatusDto {
  const status = buildStatus(now)
  if (allowBackgroundSync() && !inflightSync) {
    const fxNeedsRefresh = status.fx.stale && now.getTime() - fxFailedAt >= FX_RETRY_MS
    if (status.stale || fxNeedsRefresh) {
      void syncPricingNow(now).catch((err) => console.warn('usage pricing background sync failed:', err))
    }
  }
  return status
}

function isTextModel(id: string, m: Record<string, unknown>): boolean {
  const modalities = m.modalities as { output?: unknown } | undefined
  if (
    Array.isArray(modalities?.output) &&
    modalities.output.length > 0 &&
    !modalities.output.includes('text')
  ) {
    return false
  }
  const lower = id.toLowerCase()
  return !NON_TEXT_SUBSTRINGS.some((bad) => lower.includes(bad))
}

function parseCost(id: string, raw: unknown): ModelPrice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const input = Number(r.input ?? 0)
  const output = Number(r.output ?? 0)
  const cacheRead = Number(r.cache_read ?? r.cacheRead ?? 0)
  const cacheWrite = Number(r.cache_write ?? r.cacheWrite ?? 0)
  let cacheWrite1h = Number(r.cache_write_1h ?? r.cacheWrite1h ?? 0)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return null

  const isClaude = id.toLowerCase().includes('claude')
  if (isClaude && cacheWrite > 0 && cacheWrite1h <= 0) cacheWrite1h = 2 * input

  const tiers: PricingTier[] = []
  if (Array.isArray(r.tiers)) {
    for (const item of r.tiers) {
      if (!item || typeof item !== 'object') continue
      const t = item as Record<string, unknown>
      let above = Number(t.above ?? 0)
      const nested = t.tier as { type?: string; size?: number } | undefined
      if (nested && typeof nested === 'object') {
        if (nested.type && nested.type !== 'context') continue
        above = Number(nested.size ?? 0)
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

export function distillLiveModelsDev(
  rawCatalog: Record<string, unknown>,
  syncedAt: string,
  fx: FxCache,
): PricingSnapshot {
  const providers: Record<string, PricingProviderEntry> = {}
  let providerCount = 0
  let modelCount = 0

  for (const [pid, rawProv] of Object.entries(rawCatalog)) {
    if (!rawProv || typeof rawProv !== 'object' || isMembershipCatalog(pid)) continue
    const prov = rawProv as Record<string, unknown>
    const rawModels = prov.models
    if (!rawModels || typeof rawModels !== 'object') continue
    const models: Record<string, PricingModelEntry> = {}
    for (const [mid, rawModel] of Object.entries(rawModels as Record<string, unknown>)) {
      if (!rawModel || typeof rawModel !== 'object') continue
      const m = rawModel as Record<string, unknown>
      if (!isTextModel(mid, m)) continue
      const cost = parseCost(mid, m.cost)
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

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'gonggong' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

async function fetchLiveFx(now: Date): Promise<FxCache> {
  const url = fxUrlOverride ?? FX_URL
  try {
    const raw = (await fetchJson(url, 15_000)) as { rates?: Record<string, unknown> }
    const rate = Number(raw?.rates?.CNY)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid CNY rate in FX response')
    const next: FxCache = { usdToCny: rate, syncedAt: now.toISOString(), source: FX_URL }
    fxMem = next
    fxFailedAt = 0
    await writeJsonAtomic(fxCachePath(), next).catch(() => {})
    return next
  } catch {
    fxFailedAt = now.getTime()
    if (!fxMem) {
      const disk = await readFxDisk()
      if (disk) fxMem = disk
    }
    return resolveFxSnapshot()
  }
}

/** Fetches BOTH models.dev/api.json and open.er-api.com/v6/latest/USD in parallel (single-flight). */
export async function syncPricingNow(now = new Date()): Promise<UsagePricingStatusDto> {
  if (inflightSync) return inflightSync
  const task = (async () => {
    const catalogUrl = modelsDevUrlOverride ?? MODELS_DEV_URL
    const [catalogRes, fx] = await Promise.all([
      fetchJson(catalogUrl, 30_000).catch(() => null),
      fetchLiveFx(now),
    ])

    if (catalogRes && typeof catalogRes === 'object' && !Array.isArray(catalogRes)) {
      const snapshot = distillLiveModelsDev(catalogRes as Record<string, unknown>, now.toISOString(), fx)
      if (snapshot.modelCount > 0) {
        await writeJsonAtomic(pricingCachePath(), snapshot).catch(() => {})
        resetPricingCache()
      }
    }

    return buildStatus(now)
  })()

  inflightSync = task
  try {
    return await task
  } finally {
    if (inflightSync === task) inflightSync = null
  }
}
