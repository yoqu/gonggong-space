import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonRelease, PROTOCOL_VERSION } from '@gonggong/protocol'
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
    'macos-aarch64': { url: '/downloads/gonggong-0.2.0-macos-aarch64', sha256: sha('a') },
    'linux-x86_64': { url: 'https://cdn.example.com/gonggong-0.2.0-linux', sha256: sha('b') },
  },
}

describe('upgradeFor', () => {
  it('picks the build for the machine os/arch only when it is newer than the running daemon', () => {
    const mac = { os: 'macos', arch: 'aarch64' } as const
    expect(upgradeFor(release, mac, '0.1.0')).toEqual({
      version: '0.2.0',
      url: '/downloads/gonggong-0.2.0-macos-aarch64',
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
    const audit = await t.app.inject({ url: '/api/admin/audit?category=admin', headers: { cookie } })
    expect(audit.json()[0].summary).toBe('发布 daemon 0.2.0（macos-aarch64、linux-x86_64）')
  })

  it('offers the build in welcome and in protocol rejects', async () => {
    const admin = await t.seed.user({ role: 'sysadmin' })
    await put(await t.seed.cookie(admin.id), release)
    const { token } = await t.seed.machine(admin.id)
    const hello = (protocol: number, daemonVersion: string, os = 'macos') => ({
      t: 'hello',
      protocol,
      token,
      daemonVersion,
      machine: { name: 'mbp', os, arch: 'aarch64' },
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
    const upgrade = { version: '0.2.0', url: '/downloads/gonggong-0.2.0-macos-aarch64', sha256: sha('a') }
    expect(await connect(hello(PROTOCOL_VERSION, '0.1.0'))).toMatchObject({
      t: 'welcome',
      upgrade,
      release: true,
    })
    expect(await connect(hello(PROTOCOL_VERSION, '0.2.0'))).toMatchObject({
      t: 'welcome',
      upgrade: null,
      release: true,
    })
    // No build for this platform: the daemon looks for updates elsewhere (GitHub Releases).
    expect(await connect(hello(PROTOCOL_VERSION, '0.1.0', 'windows'))).toMatchObject({
      t: 'welcome',
      upgrade: null,
      release: false,
    })
    expect(await connect(hello(PROTOCOL_VERSION - 1, '0.0.1'))).toMatchObject({
      t: 'reject',
      reason: 'protocol',
      upgrade,
    })
  })

  it('serves published builds from GONGGONG_DATA_DIR/downloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
    mkdirSync(join(dir, 'downloads'))
    writeFileSync(join(dir, 'downloads', 'gonggong-0.2.0-macos-aarch64'), 'binary')
    const prev = process.env.GONGGONG_DATA_DIR
    process.env.GONGGONG_DATA_DIR = dir
    try {
      const ok = await t.app.inject('/downloads/gonggong-0.2.0-macos-aarch64')
      expect(ok.statusCode).toBe(200)
      expect(ok.body).toBe('binary')
      expect((await t.app.inject('/downloads/missing')).statusCode).toBe(404)
      expect((await t.app.inject('/downloads/..%2Fsecret')).statusCode).toBe(404)
    } finally {
      process.env.GONGGONG_DATA_DIR = prev
    }
  })
})

describe('daemon release files (管理后台 · 客户端发布)', () => {
  let dir: string
  let prev: string | undefined
  beforeEach(() => {
    prev = process.env.GONGGONG_DATA_DIR
    dir = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
    process.env.GONGGONG_DATA_DIR = dir
  })
  afterEach(() => {
    process.env.GONGGONG_DATA_DIR = prev
  })

  const digest = (data: string) => createHash('sha256').update(data).digest('hex')
  async function upload(cookie: string, name: string, data: string) {
    const form = new FormData()
    form.set('file', new Blob([data]), name)
    const res = await fetch(t.url('/api/admin/daemon-release/files'), {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    return { status: res.status, body: (await res.json()) as DaemonRelease & { message?: string } }
  }
  const admin = async () => t.seed.cookie((await t.seed.user({ role: 'sysadmin' })).id)
  const downloaded = (file: string) => join(dir, 'downloads', file)

  it('stores an artifact, hashes it and adds it to the release named by the file', async () => {
    const cookie = await admin()
    const member = await t.seed.cookie((await t.seed.user()).id)
    expect((await upload(member, 'gonggong-0.2.0-macos-aarch64', 'x')).status).toBe(403)

    const first = await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'daemon')
    expect(first.status).toBe(200)
    const cast = await upload(cookie, 'gg-cast-0.2.0-macos-aarch64', 'cast')
    expect(cast.body).toEqual({
      version: '0.2.0',
      builds: {
        'macos-aarch64': { url: '/downloads/gonggong-0.2.0-macos-aarch64', sha256: digest('daemon') },
      },
      cast: { 'macos-aarch64': { url: '/downloads/gg-cast-0.2.0-macos-aarch64', sha256: digest('cast') } },
    })
    expect(readFileSync(downloaded('gg-cast-0.2.0-macos-aarch64'), 'utf8')).toBe('cast')
    expect((await t.app.inject('/downloads/gg-cast-0.2.0-macos-aarch64')).body).toBe('cast')

    const { token } = await t.seed.machine((await t.seed.user()).id, { os: 'macos', arch: 'aarch64' })
    const build = await t.app.inject({
      url: '/api/daemon/cast-build',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(build.json()).toEqual({
      version: '0.2.0',
      url: '/downloads/gg-cast-0.2.0-macos-aarch64',
      sha256: digest('cast'),
    })

    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'daemon.release.upload'))
    expect(log?.detail).toMatchObject({ kind: 'builds', version: '0.2.0', platform: 'macos-aarch64' })
    const audit = await t.app.inject({ url: '/api/admin/audit?category=admin', headers: { cookie } })
    expect(audit.json()[0].summary).toBe('上传 gg-cast 0.2.0（macos-aarch64）')
  })

  it('replaces the whole release on a newer version and refuses older versions and unknown names', async () => {
    const cookie = await admin()
    await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'old')
    await upload(cookie, 'gg-cast-0.2.0-linux-x86_64', 'old-cast')
    const next = await upload(cookie, 'gonggong-0.3.0-linux-x86_64', 'new')
    expect(next.body).toEqual({
      version: '0.3.0',
      builds: { 'linux-x86_64': { url: '/downloads/gonggong-0.3.0-linux-x86_64', sha256: digest('new') } },
      cast: {},
    })
    expect(existsSync(downloaded('gonggong-0.2.0-macos-aarch64'))).toBe(false)
    expect(existsSync(downloaded('gg-cast-0.2.0-linux-x86_64'))).toBe(false)

    const older = await upload(cookie, 'gg-cast-0.2.0-linux-x86_64', 'x')
    expect(older.status).toBe(400)
    expect(older.body.message).toContain('0.3.0')
    expect((await upload(cookie, 'gonggong.exe', 'x')).status).toBe(400)
    expect(existsSync(downloaded('gonggong.exe'))).toBe(false)
  })

  it('removes one platform build and its file', async () => {
    const cookie = await admin()
    await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'a')
    await upload(cookie, 'gg-cast-0.2.0-macos-aarch64', 'b')
    const del = (path: string) => t.app.inject({ method: 'DELETE', url: path, headers: { cookie } })
    const res = await del('/api/admin/daemon-release/cast/macos-aarch64')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ version: '0.2.0', cast: {} })
    expect(Object.keys(res.json().builds)).toEqual(['macos-aarch64'])
    expect(existsSync(downloaded('gg-cast-0.2.0-macos-aarch64'))).toBe(false)
    expect((await del('/api/admin/daemon-release/cast/macos-aarch64')).statusCode).toBe(404)
    expect((await del('/api/admin/daemon-release/docs/macos-aarch64')).statusCode).toBe(400)
    const audit = await t.app.inject({ url: '/api/admin/audit?category=admin', headers: { cookie } })
    expect(audit.json()[0].summary).toBe('移除 gg-cast 0.2.0（macos-aarch64）')
  })
})
