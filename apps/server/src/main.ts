import { buildApp } from './app.js'
import type { Ctx } from './context.js'
import { DaemonHub } from './daemon/hub.js'
import { migrateDb, openDb } from './db/client.js'
import { sysParams } from './modules/admin/params.js'
import { dataDir } from './modules/attachments/service.js'
import { ensureBootstrapAdmin } from './modules/auth/bootstrap.js'
import { larkApi } from './modules/feishu/client.js'
import { larkConnector } from './modules/feishu/gateway.js'
import { liveKitFromEnv } from './modules/live/livekit.js'
import { previewConfig } from './modules/previews/config.js'
import { TunnelHub } from './modules/previews/tunnel.js'
import { Bus } from './realtime/bus.js'
import { certFingerprint, tlsOptions } from './tls.js'

const https = tlsOptions()
const { db } = openDb()
await migrateDb(db)
const { heartbeatSec } = await sysParams(db)
const ctx: Ctx = {
  db,
  bus: new Bus(),
  hub: new DaemonHub(),
  tunnels: new TunnelHub(),
  livekit: liveKitFromEnv(process.env, dataDir()),
  feishu: { api: larkApi(), connector: larkConnector() },
  now: () => new Date(),
  config: {
    heartbeatSec: Number(process.env.GONGGONG_HEARTBEAT_SEC ?? heartbeatSec),
    secureCookies: !!https || process.env.GONGGONG_SECURE_COOKIES === '1',
    fingerprint: https ? certFingerprint(https.cert) : null,
    preview: previewConfig(),
  },
}
await ensureBootstrapAdmin(ctx, process.env.GONGGONG_ADMIN_PASSWORD)
const app = await buildApp(ctx, { https })
await app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '127.0.0.1' })
