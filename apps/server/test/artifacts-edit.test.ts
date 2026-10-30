import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ArtifactCard,
  ArtifactDesignSystem,
  ArtifactDto,
  ArtifactEditOp,
  ArtifactSubmitRes,
  ArtifactUploadRes,
  ArtifactVersionDetail,
  GgArtifactManifest,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, artifactVersions, messages, plugins } from '../src/db/schema.js'
import { BUILTIN_PLUGINS, syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'
import { png } from './support/images.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const HOME = `<!doctype html>
<html><head><link rel="stylesheet" href="../tokens.css"></head>
<body>
  <h1 class="t">报名</h1>
  <img src="x.png" alt="封面">
  <a data-gg-link="done" style="color: var(--color-primary)">去报名</a>
</body></html>
`
const FILES = { ...L1, 'screens/home.html': HOME, 'tokens.css': ':root {\n  --color-primary: #155332;\n}\n' }
const id = (html: string, needle: string) => String(html.indexOf(needle))

const PNG = png()

async function setup(o: { plugin?: boolean } = {}) {
  const w = await artifactWorld(t)
  let plugin = {}
  if (o.plugin) {
    await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
    const [p] = await t.db.select().from(plugins).where(eq(plugins.name, 'web-prototype'))
    plugin = { pluginId: p!.id, pluginVersionId: p!.versionId, designSystemId: null }
  }
  const a = await w.artifact(plugin)
  const [card] = await t.db
    .insert(messages)
    .values({
      groupId: w.g.id,
      kind: 'event',
      body: '产物',
      meta: { card: { type: 'artifact', artifactId: a.id } },
    })
    .returning()
  await t.db.update(artifacts).set({ messageId: card!.id }).where(eq(artifacts.id, a.id))
  const prev = await w.run([a.id], { status: 'succeeded' })
  const v1 = (await w.submit(prev.id, a.id, FILES)).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const edit = (ops: unknown[], base = v1.versionId) =>
    t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${a.id}/edits`,
      headers: { cookie },
      payload: { baseVersionId: base, ops },
    })
  const file = async (path: string, version?: string) =>
    (
      await t.app.inject({
        url: `/api/artifacts/${a.id}/files/${path}${version ? `?version=${version}` : ''}`,
        headers: { cookie },
      })
    ).body
  const versions = async () =>
    (await t.db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, a.id))).length
  const manifest = async () => JSON.parse(await file('gg-artifact.json')) as GgArtifactManifest
  return { ...w, a, card: card!, v1, cookie, edit, file, versions, manifest }
}

