import {
  decodeFrame,
  encodeFrame,
  TUNNEL_FRAME,
  TUNNEL_MAX_STREAMS,
  type TunnelFrameType,
  type TunnelOpen,
} from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { TunnelStream } from '../src/modules/previews/tunnel.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const json = (v: unknown) => Buffer.from(JSON.stringify(v))

/** A daemon end: /hello answers, /echo returns the body, /ws echoes raw bytes after 101, /hang never answers. */
function fakeDaemon(ws: WebSocket) {
  const send = (id: number, type: TunnelFrameType, payload: Uint8Array = new Uint8Array()) =>
    ws.send(encodeFrame(id, type, payload))
  const bodies = new Map<number, { path: string; chunks: Buffer[] }>()
  ws.on('message', (raw: Buffer) => {
    const f = decodeFrame(new Uint8Array(raw))
    if (f.type === TUNNEL_FRAME.open) {
      const open: TunnelOpen = JSON.parse(Buffer.from(f.payload).toString())
      bodies.set(f.streamId, { path: open.path, chunks: [] })
      if (open.path === '/ws') send(f.streamId, TUNNEL_FRAME.head, json({ status: 101, headers: [] }))
      return
    }
    const s = bodies.get(f.streamId)
    if (!s) return
    if (f.type === TUNNEL_FRAME.data) {
      if (s.path === '/ws') send(f.streamId, TUNNEL_FRAME.data, f.payload)
      else s.chunks.push(Buffer.from(f.payload))
    }
    if (f.type !== TUNNEL_FRAME.end) return
    if (s.path === '/hang') return
    if (s.path !== '/ws') {
      const body = s.path === '/hello' ? Buffer.from('hi') : Buffer.concat(s.chunks)
      send(
        f.streamId,
        TUNNEL_FRAME.head,
        json({
          status: 200,
          headers: [
            ['x-a', '1'],
            ['x-a', '2'],
          ],
        }),
      )
      send(f.streamId, TUNNEL_FRAME.data, body)
    }
    send(f.streamId, TUNNEL_FRAME.end)
  })
}

async function daemon() {
  const u = await t.seed.user()
  const { machine, token } = await t.seed.machine(u.id)
  const ws = t.ws('/ws/daemon/tunnel', { authorization: `Bearer ${token}` })
  fakeDaemon(ws)
  await vi.waitFor(() => expect(t.ctx.tunnels.get(machine.id)).toBeDefined())
  return { machine, ws, conn: t.ctx.tunnels.get(machine.id)! }
}

const open = (path: string, upgrade = false): TunnelOpen => ({
  previewId: 'p1',
  port: 5173,
  method: 'GET',
  path,
  headers: [],
  upgrade,
})

async function read(s: TunnelStream) {
  const chunks: Buffer[] = []
  for await (const c of s) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString()
}

describe('preview tunnel (server side)', () => {
  it('refuses connections without a valid machine token', async () => {
    const ws = t.ws('/ws/daemon/tunnel', { authorization: 'Bearer mt_nope' })
    const status = await new Promise((r) => {
      ws.on('unexpected-response', (req, res) => {
        req.destroy()
        r(res.statusCode)
      })
      ws.on('open', () => r('opened'))
    })
    expect(status).toBe(401)
  })

  it('multiplexes requests with streamed bodies and keeps repeated headers', async () => {
    const { conn } = await daemon()
    const hello = conn.open(open('/hello'))
    hello.end()
    const post = conn.open({ ...open('/echo'), method: 'POST' })
    post.write('abc')
    post.end('def')
    expect(await hello.head).toEqual({
      status: 200,
      headers: [
        ['x-a', '1'],
        ['x-a', '2'],
      ],
    })
    expect(await read(hello)).toBe('hi')
    await post.head
    expect(await read(post)).toBe('abcdef')
  })

  it('carries raw bytes both ways after an upgrade', async () => {
    const { conn } = await daemon()
    const s = conn.open(open('/ws', true))
    expect((await s.head).status).toBe(101)
    s.write('ping')
    const [echo] = (await new Promise((r) => s.once('data', (d) => r([d])))) as Buffer[]
    expect(echo!.toString()).toBe('ping')
    s.end()
    await new Promise((r) => s.on('end', r).resume())
  })

  it('fails open streams when the daemon disconnects, and forgets it', async () => {
    const { conn, ws, machine } = await daemon()
    const s = conn.open(open('/hang'))
    s.end()
    s.on('error', () => {})
    ws.close()
    await expect(s.head).rejects.toThrow('daemon')
    await vi.waitFor(() => expect(t.ctx.tunnels.get(machine.id)).toBeUndefined())
  })

  it(`allows at most ${TUNNEL_MAX_STREAMS} concurrent streams per machine`, async () => {
    const { conn } = await daemon()
    const live = Array.from({ length: TUNNEL_MAX_STREAMS }, () => conn.open(open('/hang')))
    expect(() => conn.open(open('/hang'))).toThrow()
    live[0]!.destroy()
    expect(() => conn.open(open('/hang')).destroy()).not.toThrow()
    for (const s of live) s.destroy()
  })
})
