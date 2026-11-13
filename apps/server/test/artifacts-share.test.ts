import { mkdtempSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactShareDto, ArtifactSubmitRes, SkillFile } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, plugins, pluginVersions, previewShares } from '../src/db/schema.js'
import { BUILTIN_PLUGINS, syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
})
afterEach(() => t.close())

const KIT = join(BUILTIN_PLUGINS, 'web-prototype/skills/web-prototype/kit')
const DAY = 86400_000

type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string }
function get(host: string, path: string, headers: Record<string, string> = {}, body?: object) {
  const port = Number(new URL(t.url('/')).port)
  return new Promise<Res>((resolve, reject) => {
    const method = body ? 'POST' : 'GET'
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host, ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
}
const cookieOf = (r: Res) => (r.headers['set-cookie'] as string[])[0]!.split(';')[0]!

async function setup() {
  const w = await artifactWorld(t)
  await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
  const [p] = await t.db.select().from(plugins).where(eq(plugins.name, 'web-prototype'))
  const a = await w.artifact({ pluginId: p!.id, pluginVersionId: p!.versionId })
  const firstRun = await w.run([a.id])
  const files = { ...L1, 'index.html': '<p>an old copy of the shell</p>', 'assets/a.png': 'png-bytes' }
  const v1 = (await w.submit(firstRun.id, a.id, files)).json() as ArtifactSubmitRes
  const li = await t.seed.cookie(w.li.id)
  const wang = await t.seed.cookie(w.wang.id)
  const req = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  return { ...w, a, firstRun, v1, files, liCookie: li, wangCookie: wang, req }
}

describe('artifact export', () => {
  it("zips a version's files with the plugin's shell and a README, under the artifact's folder", async () => {
    const s = await setup()
    const v2 = (
      await s.submit(
        s.firstRun.id,
        s.a.id,
        { ...s.files, 'screens/home.html': '<img src="../assets/a.png"><p>v2</p>', 'assets/old.png': 'old' },
        { parent: s.v1.versionId },
      )
    ).json() as ArtifactSubmitRes
    const slug = s.a.dir.slice('design/'.length)
    const res = await s.req('GET', `/api/artifacts/${s.a.id}/export.zip`, s.liCookie)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${slug}-v2.zip"`)
    const zip = unzipSync(new Uint8Array(res.rawPayload))
    const text = (p: string) => strFromU8(zip[`${slug}/${p}`] ?? new Uint8Array())
    expect(Object.keys(zip).sort()).toEqual(
      [
        'README.txt',
        '_gg/gg-kit.css',
        '_gg/gg-kit.js',
        'assets/a.png',
        'gg-artifact.json',
        'index.html',
        'screens/done.html',
        'screens/home.html',
        'tokens.css',
      ].map((p) => `${slug}/${p}`),
    )
    expect(text('screens/home.html')).toBe('<img src="../assets/a.png"><p>v2</p>')
    expect(text('screens/done.html')).toBe(L1['screens/done.html'])
    expect(text('assets/a.png')).toBe('png-bytes')
    // The manifest inline ahead of the shell's script: a double-click (file://) opens it without fetching.
    const shell = readFileSync(join(KIT, 'index.html'), 'utf8')
    const inline = `<script type="application/json" id="gg-manifest">${L1['gg-artifact.json']}</script>\n`
    const at = shell.indexOf('<script')
    expect(text('index.html')).toBe(shell.slice(0, at) + inline + shell.slice(at))
    expect(text('_gg/gg-kit.js')).toBe(readFileSync(join(KIT, 'gg-kit.js'), 'utf8'))
    expect(text('README.txt')).toContain('双击 index.html')

    const old = await s.req(
      'GET',
      `/api/artifacts/${s.a.id}/export.zip?version=${s.v1.versionId}`,
      s.liCookie,
    )
    expect(old.headers['content-disposition']).toBe(`attachment; filename="${slug}-v1.zip"`)
    expect(strFromU8(unzipSync(new Uint8Array(old.rawPayload))[`${slug}/screens/home.html`]!)).toBe(
      L1['screens/home.html'],
    )
    expect(v2.n).toBe(2)
  })

  it('zips a single-page artifact as it is, for members only', async () => {
    const s = await setup()
    const l0 = await s.artifact()
    const run = await s.run([l0.id])
    await s.submit(run.id, l0.id, { 'index.html': '<h1>single page</h1>' })
    const res = await s.req('GET', `/api/artifacts/${l0.id}/export.zip`, s.liCookie)
    const slug = l0.dir.slice('design/'.length)
    const zip = unzipSync(new Uint8Array(res.rawPayload))
    expect(Object.keys(zip).sort()).toEqual([`${slug}/README.txt`, `${slug}/index.html`])
    expect(strFromU8(zip[`${slug}/index.html`]!)).toBe('<h1>single page</h1>')

    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await s.req('GET', `/api/artifacts/${s.a.id}/export.zip`, outsider)).statusCode).toBe(404)
    expect(
      (await s.req('GET', `/api/artifacts/${s.a.id}/export.zip?version=nope`, s.liCookie)).statusCode,
    ).toBe(404)
    const empty = await s.artifact()
    expect((await s.req('GET', `/api/artifacts/${empty.id}/export.zip`, s.liCookie)).statusCode).toBe(404)
  })

  it('downloads with the session cookie alone, whatever team the client has picked', async () => {
    const s = await setup()
    const url = `/api/artifacts/${s.a.id}/export.zip`
    // A plain link click: the browser sends the cookie and no X-GG-Team.
    const plain = await t.app.inject({
      method: 'GET',
      url,
      headers: { cookie: s.liCookie, accept: 'text/html', 'sec-fetch-mode': 'navigate' },
    })
    expect(plain.statusCode).toBe(200)
    expect(plain.headers['content-type']).toBe('application/zip')
    const other = await t.seed.team({ ownerId: s.li.id, name: '另一个团队' })
    const elsewhere = await t.app.inject({
      method: 'GET',
      url,
      headers: { cookie: s.liCookie, 'x-gg-team': other.id },
    })
    expect(elsewhere.statusCode).toBe(200)
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401)
  })
})