describe('direct edits', () => {
  it('applies every op of a save as one version by the member, and moves the head and the card', async () => {
    const s = await setup()
    const res = await s.edit([
      { kind: 'text', file: 'screens/home.html', ggId: id(HOME, '<h1'), text: '立即 <b>报名</b> & 抽奖' },
      { kind: 'style', file: 'screens/home.html', ggId: id(HOME, '<h1'), props: { 'font-size': '20px' } },
      { kind: 'attr', file: 'screens/home.html', ggId: id(HOME, '<img'), name: 'alt', value: '新封面' },
      { kind: 'style', file: 'screens/home.html', ggId: id(HOME, '<a '), props: { color: '' } },
      { kind: 'text', file: 'screens/done.html', ggId: id(L1['screens/done.html'], '<h1'), text: '成功' },
      { kind: 'token', name: '--color-primary', value: '#0071e3' },
    ])
    expect(res.statusCode).toBe(200)
    const dto = res.json() as ArtifactDto
    expect(dto.head).toMatchObject({ n: 2, source: 'edit', userId: s.li.id, parentVersionId: s.v1.versionId })
    expect(dto.head?.authorName).toBe('李建国')
    expect(await s.file('screens/home.html')).toBe(
      HOME.replace(
        '<h1 class="t">报名</h1>',
        '<h1 class="t" style="font-size: 20px">立即 &lt;b&gt;报名&lt;/b&gt; &amp; 抽奖</h1>',
      )
        .replace('alt="封面"', 'alt="新封面"')
        .replace(' style="color: var(--color-primary)"', ''),
    )
    expect(await s.file('screens/done.html')).toBe(L1['screens/done.html'].replace('报名成功', '成功'))
    expect(await s.file('tokens.css')).toBe(':root {\n  --color-primary: #0071e3;\n}\n')
    // The old version stays as it was.
    expect(await s.file('screens/home.html', s.v1.versionId)).toBe(HOME)
    const [card] = await t.db.select().from(messages).where(eq(messages.id, s.card.id))
    expect((card!.meta as { card: ArtifactCard }).card).toMatchObject({ versionN: 2, status: 'ready' })
  })

  it('refuses a base that is no longer the head, and edits while a run has the artifact', async () => {
    const s = await setup()
    const op = { kind: 'text', file: 'screens/home.html', ggId: id(HOME, '<h1'), text: 'x' }
    expect((await s.edit([op])).statusCode).toBe(200)
    const stale = await s.edit([op])
    expect(stale.statusCode).toBe(409)
    expect(stale.json().message).toContain('新版本')

    const head = (await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id)))[0]!.headVersionId!
    await s.run([s.a.id], { status: 'running' })
    const busy = await s.edit([op], head)
    expect(busy.statusCode).toBe(409)
    expect(busy.json().message).toContain('AI')
    expect(await s.versions()).toBe(2)
  })

  it('refuses unsafe values, paths, unknown elements and tokens without a new version', async () => {
    const s = await setup()
    const at = { file: 'screens/home.html', ggId: id(HOME, '<a ') }
    const bad: unknown[] = [
      { kind: 'style', ...at, props: { color: 'red' } },
      { kind: 'style', ...at, props: { width: 'url(javascript:alert(1))' } },
      { kind: 'style', ...at, props: { width: '1px;position:fixed' } },
      { kind: 'style', ...at, props: { position: 'fixed' } },
      { kind: 'attr', ...at, name: 'href', value: 'javascript:alert(1)' },
      { kind: 'attr', ...at, name: 'onclick', value: 'x()' },
      { kind: 'attr', ...at, name: 'src', value: '//evil.test/x.png' },
      { kind: 'text', file: '../secret.html', ggId: '0', text: 'x' },
      { kind: 'text', file: 'screens/nope.html', ggId: '0', text: 'x' },
      { kind: 'text', file: 'screens/home.html', ggId: '3', text: 'x' },
      { kind: 'text', file: 'screens/home.html', ggId: id(HOME, '<body'), text: 'x' },
      { kind: 'token', name: '--color-x', value: '#000' },
      { kind: 'token', name: '--color-primary', value: 'red; } body { display: none' },
      { kind: 'asset', ...at, uploadId: 'nope.png' },
      { kind: 'manifest', op: 'rename', screenId: 'home' },
    ]
    for (const op of bad) {
      const res = await s.edit([op])
      expect([op, res.statusCode]).toEqual([op, 400])
    }
    expect(await s.versions()).toBe(1)
  })

  it('duplicates, renames, reorders and deletes screens through the manifest', async () => {
    const s = await setup()
    const screen = (op: string, screenId: string, extra = {}) => ({
      kind: 'manifest',
      op,
      screenId,
      ...extra,
    })
    expect((await s.edit([screen('duplicate', 'home'), screen('duplicate', 'home')])).statusCode).toBe(200)
    let m = await s.manifest()
    expect(m.screens.map((x) => [x.id, x.title, x.file])).toEqual([
      ['home', '首页', 'screens/home.html'],
      ['home-copy-2', '首页 副本', 'screens/home-copy-2.html'],
      ['home-copy', '首页 副本', 'screens/home-copy.html'],
      ['done', '报名成功', 'screens/done.html'],
    ])
    expect(await s.file('screens/home-copy.html')).toBe(HOME)

    const head = () => t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    const base = async () => (await head())[0]!.headVersionId!
    const res = await s.edit(
      [
        screen('rename', 'done', { title: '完成' }),
        screen('reorder', 'done', { index: 0 }),
        screen('delete', 'home'),
      ],
      await base(),
    )
    expect(res.statusCode).toBe(200)
    m = await s.manifest()
    expect(m.entry).toBe('done')
    expect(m.screens.map((x) => [x.id, x.title])).toEqual([
      ['done', '完成'],
      ['home-copy-2', '首页 副本'],
      ['home-copy', '首页 副本'],
    ])
    const v = (res.json() as ArtifactDto).headVersionId!
    const [row] = await t.db.select().from(artifactVersions).where(eq(artifactVersions.id, v))
    expect(row!.files.map((f) => f.path)).not.toContain('screens/home.html')

    const last = await s.edit(
      [screen('delete', 'done'), screen('delete', 'home-copy'), screen('delete', 'home-copy-2')],
      await base(),
    )
    expect(last.statusCode).toBe(400)
  })

  it('uploads images for asset ops, refusing SVG, mislabelled content and oversized files', async () => {
    const s = await setup()
    const upload = (body: Buffer, type: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/artifacts/${s.a.id}/uploads`,
        headers: { cookie: s.cookie, 'content-type': type },
        payload: body,
      })
    expect((await upload(Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).statusCode).toBe(400)
    expect((await upload(Buffer.from('<html><script>alert(1)</script>'), 'image/png')).statusCode).toBe(400)
    expect((await upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')).statusCode).toBe(400)
    const ok = await upload(PNG, 'image/png')
    expect(ok.statusCode).toBe(200)
    const { uploadId, path } = ok.json() as ArtifactUploadRes
    expect(path).toBe(`assets/${uploadId}`)
    expect(uploadId).toMatch(/^[0-9a-f]{64}\.png$/)

    const res = await s.edit([{ kind: 'asset', file: 'screens/home.html', ggId: id(HOME, '<img'), uploadId }])
    expect(res.statusCode).toBe(200)
    expect(await s.file('screens/home.html')).toBe(HOME.replace('src="x.png"', `src="../assets/${uploadId}"`))
    expect(await s.file(path!)).toBe(PNG.toString())
  })

  it('lets only members edit', async () => {
    const s = await setup()
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${s.a.id}/edits`,
      headers: { cookie: await t.seed.cookie(s.outsider.id) },
      payload: {
        baseVersionId: s.v1.versionId,
        ops: [
          {
            kind: 'text',
            file: 'screens/home.html',
            ggId: id(HOME, '<h1'),
            text: 'x',
          } satisfies ArtifactEditOp,
        ],
      },
    })
    expect(res.statusCode).toBe(404)
  })
})

