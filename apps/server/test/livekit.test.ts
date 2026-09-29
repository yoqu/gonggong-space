import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenVerifier } from 'livekit-server-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { previews } from '../src/db/schema.js'
import { HostedLiveKit, liveKitFromEnv, liveTokens } from '../src/modules/live/livekit.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

/**
 * Stands in for livekit-server: reads LIVEKIT_CONFIG like the real one, serves `/` (health), echoes other requests,
 * and answers upgrades with a 101 followed by the path it saw, then echoes the connection's bytes.
 */
const FAKE = `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const cfg = JSON.parse(process.env.LIVEKIT_CONFIG)
fs.writeFileSync(process.env.FAKE_LIVEKIT_SEEN, JSON.stringify(cfg))
const server = http.createServer((req, res) => res.end(req.url === '/' ? 'OK' : 'saw ' + req.url))
server.on('upgrade', (req, socket, head) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n')
  socket.write('path=' + req.url + ';')
  socket.write(head)
  socket.pipe(socket)
})
server.listen(cfg.port, cfg.bind_addresses[0])
`

function fakeBinary() {
  const dir = mkdtempSync(join(tmpdir(), 'gonggong-livekit-'))
  const bin = join(dir, 'livekit-server')
  writeFileSync(bin, FAKE)
  chmodSync(bin, 0o755)
  const seen = join(dir, 'seen.json')
  process.env.FAKE_LIVEKIT_SEEN = seen
  return { dir, bin, config: () => JSON.parse(readFileSync(seen, 'utf8')) }
}

describe('liveKitFromEnv', () => {
  it('connects to an external LiveKit when all three variables are set', async () => {
    const lk = liveKitFromEnv(
      { LIVEKIT_URL: 'wss://lk.example.com', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' },
      '/tmp',
    )
    expect(await lk.endpoint()).toEqual({
      url: 'wss://lk.example.com',
      api: 'https://lk.example.com',
      key: 'k',
      secret: 's',
    })
    expect(lk.signalPort).toBeNull()
  })

  it('refuses a partial external configuration', () => {
    expect(() => liveKitFromEnv({ LIVEKIT_URL: 'wss://lk.example.com' }, '/tmp')).toThrow(/同时设置/)
  })

  it('hosts one otherwise', () => {
    expect(liveKitFromEnv({}, '/tmp')).toBeInstanceOf(HostedLiveKit)
  })
})

describe('hosted LiveKit', () => {
  let lk: HostedLiveKit | undefined
  afterEach(async () => {
    await lk?.close()
    lk = undefined
  })

  it('starts on first use with generated keys, loopback signaling and the configured media ports', async () => {
    const fake = fakeBinary()
    lk = new HostedLiveKit({
      dir: fake.dir,
      bin: fake.bin,
      udpPort: 17882,
      tcpPort: 17881,
      nodeIp: '10.0.0.5',
    })
    expect(lk.signalPort).toBeNull()
    const ep = await lk.endpoint()
    expect(ep.url).toBeNull()
    expect(ep.secret.length).toBeGreaterThanOrEqual(32)
    const cfg = fake.config()
    expect(cfg).toMatchObject({
      port: lk.signalPort,
      bind_addresses: ['127.0.0.1'],
      rtc: { udp_port: 17882, tcp_port: 17881, use_external_ip: false, node_ip: '10.0.0.5' },
      keys: { [ep.key]: ep.secret },
    })
    expect(ep.api).toBe(`http://127.0.0.1:${lk.signalPort}`)
    expect(await (await fetch(ep.api)).text()).toBe('OK')
    // Same process on later use.
    expect(await lk.endpoint()).toEqual(ep)
  })

  it('restarts a crashed server with the same keys, and stops it on close', async () => {
    const fake = fakeBinary()
    lk = new HostedLiveKit({ dir: fake.dir, bin: fake.bin, udpPort: 17882, tcpPort: 17881 })
    const ep = await lk.endpoint()
    const pid = Number(readFileSync(join(fake.dir, 'livekit.pid'), 'utf8'))
    process.kill(pid, 'SIGKILL')
    await vi.waitFor(
      () => {
        const again = Number(readFileSync(join(fake.dir, 'livekit.pid'), 'utf8'))
        expect(again).not.toBe(pid)
        expect(lk?.signalPort).not.toBeNull()
      },
      { timeout: 10_000 },
    )
    expect(await lk.endpoint()).toEqual(ep)
    const last = Number(readFileSync(join(fake.dir, 'livekit.pid'), 'utf8'))
    await lk.close()
    expect(() => process.kill(last, 0)).toThrow()
  })

  it('says why it cannot start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gonggong-livekit-'))
    const bin = join(dir, 'livekit-server')
    writeFileSync(bin, '#!/bin/sh\necho "bind: address already in use" >&2\nexit 1\n')
    chmodSync(bin, 0o755)
    lk = new HostedLiveKit({ dir, bin, udpPort: 17882, tcpPort: 17881 })
    await expect(lk.endpoint()).rejects.toThrow(/address already in use/)
  })
})

