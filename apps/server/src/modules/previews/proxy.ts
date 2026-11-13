import { type IncomingMessage, type ServerResponse, STATUS_CODES } from 'node:http'
import type { Duplex } from 'node:stream'
import { type I18nParams, resolveLocale, type TunnelHead } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { previews } from '../../db/schema.js'
import { type MessageKey, translator } from '../../i18n/index.js'
import { remember } from '../../lib/lru.js'
import { serveArtifact } from '../artifacts/serve.js'
import { foreignCookies, redeemCode, setCookie, type Visitor, verifyCookie } from './access.js'
import { shareUnlockPage } from './share-unlock.js'
import { countVisit, linkShare, PASSWORD_PAUSE_MIN, passKey, shareAllows, tryPassword } from './shares.js'

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

/** Served by the preview host, outside Fastify: the language comes from the visitor's own header. */
function page(res: ServerResponse, status: number, key: MessageKey, params?: I18nParams) {
  const t = translator(resolveLocale(res.req.headers['accept-language']))
  const html = `<!doctype html><meta charset="utf-8"><title>${t('共工空间预览')}</title><body style="font:15px system-ui;padding:48px;color:#555">${t(key, params)}</body>`
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
/** Previews whose last write is remembered; a forgotten one is only written once more. */
const LAST_WRITE_MAX = 1000
/** Idle previews are closed (plan P11); a write a minute is enough to tell. */
function touch(ctx: Ctx, id: string) {
  const now = ctx.now()
  if (now.getTime() - (lastWrite.get(id) ?? 0) < 60_000) return
  remember(lastWrite, id, now.getTime(), LAST_WRITE_MAX)
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

/**
 * A signed cookie's visitor, with the artifact version a public link pins (null: the preview's own); for public-link
 * visitors the link must also still be valid.
 */
async function allowed(
  ctx: Ctx,
  req: IncomingMessage,
  preview: OpenPreview,
): Promise<{ visitor: Visitor; version: string | null } | null> {
  const visitor = verifyCookie(req, preview.id, ctx.now())
  if (!visitor) return null
  if (!('shareId' in visitor)) return { visitor, version: null }
  const version = await shareAllows(ctx, visitor, preview.id)
  return version === false ? null : { visitor, version }
}

function json(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    .end(JSON.stringify(body))
}

async function readPassword(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1024) return ''
  }
  try {
    const { password } = JSON.parse(body) as { password?: unknown }
    return typeof password === 'string' ? password : ''
  } catch {
    return ''
  }
}

/**
 * A public link: sets the visitor's cookie and sends them to the preview. A locked one first shows the password page,
 * which posts the digits back here and is answered with JSON.
 */
async function serveShareLink(
  ctx: Ctx,
  preview: OpenPreview,
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
) {
  const share = await linkShare(ctx, preview.id, token)
  if (!share) return page(res, 410, '公开链接已失效或已被收回。')
  const location = localPath(preview.path)
  if (!share.password) {
    await countVisit(ctx, preview, share.id)
    res.writeHead(302, { location, 'set-cookie': setCookie(ctx, preview.id, { shareId: share.id }) })
    return res.end()
  }
  const t = translator(resolveLocale(req.headers['accept-language']))
  if (req.method !== 'POST')
    return res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(shareUnlockPage(t))
  const result = tryPassword(ctx, share.id, share.password, await readPassword(req))
  if (result === 'locked')
    return json(res, 429, { error: t('尝试次数过多，请 {n} 分钟后再试', { n: PASSWORD_PAUSE_MIN }) })
  if (result === 'wrong') return json(res, 403, { error: t('密码不对，再试一次') })
  await countVisit(ctx, preview, share.id)
  const visitor = { shareId: share.id, key: passKey(share.id, share.password) }
  return json(res, 200, { location }, { 'set-cookie': setCookie(ctx, preview.id, visitor) })
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
    return serveShareLink(ctx, preview, req, res, url.pathname.slice('/__gg/share/'.length))
  }
  const access = await allowed(ctx, req, preview)
  if (!access) {
    const { publicUrl } = ctx.config.preview
    if (publicUrl && req.method === 'GET' && req.headers.accept?.includes('text/html')) {
      const next = `${publicUrl}/api/previews/${preview.id}/open?path=${encodeURIComponent(req.url ?? '/')}`
      return res.writeHead(302, { location: next }).end()
    }
    return page(res, 401, UNKNOWN)
  }
  if (preview.kind === 'artifact') {
    touch(ctx, preview.id)
    const refused = await serveArtifact(ctx, preview, access.visitor, req, res, access.version)
    // Browsers ask for a favicon on their own: one the artifact lacks is empty, not an error in the console.
    if (refused?.status === 404 && url.pathname === '/favicon.ico') return res.writeHead(204).end()
    return refused && page(res, refused.status, refused.key)
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
    return page(res, 503, '预览繁忙：{error}', { error: (err as Error).message })
  }
  stream.on('error', () => res.destroy())
  req.pipe(stream)
  let head: TunnelHead
  try {
    head = await stream.head
  } catch (err) {
    return res.headersSent
      ? res.destroy()
      : page(res, 502, '预览所在的机器离线，稍后再试。（{error}）', { error: (err as Error).message })
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
  if (!preview || preview.kind === 'artifact') return refuse(404)
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