const LUKE = join(BUILTIN_PLUGINS, 'web-prototype/skills/web-prototype/design-systems/luke-plus')

describe('design system edits', () => {
  it('replaces DESIGN.md and tokens.css whole, and lint leaves DESIGN.md alone', async () => {
    const s = await setup()
    const md = '# 品牌\n\n<script>alert(1)</script> 只是文字\n'
    const css =
      '/* 主题 */\n:root { --color-primary: #0071e3; --font-sans: "PingFang SC", sans-serif; }\n.t-title { font-size: 20px; }\n'
    const res = await s.edit([
      { kind: 'file', path: 'DESIGN.md', content: md },
      { kind: 'file', path: 'tokens.css', content: css },
      { kind: 'token', name: '--color-primary', value: '#111111' },
    ])
    expect(res.statusCode).toBe(200)
    expect((res.json() as ArtifactDto).head?.issues).toEqual([])
    expect(await s.file('DESIGN.md')).toBe(md)
    expect(await s.file('tokens.css')).toBe(css.replace('#0071e3', '#111111'))
  })

  it('refuses a tokens.css that could load or break out, and oversized files', async () => {
    const s = await setup()
    for (const content of [
      '@import url("https://evil.test/x.css");',
      ':root { --a: url(https://evil.test/x.png); }',
      'body { display: none; }',
      ':root { --a: 1px; } </style><script>alert(1)</script>',
    ]) {
      const res = await s.edit([{ kind: 'file', path: 'tokens.css', content }])
      expect([content, res.statusCode]).toEqual([content, 400])
    }
    expect(
      (await s.edit([{ kind: 'file', path: 'DESIGN.md', content: 'x'.repeat(200 * 1024 + 1) }])).statusCode,
    ).toBe(400)
    expect((await s.edit([{ kind: 'file', path: 'index.html', content: '<p>' }])).statusCode).toBe(400)
    expect(await s.versions()).toBe(1)
  })

  it('lists the plugin design systems as presets and applies one', async () => {
    const s = await setup({ plugin: true })
    const list = await t.app.inject({
      url: `/api/artifacts/${s.a.id}/design-systems`,
      headers: { cookie: s.cookie },
    })
    expect(list.statusCode).toBe(200)
    const presets = list.json() as ArtifactDesignSystem[]
    expect(presets[0]).toEqual({
      id: 'luke-plus',
      title: '麓客+',
      description: expect.stringContaining('麓湖'),
      category: '品牌',
      swatches: ['#155332', '#F5F5F7', '#FFFFFF', '#000000', '#FEE70F'],
    })
    expect(presets.map((d) => d.id)).toEqual([
      'luke-plus',
      'warm-paper',
      'geometric',
      'glacier',
      'neon-night',
    ])
    const res = await s.edit([{ kind: 'design-system', id: 'luke-plus' }])
    expect(res.statusCode).toBe(200)
    expect((res.json() as ArtifactDto).designSystemId).toBe('luke-plus')
    expect(await s.file('DESIGN.md')).toBe(readFileSync(join(LUKE, 'DESIGN.md'), 'utf8'))
    expect(await s.file('tokens.css')).toBe(readFileSync(join(LUKE, 'tokens.css'), 'utf8'))
    const [row] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(row!.designSystemId).toBe('luke-plus')
  })

  it('refuses unknown design systems and artifacts without a plugin', async () => {
    const s = await setup({ plugin: true })
    expect((await s.edit([{ kind: 'design-system', id: 'nope' }])).statusCode).toBe(400)
    const bare = await setup()
    expect((await bare.edit([{ kind: 'design-system', id: 'luke-plus' }])).statusCode).toBe(400)
    const list = await t.app.inject({
      url: `/api/artifacts/${bare.a.id}/design-systems`,
      headers: { cookie: bare.cookie },
    })
    expect(list.json()).toEqual([])
    const outsider = await t.app.inject({
      url: `/api/artifacts/${s.a.id}/design-systems`,
      headers: { cookie: await t.seed.cookie(s.outsider.id) },
    })
    expect(outsider.statusCode).toBe(404)
  })
})

