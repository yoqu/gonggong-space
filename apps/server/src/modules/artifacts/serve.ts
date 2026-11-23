import { createReadStream, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { ArtifactHtmlFile, BRIDGE_SCRIPT_PATH, GG_ARTIFACT_MANIFEST } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactVersions, type previews } from '../../db/schema.js'
import type { MessageKey } from '../../i18n/index.js'
import type { Visitor } from '../previews/access.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { CURRENT_EDITOR_VERSION, editorCsp, resolveEditorAsset } from './editors.js'
import { injectBridge } from './html.js'
import { currentKitFile, kitName, LATEST_KIT_FILES, pluginKit } from './kit.js'
import { readStagedBlob, sniffMediaMime } from './publish.js'
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
  '.wasm': 'application/wasm',
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
  pinned: string | null = null,
): Promise<Refusal | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end()
    return null
  }
  const a = preview.artifactId ? await findArtifact(ctx.db, preview.artifactId) : undefined
  const versionId = pinned ?? preview.artifactVersionId ?? a?.headVersionId
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

  // ── Platform open-artifact editor assets (`/__oa/<type>[@<ver>]/…`) ──
  const oa = /^__oa\/([a-z]+)(?:@([a-zA-Z0-9._-]+))?\/(.*)$/.exec(path)
  if (oa) {
    const [, editorType, editorVer, sub] = oa
    const ver = editorVer ?? a.editorVersion ?? CURRENT_EDITOR_VERSION
    const csp = editorCsp(parent ?? "'self'")
    if (sub && sub.startsWith('project/')) {
      const f = v.files.find((x) => x.path === sub)
      if (!f) return { status: 404, key: '文件不存在' }
      const etag = `"${f.hash}"`
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag }).end()
        return null
      }
      const stream = await artifactBlobs.open(a.groupId, f.hash)
      res.writeHead(
        200,
        head(mimeOf(f.path), { etag, 'content-length': String(f.size), 'content-security-policy': csp }),
      )
      if (req.method === 'HEAD') {
        stream.destroy()
        res.end()
        return null
      }
      stream.on('error', () => res.destroy())
      stream.pipe(res)
      return null
    }
    const asset = editorType && sub ? resolveEditorAsset(editorType, ver, sub) : null
    if (!asset) return { status: 404, key: '文件不存在' }
    const stat = statSync(asset.fullPath)
    const headers = head(mimeOf(asset.fullPath), {
      'content-length': String(stat.size),
      'content-security-policy': csp,
      ...(asset.immutable && { 'cache-control': 'public, max-age=31536000, immutable' }),
    })
    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
      return null
    }
    const stream = createReadStream(asset.fullPath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return null
  }

  // ── Uploaded media blobs (`/_blob/<32hex>`): version files first, then staged uploads for members on head ──
  const blobMatch = /^_blob\/([0-9a-f]{32})$/.exec(path)
  if (blobMatch?.[1]) {
    const id32 = blobMatch[1]
    const fromVersion = v.files.find((f) => f.path === `_blob/${id32}` || f.hash.startsWith(id32))
    const staged =
      !fromVersion && 'userId' in visitor && !pinned && !preview.artifactVersionId
        ? await readStagedBlob(a.groupId, a.id, id32)
        : null
    const hash = fromVersion?.hash ?? staged?.hash
    if (!hash) return { status: 404, key: '文件不存在' }
    const buf = await readBlob(a.groupId, hash)
    const contentType = staged?.contentType ?? sniffMediaMime(buf)
    const etag = `"${hash}"`
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag }).end()
      return null
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    if (range?.[1] && buf.length > 0) {
      const start = Number(range[1])
      const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1
      if (start <= end && start < buf.length) {
        const slice = buf.subarray(start, end + 1)
        res.writeHead(
          206,
          head(contentType, {
            etag,
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${buf.length}`,
            'content-length': String(slice.length),
            'cache-control': 'private, max-age=31536000, immutable',
          }),
        )
        res.end(req.method === 'HEAD' ? undefined : slice)
        return null
      }
    }
    res.writeHead(
      200,
      head(contentType, {
        etag,
        'accept-ranges': 'bytes',
        'content-length': String(buf.length),
        'cache-control': 'private, max-age=31536000, immutable',
      }),
    )
    res.end(req.method === 'HEAD' ? undefined : buf)
    return null
  }

  const l1 = v.files.some((f) => f.path === GG_ARTIFACT_MANIFEST)
  const shell = l1 ? kitName(path) : null
  const kit = shell ? await pluginKit(ctx.db, a.pluginVersionId) : null
  if (shell === 'index.html' && kit?.has(shell)) {
    const page = ((await currentKitFile(ctx.db, a, shell)) ?? (kit.get(shell) as Buffer)).toString('utf8')
    // The shell shows which version it plays.
    const meta = `<script type="application/json" id="gg-meta">${JSON.stringify({ version: v.n })}</script>`
    const at = page.indexOf('</head>')
    return send(mimeOf(path), Buffer.from(at < 0 ? page : page.slice(0, at) + meta + page.slice(at)))
  }
  const fromKit =
    shell &&
    kit?.has(shell) &&
    (LATEST_KIT_FILES.has(shell) ? await currentKitFile(ctx.db, a, shell) : kit.get(shell))
  if (fromKit) return send(mimeOf(path), fromKit)
  const site = a.siteDir !== null
  const find = (p: string) => v.files.find((f) => f.path === p)
  // A hosted site's routes: `about/` of a static export, else a single-page app's own router behind index.html.
  const file =
    find(path) ?? (site && !extname(path) ? (find(`${path}/index.html`) ?? find('index.html')) : undefined)
  if (!file) return { status: 404, key: '文件不存在' }
  if (parent && !site && bridged(path, l1))
    return send(
      mimeOf(file.path),
      Buffer.from(injectBridge((await readBlob(a.groupId, file.hash)).toString('utf8'), parent)),
    )
  const etag = `"${file.hash}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag }).end()
    return null
  }
  const body = await artifactBlobs.open(a.groupId, file.hash)
  res.writeHead(200, head(mimeOf(file.path), { etag, 'content-length': String(file.size) }))
  if (req.method === 'HEAD') {
    body.destroy()
    res.end()
    return null
  }
  body.on('error', () => res.destroy())
  body.pipe(res)
  return null
}
