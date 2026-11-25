import type { ArtifactFile } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactThreads, groups, teamMembers } from '../../db/schema.js'
import { findMember } from '../groups/service.js'
import { memberIds } from '../messages/service.js'
import { type Artifact, artifactGrantees, isArtifactManager } from './service.js'
import { loadThreads } from './threads.js'

/**
 * Every user who may view `a`: managers for private, group members for group, plus team members for team; and its
 * creator and those given access wherever they are.
 */
export async function artifactAudience(ctx: Ctx, a: Artifact): Promise<string[]> {
  return [...new Set([...(await byVisibility(ctx, a)), ...(await artifactGrantees(ctx.db, a))])]
}

async function byVisibility(ctx: Ctx, a: Artifact): Promise<string[]> {
  const ids = await memberIds(ctx, a.groupId)
  if (a.visibility === 'private') {
    const ok = await Promise.all(
      ids.map(async (id) => {
        const m = await findMember(ctx, a.groupId, id)
        return !!m && (await isArtifactManager(ctx, a, id, m.member.isAdmin))
      }),
    )
    return ids.filter((_, i) => ok[i])
  }
  if (a.visibility !== 'team') return ids
  const [g] = await ctx.db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, a.groupId))
  if (!g) return ids
  const tm = await ctx.db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, g.teamId))
  return [...new Set([...ids, ...tm.map((r) => r.userId)])]
}

/** Path → new hash (or `null` when deleted) between two version file lists. */
export function diffFileLists(
  before: readonly ArtifactFile[],
  after: readonly ArtifactFile[],
): Record<string, string | null> {
  const prev = new Map(before.map((f) => [f.path, f.hash]))
  const next = new Map(after.map((f) => [f.path, f.hash]))
  const changes: Record<string, string | null> = {}
  for (const [path, hash] of next) if (prev.get(path) !== hash) changes[path] = hash
  for (const path of prev.keys()) if (!next.has(path)) changes[path] = null
  return changes
}

/** Pushes an `artifact.files` realtime event when at least one path changed. */
export async function publishArtifactFiles(
  ctx: Ctx,
  a: Artifact,
  payload: {
    versionId: string
    n: number
    changes: Record<string, string | null>
    author?: string
    clientId?: string
  },
) {
  if (!Object.keys(payload.changes).length) return
  ctx.bus.publish(await artifactAudience(ctx, a), {
    t: 'artifact.files',
    artifactId: a.id,
    versionId: payload.versionId,
    n: payload.n,
    changes: payload.changes,
    ...(payload.author !== undefined && { author: payload.author }),
    ...(payload.clientId !== undefined && { clientId: payload.clientId }),
  })
}

/** Pushes the artifact's full thread list over `/ws/web` to everyone who may view it. */
export async function publishArtifactThreads(ctx: Ctx, a: Artifact) {
  const threads = await loadThreads(ctx, eq(artifactThreads.artifactId, a.id))
  ctx.bus.publish(await artifactAudience(ctx, a), {
    t: 'artifact.threads',
    artifactId: a.id,
    threads,
  })
}
