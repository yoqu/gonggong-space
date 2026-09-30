import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const SLOW = { timeout: 30_000 }

async function connect() {
  const u = await t.seed.user()
  const cookie = await t.seed.cookie(u.id)
  const origin = `http://${new URL(t.url('/')).host}`
  return { userId: u.id, open: () => t.ws('/ws/web', { cookie, origin }) }
}

it('does not subscribe a socket that closed while it was being authenticated', SLOW, async () => {
  const c = await connect()
  let release = () => {}
  let locked = () => {}
  const lock = t.db.transaction(async (tx) => {
    await tx.execute(sql`lock table web_sessions in access exclusive mode`)
    locked()
    await new Promise<void>((r) => {
      release = r
    })
  })
  await new Promise<void>((r) => {
    locked = r
  })
  const ws = c.open()
  await inbox(ws).opened
  ws.terminate()
  await new Promise((r) => setTimeout(r, 200))
  release()
  await lock
  await new Promise((r) => setTimeout(r, 200))
  expect(t.ctx.bus.isConnected(c.userId)).toBe(false)
})

it('drops a client that stops reading instead of buffering without bound', SLOW, async () => {
  const c = await connect()
  const ws = c.open()
  await inbox(ws).opened
  await expect.poll(() => t.ctx.bus.isConnected(c.userId)).toBe(true)
  ;(ws as unknown as { _socket: { pause(): void } })._socket.pause()
  const text = 'x'.repeat(1 << 20)
  for (let i = 0; i < 64 && t.ctx.bus.isConnected(c.userId); i++) {
    t.ctx.bus.publish([c.userId], { t: 'run.delta', runId: 'r', text })
    await new Promise((r) => setImmediate(r))
  }
  await expect.poll(() => t.ctx.bus.isConnected(c.userId), SLOW).toBe(false)
})
