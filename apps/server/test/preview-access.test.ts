import { request } from 'node:http'
import { connect as tcpConnect } from 'node:net'
import { decodeFrame, encodeFrame, TUNNEL_FRAME, type TunnelOpen } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { previews } from '../src/db/schema.js'
import { closePortListener, openPortListener } from '../src/modules/previews/gateway.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
})
afterEach(() => t.close())

/** Answers every request with what it received; /ws upgrades to a raw echo. */
function fakeDaemon(ws: WebSocket) {
  const send = (id: number, type: number, payload: Uint8Array = new Uint8Array()) =>
    ws.send(encodeFrame(id, type as never, payload))
  const opens = new Map<number, TunnelOpen>()
  ws.on('message', (raw: Buffer) => {
    const f = decodeFrame(new Uint8Array(raw))
    if (f.type === TUNNEL_FRAME.open) {
      const open: TunnelOpen = JSON.parse(Buffer.from(f.payload).toString())
      opens.set(f.streamId, open)
      if (open.upgrade)
        send(
          f.streamId,
          TUNNEL_FRAME.head,
          Buffer.from(
            JSON.stringify({
              status: 101,
              headers: [
                ['upgrade', 'echo'],
                ['connection', 'upgrade'],
              ],
            }),
          ),
        )
      return
    }
    const open = opens.get(f.streamId)
    if (open?.upgrade && f.type === TUNNEL_FRAME.data) return send(f.streamId, TUNNEL_FRAME.data, f.payload)
    if (f.type !== TUNNEL_FRAME.end || !open) return
    if (!open.upgrade) {
      const head = {
        status: 200,
        headers: [
          ['content-type', 'application/json'],
          ['transfer-encoding', 'chunked'],
        ],
      }
      send(f.streamId, TUNNEL_FRAME.head, Buffer.from(JSON.stringify(head)))
      send(f.streamId, TUNNEL_FRAME.data, Buffer.from(JSON.stringify(open)))
    }
    send(f.streamId, TUNNEL_FRAME.end)
  })
}

async function setup({ daemon = true } = {}) {
  const alice = await t.seed.user()
  const bob = await t.seed.user()
  const { machine, token } = await t.seed.machine(alice.id)
  const bot = await t.seed.bot({ ownerId: alice.id, machineId: machine.id })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
  const [preview] = await t.db
    .insert(previews)
    .values({
      slug: 'k3m9q2x7',
      kind: 'http',
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      port: 5173,
      title: '首页',
    })
    .returning()
  if (daemon) {
    fakeDaemon(t.ws('/ws/daemon/tunnel', { authorization: `Bearer ${token}` }))
    await vi.waitFor(() => expect(t.ctx.tunnels.get(machine.id)).toBeDefined())
  }
  return {
    alice,
    bob,
    group,
    preview: preview!,
    cookie: await t.seed.cookie(alice.id),
    bobCookie: await t.seed.cookie(bob.id),
  }
}

const HOST = 'k3m9q2x7.preview.test'

type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string }
function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<Res>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })
}
const mainPort = () => Number(new URL(t.url('/')).port)
const onPreview = (path: string, headers: Record<string, string> = {}) =>
  get(mainPort(), path, { host: HOST, ...headers })
const cookieOf = (res: Res) => (res.headers['set-cookie'] as string[])[0]!

/** Goes through the main site's 打开 entry and returns the preview cookie it ends with. */
async function login(previewId: string, cookie: string, path = '/a?b=1') {
  const open = await t.app.inject({
    url: `/api/previews/${previewId}/open?path=${encodeURIComponent(path)}`,
    headers: { cookie },
  })
  expect(open.statusCode).toBe(302)
  const target = new URL(open.headers.location as string)
  expect(target.host).toBe(HOST)
  expect(target.pathname).toBe('/__gg/auth')
  const auth = await onPreview(`${target.pathname}${target.search}`)
  expect(auth.status).toBe(302)
  expect(auth.headers.location).toBe(path)
  const set = cookieOf(auth)
  expect(set).toMatch(/^gg_pv_[0-9a-f-]+=[^;]+;.*HttpOnly/)
  return { cookie: set.split(';')[0]!, again: `${target.pathname}${target.search}` }
}

