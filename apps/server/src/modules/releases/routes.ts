import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { compareVersions, DaemonRelease, type MachineInfo, type UpgradeInfo } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { systemParams } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { dataDir } from '../attachments/service.js'
import { requireSysadmin } from '../auth/session.js'

const KEY = 'daemonRelease'
const FILE = /^\w[\w.-]*$/

/** The published daemon build (plan D17), or null before a sysadmin publishes one. */
export async function daemonRelease(ctx: Ctx): Promise<DaemonRelease | null> {
  const [row] = await ctx.db.select().from(systemParams).where(eq(systemParams.key, KEY))
  return (row?.value as DaemonRelease | undefined) ?? null
}

/** The build for this machine when it is newer than the daemon it runs; the daemon never downgrades. */
export function upgradeFor(
  release: DaemonRelease | null,
  machine: Pick<MachineInfo, 'os' | 'arch'>,
  daemonVersion: string,
): UpgradeInfo | null {
  const build = release?.builds[`${machine.os}-${machine.arch}`]
  if (!release || !build || compareVersions(release.version, daemonVersion) <= 0) return null
  return { version: release.version, ...build }
}

export function releaseRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/admin/daemon-release', async (req) => {
      await requireSysadmin(ctx, req)
      return daemonRelease(ctx)
    })

    app.put('/api/admin/daemon-release', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const release = DaemonRelease.parse(req.body)
      await ctx.db
        .insert(systemParams)
        .values({ key: KEY, value: release })
        .onConflictDoUpdate({ target: systemParams.key, set: { value: release } })
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'daemon.release',
        detail: { version: release.version, platforms: Object.keys(release.builds) },
      })
      return release
    })

    // Daemon builds for server-relative release URLs; public like any download page, the sha256 guards integrity.
    app.get<{ Params: { file: string } }>('/downloads/:file', async (req, reply) => {
      const { file } = req.params
      const path = join(dataDir(), 'downloads', file)
      if (
        !FILE.test(file) ||
        !(await access(path).then(
          () => true,
          () => false,
        ))
      )
        return fail('not_found', '文件不存在')
      return reply.header('content-type', 'application/octet-stream').send(createReadStream(path))
    })
  }
}