describe('artifact sharing', () => {
  it("turns a public link to the head on and off; the bot's managers switch it, members read it", async () => {
    const s = await setup()
    const url = `/api/artifacts/${s.a.id}/share`
    const off: ArtifactShareDto = {
      enabled: false,
      url: null,
      expiresAt: null,
      version: null,
      latest: null,
      password: null,
    }
    expect((await s.req('GET', url, s.liCookie)).json()).toEqual(off)
    expect((await s.req('POST', url, s.liCookie, { enabled: true })).statusCode).toBe(403)

    const on = await s.req('POST', url, s.wangCookie, { enabled: true })
    expect(on.statusCode).toBe(200)
    const share = on.json() as ArtifactShareDto
    expect(share.enabled).toBe(true)
    expect(share.password).toBeNull()
    expect(share.url).toMatch(/^http:\/\/[a-z0-9]+\.preview\.test(:\d+)?\/__gg\/share\/ps_/)
    expect(new Date(share.expiresAt!).getTime() - t.ctx.now().getTime()).toBeGreaterThan(7 * DAY - 60_000)
    // Reused: one link per artifact, readable by every member.
    expect((await s.req('POST', url, s.wangCookie, { enabled: true })).json()).toEqual(share)
    expect((await s.req('GET', url, s.liCookie)).json()).toEqual(share)
    expect(await t.db.select().from(previewShares)).toHaveLength(1)
    // The link's secret is stored sealed, never as written.
    const [row] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    const token = share.url!.split('/__gg/share/')[1]!
    expect(row!.shareToken).toMatch(/^v1:/)
    expect(row!.shareToken).not.toContain(token)

    // Visitors see the head's stored source, with no element ids and no bridge.
    const link = new URL(share.url!)
    const visit = await get(link.host, link.pathname)
    // No fragment in Location: browsers carry the link's own (`#play:<screen>`) over the redirect (RFC 9110 §10.2.2).
    expect(visit.status).toBe(302)
    expect(visit.headers.location).toBe('/')
    const cookie = (visit.headers['set-cookie'] as string[])[0]!.split(';')[0]!
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe(L1['screens/home.html'])
    expect((await get(link.host, '/__gg/bridge.js', { cookie })).status).toBe(404)
    await s.submit(
      s.firstRun.id,
      s.a.id,
      { ...s.files, 'screens/home.html': '<p>v2</p>' },
      { parent: s.v1.versionId },
    )
    // Pinned to the version it was shared at.
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe(L1['screens/home.html'])

    expect((await s.req('POST', url, s.liCookie, { enabled: false })).statusCode).toBe(403)
    expect((await s.req('POST', url, s.wangCookie, { enabled: false })).json()).toEqual(off)
    expect((await s.req('GET', url, s.liCookie)).json()).toEqual(off)
    expect((await get(link.host, '/screens/home.html', { cookie })).status).not.toBe(200)

    const again = (await s.req('POST', url, s.wangCookie, { enabled: true })).json() as ArtifactShareDto
    expect(again.enabled).toBe(true)
    expect(again.url).not.toBe(share.url)
  })

  it('pins the link to the version it was shared at, follows the latest on request and re-pins in place', async () => {
    const s = await setup()
    const url = `/api/artifacts/${s.a.id}/share`
    const share = (await s.req('POST', url, s.wangCookie, { enabled: true })).json() as ArtifactShareDto
    expect(share).toMatchObject({ enabled: true, version: 1, latest: 1 })
    const link = new URL(share.url!)
    const cookie = ((await get(link.host, link.pathname)).headers['set-cookie'] as string[])[0]!.split(
      ';',
    )[0]!
    const v2 = (
      await s.submit(
        s.firstRun.id,
        s.a.id,
        { ...s.files, 'screens/home.html': '<p>v2</p>' },
        { parent: s.v1.versionId },
      )
    ).json() as ArtifactSubmitRes
    // A newer version does not reach the visitor of a pinned link.
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe(L1['screens/home.html'])
    expect((await s.req('GET', url, s.liCookie)).json()).toMatchObject({ version: 1, latest: 2 })
    // The shell learns the version it shows.
    const shell = await get(link.host, '/', { cookie })
    expect(shell.text).toContain('<script type="application/json" id="gg-meta">{"version":1}</script>')

    // Re-pinning to the head and following the latest keep the same link.
    const repinned = (await s.req('POST', url, s.wangCookie, { enabled: true, follow: false })).json()
    expect(repinned).toMatchObject({ url: share.url, version: 2, latest: 2 })
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe('<p>v2</p>')
    const follow = (await s.req('POST', url, s.wangCookie, { enabled: true, follow: true })).json()
    expect(follow).toMatchObject({ url: share.url, version: null, latest: 2 })
    await s.submit(
      s.firstRun.id,
      s.a.id,
      { ...s.files, 'screens/home.html': '<p>v3</p>' },
      { parent: v2.versionId },
    )
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe('<p>v3</p>')
    expect((await get(link.host, '/', { cookie })).text).toContain('{"version":3}')
    // Plain "on" keeps whatever the link does.
    expect((await s.req('POST', url, s.wangCookie, { enabled: true })).json()).toMatchObject({
      version: null,
    })
    expect((await s.req('POST', url, s.liCookie, { enabled: true, follow: false })).statusCode).toBe(403)
  })

  it('serves the newest shell of the plugin, even to artifacts made with an older one', async () => {
    const s = await setup()
    const [p] = await t.db.select().from(plugins).where(eq(plugins.name, 'web-prototype'))
    const [old] = await t.db.select().from(pluginVersions).where(eq(pluginVersions.id, p!.versionId!))
    const files = (old!.files as SkillFile[]).map((f) =>
      f.path.endsWith('kit/index.html') ? { ...f, content: '<p>new shell</p>' } : f,
    )
    const [next] = await t.db
      .insert(pluginVersions)
      .values({ ...old!, id: undefined, revision: old!.revision + 1, files, digest: 'next' })
      .returning()
    await t.db
      .update(plugins)
      .set({ versionId: next!.id, listedVersionId: next!.id })
      .where(eq(plugins.id, p!.id))
    const share = (
      await s.req('POST', `/api/artifacts/${s.a.id}/share`, s.wangCookie, { enabled: true })
    ).json() as ArtifactShareDto
    const link = new URL(share.url!)
    const cookie = ((await get(link.host, link.pathname)).headers['set-cookie'] as string[])[0]!.split(
      ';',
    )[0]!
    expect((await get(link.host, '/', { cookie })).text).toContain('<p>new shell</p>')
  })

  it('reports an expired or revoked link as off, and keeps outsiders out', async () => {
    const s = await setup()
    const url = `/api/artifacts/${s.a.id}/share`
    await s.req('POST', url, s.wangCookie, { enabled: true })
    await t.db.update(previewShares).set({ expiresAt: new Date(t.ctx.now().getTime() - 1000) })
    expect(((await s.req('GET', url, s.liCookie)).json() as ArtifactShareDto).enabled).toBe(false)
    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await s.req('GET', url, outsider)).statusCode).toBe(404)
    expect((await s.req('POST', url, s.wangCookie, {})).statusCode).toBe(400)
  })

  it('locks the link with a 4-digit password that visitors enter on the link, with limited tries', async () => {
    const s = await setup()
    const url = `/api/artifacts/${s.a.id}/share`
    const share = (await s.req('POST', url, s.wangCookie, { enabled: true })).json() as ArtifactShareDto
    const link = new URL(share.url!)
    const openCookie = cookieOf(await get(link.host, link.pathname))
    expect((await s.req('POST', url, s.liCookie, { enabled: true, locked: true })).statusCode).toBe(403)

    const locked = (await s.req('POST', url, s.wangCookie, { enabled: true, locked: true })).json()
    expect(locked).toMatchObject({ url: share.url, password: expect.stringMatching(/^\d{4}$/) })
    const { password } = locked as ArtifactShareDto & { password: string }
    expect((await s.req('GET', url, s.liCookie)).json()).toMatchObject({ password })
    // Stored sealed.
    const [row] = await t.db.select().from(previewShares)
    expect(row!.password).toMatch(/^v1:/)
    // Visitors who came in before the lock are asked too.
    expect((await get(link.host, '/screens/home.html', { cookie: openCookie })).status).not.toBe(200)

    // The link itself asks for the password, letting no one in until it is right.
    const gate = await get(link.host, link.pathname, { accept: 'text/html' })
    expect(gate.status).toBe(200)
    expect(gate.headers['set-cookie']).toBeUndefined()
    expect(gate.text).toContain('请输入访问密码')
    const wrong = password === '0000' ? '1111' : '0000'
    const bad = await get(link.host, link.pathname, {}, { password: wrong })
    expect(bad.status).toBe(403)
    expect(bad.headers['set-cookie']).toBeUndefined()
    const ok = await get(link.host, link.pathname, {}, { password })
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.text)).toEqual({ location: '/' })
    const cookie = cookieOf(ok)
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe(L1['screens/home.html'])

    // A new password locks out those who knew the old one; dropping it opens the link again.
    const relocked = (await s.req('POST', url, s.wangCookie, { enabled: true, locked: true })).json()
    expect(relocked).toMatchObject({ url: share.url, password: expect.stringMatching(/^\d{4}$/) })
    expect((await get(link.host, '/screens/home.html', { cookie })).status).not.toBe(200)
    const opened = (await s.req('POST', url, s.wangCookie, { enabled: true, locked: false })).json()
    expect(opened).toMatchObject({ url: share.url, password: null })
    expect((await get(link.host, link.pathname)).status).toBe(302)

    // Five wrong tries lock the link for a while, even against the right password.
    const again = (await s.req('POST', url, s.wangCookie, { enabled: true, locked: true })).json()
    const right = (again as ArtifactShareDto).password!
    const miss = right === '0000' ? '1111' : '0000'
    for (let i = 0; i < 5; i++) await get(link.host, link.pathname, {}, { password: miss })
    expect((await get(link.host, link.pathname, {}, { password: right })).status).toBe(429)
  })
})
