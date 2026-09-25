import { NET_PROBE_MAX_BYTES } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { machines } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
const at = new Date('2026-09-23T10:00:00Z')
beforeEach(async () => {
  t = await createTestApp({ now: () => at })
})
afterEach(() => t.close())

async function machine() {
  const u = await t.seed.user()
  const m = await t.seed.machine(u.id)
  return { ...m, auth: { authorization: `Bearer ${m.token}` } }
}

describe('GET /api/daemon/net/probe', () => {
  it('streams exactly the requested number of incompressible bytes', async () => {
    const m = await machine()
    const res = await fetch(t.url('/api/daemon/net/probe?bytes=300000'), { headers: m.auth })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(300_000)
    expect(new Set(body.subarray(0, 4096)).size).toBeGreaterThan(200)
  })

  it('rejects sizes outside 1..NET_PROBE_MAX_BYTES and callers without a machine token', async () => {
    const m = await machine()
    const probe = (q: string, headers = m.auth) =>
      t.app.inject({ url: `/api/daemon/net/probe?${q}`, headers })
    expect((await probe(`bytes=${NET_PROBE_MAX_BYTES + 1}`)).statusCode).toBe(400)
    expect((await probe('bytes=0')).statusCode).toBe(400)
    expect((await probe('bytes=abc')).statusCode).toBe(400)
    expect((await probe('bytes=10', {} as typeof m.auth)).statusCode).toBe(401)
  })
})

describe('POST /api/daemon/net', () => {
  it("records the machine's latency, bandwidth and measurement time", async () => {
    const m = await machine()
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/daemon/net',
      headers: m.auth,
      payload: { latencyMs: 23.6, bandwidthMbps: 87.25 },
    })
    expect(res.statusCode).toBe(204)
    const [row] = await t.db.select().from(machines).where(eq(machines.id, m.machine.id))
    expect(row).toMatchObject({ latencyMs: 24, bandwidthMbps: 87.25, netMeasuredAt: at })
  })

  it('validates the body and the token', async () => {
    const m = await machine()
    const post = (payload: object, headers = m.auth) =>
      t.app.inject({ method: 'POST', url: '/api/daemon/net', headers, payload })
    expect((await post({ latencyMs: -1, bandwidthMbps: 1 })).statusCode).toBe(400)
    expect((await post({ latencyMs: 1 })).statusCode).toBe(400)
    expect(
      (await post({ latencyMs: 1, bandwidthMbps: 1 }, { authorization: 'Bearer nope' })).statusCode,
    ).toBe(401)
  })
})