describe('preview access (domain mode)', () => {
  it('lets group members in through the main site with a one-time code', async () => {
    const s = await setup()
    const { cookie, again } = await login(s.preview.id, s.cookie)
    expect((await onPreview(again)).status).toBe(401)

    const res = await onPreview('/a?b=1', { cookie: `${cookie}; theme=dark` })
    expect(res.status).toBe(200)
    const seen: TunnelOpen = JSON.parse(res.text)
    expect(seen).toMatchObject({ previewId: s.preview.id, port: 5173, method: 'GET', path: '/a?b=1' })
    const headers = Object.fromEntries(seen.headers)
    expect(headers.host).toBe('127.0.0.1:5173')
    expect(headers['x-forwarded-host']).toBe(HOST)
    expect(headers.cookie).toBe('theme=dark')
    await vi.waitFor(async () => {
      const [row] = await t.db.select().from(previews).where(eq(previews.id, s.preview.id))
      expect(row?.lastAccessAt).not.toBeNull()
    })
  })

  it('only ever redirects within the preview origin', async () => {
    const s = await setup()
    for (const path of ['//evil.example/x', '/\\evil.example/x']) {
      const open = await t.app.inject({
        url: `/api/previews/${s.preview.id}/open`,
        headers: { cookie: s.cookie },
      })
      const code = new URL(open.headers.location as string).searchParams.get('code')!
      const res = await onPreview(`/__gg/auth?code=${code}&return=${encodeURIComponent(path)}`)
      expect(res.headers.location).toBe('/x')
    }
  })

  it('refuses non-members, strangers and closed previews', async () => {
    const s = await setup()
    const open = (cookie: string) =>
      t.app.inject({ url: `/api/previews/${s.preview.id}/open`, headers: { cookie } })
    expect((await open(s.bobCookie)).statusCode).toBe(404)
    expect((await t.app.inject({ url: `/api/previews/${s.preview.id}/open` })).statusCode).toBe(401)
    const stranger = await onPreview('/', { accept: 'text/html' })
    expect(stranger.status).toBe(401)
    expect(stranger.text).toContain('请从共工的预览卡片打开')

    const { cookie } = await login(s.preview.id, s.cookie)
    await t.db.update(previews).set({ closedAt: new Date() }).where(eq(previews.id, s.preview.id))
    expect((await onPreview('/', { cookie })).status).toBe(404)
    expect((await open(s.cookie)).statusCode).toBe(404)
  })

  it('sends strangers back through the main site when its public URL is known', async () => {
    const s = await setup()
    t.ctx.config.preview.publicUrl = 'https://gg.example.com'
    const res = await onPreview('/x', { accept: 'text/html' })
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`https://gg.example.com/api/previews/${s.preview.id}/open?path=%2Fx`)
  })

  it('shows an offline page when the daemon tunnel is down', async () => {
    const s = await setup({ daemon: false })
    const { cookie } = await login(s.preview.id, s.cookie)
    const res = await onPreview('/', { cookie })
    expect(res.status).toBe(502)
    expect(res.text).toContain('离线')
  })

  it('tunnels upgrades (HMR sockets) for authorized visitors only', async () => {
    const s = await setup()
    const { cookie } = await login(s.preview.id, s.cookie)
    const port = mainPort()
    const upgrade = (withCookie: boolean) =>
      new Promise<string>((resolve) => {
        const sock = tcpConnect(port, '127.0.0.1', () => {
          const auth = withCookie ? `cookie: ${cookie}\r\n` : ''
          sock.write(
            `GET /hmr HTTP/1.1\r\nhost: ${HOST}\r\nconnection: Upgrade\r\nupgrade: echo\r\n${auth}\r\n`,
          )
        })
        let got = ''
        sock.on('data', (d) => {
          got += d.toString()
          if (got.includes('\r\n\r\n') && got.startsWith('HTTP/1.1 101') && !got.includes('ping'))
            sock.write('ping')
          if (got.endsWith('ping') || !got.startsWith('HTTP/1.1 101')) {
            sock.destroy()
            resolve(got)
          }
        })
      })
    expect(await upgrade(false)).toMatch(/^HTTP\/1.1 401/)
    const ok = await upgrade(true)
    expect(ok).toMatch(/^HTTP\/1.1 101/)
    expect(ok.endsWith('ping')).toBe(true)
  })
})

describe('preview access (port mode)', () => {
  it('serves a preview on its own port and signs visitors in there', async () => {
    t.ctx.config.preview.domain = null
    const s = await setup()
    const publicPort = await openPortListener(t.ctx, s.preview.id)
    const open = await t.app.inject({
      url: `/api/previews/${s.preview.id}/open`,
      headers: { cookie: s.cookie, host: '192.168.1.5:8787' },
    })
    const target = new URL(open.headers.location as string)
    expect(target.host).toBe(`192.168.1.5:${publicPort}`)
    const auth = await get(publicPort, `${target.pathname}${target.search}`)
    const cookie = cookieOf(auth).split(';')[0]!
    const res = await get(publicPort, '/', { cookie })
    expect((JSON.parse(res.text) as Extract<TunnelOpen, { previewId: string }>).previewId).toBe(s.preview.id)
    await closePortListener(t.ctx, s.preview.id)
    await expect(get(publicPort, '/')).rejects.toThrow()
  })
})
