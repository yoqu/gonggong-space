import { type IncomingMessage, type ServerResponse, STATUS_CODES } from 'node:http'
import type { Duplex } from 'node:stream'
import type { TunnelHead } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { previews } from '../../db/schema.js'
import { foreignCookies, redeemCode, setCookie, verifyCookie } from './access.js'
import { redeemShare, shareAllows } from './shares.js'

export type OpenPreview = typeof previews.$inferSelect

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
  'transfer-encoding',
])

function page(res: ServerResponse, status: number, text: string) {
  const html = `<!doctype html><meta charset="utf-8"><title>共工空间预览</title><body style="font:15px system-ui;padding:48px;color:#555">${text}</body>`
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html)
}

/** Path and query only: `//host` or `/\\host` must not send the visitor to another site. */
function localPath(target: string) {
  const u = new URL(target, 'http://preview.invalid')
  return `${u.pathname}${u.search}`
}

const OFFLINE = '预览所在的机器离线，稍后再试。'
const UNKNOWN = '请从共工空间的预览卡片打开这个预览。'

const lastWrite = new Map<string, number>()
/** Idle previews are closed (plan P11); a write a minute is enough to tell. */
function touch(ctx: Ctx, id: string) {
  const now = ctx.now()
  if (now.getTime() - (lastWrite.get(id) ?? 0) < 60_000) return
  lastWrite.set(id, now.getTime())
  void ctx.db
    .update(previews)
    .set({ lastAccessAt: now })
    .where(eq(previews.id, id))
    .catch(() => {})
}

/** Request headers for the local server: our cookie removed, Host as it expects, the public host forwarded. */
function upstreamHeaders(req: IncomingMessage, port: number, upgrade: boolean) {
  const out: [string, string][] = []
  const raw = req.rawHeaders
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [name, value] = [raw[i]?.toLowerCase() ?? '', raw[i + 1] ?? '']
    if (name === 'host' || name === 'cookie' || (!upgrade && HOP.has(name) && name !== 'transfer-encoding'))
      continue
    out.push([name, value])
  }
  const cookie = foreignCookies(req.headers.cookie)
  if (cookie) out.push(['cookie', cookie])
  const proto = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  out.push(
    ['host', `127.0.0.1:${port}`],
    ['x-forwarded-host', req.headers.host ?? ''],
    ['x-forwarded-proto', proto],
  )
  return out
}

/** A signed cookie; for public-link visitors the link must also still be valid. */
async function allowed(ctx: Ctx, req: IncomingMessage, preview: OpenPreview) {
  const visitor = verifyCookie(req, preview.id, ctx.now())
  if (!visitor) return false
  return 'shareId' in visitor ? shareAllows(ctx, visitor.shareId, preview.id) : true
}

const downstream = (head: TunnelHead) => head.headers.filter(([k]) => !HOP.has(k.toLowerCase()))

/** Everything a preview origin answers: the sign-in hand-off, then the tunnelled site for known visitors. */
export async function servePreviewHttp(
  ctx: Ctx,
  preview: OpenPreview | undefined,
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (!preview) return page(res, 404, '预览不存在或已关闭。')
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/__gg/auth') {
    const visitor = redeemCode(ctx, url.searchParams.get('code') ?? '', preview.id)
    if (!visitor) return page(res, 401, '链接已失效，请回到共工空间重新打开预览。')
    const back = localPath(url.searchParams.get('return') ?? '/')
    res.writeHead(302, { location: back, 'set-cookie': setCookie(ctx, preview.id, visitor) })
    return res.end()
  }
  if (url.pathname.startsWith('/__gg/share/')) {
    const shareId = await redeemShare(ctx, preview, url.pathname.slice('/__gg/share/'.length))
    if (!shareId) return page(res, 410, '公开链接已失效或已被收回。')
    const location = localPath(preview.path)
    res.writeHead(302, { location, 'set-cookie': setCookie(ctx, preview.id, { shareId }) })
    return res.end()
  }
  if (!(await allowed(ctx, req, preview))) {
    const { publicUrl } = ctx.config.preview
    if (publicUrl && req.method === 'GET' && req.headers.accept?.includes('text/html')) {
      const next = `${publicUrl}/api/previews/${preview.id}/open?path=${encodeURIComponent(req.url ?? '/')}`
      return res.writeHead(302, { location: next }).end()
    }
    return page(res, 401, UNKNOWN)
  }
  const conn = ctx.tunnels.get(preview.machineId)
  if (!conn || preview.port === null) return page(res, 502, OFFLINE)
  touch(ctx, preview.id)
  let stream: ReturnType<typeof conn.open>
  try {
    stream = conn.open({
      previewId: preview.id,
      port: preview.port,
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: upstreamHeaders(req, preview.port, false),
      upgrade: false,
    })
  } catch (err) {
    return page(res, 503, `预览繁忙：${(err as Error).message}`)
  }
  stream.on('error', () => res.destroy())
  req.pipe(stream)
  let head: TunnelHead
  try {
    head = await stream.head
  } catch (err) {
    return res.headersSent ? res.destroy() : page(res, 502, `${OFFLINE}（${(err as Error).message}）`)
  }
  res.writeHead(head.status, downstream(head).flat())
  stream.pipe(res)
  res.on('close', () => {
    if (!res.writableFinished) stream.destroy()
  })
}

export async function servePreviewUpgrade(
  ctx: Ctx,
  preview: OpenPreview | undefined,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const refuse = (status: number) =>
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`)
  if (!preview) return refuse(404)
  if (!(await allowed(ctx, req, preview))) return refuse(401)
  const conn = ctx.tunnels.get(preview.machineId)
  if (!conn || preview.port === null) return refuse(502)
  touch(ctx, preview.id)
  let stream: ReturnType<typeof conn.open>
  try {
    stream = conn.open({
      previewId: preview.id,
      port: preview.port,
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: upstreamHeaders(req, preview.port, true),
      upgrade: true,
    })
  } catch {
    return refuse(503)
  }
  socket.on('error', () => stream.destroy())
  stream.on('error', () => socket.destroy())
  if (head.length) stream.write(head)
  let answer: TunnelHead
  try {
    answer = await stream.head
  } catch {
    return refuse(502)
  }
  const switching = answer.status === 101
  const headers = switching ? answer.headers : [...downstream(answer), ['connection', 'close']]
  const lines = headers.map(([k, v]) => `${k}: ${v}\r\n`).join('')
  socket.write(`HTTP/1.1 ${answer.status} ${STATUS_CODES[answer.status] ?? ''}\r\n${lines}\r\n`)
  if (switching) socket.pipe(stream)
  stream.pipe(socket)
}
