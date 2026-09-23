import { buildApp } from './app.js'
import type { Ctx } from './context.js'
import { DaemonHub } from './daemon/hub.js'
import { migrateDb, openDb } from './db/client.js'
import { sysParams } from './modules/admin/params.js'
import { ensureBootstrapAdmin } from './modules/auth/bootstrap.js'
import { Bus } from './realtime/bus.js'
import { tlsOptions } from './tls.js'

const https = tlsOptions()
const { db } = openDb()
await migrateDb(db)
const { heartbeatSec } = await sysParams(db)
const ctx: Ctx = {
  db,
  bus: new Bus(),
  hub: new DaemonHub(),
  now: () => new Date(),
  config: {
    heartbeatSec: Number(process.env.AIWS_HEARTBEAT_SEC ?? heartbeatSec),
    secureCookies: !!https || process.env.AIWS_SECURE_COOKIES === '1',
  },
}
await ensureBootstrapAdmin(ctx, process.env.AIWS_ADMIN_PASSWORD)
const app = await buildApp(ctx, { https })
await app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '127.0.0.1' })
