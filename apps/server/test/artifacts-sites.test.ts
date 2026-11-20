import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactSubmitRes, PreviewHostRes, SiteOpenRes, WorkDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, artifactVersions, messages, previews, services } from '../src/db/schema.js'
import { runArtifacts } from '../src/modules/artifacts/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, fileList } from './support/artifacts.js'
import { sha } from './support/sync.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
})
afterEach(() => t.close())

const SITE = {
  'index.html':
    '<!doctype html><div id="app" style="color: #f00"></div><script src="/assets/app.js"></script>',
  'assets/app.js': 'console.log(1)',
  'docs/index.html': '<h1>docs</h1>',
}

async function world() {
  const w = await artifactWorld(t)
  const run = await w.run([])
  const open = (dir: string, token?: string, runId = run.id) =>
    t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${runId}/sites`,
      headers: w.auth(token),
      payload: { dir, title: '活动官网' },
    })
  /** Uploads the files over the machine routes and submits them as a hosted version. */
  const host = async (
    id: string,
    files: Record<string, string>,
    o: { token?: string; source?: string } = {},
  ) => {
    const missing = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/artifacts/${id}/blobs/missing`,
      headers: w.auth(o.token),
      payload: { hashes: Object.values(files).map(sha) },
    })
    if (missing.statusCode !== 200) return missing
    for (const content of Object.values(files))
      await t.app.inject({
        method: 'PUT',
        url: `/api/daemon/artifacts/${id}/blobs/${sha(content)}`,
        headers: { ...w.auth(o.token), 'content-type': 'application/octet-stream' },
        payload: Buffer.from(content),
      })
    return t.app.inject({
      method: 'POST',
      url: `/api/daemon/artifacts/${id}/versions`,
      headers: w.auth(o.token),
      payload: {
        parentVersionId: null,
        source: o.source ?? 'host',
        submitKey: randomUUID(),
        files: fileList(files),
      },
    })
  }
  return { ...w, run, open, host }
}

describe('hosted sites', () => {
  it('opens one site per bot dir with a card, and each upload becomes the head, unlinted', async () => {
    const w = await world()
    const res = await w.open('dist')
    expect(res.statusCode).toBe(200)
    const { artifactId } = res.json() as SiteOpenRes
    expect(((await w.open('dist')).json() as SiteOpenRes).artifactId).toBe(artifactId)
    expect(((await w.open('./dist/')).json() as SiteOpenRes).artifactId).toBe(artifactId)
    expect(((await w.open('web/dist')).json() as SiteOpenRes).artifactId).not.toBe(artifactId)

    const [a] = await t.db.select().from(artifacts).where(eq(artifacts.id, artifactId))
    expect(a).toMatchObject({ siteDir: 'dist', botId: w.bot.id, createdBy: w.wang.id, title: '活动官网' })
    const [card] = await t.db.select().from(messages).where(eq(messages.id, a!.messageId!))
    expect(card!.body).toBe('托管网页「活动官网」')

    const v1 = (await w.host(artifactId, SITE)).json() as ArtifactSubmitRes
    expect(v1).toMatchObject({ n: 1, head: true })
    const v2 = (
      await w.host(artifactId, { ...SITE, 'assets/app.js': 'console.log(2)' })
    ).json() as ArtifactSubmitRes
    expect(v2).toMatchObject({ n: 2, head: true })
    const [row] = await t.db.select().from(artifactVersions).where(eq(artifactVersions.id, v2.versionId))
    expect(row).toMatchObject({ source: 'host', parentVersionId: v1.versionId, issues: [] })

    // Shown in 作品.
    const cookie = await t.seed.cookie(w.li.id)
    const works = (await t.app.inject({ url: '/api/works', headers: { cookie } })).json() as WorkDto[]
    expect(works.map((x) => x.id)).toContain(artifactId)
  })

  it('takes uploads only from the machine of the bot, for sites, as host versions', async () => {
    const w = await world()
    const { artifactId } = (await w.open('dist')).json() as SiteOpenRes
    expect((await w.host(artifactId, SITE, { token: w.B.token })).statusCode).toBe(403)
    expect((await w.host(artifactId, SITE, { source: 'run' })).statusCode).toBe(400)
    const design = await w.artifact()
    expect((await w.host(design.id, SITE)).statusCode).toBe(404)
    expect((await w.open('dist', w.B.token)).statusCode).toBe(404)
  })

  it('never checks a site out into runs', async () => {
    const w = await world()
    const { artifactId } = (await w.open('dist')).json() as SiteOpenRes
    await w.host(artifactId, SITE)
    const design = await w.artifact()
    const picked = await t.db.transaction((tx) =>
      runArtifacts(tx, w.g.id, w.bot.id, { artifactRefs: [artifactId] }),
    )
    expect(JSON.stringify(picked)).not.toContain(artifactId)
    expect(JSON.stringify(picked)).toContain(design.id)
  })

  it("serves a site's routes from index.html, without the bridge", async () => {
    const w = await world()
    const { artifactId } = (await w.open('dist')).json() as SiteOpenRes
    await w.host(artifactId, SITE)
    const cookie = await t.seed.cookie(w.li.id)
    const body = (
      await t.app.inject({ method: 'POST', url: `/api/artifacts/${artifactId}/preview`, headers: { cookie } })
    ).json() as { url: string }
    const hop = await t.app.inject({ url: body.url, headers: { cookie } })
    const target = new URL(hop.headers.location as string)
    const get = (path: string, headers: Record<string, string> = {}) =>
      new Promise<{ status: number; type?: string; text: string; cookie?: string[] }>((resolve, reject) => {
        const port = Number(new URL(t.url('/')).port)
        const req = request(
          { host: '127.0.0.1', port, path, headers: { host: target.host, ...headers } },
          (res) => {
            let text = ''
            res.on('data', (d) => (text += d))
            res.on('end', () =>
              resolve({
                status: res.statusCode!,
                type: res.headers['content-type'],
                text,
                cookie: res.headers['set-cookie'],
              }),
            )
          },
        )
        req.on('error', reject)
        req.end()
      })
    const auth = await get(`${target.pathname}${target.search}`)
    const pv = { cookie: auth.cookie![0]!.split(';')[0]! }
    expect((await get('/', pv)).text).toBe(SITE['index.html'])
    const deep = await get('/events/42', pv)
    expect([deep.status, deep.type, deep.text]).toEqual([200, 'text/html; charset=utf-8', SITE['index.html']])
    expect((await get('/docs', pv)).text).toBe(SITE['docs/index.html'])
    expect((await get('/assets/missing.js', pv)).status).toBe(404)
  })
})

