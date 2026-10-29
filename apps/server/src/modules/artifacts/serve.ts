import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { ArtifactHtmlFile, BRIDGE_SCRIPT_PATH, GG_ARTIFACT_MANIFEST } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactVersions, type previews } from '../../db/schema.js'
import type { MessageKey } from '../../i18n/index.js'
import type { Visitor } from '../previews/access.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { injectBridge } from './html.js'
import { kitName, pluginKit } from './kit.js'
import { findArtifact } from './service.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}
export const mimeOf = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

const BRIDGE = readFileSync(new URL('./bridge.js', import.meta.url))

type Preview = typeof previews.$inferSelect
export type Refusal = { status: number; key: MessageKey }

/** The files the bridge goes into: an L1 artifact's screens, an L0 artifact's page. */
const bridged = (path: string, l1: boolean) =>
  ArtifactHtmlFile.safeParse(path).success && path.startsWith('screens/') === l1

/**
 * An artifact preview (§3.4), read from the server's copy so it works with the bot offline: an L1 artifact's `/` and
 * `/_gg/*` come from its plugin version's shell, everything else from the version's files (the head when the preview
 * follows it). A member's view of a screen carries `data-gg-id`s and the bridge (talking to `visitor.parent`); a
 * shared link's does not. Returns what to refuse with instead of answering.
 */
export async function serveArtifact(
  ctx: Ctx,
  preview: Preview,
  visitor: Visitor,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Refusal | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end()
    return null
  }
  const a = preview.artifactId ? await findArtifact(ctx.db, preview.artifactId) : undefined
  const versionId = preview.artifactVersionId ?? a?.headVersionId
  const [v] =
    a && versionId
      ? await ctx.db
          .select()
          .from(artifactVersions)
          .where(and(eq(artifactVersions.id, versionId), eq(artifactVersions.artifactId, a.id)))
      : []
  if (!a || !v) return { status: 404, key: '产物还没有可预览的版本。' }
  let path: string
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '')
  } catch {
    return { status: 400, key: '请求无效' }
  }
  if (path === '' || path.endsWith('/')) path += 'index.html'
  const head = (type: string, extra: Record<string, string> = {}) => ({
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
    ...extra,
  })
  const send = (type: string, body: Buffer) => {
    res.writeHead(200, head(type, { 'content-length': String(body.length) }))
    res.end(req.method === 'HEAD' ? undefined : body)
    return null
  }
  const parent = 'userId' in visitor ? visitor.parent : undefined
  if (`/${path}` === BRIDGE_SCRIPT_PATH)
    return parent ? send(mimeOf(path), BRIDGE) : { status: 404, key: '文件不存在' }
  const l1 = v.files.some((f) => f.path === GG_ARTIFACT_MANIFEST)
  const shell = l1 ? kitName(path) : null
  const kit = shell ? await pluginKit(ctx.db, a.pluginVersionId) : null
  const fromKit = shell && kit?.get(shell)
  if (fromKit) return send(mimeOf(path), fromKit)
  const file = v.files.find((f) => f.path === path)
  if (!file) return { status: 404, key: '文件不存在' }
  if (parent && bridged(path, l1))
    return send(
      mimeOf(path),
      Buffer.from(injectBridge((await readBlob(a.groupId, file.hash)).toString('utf8'), parent)),
    )
  const etag = `"${file.hash}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag }).end()
    return null
  }
  const body = await artifactBlobs.open(a.groupId, file.hash)
  res.writeHead(200, head(mimeOf(path), { etag, 'content-length': String(file.size) }))
  if (req.method === 'HEAD') {
    body.destroy()
    res.end()
    return null
  }
  body.on('error', () => res.destroy())
  body.pipe(res)
  return null
}
