import { and, desc, eq, isNull, ne, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifacts, artifactVersions, bots } from '../../db/schema.js'

/** Heads asked for at once, most recently updated first. */
const SNAPSHOT_MAX = 20

/**
 * Asks the bot's machine to screenshot the heads of `where`'s artifacts that have no thumbnail (artifact.snapshot):
 * after an edit or a restore, when the machine comes online, after a run of the bot. `run` versions are left out: the
 * daemon shoots those itself after the turn. Offline machines are skipped; they are asked again next time.
 */
export async function snapshotPending(ctx: Ctx, where: SQL) {
  const rows = await ctx.db
    .select({ artifactId: artifacts.id, versionId: artifactVersions.id, machineId: bots.machineId })
    .from(artifacts)
    .innerJoin(bots, eq(bots.id, artifacts.botId))
    .innerJoin(artifactVersions, eq(artifactVersions.id, artifacts.headVersionId))
    .where(
      and(
        where,
        isNull(artifacts.archivedAt),
        isNull(artifactVersions.thumbnailHash),
        ne(artifactVersions.source, 'run'),
      ),
    )
    .orderBy(desc(artifacts.updatedAt))
    .limit(SNAPSHOT_MAX)
  for (const r of rows)
    if (r.machineId && ctx.hub.features(r.machineId).includes('artifactSnapshot'))
      ctx.hub.send(r.machineId, { t: 'artifact.snapshot', artifactId: r.artifactId, versionId: r.versionId })
}
