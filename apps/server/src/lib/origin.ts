import type { FastifyInstance } from 'fastify'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Plan P6: previews serve agent-written pages from the same site in port mode, and browsers send the session cookie
 * (SameSite=lax ignores ports) with their POSTs and WebSocket handshakes. Browsers always send Origin on those, so a
 * foreign Origin is refused; requests without one (daemon, CLI) are not browser-driven.
 */
export function originCheck(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (!origin || (SAFE.has(req.method) && req.headers.upgrade?.toLowerCase() !== 'websocket')) return
    let host: string
    try {
      host = new URL(origin).host
    } catch {
      host = ''
    }
    if (host === req.headers.host || host === req.headers['x-forwarded-host']) return
    return reply.status(403).send({ error: 'cross_origin', message: '拒绝跨站请求' })
  })
}
