import { buildApp } from './app.js'
import { DaemonHub } from './daemon/hub.js'
import { migrateDb, openDb } from './db/client.js'
import { Bus } from './realtime/bus.js'

const { db } = openDb()
await migrateDb(db)
const app = await buildApp({
  db,
  bus: new Bus(),
  hub: new DaemonHub(),
  now: () => new Date(),
  config: {
    heartbeatSec: Number(process.env.AIWS_HEARTBEAT_SEC ?? 15),
    secureCookies: process.env.AIWS_SECURE_COOKIES === '1',
  },
})
await app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '127.0.0.1' })
