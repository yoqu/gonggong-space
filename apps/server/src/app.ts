import { PROTOCOL_VERSION } from '@aiws/protocol'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { daemonGateway } from './daemon/gateway.js'

export async function buildApp() {
  const app = Fastify({ logger: process.env.AIWS_LOG === '1' })
  await app.register(websocket)
  app.get('/api/health', async () => ({ ok: true, protocol: PROTOCOL_VERSION }))
  await app.register(daemonGateway)
  return app
}
