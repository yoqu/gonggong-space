import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import {
  ClientDownloads,
  compareVersions,
  DaemonRelease,
  DaemonReleaseNotesReq,
  type MachineInfo,
  parseReleaseFile,
  ReleaseKind,
  ReleaseNotesReq,
  type UpgradeInfo,
} from '@gonggong/protocol'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, runs, systemParams, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { dataDir } from '../attachments/service.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { LIVE } from '../runs/dto.js'

const KEY = 'daemonRelease'
const FILE = /^\w[\w.-]*$/
/** A gg-cast build is ~30 MB (libwebrtc); leave room for debug-ish builds without accepting anything. */
const MAX_FILE_MB = 300
const MAX_NOTES_MB = 1
const downloads = () => join(dataDir(), 'downloads')

/** The published daemon build (plan D17), or null before a sysadmin publishes one. */
export async function daemonRelease(ctx: Ctx): Promise<DaemonRelease | null> {
  const [row] = await ctx.db.select().from(systemParams).where(eq(systemParams.key, KEY))
  return (row?.value as DaemonRelease | undefined) ?? null
}

/** The release has a build for this machine's platform, whatever its version. */
export const hasBuild = (release: DaemonRelease | null, machine: Pick<MachineInfo, 'os' | 'arch'>) =>
  !!release?.builds[`${machine.os}-${machine.arch}`]

/** The build for this machine when it is newer than the daemon it runs; the daemon never downgrades. */
export function upgradeFor(
  release: DaemonRelease | null,
  machine: Pick<MachineInfo, 'os' | 'arch'>,
  daemonVersion: string,
): UpgradeInfo | null {
  const build = release?.builds[`${machine.os}-${machine.arch}`]
  if (!release || !build || compareVersions(release.version, daemonVersion) <= 0) return null
  return {
    version: release.version,
    ...build,
    ...(release.releaseNotes && { releaseNotes: release.releaseNotes }),
  }
}

