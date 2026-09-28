import {
  createServer as createHttp,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from 'node:http'
import { createServer as createHttps } from 'node:https'
import type { Duplex } from 'node:stream'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyServerFactory } from 'fastify'
import type { Ctx } from '../../context.js'
import { previews } from '../../db/schema.js'
import type { TlsOptions } from '../../tls.js'
import { servePreviewHttp, servePreviewUpgrade } from './proxy.js'

async function openPreview(ctx: Ctx, where: { slug: string } | { id: string }) {
  const match = 'slug' in where ? eq(previews.slug, where.slug) : eq(previews.id, where.id)
  const [row] = await ctx.db
    .select()
    .from(previews)
    .where(and(match, isNull(previews.closedAt)))
  return row
}

/** Domain mode: the preview slug of a `<slug>.<domain>` Host, else null (a main-site request). */
function slugOf(ctx: Ctx, host: string | undefined) {
  const domain = ctx.config.preview.domain
  const name = host?.replace(/:\d+$/, '').toLowerCase()
  if (!domain || !name?.endsWith(`.${domain}`)) return null
  const slug = name.slice(0, -domain.length - 1)
  return slug.includes('.') ? null : slug
}

const fail = (err: unknown) => console.error('preview:', err)

/**
 * The main listener, with domain-mode preview hosts answered before Fastify sees them. Their upgrades are taken off
 * the websocket plugin's listener in `routeUpgrades`, once the plugin has attached it.
 */
export function previewServerFactory(ctx: Ctx, tls: TlsOptions | null): FastifyServerFactory {
  return (handler) => {
    const listener: RequestListener = (req, res) => {
      const slug = slugOf(ctx, req.headers.host)
      if (!slug) return handler(req, res)
      openPreview(ctx, { slug })
        .then((p) => servePreviewHttp(ctx, p, req, res))
        .catch((err) => {
          fail(err)
          res.destroy()
        })
    }
    return tls ? createHttps(tls, listener) : createHttp(listener)
  }
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

export function routeUpgrades(ctx: Ctx, server: Server) {
  const others = server.listeners('upgrade') as UpgradeListener[]
  server.removeAllListeners('upgrade')
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const slug = slugOf(ctx, req.headers.host)
    if (!slug) {
      for (const l of others) l.call(server, req, socket, head)
      return
    }
    openPreview(ctx, { slug })
      .then((p) => servePreviewUpgrade(ctx, p, req, socket, head))
      .catch((err) => {
        fail(err)
        socket.destroy()
      })
  })
}

// ── Port mode ────────────────────────────────────────────────────────────────
type Pool = { tls: TlsOptions | null; servers: Map<string, Server> }
const pools = new WeakMap<Ctx, Pool>()

function listen(ctx: Ctx, pool: Pool, previewId: string, port: number) {
  const listener: RequestListener = (req, res) => {
    openPreview(ctx, { id: previewId })
      .then((p) => servePreviewHttp(ctx, p, req, res))
      .catch((err) => {
        fail(err)
        res.destroy()
      })
  }
  const server = pool.tls ? createHttps(pool.tls, listener) : createHttp(listener)
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    openPreview(ctx, { id: previewId })
      .then((p) => servePreviewUpgrade(ctx, p, req, socket, head))
      .catch((err) => {
        fail(err)
        socket.destroy()
      })
  })
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, ctx.config.preview.listenHost ?? '127.0.0.1', () => {
      server.off('error', reject)
      pool.servers.set(previewId, server)
      resolve((server.address() as { port: number }).port)
    })
  })
}

/** Port mode: gives an open preview a listener on a free port of the range and records it. */
export async function openPortListener(ctx: Ctx, previewId: string) {
  const pool = pools.get(ctx)
  if (!pool) throw new Error('preview port pool not started')
  const [lo, hi] = ctx.config.preview.ports
  const span = hi - lo + 1
  const start = Math.floor(Math.random() * span)
  for (let i = 0; i < span; i++) {
    const candidate = lo + ((start + i) % span)
    const used = [...pool.servers.values()].some(
      (s) => (s.address() as { port: number } | null)?.port === candidate,
    )
    if (candidate !== 0 && used) continue
    try {
      const port = await listen(ctx, pool, previewId, candidate)
      await ctx.db.update(previews).set({ publicPort: port }).where(eq(previews.id, previewId))
      return port
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    }
  }
  throw new Error(`预览端口 ${lo}-${hi} 已用完`)
}

export async function closePortListener(ctx: Ctx, previewId: string) {
  const servers = pools.get(ctx)?.servers
  const server = servers?.get(previewId)
  if (!servers || !server) return
  servers.delete(previewId)
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

/** Port mode listeners live with the app: open previews get their port back on start (a new one if it is taken). */
export function startPortListeners(ctx: Ctx, tls: TlsOptions | null) {
  const pool: Pool = { tls, servers: new Map() }
  pools.set(ctx, pool)
  const ready = (async () => {
    if (ctx.config.preview.domain) return
    const open = await ctx.db
      .select({ id: previews.id, port: previews.publicPort })
      .from(previews)
      .where(and(isNull(previews.closedAt), isNotNull(previews.publicPort)))
    for (const p of open)
      await listen(ctx, pool, p.id, p.port ?? 0).catch(() => openPortListener(ctx, p.id).catch(fail))
  })()
  return async () => {
    await ready.catch(fail)
    await Promise.all([...pool.servers.keys()].map((id) => closePortListener(ctx, id)))
  }
}
