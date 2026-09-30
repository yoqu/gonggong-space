import { randomUUID } from 'node:crypto'
import type { BotProbeDto, GitProtocol, RepoProbeRes, RepoProbeResult } from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, users } from '../../db/schema.js'
import { onlineMachine } from '../workspaces/provision.js'

/** A daemon tries up to two URLs at 15 s each; the rest is slack for the round trip. */
const PROBE_TIMEOUT_MS = 40_000
/** How long a probe's "branch missing" verdict blocks binding that url + branch (spec §4). */
const MISSING_TTL_MS = 60_000

const missing = new Map<string, number>()
const cacheKey = (url: string, branch: string) => `${url.trim()}\n${branch.trim()}`

function ask(ctx: Ctx, machineId: string, o: { url: string; branch: string; protocol: GitProtocol }) {
  const msg = { t: 'repo.probe', requestId: randomUUID(), ...o } as const
  return ctx.hub.request(machineId, msg, 'repo.probe.result', PROBE_TIMEOUT_MS)
}

/** True while a recent probe found the repo readable but without this branch. */
export function branchKnownMissing(url: string, branch: string, now: Date) {
  for (const [k, at] of missing) if (now.getTime() - at >= MISSING_TTL_MS) missing.delete(k)
  return missing.has(cacheKey(url, branch))
}

async function targets(ctx: Ctx, userId: string, botIds: string[]) {
  return ctx.db
    .select({ id: bots.id, machineId: bots.machineId, protocol: users.gitProtocol })
    .from(bots)
    .innerJoin(users, eq(users.id, bots.ownerId))
    .where(and(isNull(bots.deletedAt), botIds.length ? inArray(bots.id, botIds) : eq(bots.ownerId, userId)))
}

/**
 * Probes the repo from every given bot's machine (the caller's own bots when none are given). Bots sharing a machine
 * and an owner protocol share one probe; offline machines are reported without asking.
 */
export async function probeBots(
  ctx: Ctx,
  userId: string,
  o: { url: string; branch: string; botIds: string[] },
): Promise<RepoProbeRes> {
  const url = o.url.trim()
  const branch = o.branch.trim()
  const list = await targets(ctx, userId, o.botIds)
  const probes = new Map<string, Promise<RepoProbeResult | undefined>>()
  const results = await Promise.all(
    list.map(async (bot): Promise<[BotProbeDto, RepoProbeResult | null]> => {
      const machineId = onlineMachine(ctx, bot.machineId)
      const offline = { botId: bot.id, ok: false, reason: 'offline' as const, usedUrl: null, detail: null }
      if (!machineId) return [offline, null]
      const k = `${machineId}\n${bot.protocol}`
      if (!probes.has(k))
        probes.set(k, ask(ctx, machineId, { url, branch, protocol: bot.protocol as GitProtocol }))
      const r = await probes.get(k)
      if (!r) return [{ ...offline, reason: 'timeout', detail: '机器未在规定时间内响应' }, null]
      return [{ botId: bot.id, ok: r.ok, reason: r.reason, usedUrl: r.usedUrl, detail: r.detail }, r]
    }),
  )
  const listing = results.map(([, r]) => r).find((r) => r && (r.ok || r.reason === 'branch_missing'))
  if (listing?.ok) missing.delete(cacheKey(url, branch))
  else if (listing) missing.set(cacheKey(url, branch), ctx.now().getTime())
  return {
    results: results.map(([dto]) => dto),
    defaultBranch: listing?.defaultBranch ?? null,
    branches: listing?.branches ?? [],
  }
}