describe('托管到服务器 on a preview card', () => {
  async function preview(command: string) {
    const w = await world()
    const [svc] = await t.db
      .insert(services)
      .values({
        id: randomUUID(),
        machineId: w.A.machine.id,
        groupId: w.g.id,
        botId: w.bot.id,
        name: 'static-dist',
        command,
        cwd: 'dist',
        port: 4321,
        status: 'running',
      })
      .returning()
    const [p] = await t.db
      .insert(previews)
      .values({
        slug: randomUUID().slice(0, 12),
        kind: 'http',
        machineId: w.A.machine.id,
        groupId: w.g.id,
        botId: w.bot.id,
        serviceId: svc!.id,
        port: 4321,
        title: '活动官网',
      })
      .returning()
    const host = (userId: string) =>
      t.seed
        .cookie(userId)
        .then((cookie) =>
          t.app.inject({ method: 'POST', url: `/api/previews/${p!.id}/host`, headers: { cookie } }),
        )
    return { ...w, svc: svc!, p: p!, host }
  }

  it("has the machine upload a static preview's dir into the bot's site", async () => {
    const s = await preview('静态站点 dist')
    const asked: unknown[] = []
    t.ctx.hub.features = () => ['siteHost']
    t.ctx.hub.request = (async (_m: string, msg: { requestId: string }) => {
      asked.push(msg)
      return { t: 'site.host.result', requestId: msg.requestId, error: null }
    }) as typeof t.ctx.hub.request
    expect((await s.host(s.li.id)).statusCode).toBe(403)
    const res = await s.host(s.wang.id)
    expect(res.statusCode).toBe(200)
    const { artifactId } = res.json() as { artifactId: string }
    expect(asked).toEqual([expect.objectContaining({ t: 'site.host', serviceId: s.svc.id, artifactId })])
    const [a] = await t.db.select().from(artifacts).where(eq(artifacts.id, artifactId))
    expect(a).toMatchObject({ siteDir: 'dist', botId: s.bot.id, createdBy: s.wang.id })

    t.ctx.hub.request = (async (_m: string, msg: { requestId: string }) => ({
      t: 'site.host.result',
      requestId: msg.requestId,
      error: '目录里没有 index.html',
    })) as typeof t.ctx.hub.request
    const failed = await s.host(s.wang.id)
    expect([failed.statusCode, failed.json().message]).toEqual([400, '目录里没有 index.html'])
  })

  it('asks the bot to build and host a dynamic preview', async () => {
    const s = await preview('npm run dev')
    const res = await s.host(s.wang.id)
    expect(res.json() as PreviewHostRes).toEqual({ asked: true })
    const [m] = await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, s.g.id), eq(messages.authorUserId, s.wang.id)))
      .orderBy(messages.createdAt)
      .then((rows) => rows.slice(-1))
    expect(m!.body).toContain('preview_host')
    expect(m!.meta).toMatchObject({ mentions: [s.bot.id] })
  })
})
