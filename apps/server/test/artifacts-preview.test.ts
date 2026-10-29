import { mkdtempSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactSubmitRes, GroupPreviewsDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { plugins } from '../src/db/schema.js'
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

type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string }
function get(host: string, path: string, headers: Record<string, string> = {}, method = 'GET') {
  const port = Number(new URL(t.url('/')).port)
  return new Promise<Res>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host, ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function setup() {
  const w = await artifactWorld(t)
  await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
  const [p] = await t.db.select().from(plugins).where(eq(plugins.name, 'web-prototype'))
  const a = await w.artifact({ pluginId: p!.id, pluginVersionId: p!.versionId })
  const firstRun = await w.run([a.id])
  const files = { ...L1, 'index.html': '<p>an old copy of the shell</p>', 'assets/a.png': 'png-bytes' }
  const v1 = (await w.submit(firstRun.id, a.id, files)).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)

  /** Opens (or reuses) a preview and signs li in on its origin; `fetch` reads from it. */
  const open = async (versionId?: string, artifactId = a.id) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${artifactId}/preview`,
      headers: { cookie },
      payload: versionId ? { versionId } : {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { previewId: string; origin: string; url: string }
    const hop = await t.app.inject({ url: body.url, headers: { cookie } })
    const target = new URL(hop.headers.location as string)
    expect(target.origin).toBe(body.origin)
    const auth = await get(target.host, `${target.pathname}${target.search}`)
    const pv = (auth.headers['set-cookie'] as string[])[0]!.split(';')[0]!
    return {
      ...body,
      fetch: (path: string, method?: string) => get(target.host, path, { cookie: pv }, method),
    }
  }
  return { ...w, a, firstRun, v1, cookie, open }
}

describe('artifact previews', () => {
  it("serves the plugin's shell at / and /_gg/*, and the version's files from the server", async () => {
    const s = await setup()
    const p = await s.open()
    const shell = await p.fetch('/')
    expect(shell.status).toBe(200)
    expect(shell.text).toBe(readFileSync(join(KIT, 'index.html'), 'utf8'))
    expect(shell.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(shell.headers['x-content-type-options']).toBe('nosniff')
    const css = await p.fetch('/_gg/gg-kit.css')
    expect(css.text).toBe(readFileSync(join(KIT, 'gg-kit.css'), 'utf8'))
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8')
    expect((await p.fetch('/_gg/gg-kit.js')).headers['content-type']).toBe('text/javascript; charset=utf-8')

    const screen = await p.fetch('/screens/home.html')
    expect(screen.text).toBe(L1['screens/home.html'])
    expect(screen.headers['x-content-type-options']).toBe('nosniff')
    expect((await p.fetch('/tokens.css')).headers['content-type']).toBe('text/css; charset=utf-8')
    expect((await p.fetch('/gg-artifact.json')).headers['content-type']).toBe(
      'application/json; charset=utf-8',
    )
    const png = await p.fetch('/assets/a.png')
    expect([png.headers['content-type'], png.text]).toEqual(['image/png', 'png-bytes'])
    expect((await p.fetch('/nope.html')).status).toBe(404)
    expect((await p.fetch('/screens/home.html', 'POST')).status).toBe(405)
  })

  it('follows the head unless opened on a version, and reuses open previews', async () => {
    const s = await setup()
    const head = await s.open()
    expect((await s.open()).previewId).toBe(head.previewId)
    await s.submit(
      s.firstRun.id,
      s.a.id,
      { ...L1, 'screens/home.html': '<p>v2</p>' },
      { parent: s.v1.versionId },
    )
    expect((await head.fetch('/screens/home.html')).text).toBe('<p>v2</p>')

    const pinned = await s.open(s.v1.versionId)
    expect(pinned.previewId).not.toBe(head.previewId)
    expect((await pinned.fetch('/screens/home.html')).text).toBe(L1['screens/home.html'])
    expect((await s.open(s.v1.versionId)).previewId).toBe(pinned.previewId)

    // Not a card of the previews panel: the artifact tab opens it.
    const list = await t.app.inject({ url: `/api/groups/${s.g.id}/previews`, headers: { cookie: s.cookie } })
    expect((list.json() as GroupPreviewsDto).previews).toEqual([])
  })

  it('renders an artifact without a manifest from its own index.html', async () => {
    const s = await setup()
    const l0 = await s.artifact({ pluginVersionId: (await t.db.select().from(plugins))[0]!.versionId })
    const run = await s.run([l0.id])
    await s.submit(run.id, l0.id, { 'index.html': '<h1>single page</h1>' })
    const p = await s.open(undefined, l0.id)
    expect((await p.fetch('/')).text).toBe('<h1>single page</h1>')
  })

  it('lets only members open one, and has nothing to show before the first version', async () => {
    const s = await setup()
    const empty = await s.artifact()
    const outsider = await t.seed.cookie(s.outsider.id)
    const post = (id: string, cookie: string) =>
      t.app.inject({ method: 'POST', url: `/api/artifacts/${id}/preview`, headers: { cookie } })
    expect((await post(s.a.id, outsider)).statusCode).toBe(404)
    const page = await (await s.open(undefined, empty.id)).fetch('/')
    expect(page.status).toBe(404)
    expect(page.text).toContain('产物还没有可预览的版本')
  })
})
