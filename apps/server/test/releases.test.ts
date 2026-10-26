import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonRelease, PROTOCOL_VERSION } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, messages, runs } from '../src/db/schema.js'
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
  releaseNotes: '## 0.2.0\n\n- 修复更新提示',
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
      releaseNotes: release.releaseNotes,
    })
    expect(upgradeFor(release, { os: 'linux', arch: 'x86_64' }, '0.1.9')?.sha256).toBe(sha('b'))
    expect(upgradeFor(release, mac, '0.2.0')).toBeNull()
    expect(upgradeFor(release, mac, '0.3.0')).toBeNull()
    expect(upgradeFor(release, { os: 'windows', arch: 'x86_64' }, '0.1.0')).toBeNull()
    expect(upgradeFor(null, mac, '0.1.0')).toBeNull()
    expect(upgradeFor({ ...release, releaseNotes: undefined }, mac, '0.1.0')).not.toHaveProperty(
      'releaseNotes',
    )
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
  async function upload(cookie: string, name: string, data: string, notes?: string) {
    const form = new FormData()
    form.set('file', new Blob([data]), name)
    if (notes !== undefined) form.set('releaseNotes', notes)
    const res = await fetch(t.url('/api/admin/daemon-release/files'), {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    return {
      status: res.status,
      body: (await res.json()) as DaemonRelease & { message?: string; warning?: string },
    }
  }
  const admin = async () => t.seed.cookie((await t.seed.user({ role: 'sysadmin' })).id)
  const downloaded = (file: string) => join(dir, 'downloads', file)

  it('stores an artifact, hashes it and adds it to the release named by the file', async () => {
    const cookie = await admin()
    const member = await t.seed.cookie((await t.seed.user()).id)
    expect((await upload(member, 'gonggong-0.2.0-macos-aarch64', 'x')).status).toBe(403)

    const first = await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'daemon')
    expect(first.body.releaseNotes).toBeUndefined()
    expect(first.status).toBe(200)
    const cast = await upload(cookie, 'gg-cast-0.2.0-macos-aarch64', 'cast')
    expect(cast.body).toMatchObject({
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

  it('merges concurrent same-version uploads without losing platforms or notes', async () => {
    const cookie = await admin()
    await upload(cookie, 'Gonggong_0.2.0_aarch64.app.tar.gz', 'app')
    await upload(cookie, 'RELEASE_NOTES.md', '## 0.2.0\n\n- 并发上传保留说明')
    const artifacts: [string, string][] = [
      ['macos-aarch64', 'mac'],
      ['macos-x86_64', 'intel'],
      ['linux-x86_64', 'linux64'],
      ['linux-aarch64', 'linuxarm'],
      ['windows-x86_64.exe', 'windows'],
    ]
    const done = await Promise.all(
      artifacts.map(([platform, data]) => upload(cookie, `gonggong-0.2.0-${platform}`, data)),
    )
    expect(done.every((res) => res.status === 200)).toBe(true)

    const got = await t.app.inject({ url: '/api/admin/daemon-release', headers: { cookie } })
    expect(got.json().releaseNotes).toBe('## 0.2.0\n\n- 并发上传保留说明')
    expect(got.json().update['macos-aarch64']).toEqual({
      url: '/downloads/Gonggong_0.2.0_aarch64.app.tar.gz',
      sha256: digest('app'),
    })
    expect(Object.keys(got.json().builds)).toHaveLength(5)
    for (const [platform, data] of [
      ['macos-aarch64', 'mac'],
      ['macos-x86_64', 'intel'],
      ['linux-x86_64', 'linux64'],
      ['linux-aarch64', 'linuxarm'],
      ['windows-x86_64', 'windows'],
    ] as [string, string][]) {
      expect(got.json().builds[platform]).toEqual({
        url: `/downloads/gonggong-0.2.0-${platform}${platform.startsWith('windows') ? '.exe' : ''}`,
        sha256: digest(data),
      })
    }
  })

  it('serializes edited notes with concurrent artifacts', async () => {
    const cookie = await admin()
    await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'daemon')
    await upload(cookie, 'RELEASE_NOTES.md', '## 0.2.0\n\n- 首批上传')
    await Promise.all([
      upload(cookie, 'gonggong-0.2.0-linux-x86_64', 'linux'),
      upload(cookie, 'RELEASE_NOTES.md', '## 0.2.0\n\n- 最后编辑'),
    ])
    const got = await t.app.inject({ url: '/api/admin/daemon-release', headers: { cookie } })
    expect(got.json().releaseNotes).toBe('## 0.2.0\n\n- 最后编辑')
    expect(Object.keys(got.json().builds).sort()).toEqual(['linux-x86_64', 'macos-aarch64'])
  })

  it('rejects an older upload that finishes after a newer version without leaving its file', async () => {
    const cookie = await admin()
    const boundary = 'gonggong-release-race'
    const req = request(t.url('/api/admin/daemon-release/files'), {
      method: 'POST',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    })
    const response = new Promise<{ status: number; body: DaemonRelease & { message?: string } }>(
      (resolve, reject) => {
        req.on('response', (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => (body += chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 500, body: JSON.parse(body) }))
        })
        req.on('error', reject)
      },
    )
    req.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="gonggong-0.2.0-macos-aarch64"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\nold',
    )
    try {
      await expect
        .poll(() => readdirSync(join(dir, 'downloads')).some((name) => name.startsWith('.upload-')))
        .toBe(true)
      expect((await upload(cookie, 'gonggong-0.3.0-linux-x86_64', 'new')).status).toBe(200)
    } finally {
      req.end(`\r\n--${boundary}--\r\n`)
    }

    const older = await response
    expect(older.status).toBe(400)
    expect(older.body.message).toContain('0.3.0')
    const got = await t.app.inject({ url: '/api/admin/daemon-release', headers: { cookie } })
    expect(got.json().version).toBe('0.3.0')
    expect(got.json().builds['linux-x86_64'].sha256).toBe(digest('new'))
    expect(readFileSync(downloaded('gonggong-0.3.0-linux-x86_64'), 'utf8')).toBe('new')
    expect(existsSync(downloaded('gonggong-0.2.0-macos-aarch64'))).toBe(false)
  })

  it('replaces the whole release on a newer version and refuses older versions and unknown names', async () => {
    const cookie = await admin()
    await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'old')
    await upload(cookie, 'gg-cast-0.2.0-linux-x86_64', 'old-cast')
    const next = await upload(cookie, 'gonggong-0.3.0-linux-x86_64', 'new')
    expect(next.body).toMatchObject({
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

  it('uploads RELEASE_NOTES.md, keeps it with the version, and lets it be edited later', async () => {
    const cookie = await admin()
    const notes = '## 0.2.0\n\n- 更新说明会上传到客户端'
    const initial = await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'daemon')
    expect(initial.status).toBe(200)
    expect(initial.body.warning).toContain('RELEASE_NOTES.md')
    expect((await upload(cookie, 'RELEASE_NOTES.md', notes)).body.releaseNotes).toBe(notes)
    expect((await upload(cookie, 'gg-cast-0.2.0-macos-aarch64', 'cast')).body.releaseNotes).toBe(notes)

    const next = await upload(cookie, 'RELEASE_NOTES.md', notes + '\n- 发布后还能修改')
    expect(next.status).toBe(200)
    expect(next.body.releaseNotes).toBe(notes + '\n- 发布后还能修改')
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/daemon-release/notes',
      headers: { cookie },
      payload: { releaseNotes: '  直接在线编辑  ' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().releaseNotes).toBe('直接在线编辑')
    const read = await t.app.inject({ url: '/api/admin/daemon-release', headers: { cookie } })
    expect(read.json().releaseNotes).toBe('直接在线编辑')
  })

  it('warns without blocking a release that has no notes', async () => {
    const cookie = await admin()
    const res = await upload(cookie, 'gonggong-0.2.0-macos-aarch64', 'daemon')
    expect(res.status).toBe(200)
    expect(res.body.warning).toContain('RELEASE_NOTES.md')
  })

  it('offers desktop installers and daemon builds to signed-in members', async () => {
    const cookie = await admin()
    expect((await t.app.inject('/api/client-downloads')).statusCode).toBe(401)
    const member = await t.seed.cookie((await t.seed.user()).id)
    const list = async () =>
      (await t.app.inject({ url: '/api/client-downloads', headers: { cookie: member } })).json()
    expect(await list()).toBeNull()
    await upload(cookie, 'Gonggong_0.2.0_aarch64.dmg', 'dmg')
    await upload(cookie, 'gonggong-0.2.0-linux-x86_64', 'cli')
    await upload(cookie, 'gg-cast-0.2.0-macos-aarch64', 'cast')
    expect(await list()).toEqual({
      version: '0.2.0',
      builds: { 'linux-x86_64': { url: '/downloads/gonggong-0.2.0-linux-x86_64', sha256: digest('cli') } },
      desktop: { 'macos-aarch64': { url: '/downloads/Gonggong_0.2.0_aarch64.dmg', sha256: digest('dmg') } },
    })
    const dmg = await t.app.inject('/downloads/Gonggong_0.2.0_aarch64.dmg')
    expect(dmg.headers['content-disposition']).toBe('attachment; filename="Gonggong_0.2.0_aarch64.dmg"')

    await upload(cookie, 'gonggong-0.3.0-linux-x86_64', 'new')
    expect(existsSync(downloaded('Gonggong_0.2.0_aarch64.dmg'))).toBe(false)
    const audit = await t.app.inject({ url: '/api/admin/audit?category=admin', headers: { cookie } })
    expect(audit.json().at(-1).summary).toBe('上传 桌面端 0.2.0（macos-aarch64）')
  })

  it('serves the desktop app update feed (Tauri updater) from hosted packages and signatures', async () => {
    const cookie = await admin()
    const feed = (path: string, headers: Record<string, string> = {}) =>
      t.app.inject({ url: `/api/desktop-update/${path}`, headers: { host: 'gg.example.com', ...headers } })
    expect((await feed('darwin/aarch64/0.3.1')).statusCode).toBe(404)

    expect((await upload(cookie, 'Gonggong_0.3.2_aarch64.app.tar.gz', 'app')).status).toBe(200)
    await upload(cookie, 'RELEASE_NOTES.md', '## 0.3.2\n\n- 桌面更新说明')
    // Without its signature the package cannot be verified: still none, so the app falls back to GitHub.
    expect((await feed('darwin/aarch64/0.3.1')).statusCode).toBe(404)
    await upload(cookie, 'Gonggong_0.3.2_aarch64.app.tar.gz.sig', 'c2ln\n')
    const mac = await feed('darwin/aarch64/0.3.1', { 'x-forwarded-proto': 'https' })
    expect(mac.statusCode).toBe(200)
    expect(mac.json()).toEqual({
      version: '0.3.2',
      url: 'https://gg.example.com/downloads/Gonggong_0.3.2_aarch64.app.tar.gz',
      signature: 'c2ln',
      notes: '## 0.3.2\n\n- 桌面更新说明',
    })
    expect((await feed('darwin/aarch64/0.3.2')).statusCode).toBe(204)
    expect((await feed('darwin/x86_64/0.3.1')).statusCode).toBe(404)

    // Windows: the NSIS installer is the update package.
    await upload(cookie, 'Gonggong_0.3.2_x64-setup.exe', 'exe')
    await upload(cookie, 'Gonggong_0.3.2_x64-setup.exe.sig', 'd2lu')
    expect((await feed('windows/x86_64/0.3.0')).json()).toMatchObject({
      url: 'http://gg.example.com/downloads/Gonggong_0.3.2_x64-setup.exe',
      signature: 'd2lu',
    })

    await upload(cookie, 'gonggong-0.4.0-linux-x86_64', 'new')
    expect(existsSync(downloaded('Gonggong_0.3.2_aarch64.app.tar.gz.sig'))).toBe(false)
    expect((await feed('darwin/aarch64/0.3.1')).statusCode).toBe(404)
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

  it('takes a file from the machine of a live run a sysadmin started (gonggong MCP client_release_publish)', async () => {
    const admin = await t.seed.user({ role: 'sysadmin', name: '管理员' })
    const member = await t.seed.user()
    const { machine, token } = await t.seed.machine(member.id)
    const { token: other } = await t.seed.machine(member.id)
    const bot = await t.seed.bot({ ownerId: member.id, machineId: machine.id })
    const group = await t.seed.group({ createdBy: admin.id, memberIds: [member.id], botIds: [bot.id] })
    const [msg] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: admin.id, body: '发布客户端' })
      .returning()
    const run = async (originUserId: string, status = 'running') =>
      (
        await t.db
          .insert(runs)
          .values({ groupId: group.id, botId: bot.id, triggerMessageId: msg!.id, originUserId, status })
          .returning()
      )[0]!
    const send = async (runId: string, bearer: string, name = 'gonggong-0.3.1-macos-aarch64') => {
      const form = new FormData()
      form.set('file', new Blob(['daemon']), name)
      const res = await fetch(t.url(`/api/daemon/runs/${runId}/release-files`), {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}` },
        body: form,
      })
      return { status: res.status, body: (await res.json()) as DaemonRelease & { message?: string } }
    }

    const mine = await run(admin.id)
    expect((await send(mine.id, other)).status).toBe(404)
    expect((await send((await run(member.id)).id, token)).status).toBe(403)
    expect((await send((await run(admin.id, 'completed')).id, token)).status).toBe(404)
    expect((await send(mine.id, token, 'notes.md')).status).toBe(400)
    const ok = await send(mine.id, token)
    expect(ok.status).toBe(200)
    expect(ok.body.builds['macos-aarch64']).toEqual({
      url: '/downloads/gonggong-0.3.1-macos-aarch64',
      sha256: digest('daemon'),
    })
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'daemon.release.upload'))
    expect(log?.actorUserId).toBe(admin.id)
  })

  it('updates release notes from a sysadmin live run (gonggong MCP client_release_notes)', async () => {
    const adminUser = await t.seed.user({ role: 'sysadmin', name: '管理员' })
    const member = await t.seed.user()
    const { machine, token } = await t.seed.machine(member.id)
    const { token: other } = await t.seed.machine(member.id)
    const bot = await t.seed.bot({ ownerId: member.id, machineId: machine.id })
    const group = await t.seed.group({ createdBy: adminUser.id, memberIds: [member.id], botIds: [bot.id] })
    const [msg] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: adminUser.id, body: '发布客户端' })
      .returning()
    const run = async (originUserId: string, status = 'running') =>
      (
        await t.db
          .insert(runs)
          .values({ groupId: group.id, botId: bot.id, triggerMessageId: msg!.id, originUserId, status })
          .returning()
      )[0]!
    const send = async (runId: string, bearer: string, payload: unknown) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${runId}/release-notes`,
        headers: { authorization: `Bearer ${bearer}` },
        payload: payload as object,
      })
      return { status: res.statusCode, body: res.json() }
    }

    const cookie = await admin()
    await upload(cookie, 'gonggong-0.3.1-macos-aarch64', 'daemon')
    const mine = await run(adminUser.id)
    const notes = { version: '0.3.1', releaseNotes: '## 0.3.1\n\n- 从 MCP 写入' }
    expect((await send(mine.id, other, notes)).status).toBe(404)
    expect((await send((await run(member.id)).id, token, notes)).status).toBe(403)
    expect((await send((await run(adminUser.id, 'completed')).id, token, notes)).status).toBe(404)
    expect((await send(mine.id, token, { ...notes, version: '0.3.0' })).body.message).toContain(
      '当前发布版本是 0.3.1',
    )
    expect((await send(mine.id, token, { ...notes, releaseNotes: '  ' })).status).toBe(400)
    const ok = await send(mine.id, token, notes)
    expect(ok.status).toBe(200)
    expect(ok.body.releaseNotes).toBe(notes.releaseNotes)
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'daemon.release.notes'))
    expect(log).toMatchObject({
      actorUserId: adminUser.id,
      detail: { version: '0.3.1', source: 'mcp' },
    })
  })
})
