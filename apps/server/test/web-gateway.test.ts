import type { WebEvent } from '@gonggong/protocol'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type WebSocket from 'ws'
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

/** Resolves once the server has read everything sent before: its pong answers frames in order. */
const flushed = (ws: WebSocket) =>
  new Promise((r) => {
    ws.once('pong', r)
    ws.ping()
  })

const focus = (ws: WebSocket, groupId: string | null) => ws.send(JSON.stringify({ t: 'focus', groupId }))

const DELTA_AT = new Date().toISOString()
const delta = (group: string): WebEvent => ({
  t: 'run.delta',
  runId: `run-${group}`,
  text: group,
  lastActivityAt: DELTA_AT,
})
const MARK: WebEvent = { t: 'group.removed', groupId: 'mark' }

/** A connected, attached socket whose user is `userId`; `upTo()` collects what it got through the next MARK. */
async function client() {
  const c = await connect()
  const ws = c.open()
  const box = inbox(ws)
  await box.opened
  await expect.poll(() => t.ctx.bus.isConnected(c.userId)).toBe(true)
  const upTo = async () => {
    const got: unknown[] = []
    for (let m = await box.next(); ; m = await box.next()) {
      if ((m as WebEvent).t === MARK.t) return got
      got.push(m)
    }
  }
  return { ...c, ws, upTo }
}

it(
  'streams live output only to connections showing its group; one that never said gets all',
  SLOW,
  async () => {
    const [a, b, none, old] = await Promise.all([client(), client(), client(), client()])
    focus(a.ws, 'A')
    focus(b.ws, 'B')
    focus(none.ws, null)
    await Promise.all([a, b, none].map((c) => flushed(c.ws)))
    const users = [a, b, none, old].map((c) => c.userId)
    t.ctx.bus.publish(users, delta('A'), 'A')
    t.ctx.bus.publish(users, delta('B'), 'B')
    t.ctx.bus.publish(users, MARK)
    expect(await a.upTo()).toEqual([delta('A')])
    expect(await b.upTo()).toEqual([delta('B')])
    expect(await none.upTo()).toEqual([])
    expect(await old.upTo()).toEqual([delta('A'), delta('B')])

    focus(a.ws, 'B')
    await flushed(a.ws)
    t.ctx.bus.publish(users, delta('A'), 'A')
    t.ctx.bus.publish(users, delta('B'), 'B')
    t.ctx.bus.publish(users, MARK)
    expect(await a.upTo()).toEqual([delta('B')])
  },
)

it('applies a focus sent while the session was still being resolved', SLOW, async () => {
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
  const box = inbox(ws)
  await box.opened
  focus(ws, 'A')
  await flushed(ws)
  expect(t.ctx.bus.isConnected(c.userId)).toBe(false)
  release()
  await lock
  await expect.poll(() => t.ctx.bus.isConnected(c.userId)).toBe(true)
  t.ctx.bus.publish([c.userId], delta('B'), 'B')
  t.ctx.bus.publish([c.userId], delta('A'), 'A')
  expect(await box.next()).toEqual(delta('A'))
})

it('ignores malformed and oversized messages, keeping the connection and its focus', SLOW, async () => {
  const c = await client()
  focus(c.ws, 'A')
  c.ws.send('not json')
  c.ws.send(JSON.stringify({ t: 'focus', groupId: 5 }))
  c.ws.send(JSON.stringify({ t: 'focus', groupId: `B${'x'.repeat(4096)}` }))
  await flushed(c.ws)
  t.ctx.bus.publish([c.userId], delta('B'), 'B')
  t.ctx.bus.publish([c.userId], delta('A'), 'A')
  t.ctx.bus.publish([c.userId], MARK)
  expect(await c.upTo()).toEqual([delta('A')])
})

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
    t.ctx.bus.publish([c.userId], {
      t: 'run.delta',
      runId: 'r',
      text,
      lastActivityAt: new Date().toISOString(),
    })
    await new Promise((r) => setImmediate(r))
  }
  await expect.poll(() => t.ctx.bus.isConnected(c.userId), SLOW).toBe(false)
})