async function updateRelease(
  ctx: Ctx,
  change: (current: DaemonRelease | null) => DaemonRelease | Promise<DaemonRelease>,
) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`)
    const [row] = await tx.select().from(systemParams).where(eq(systemParams.key, KEY))
    const current = (row?.value as DaemonRelease | undefined) ?? null
    const release = await change(current)
    await tx
      .insert(systemParams)
      .values({ key: KEY, value: release })
      .onConflictDoUpdate({ target: systemParams.key, set: { value: release } })
    return { current, release }
  })
}

/** Deletes a build this server hosts; external (CDN) urls are left alone. */
async function removeHosted(url: string) {
  const path = hostedPath(url)
  if (path) await unlink(path).catch(() => {})
}

/** Stores one uploaded artifact (multipart) and records it in the release; audited as `actorId`'s. */
async function storeReleaseFile(ctx: Ctx, actorId: string, req: FastifyRequest) {
  const part = await req.file({ limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 } })
  if (!part) return fail('invalid', '缺少文件')
  if (part.filename === 'RELEASE_NOTES.md') {
    const chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of part.file) {
        size += chunk.length
        if (size > MAX_NOTES_MB * 1024 * 1024) {
          return fail('invalid', '版本说明不能超过 {mb} MB', { mb: MAX_NOTES_MB })
        }
        chunks.push(chunk)
      }
    } finally {
      part.file.resume()
    }
    const releaseNotes = Buffer.concat(chunks).toString('utf8').trim()
    if (!releaseNotes) return fail('invalid', '版本说明不能为空')
    const { release } = await updateRelease(ctx, (current) => {
      if (!current) return fail('invalid', '请先上传一个发布产物，再上传版本说明')
      return { ...current, releaseNotes }
    })
    await audit(ctx, {
      category: 'admin',
      actorUserId: actorId,
      action: 'daemon.release.notes',
      detail: { version: release.version, source: 'upload' },
    })
    return release
  }
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
    const url = `/downloads/${part.filename}`
    const sha256 = hash.digest('hex')
    const { release } = await updateRelease(ctx, async (current) => {
      if (current && compareVersions(file.version, current.version) < 0)
        return fail('invalid', '{file} 的版本低于当前发布的 {version}', {
          file: part.filename,
          version: current.version,
        })
      // Keep file replacement and deletion under the manifest lock; only multipart streaming stays parallel.
      await rename(tmp, join(downloads(), part.filename))
      if (current && current.version !== file.version)
        await Promise.all(hostedUrls(current).map(removeHosted))
      const base: DaemonRelease =
        current?.version === file.version && current
          ? current
          : { version: file.version, builds: {}, cast: {} }
      return { ...base, [file.kind]: { ...base[file.kind], [file.platform]: { url, sha256 } } }
    })
    await audit(ctx, {
      category: 'admin',
      actorUserId: actorId,
      action: 'daemon.release.upload',
      detail: file,
    })
    return release.releaseNotes ? release : { ...release, warning: '未提供版本说明，请补充 RELEASE_NOTES.md' }
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

const hostedUrls = (r: DaemonRelease) =>
  [r.builds, r.cast, r.desktop, r.update, r.signature].flatMap((kind) =>
    Object.values(kind ?? {}).map((b) => b.url),
  )

/** The hosted file behind a `/downloads/<file>` url, or null for an external one. */
function hostedPath(url: string) {
  const file = url.startsWith('/downloads/') ? url.slice('/downloads/'.length) : ''
  return FILE.test(file) ? join(downloads(), file) : null
}

export function releaseRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    await app.register(multipart)

    app.get('/api/admin/daemon-release', async (req) => {
      await requireSysadmin(ctx, req)
      return daemonRelease(ctx)
    })

    app.get('/api/client-downloads', async (req) => {
      await requireUser(ctx, req)
      const release = await daemonRelease(ctx)
      return release ? ClientDownloads.parse(release) : null
    })

    // Tauri updater endpoint of the desktop app, checked before GitHub: 404 while this server hosts no signed update
    // for the platform (the app then asks GitHub), 204 when the app is up to date. Public like /downloads.
    app.get<{ Params: { target: string; arch: string; current: string } }>(
      '/api/desktop-update/:target/:arch/:current',
      async (req, reply) => {
        const { target, arch, current } = req.params
        const platform = `${target === 'darwin' ? 'macos' : target}-${arch}`
        const release = await daemonRelease(ctx)
        const pkg = (platform.startsWith('windows') ? release?.desktop : release?.update)?.[platform]
        const sig = hostedPath(release?.signature?.[platform]?.url ?? '')
        const signature = sig && (await readFile(sig, 'utf8').catch(() => null))
        if (!release || !pkg || !signature) return fail('not_found', '没有可用的桌面端更新')
        if (compareVersions(release.version, current) <= 0) return reply.code(204).send()
        const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]
        const url = pkg.url.startsWith('/') ? `${proto}://${req.host}${pkg.url}` : pkg.url
        return {
          version: release.version,
          url,
          signature: signature.trim(),
          ...(release.releaseNotes && { notes: release.releaseNotes }),
        }
      },
    )

    app.put('/api/admin/daemon-release', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const release = DaemonRelease.parse(req.body)
      await updateRelease(ctx, () => release)
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
      return storeReleaseFile(ctx, actor.id, req)
    })

    app.put('/api/admin/daemon-release/notes', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const { releaseNotes } = ReleaseNotesReq.parse(req.body)
      const { release } = await updateRelease(ctx, (current) => {
        if (!current) return fail('not_found', '还没有已发布的版本')
        return { ...current, releaseNotes }
      })
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        action: 'daemon.release.notes',
        detail: { version: release.version, source: 'edit' },
      })
      return release
    })

    // The gonggong MCP `client_release_publish` of a live run: its bot's machine uploads a file it built, on behalf
    // of whoever asked, who must be a sysadmin (the same right as uploading in the admin console).
    app.post<{ Params: { runId: string } }>('/api/daemon/runs/:runId/release-files', async (req) => {
      const actorId = await releaseRunActor(ctx, req)
      return storeReleaseFile(ctx, actorId, req)
    })

    // The gonggong MCP `client_release_notes`: a sysadmin's live run may fill the notes of the current release.
    app.post<{ Params: { runId: string } }>('/api/daemon/runs/:runId/release-notes', async (req) => {
      const actorId = await releaseRunActor(ctx, req)
      const { version, releaseNotes } = DaemonReleaseNotesReq.parse(req.body)
      const { release } = await updateRelease(ctx, (current) => {
        if (!current) return fail('not_found', '还没有已发布的版本')
        if (current.version !== version)
          return fail('conflict', '当前发布版本是 {current}，不是 {version}', {
            current: current.version,
            version,
          })
        return { ...current, releaseNotes }
      })
      await audit(ctx, {
        category: 'admin',
        actorUserId: actorId,
        action: 'daemon.release.notes',
        detail: { version, source: 'mcp' },
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
        const { current, release } = await updateRelease(ctx, async (current) => {
          const build = current?.[kind.data]?.[platform]
          if (!current || !build) return fail('not_found', '该平台没有已发布的文件')
          await removeHosted(build.url)
          const { [platform]: _, ...rest } = current[kind.data] ?? {}
          return { ...current, [kind.data]: rest }
        })
        await audit(ctx, {
          category: 'admin',
          actorUserId: actor.id,
          action: 'daemon.release.remove',
          detail: { kind: kind.data, version: current?.version, platform },
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
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${file}"`)
        .send(createReadStream(path))
    })
  }
}

/** The sysadmin behind a live run on the calling machine, for the two MCP release tools. */
async function releaseRunActor(ctx: Ctx, req: FastifyRequest<{ Params: { runId: string } }>) {
  const machine = await requireMachine(ctx, req)
  const [row] = await ctx.db
    .select({ status: runs.status, origin: users })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .where(and(eq(runs.id, idParam(req.params.runId, '运行不存在')), eq(bots.machineId, machine.id)))
  if (!row || !LIVE.includes(row.status)) return fail('not_found', '运行不存在或已结束')
  if (row.origin.role !== 'sysadmin' || row.origin.disabledAt)
    return fail('forbidden', '只有系统管理员发起的运行可以发布客户端')
  return row.origin.id
}
