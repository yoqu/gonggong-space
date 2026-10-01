import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import {
  compareVersions,
  DaemonRelease,
  type MachineInfo,
  parseReleaseFile,
  ReleaseKind,
  type UpgradeInfo,
} from '@gonggong/protocol'
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
/** A gg-cast build is ~30 MB (libwebrtc); leave room for debug-ish builds without accepting anything. */
const MAX_FILE_MB = 300
const downloads = () => join(dataDir(), 'downloads')

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

async function saveRelease(ctx: Ctx, release: DaemonRelease) {
  await ctx.db
    .insert(systemParams)
    .values({ key: KEY, value: release })
    .onConflictDoUpdate({ target: systemParams.key, set: { value: release } })
}

/** Deletes a build this server hosts; external (CDN) urls are left alone. */
async function removeHosted(url: string) {
  const file = url.startsWith('/downloads/') ? url.slice('/downloads/'.length) : ''
  if (FILE.test(file)) await unlink(join(downloads(), file)).catch(() => {})
}

const hostedUrls = (r: DaemonRelease) =>
  [...Object.values(r.builds), ...Object.values(r.cast ?? {})].map((b) => b.url)

export function releaseRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    await app.register(multipart)

    app.get('/api/admin/daemon-release', async (req) => {
      await requireSysadmin(ctx, req)
      return daemonRelease(ctx)
    })

    app.put('/api/admin/daemon-release', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const release = DaemonRelease.parse(req.body)
      await saveRelease(ctx, release)
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'daemon.release',
        detail: { version: release.version, platforms: Object.keys(release.builds) },
      })
      return release
    })

    /** multipart: one release.sh artifact; its name decides kind, version and platform. A newer version starts a new release. */
    app.post('/api/admin/daemon-release/files', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const part = await req.file({ limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 } })
      if (!part) return fail('invalid', '缺少文件')
      const file = parseReleaseFile(part.filename)
      const current = await daemonRelease(ctx)
      if (!file || (current && compareVersions(file.version, current.version) < 0)) {
        part.file.resume()
        return file
          ? fail('invalid', '{file} 的版本低于当前发布的 {version}', {
              file: part.filename,
              version: current?.version ?? '',
            })
          : fail(
              'invalid',
              '{file} 不是发布产物：文件名应形如 gonggong-0.2.0-macos-aarch64 或 gg-cast-0.2.0-windows-x86_64.exe',
              { file: part.filename },
            )
      }
      await mkdir(downloads(), { recursive: true })
      const tmp = join(downloads(), `.upload-${randomUUID()}`)
      const hash = createHash('sha256')
      try {
        await pipeline(
          part.file,
          async function* (src: AsyncIterable<Buffer>) {
            for await (const chunk of src) {
              hash.update(chunk)
              yield chunk
            }
          },
          createWriteStream(tmp),
        )
        if (part.file.truncated) fail('invalid', '单个文件不能超过 {mb} MB', { mb: MAX_FILE_MB })
        await rename(tmp, join(downloads(), part.filename))
      } catch (e) {
        await unlink(tmp).catch(() => {})
        throw e
      }
      const same = current?.version === file.version
      const base: DaemonRelease = same && current ? current : { version: file.version, builds: {}, cast: {} }
      const url = `/downloads/${part.filename}`
      const release = {
        ...base,
        [file.kind]: { ...base[file.kind], [file.platform]: { url, sha256: hash.digest('hex') } },
      }
      await saveRelease(ctx, release)
      if (current && !same) await Promise.all(hostedUrls(current).map(removeHosted))
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'daemon.release.upload',
        detail: file,
      })
      return release
    })

    app.delete<{ Params: { kind: string; platform: string } }>(
      '/api/admin/daemon-release/:kind/:platform',
      async (req) => {
        const actor = await requireSysadmin(ctx, req)
        const kind = ReleaseKind.safeParse(req.params.kind)
        if (!kind.success) return fail('invalid', '未知的产物类型')
        const { platform } = req.params
        const current = await daemonRelease(ctx)
        const build = current?.[kind.data]?.[platform]
        if (!current || !build) return fail('not_found', '该平台没有已发布的文件')
        const { [platform]: _, ...rest } = current[kind.data] ?? {}
        const release = { ...current, [kind.data]: rest }
        await saveRelease(ctx, release)
        await removeHosted(build.url)
        await audit(ctx, {
          category: 'admin',
          actorUserId: actor.id,
          action: 'daemon.release.remove',
          detail: { kind: kind.data, version: current.version, platform },
        })
        return release
      },
    )

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
