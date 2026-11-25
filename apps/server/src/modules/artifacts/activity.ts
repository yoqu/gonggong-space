import type { ArtifactActivity, ArtifactActivityDto } from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactVersions, bots, runs } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { findMember } from '../groups/service.js'
import { memberIds } from '../messages/service.js'
import { type Artifact, artifactGrantees, findArtifact, isArtifactManager, manifestOf } from './service.js'

/** A run that has written nothing for this long is shown idle again (its daemon may have died mid-turn). */
export const ACTIVITY_IDLE_MS = 60_000

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const SCREEN = /^screens\/([^/]+)\.html$/

type Entry = ArtifactActivityDto & { machineId: string; timer: ReturnType<typeof setTimeout> }

/** artifactId → runId → what that run is writing; in memory only (one server process). */
const live = new Map<string, Map<string, Entry>>()

const dtoOf = ({ runId, botId, title, screens, global }: Entry): ArtifactActivityDto => ({
  runId,
  botId,
  title,
  screens,
  global,
})

/** ArtifactDto.activity. */
export const artifactActivity = (artifactId: string) => [...(live.get(artifactId)?.values() ?? [])].map(dtoOf)

/** The members who may open `a` (a private one's managers only), its creator and those given access. */
async function audience(ctx: Ctx, a: Artifact) {
  const grantees = new Set(await artifactGrantees(ctx.db, a))
  const ids = [...new Set([...(await memberIds(ctx, a.groupId)), ...grantees])]
  if (a.visibility !== 'private') return ids
  const ok = await Promise.all(
    ids.map(async (id) => {
      if (grantees.has(id)) return true
      const m = await findMember(ctx, a.groupId, id)
      return !!m && (await isArtifactManager(ctx, a, id, m.member.isAdmin))
    }),
  )
  return ids.filter((_, i) => ok[i])
}

async function publish(ctx: Ctx, artifactId: string) {
  const a = await findArtifact(ctx.db, artifactId)
  if (!a) return
  ctx.bus.publish(await audience(ctx, a), {
    t: 'artifact.activity',
    artifactId,
    activity: artifactActivity(artifactId),
  })
}

function drop(ctx: Ctx, artifactId: string, runId: string) {
  const runs = live.get(artifactId)
  const e = runs?.get(runId)
  if (!runs || !e) return false
  clearTimeout(e.timer)
  runs.delete(runId)
  if (!runs.size) live.delete(artifactId)
  return true
}

/** artifact.activity from `machineId`: kept only for a live run of a bot on it that was sent the artifact. */
export async function onArtifactActivity(ctx: Ctx, machineId: string, msg: ArtifactActivity) {
  if (!isUuid(msg.runId)) return
  const [row] = await ctx.db
    .select({ botId: runs.botId, groupId: runs.groupId, artifacts: runs.artifacts })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, msg.runId), eq(bots.machineId, machineId), inArray(runs.status, LIVE)))
  const a = row?.artifacts.includes(msg.artifactId) ? await findArtifact(ctx.db, msg.artifactId) : undefined
  if (!row || !a) return
  const ids = [...new Set(msg.paths.flatMap((p) => SCREEN.exec(p)?.slice(1) ?? []))]
  const [head] = a.headVersionId
    ? await ctx.db.select().from(artifactVersions).where(eq(artifactVersions.id, a.headVersionId))
    : []
  const manifest = ids.length ? await manifestOf(a, head) : null
  const screens = ids.map((id) => ({ id, title: manifest?.screens.find((x) => x.id === id)?.title ?? id }))
  const global = msg.paths.some((p) => !SCREEN.test(p))
  drop(ctx, msg.artifactId, msg.runId)
  if (screens.length || global) {
    const timer = setTimeout(() => {
      if (drop(ctx, msg.artifactId, msg.runId)) void publish(ctx, msg.artifactId).catch(console.error)
    }, ACTIVITY_IDLE_MS)
    const runsOf = live.get(msg.artifactId) ?? new Map<string, Entry>()
    runsOf.set(msg.runId, {
      runId: msg.runId,
      botId: row.botId,
      title: a.title,
      screens,
      global,
      machineId,
      timer,
    })
    live.set(msg.artifactId, runsOf)
  }
  await publish(ctx, msg.artifactId)
}

/** The run ended: whatever it was writing is done. */
export async function endRunActivity(ctx: Ctx, runId: string) {
  for (const artifactId of [...live.keys()]) if (drop(ctx, artifactId, runId)) await publish(ctx, artifactId)
}

/** The machine went away: its runs' activity is no longer known. */
export async function dropMachineActivity(ctx: Ctx, machineId: string) {
  for (const [artifactId, byRun] of [...live])
    for (const e of [...byRun.values()])
      if (e.machineId === machineId && drop(ctx, artifactId, e.runId)) await publish(ctx, artifactId)
}
