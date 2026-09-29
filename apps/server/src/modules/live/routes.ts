import { randomBytes } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { CastBuildDto, CastTokenDto, LiveTokenDto } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { requireOpenPreview } from '../previews/routes.js'
import { daemonRelease } from '../releases/routes.js'
import { liveTokens } from './livekit.js'
import { watch } from './service.js'

const PREFIX = '/livekit'

/** A preview streamed through LiveKit: a desktop app's window or a mini program's simulator. */
async function requireLivePreview(ctx: Ctx, id: string) {
  const preview = await requireOpenPreview(ctx, id)
  if (preview.kind !== 'gui' && preview.kind !== 'miniprogram') fail('invalid', '这个预览没有实时画面')
  return preview
}

export function liveRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post('/api/previews/:id/live', async (req): Promise<LiveTokenDto> => {
      const user = await requireUser(ctx, req)
      const preview = await requireLivePreview(ctx, (req.params as { id: string }).id)
      await requireMember(ctx, preview.groupId, user.id)
      const ep = await ctx.livekit.endpoint()
      // One identity per viewer connection: several tabs of one member must not kick each other out.
      const identity = `u:${user.id}:${randomBytes(4).toString('hex')}`
      const token = await liveTokens.viewer(ep, preview.id, { identity, name: user.name, control: false })
      return { url: ep.url, token, identity }
    })

    app.post('/api/previews/:id/watch', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const preview = await requireLivePreview(ctx, (req.params as { id: string }).id)
      await requireMember(ctx, preview.groupId, user.id)
      await watch(ctx, preview, user.id)
      return reply.status(204).send()
    })

    app.get('/api/daemon/cast-build', async (req): Promise<CastBuildDto> => {
      const machine = await requireMachine(ctx, req)
      const platform = `${machine.os}-${machine.arch}`
      const release = await daemonRelease(ctx)
      const build = release?.cast?.[platform]
      if (!release || !build) return fail('not_found', `服务器还没有发布 ${platform} 的 gg-cast`)
      return { version: release.version, ...build }
    })

    app.post('/api/daemon/previews/:id/cast', async (req): Promise<CastTokenDto> => {
      const machine = await requireMachine(ctx, req)
      const preview = await requireLivePreview(ctx, (req.params as { id: string }).id)
      if (preview.machineId !== machine.id) return fail('not_found', '预览不存在或已关闭')
      const ep = await ctx.livekit.endpoint()
      return { url: ep.url, token: await liveTokens.publisher(ep, preview.id) }
    })

    // The signaling's HTTP side (the client's `/rtc/validate` after a failed join).
    app.get(`${PREFIX}/*`, async (req, reply) => {
      const port = ctx.livekit.signalPort
      if (!port) return fail('not_found', 'LiveKit 未运行')
      const res = await fetch(`http://127.0.0.1:${port}${req.url.slice(PREFIX.length)}`)
      reply.status(res.status).header('content-type', res.headers.get('content-type') ?? 'text/plain')
      return reply.send(await res.text())
    })
  }
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

/**
 * LiveKit signaling WebSockets under `/livekit` go to the hosted server's loopback port as raw bytes, ahead of the
 * app's own upgrade handling (the access token in the query is their authentication, not the session cookie).
 */
export function routeLiveKitUpgrades(ctx: Ctx, server: Server) {
  const others = server.listeners('upgrade') as UpgradeListener[]
  server.removeAllListeners('upgrade')
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url?.startsWith(`${PREFIX}/`)) {
      for (const l of others) l.call(server, req, socket, head)
      return
    }
    const port = ctx.livekit.signalPort
    if (!port) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      return
    }
    const upstream = connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url?.slice(PREFIX.length)} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      upstream.write(head)
      upstream.pipe(socket).pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
}
