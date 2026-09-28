import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Ctx } from '../../context.js'

/** Who a preview cookie lets in: a group member, or a visitor through a public link (plan P7/P8). */
export type Visitor = { userId: string } | { shareId: string }

// Per process: a restart only costs visitors one silent trip through the main site.
const SECRET = randomBytes(32)
const COOKIE_TTL_S = 8 * 3600
const CODE_TTL_MS = 60_000

export const cookieName = (previewId: string) => `gg_pv_${previewId}`

const mac = (data: string) => createHmac('sha256', SECRET).update(data).digest('base64url')

function sign(previewId: string, visitor: Visitor, now: Date) {
  const body = Buffer.from(
    JSON.stringify({ p: previewId, v: visitor, e: now.getTime() + COOKIE_TTL_S * 1000 }),
  )
  const data = body.toString('base64url')
  return `${data}.${mac(data)}`
}

export function verifyCookie(req: IncomingMessage, previewId: string, now: Date): Visitor | null {
  const token = readCookies(req.headers.cookie)[cookieName(previewId)]
  const [data, sig] = token?.split('.') ?? []
  if (!data || !sig) return null
  const want = Buffer.from(mac(data))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const { p, v, e } = JSON.parse(Buffer.from(data, 'base64url').toString())
  return p === previewId && e > now.getTime() ? v : null
}

export function setCookie(ctx: Ctx, previewId: string, visitor: Visitor) {
  // Embedded in the chat, a domain-mode preview is a third-party frame: only a partitioned cookie survives there.
  const site = ctx.config.secureCookies ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'
  const value = sign(previewId, visitor, ctx.now())
  return `${cookieName(previewId)}=${value}; Path=/; Max-Age=${COOKIE_TTL_S}; HttpOnly; ${site}`
}

export function readCookies(header: string | undefined) {
  const out: Record<string, string> = {}
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

/** The visitor's cookies minus ours, so the preview itself never sees them. */
export function foreignCookies(header: string | undefined) {
  const kept = (header ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith('gg_pv_'))
  return kept.length ? kept.join('; ') : null
}

const codes = new Map<string, { previewId: string; visitor: Visitor; expires: number }>()

/** One-time hand-off from the main site (where the visitor is known) to the preview origin. */
export function issueCode(ctx: Ctx, previewId: string, visitor: Visitor) {
  const now = ctx.now().getTime()
  for (const [k, c] of codes) if (c.expires < now) codes.delete(k)
  const code = randomBytes(24).toString('base64url')
  codes.set(code, { previewId, visitor, expires: now + CODE_TTL_MS })
  return code
}

export function redeemCode(ctx: Ctx, code: string, previewId: string) {
  const c = codes.get(code)
  codes.delete(code)
  return c && c.previewId === previewId && c.expires >= ctx.now().getTime() ? c.visitor : null
}
