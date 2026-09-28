import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

// Plan P6: previews run agent-written pages on the same site in port mode, so the session cookie rides along.
describe('Origin check on the main site', () => {
  const logout = (headers: Record<string, string>) =>
    t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { host: 'gg.test', ...headers } })

  it('rejects state-changing requests from another origin', async () => {
    const res = await logout({ origin: 'https://gg.test:41000' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('cross_origin')
  })

  it('accepts same-origin requests, requests without Origin, and the proxy-forwarded host', async () => {
    expect((await logout({ origin: 'https://gg.test' })).statusCode).not.toBe(403)
    expect((await logout({})).statusCode).not.toBe(403)
    const proxied = await logout({ origin: 'https://app.example.com', 'x-forwarded-host': 'app.example.com' })
    expect(proxied.statusCode).not.toBe(403)
  })

  it('lets cross-origin GETs through (CORS keeps their responses unreadable)', async () => {
    const res = await t.app.inject({
      url: '/api/health',
      headers: { host: 'gg.test', origin: 'https://x.test' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('refuses WebSocket upgrades from another origin (cookies ride along same-site)', async () => {
    const u = await t.seed.user()
    const cookie = await t.seed.cookie(u.id)
    const host = new URL(t.url('/')).host
    const ws = t.ws('/ws/web', { cookie, origin: 'http://evil.test' })
    const status = await new Promise((r) => {
      ws.on('unexpected-response', (req, res) => {
        req.destroy()
        r(res.statusCode)
      })
      ws.on('open', () => r('opened'))
    })
    expect(status).toBe(403)
    const ok = t.ws('/ws/web', { cookie, origin: `http://${host}` })
    await inbox(ok).opened
    ok.close()
  })
})