describe('prototype links', () => {
  it('links to existing screens with a transition, and an empty value removes them', async () => {
    const s = await setup()
    const a = { file: 'screens/home.html', ggId: id(HOME, '<a ') }
    const h1 = { file: 'screens/home.html', ggId: id(HOME, '<h1') }
    const res = await s.edit([
      { kind: 'attr', ...a, name: 'data-gg-link', value: '' },
      { kind: 'attr', ...h1, name: 'data-gg-link', value: 'done' },
      { kind: 'attr', ...h1, name: 'data-gg-transition', value: 'push-back' },
    ])
    expect(res.statusCode).toBe(200)
    expect(await s.file('screens/home.html')).toBe(
      HOME.replace(
        '<h1 class="t">',
        '<h1 class="t" data-gg-link="done" data-gg-transition="push-back">',
      ).replace('<a data-gg-link="done" ', '<a '),
    )
  })

  it('refuses a link to a screen the manifest does not list', async () => {
    const s = await setup()
    const h1 = { file: 'screens/home.html', ggId: id(HOME, '<h1') }
    expect((await s.edit([{ kind: 'attr', ...h1, name: 'data-gg-link', value: 'nope' }])).statusCode).toBe(
      400,
    )
    // A screen deleted in the same save is gone too.
    const gone = await s.edit([
      { kind: 'attr', ...h1, name: 'data-gg-link', value: 'done' },
      { kind: 'manifest', op: 'delete', screenId: 'done' },
    ])
    expect(gone.statusCode).toBe(400)
    expect(await s.versions()).toBe(1)
  })
})

describe('artifact details', () => {
  it('lists the links between screens of a version', async () => {
    const s = await setup()
    const res = await t.app.inject({
      url: `/api/artifacts/${s.a.id}/versions/${s.v1.versionId}`,
      headers: { cookie: s.cookie },
    })
    expect((res.json() as ArtifactVersionDetail).links).toEqual([
      { from: 'home', to: 'done', ggId: id(HOME, '<a '), text: '去报名' },
    ])
  })

  it('stars screens and archives without a new version', async () => {
    const s = await setup()
    const fav = await t.app.inject({
      method: 'PUT',
      url: `/api/artifacts/${s.a.id}/favorites`,
      headers: { cookie: s.cookie },
      payload: { screenIds: ['done', 'home', 'done'] },
    })
    expect((fav.json() as ArtifactDto).favorites).toEqual(['done', 'home'])
    const bad = await t.app.inject({
      method: 'PUT',
      url: `/api/artifacts/${s.a.id}/favorites`,
      headers: { cookie: s.cookie },
      payload: { screenIds: ['../x'] },
    })
    expect(bad.statusCode).toBe(400)
    const arch = await t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${s.a.id}/archive`,
      headers: { cookie: s.cookie },
    })
    expect((arch.json() as ArtifactDto).archivedAt).not.toBeNull()
    expect(await s.versions()).toBe(1)
    const got = await t.app.inject({ url: `/api/artifacts/${s.a.id}`, headers: { cookie: s.cookie } })
    expect((got.json() as ArtifactDto).favorites).toEqual(['done', 'home'])
  })
})
