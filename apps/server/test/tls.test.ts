import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { get } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app.js'
import { DaemonHub } from '../src/daemon/hub.js'
import { liveKitFromEnv } from '../src/modules/live/livekit.js'
import { TunnelHub } from '../src/modules/previews/tunnel.js'
import { Bus } from '../src/realtime/bus.js'
import { certFingerprint, tlsOptions } from '../src/tls.js'
import { createTestDb } from './support/db.js'
import { FakeFeishu } from './support/feishu.js'

const dir = mkdtempSync(join(tmpdir(), 'gonggong-tls-'))
const script = join(import.meta.dirname, '../../../scripts/dev-cert.sh')
const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
const env = { GONGGONG_TLS_CERT: join(dir, 'cert.pem'), GONGGONG_TLS_KEY: join(dir, 'key.pem') }
const ca = readFileSync(env.GONGGONG_TLS_CERT)

describe('tlsOptions', () => {
  it('is off without a certificate and requires cert and key together', () => {
    expect(tlsOptions({})).toBeNull()
    expect(() => tlsOptions({ GONGGONG_TLS_CERT: env.GONGGONG_TLS_CERT })).toThrow(/together/)
    expect(tlsOptions(env)).toEqual({ cert: ca, key: readFileSync(env.GONGGONG_TLS_KEY) })
  })

  it('dev-cert.sh prints the env to use and the SHA-256 fingerprint', () => {
    const fp = execFileSync(
      'openssl',
      ['x509', '-in', env.GONGGONG_TLS_CERT, '-noout', '-fingerprint', '-sha256'],
      {
        encoding: 'utf8',
      },
    )
    expect(out).toContain(`GONGGONG_TLS_CERT=${env.GONGGONG_TLS_CERT}`)
    expect(out).toContain(`sha256:${fp.split('=')[1]!.trim()}`)
  })

  it('fingerprints the certificate as sha256:<lowercase hex> of its DER bytes', () => {
    const fp = execFileSync(
      'openssl',
      ['x509', '-in', env.GONGGONG_TLS_CERT, '-noout', '-fingerprint', '-sha256'],
      {
        encoding: 'utf8',
      },
    )
    const hex = fp.split('=')[1]!.trim().replaceAll(':', '').toLowerCase()
    expect(certFingerprint(ca)).toBe(`sha256:${hex}`)
  })
})

describe('server over TLS', () => {
  let close: () => Promise<void>
  let port: number
  beforeAll(async () => {
    const t = await createTestDb()
    const ctx = {
      db: t.db,
      bus: new Bus(),
      hub: new DaemonHub(),
      tunnels: new TunnelHub(),
      livekit: liveKitFromEnv(
        { LIVEKIT_URL: 'ws://127.0.0.1:9', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' },
        dir,
      ),
      feishu: (({ api, connector }) => ({ api, connector }))(new FakeFeishu()),
      now: () => new Date(),
      config: {
        heartbeatSec: 15,
        secureCookies: true,
        fingerprint: null,
        preview: { domain: null, ports: [0, 0] as [number, number], publicUrl: null },
      },
    }
    const app = await buildApp(ctx, { https: tlsOptions(env) })
    await app.listen({ port: 0, host: '127.0.0.1' })
    port = (app.server.address() as { port: number }).port
    close = async () => {
      await app.close()
      await t.close()
    }
  })
  afterAll(() => close())

  it('serves HTTPS with the configured certificate and nothing in plain text', async () => {
    const body = await new Promise<string>((resolve, reject) =>
      get(`https://127.0.0.1:${port}/api/health`, { ca }, (res) => {
        let s = ''
        res.on('data', (c) => {
          s += c
        })
        res.on('end', () => resolve(s))
      }).on('error', reject),
    )
    expect(JSON.parse(body)).toMatchObject({ ok: true })
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()
  })

  it('accepts daemons over WSS', async () => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws/daemon`, { ca })
    await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))
    ws.close()
  })
})
