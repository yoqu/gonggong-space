import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonRelease, PROTOCOL_VERSION } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs } from '../src/db/schema.js'
import { upgradeFor } from '../src/modules/releases/routes.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const sha = (c: string) => c.repeat(64)
const release: DaemonRelease = {
  version: '0.2.0',
  builds: {
    'macos-aarch64': { url: '/downloads/aiws-0.2.0-macos-aarch64', sha256: sha('a') },
    'linux-x86_64': { url: 'https://cdn.example.com/aiws-0.2.0-linux', sha256: sha('b') },
  },
}

describe('upgradeFor', () => {
  it('picks the build for the machine os/arch only when it is newer than the running daemon', () => {
    const mac = { os: 'macos', arch: 'aarch64' } as const
    expect(upgradeFor(release, mac, '0.1.0')).toEqual({
      version: '0.2.0',
      url: '/downloads/aiws-0.2.0-macos-aarch64',
      sha256: sha('a'),
    })
    expect(upgradeFor(release, { os: 'linux', arch: 'x86_64' }, '0.1.9')?.sha256).toBe(sha('b'))
    expect(upgradeFor(release, mac, '0.2.0')).toBeNull()
    expect(upgradeFor(release, mac, '0.3.0')).toBeNull()
    expect(upgradeFor(release, { os: 'windows', arch: 'x86_64' }, '0.1.0')).toBeNull()
    expect(upgradeFor(null, mac, '0.1.0')).toBeNull()
  })
})

describe('daemon release publishing', () => {
  const put = (cookie: string, payload: unknown) =>
    t.app.inject({
      method: 'PUT',
      url: '/api/admin/daemon-release',
      headers: { cookie },
      payload: payload as object,
    })

  it('is sysadmin-only, validated and audited', async () => {
    const admin = await t.seed.user({ role: 'sysadmin', name: '管理员' })
    const member = await t.seed.user()
    expect((await put(await t.seed.cookie(member.id), release)).statusCode).toBe(403)
    const cookie = await t.seed.cookie(admin.id)
    expect((await put(cookie, { ...release, version: 'latest' })).statusCode).toBe(400)
    const res = await put(cookie, release)
    expect(res.statusCode).toBe(200)
    const got = await t.app.inject({ url: '/api/admin/daemon-release', headers: { cookie } })
    expect(got.json()).toEqual(release)
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'daemon.release'))
    expect(log).toMatchObject({
      category: 'admin',
      actorUserId: admin.id,
      detail: { version: '0.2.0', platforms: ['macos-aarch64', 'linux-x86_64'] },
    })
  })

  it('offers the build in welcome and in protocol rejects', async () => {
    const admin = await t.seed.user({ role: 'sysadmin' })
    await put(await t.seed.cookie(admin.id), release)
    const { token } = await t.seed.machine(admin.id)
    const hello = (protocol: number, daemonVersion: string) => ({
      t: 'hello',
      protocol,
      token,
      daemonVersion,
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
    })
    const connect = async (msg: unknown) => {
      const ws = t.ws('/ws/daemon')
      const box = inbox(ws)
      await box.opened
      ws.send(JSON.stringify(msg))
      const reply = await box.next()
      ws.close()
      return reply
    }
    const upgrade = { version: '0.2.0', url: '/downloads/aiws-0.2.0-macos-aarch64', sha256: sha('a') }
    expect(await connect(hello(PROTOCOL_VERSION, '0.1.0'))).toMatchObject({ t: 'welcome', upgrade })
    expect(await connect(hello(PROTOCOL_VERSION, '0.2.0'))).toMatchObject({ t: 'welcome', upgrade: null })
    expect(await connect(hello(PROTOCOL_VERSION - 1, '0.0.1'))).toMatchObject({
      t: 'reject',
      reason: 'protocol',
      upgrade,
    })
  })

  it('serves published builds from AIWS_DATA_DIR/downloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiws-data-'))
    mkdirSync(join(dir, 'downloads'))
    writeFileSync(join(dir, 'downloads', 'aiws-0.2.0-macos-aarch64'), 'binary')
    const prev = process.env.AIWS_DATA_DIR
    process.env.AIWS_DATA_DIR = dir
    try {
      const ok = await t.app.inject('/downloads/aiws-0.2.0-macos-aarch64')
      expect(ok.statusCode).toBe(200)
      expect(ok.body).toBe('binary')
      expect((await t.app.inject('/downloads/missing')).statusCode).toBe(404)
      expect((await t.app.inject('/downloads/..%2Fsecret')).statusCode).toBe(404)
    } finally {
      process.env.AIWS_DATA_DIR = prev
    }
  })
})