describe('LiveKit on the server', () => {
  let t: TestApp
  let fake: ReturnType<typeof fakeBinary>
  beforeEach(async () => {
    fake = fakeBinary()
    t = await createTestApp({
      livekit: new HostedLiveKit({ dir: fake.dir, bin: fake.bin, udpPort: 17882, tcpPort: 17881 }),
    })
  })
  afterEach(() => t.close())

  async function world() {
    const wang = await t.seed.user({ name: '王磊' })
    const li = await t.seed.user({ name: '李建国' })
    const zhao = await t.seed.user({ name: '赵六' })
    const { machine, token } = await t.seed.machine(wang.id)
    const other = await t.seed.machine(wang.id)
    const bot = await t.seed.bot({ ownerId: wang.id, machineId: machine.id })
    const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
    const insert = async (kind: string) => {
      const [p] = await t.db
        .insert(previews)
        .values({
          slug: `s${kind}${Math.random()}`,
          kind,
          machineId: machine.id,
          groupId: group.id,
          botId: bot.id,
          title: '计算器',
        })
        .returning()
      return p!
    }
    return {
      wang,
      li,
      token,
      otherToken: other.token,
      gui: await insert('gui'),
      web: await insert('http'),
      liClient: client(t, await t.seed.cookie(li.id)),
      zhaoClient: client(t, await t.seed.cookie(zhao.id)),
    }
  }

  it('gives group members a subscribe-only token for a live preview', async () => {
    const w = await world()
    const res = await w.liClient.post<{ url: string | null; token: string; identity: string }>(
      `/api/previews/${w.gui.id}/live`,
    )
    expect(res.status).toBe(200)
    expect(res.body.url).toBeNull()
    expect(res.body.identity).toMatch(new RegExp(`^u:${w.li.id}:`))
    const ep = await t.ctx.livekit.endpoint()
    const claims = await new TokenVerifier(ep.key, ep.secret).verify(res.body.token)
    expect(claims.sub).toBe(res.body.identity)
    expect(claims.name).toBe('李建国')
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: w.gui.id,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
    })

    expect((await w.zhaoClient.post(`/api/previews/${w.gui.id}/live`)).status).toBe(404)
    expect((await w.liClient.post(`/api/previews/${w.web.id}/live`)).status).toBe(400)
  })

  it('gives the preview machine a publisher token', async () => {
    const w = await world()
    const cast = (id: string, token: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/daemon/previews/${id}/cast`,
        headers: { authorization: `Bearer ${token}` },
      })
    const res = await cast(w.gui.id, w.token)
    expect(res.statusCode).toBe(200)
    const { url, token } = res.json()
    expect(url).toBeNull()
    const ep = await t.ctx.livekit.endpoint()
    const claims = await new TokenVerifier(ep.key, ep.secret).verify(token)
    expect(claims.sub).toBe('cast')
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: w.gui.id,
      canPublish: true,
      canSubscribe: false,
      canPublishData: false,
    })
    expect((await cast(w.gui.id, w.otherToken)).statusCode).toBe(404)
  })

  it('proxies signaling under /livekit on its own port', async () => {
    await t.ctx.livekit.endpoint()
    const res = await fetch(t.url('/livekit/rtc/v1/validate?access_token=abc'))
    expect(await res.text()).toBe('saw /rtc/v1/validate?access_token=abc')

    const port = Number(new URL(t.url('/')).port)
    const socket = connect(port, '127.0.0.1')
    socket.write(
      'GET /livekit/rtc/v1?access_token=abc HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: https://elsewhere.example\r\n\r\n',
    )
    socket.write('ping')
    let got = ''
    socket.setEncoding('utf8').on('data', (d) => {
      got += d
    })
    try {
      await vi.waitFor(() => expect(got).toContain('path=/rtc/v1?access_token=abc;ping'))
      expect(got.startsWith('HTTP/1.1 101')).toBe(true)
    } finally {
      socket.destroy()
    }
  })
})

describe('liveTokens', () => {
  it('lets a controller publish input on the data channel only', async () => {
    const ep = { url: null, api: 'http://127.0.0.1:1', key: 'k', secret: 's'.repeat(32) }
    const token = await liveTokens.viewer(ep, 'room', { identity: 'u:1:a', name: 'A', control: true })
    const claims = await new TokenVerifier('k', 's'.repeat(32)).verify(token)
    expect(claims.video).toMatchObject({ canSubscribe: true, canPublish: false, canPublishData: true })
  })
})
