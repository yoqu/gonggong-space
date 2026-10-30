import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AnnotationDto,
  ArtifactCard,
  ArtifactDto,
  ArtifactSubmitRes,
  ArtifactUploadRes,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
  GgArtifactManifest,
  MessageDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, messages, runs } from '../src/db/schema.js'
import type { MessageMeta } from '../src/modules/messages/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const HOME = `<!doctype html>
<html><body>
<section data-section="hero">
  <h1 class="t">报名</h1>
  <p>本周活动</p>
</section>
</body></html>
`
const H1 = String(HOME.indexOf('<h1'))
const P = String(HOME.indexOf('<p>'))
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('px')])
const PDF = Buffer.from('%PDF-1.7\n需求文档')

async function setup(files: Record<string, string> = { ...L1, 'screens/home.html': HOME }) {
  const w = await artifactWorld(t)
  const a = await w.artifact()
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
  const v1 = (await w.submit(prev.id, a.id, files)).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const req = (method: 'GET' | 'POST', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  const upload = (body: Buffer, type: string) =>
    t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${a.id}/uploads`,
      headers: { cookie, 'content-type': type },
      payload: body,
    })
  const detail = async () => (await req('GET', `/api/artifacts/${a.id}`)).json() as ArtifactDto
  const edit = async (ops: object[]) =>
    req('POST', `/api/artifacts/${a.id}/edits`, { baseVersionId: (await detail()).headVersionId, ops })
  const file = async (path: string) => (await req('GET', `/api/artifacts/${a.id}/files/${path}`)).body
  const cardOf = async () =>
    ((await t.db.select().from(messages).where(eq(messages.id, card!.id)))[0]!.meta as { card: ArtifactCard })
      .card
  const note = async (id: string) =>
    ((await t.db.select().from(messages).where(eq(messages.id, id)))[0]!.meta as MessageMeta).artifactNote
  return { ...w, a, card: card!, prev, v1, cookie, req, upload, detail, edit, file, cardOf, note }
}

describe('reference nodes (G04)', () => {
  it('uploads images, PDFs and text, refusing SVG, mislabelled content and oversized files', async () => {
    const s = await setup()
    expect((await s.upload(Buffer.from('<svg/>'), 'image/svg+xml')).statusCode).toBe(400)
    expect((await s.upload(Buffer.from('not a pdf'), 'application/pdf')).statusCode).toBe(400)
    expect((await s.upload(Buffer.from([0x61, 0, 0x62]), 'text/plain')).statusCode).toBe(400)
    expect((await s.upload(Buffer.from([0xff, 0xfe, 0x41]), 'text/markdown')).statusCode).toBe(400)
    const bigPdf = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)])
    expect((await s.upload(bigPdf, 'application/pdf')).statusCode).toBe(400)
    expect(
      (await s.upload(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'image/png')).statusCode,
    ).toBe(400)
    const pdf = await s.upload(Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]), 'application/pdf')
    expect(pdf.statusCode).toBe(200)
    expect(pdf.json()).toMatchObject({ path: null, kind: 'pdf' })
    expect((await s.upload(Buffer.from('# 需求\n'), 'text/markdown; charset=utf-8')).json()).toMatchObject({
      kind: 'text',
      path: null,
    })
    expect((await s.upload(PNG, 'image/png')).json()).toMatchObject({ kind: 'image' })
  })

  it('adds, moves and deletes reference nodes as versions; refs/ files travel with them and lint leaves them be', async () => {
    const s = await setup()
    const png = (await s.upload(PNG, 'image/png')).json() as ArtifactUploadRes
    const md = (await s.upload(Buffer.from('# 需求\n- 报名'), 'text/markdown')).json() as ArtifactUploadRes
    const pdf = (await s.upload(PDF, 'application/pdf')).json() as ArtifactUploadRes
    const res = await s.edit([
      { kind: 'ref', uploadId: png.uploadId, title: '竞品.png' },
      { kind: 'ref', uploadId: png.uploadId, title: '竞品 2.png' },
      { kind: 'ref', uploadId: md.uploadId, title: '需求.md' },
      { kind: 'ref', uploadId: pdf.uploadId, title: '需求.pdf' },
    ])
    expect(res.statusCode).toBe(200)
    const dto = res.json() as ArtifactDto
    const p8 = png.uploadId.slice(0, 8)
    expect(dto.manifest?.refs).toEqual([
      { id: `ref-${p8}`, title: '竞品.png', file: `refs/ref-${p8}.png`, kind: 'image' },
      { id: `ref-${p8}-2`, title: '竞品 2.png', file: `refs/ref-${p8}-2.png`, kind: 'image' },
      expect.objectContaining({ title: '需求.md', kind: 'text' }),
      expect.objectContaining({ title: '需求.pdf', kind: 'pdf' }),
    ])
    expect(dto.head).toMatchObject({ n: 2, source: 'edit', issues: [] })
    expect(await s.file(`refs/ref-${p8}.png`)).toBe(PNG.toString())
    expect(await s.file(dto.manifest!.refs![2]!.file)).toBe('# 需求\n- 报名')

    const moved = await s.edit([
      { kind: 'ref-move', id: `ref-${p8}`, x: 120, y: -40 },
      { kind: 'ref-rename', id: `ref-${p8}`, title: '竞品首页' },
      { kind: 'ref-delete', id: `ref-${p8}-2` },
    ])
    expect(moved.statusCode).toBe(200)
    const m = JSON.parse(await s.file('gg-artifact.json')) as GgArtifactManifest
    expect(m.refs?.[0]?.title).toBe('竞品首页')
    expect(m.refs?.map((r) => [r.id, r.x, r.y])).toEqual([
      [`ref-${p8}`, 120, -40],
      [m.refs![1]!.id, undefined, undefined],
      [m.refs![2]!.id, undefined, undefined],
    ])
    const head = (moved.json() as ArtifactDto).headVersionId!
    const v = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions/${head}`)
    ).json() as ArtifactVersionDetail
    expect(v.files.map((f) => f.path)).not.toContain(`refs/ref-${p8}-2.png`)
    expect(v.files.map((f) => f.path)).toContain(`refs/ref-${p8}.png`)
  })

  it('refuses unknown uploads and refs, PDFs as image assets, and refs on an L0 artifact', async () => {
    const s = await setup()
    const pdf = (await s.upload(PDF, 'application/pdf')).json() as ArtifactUploadRes
    for (const op of [
      { kind: 'ref', uploadId: `${'0'.repeat(64)}.png`, title: 'x' },
      { kind: 'ref-delete', id: 'ref-nope' },
      { kind: 'ref-move', id: 'ref-nope', x: 0, y: 0 },
      { kind: 'ref-rename', id: 'ref-nope', title: 'x' },
      { kind: 'asset', file: 'screens/home.html', ggId: H1, uploadId: pdf.uploadId },
    ])
      expect((await s.edit([op])).statusCode).toBe(400)
    const l0 = await setup({ 'index.html': '<!doctype html><p>单页</p>' })
    const up = (await l0.upload(PNG, 'image/png')).json() as ArtifactUploadRes
    expect((await l0.edit([{ kind: 'ref', uploadId: up.uploadId, title: 'x' }])).statusCode).toBe(400)
  })

  it('tells the agent where the reference files are when a message carries them', async () => {
    const s = await setup()
    const png = (await s.upload(PNG, 'image/png')).json() as ArtifactUploadRes
    const dto = (
      await s.edit([{ kind: 'ref', uploadId: png.uploadId, title: '竞品.png' }])
    ).json() as ArtifactDto
    const ref = dto.manifest!.refs![0]!
    const res = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '照这个做首页',
      clientId: 'client-0001',
      artifactContext: { artifactId: s.a.id, screenIds: ['home'], refs: [ref.file] },
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg.canvas?.refs).toEqual([{ id: ref.id, title: '竞品.png' }])
    expect(await s.note(msg.id)).toContain(`- ${s.a.dir}/${ref.file}（图片：竞品.png）`)
    const bad = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: 'x',
      clientId: 'client-0002',
      artifactContext: { artifactId: s.a.id, refs: ['refs/ref-nope.png'] },
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('region annotations (G08)', () => {
  it('are told to the agent as the region with the elements the web listed inside it', async () => {
    const s = await setup()
    const region = (rect: object, snippet: string, note: string) =>
      s.req('POST', `/api/artifacts/${s.a.id}/annotations`, {
        versionId: s.v1.versionId,
        file: 'screens/home.html',
        ggId: null,
        selector: '',
        rect,
        snippet,
        note,
      })
    const made = await region({ x: 0, y: 40.4, w: 200, h: 120 }, `${H1},${P}`, '这块换成轮播')
    expect(made.statusCode).toBe(200)
    const n = made.json() as AnnotationDto
    expect(n).toMatchObject({ ggId: null, selector: '', snippet: `${H1},${P}` })
    const empty = (await region({ x: 0, y: 500, w: 10, h: 10 }, '', '这里加个按钮')).json() as AnnotationDto
    const sent = await s.req('POST', `/api/artifacts/${s.a.id}/annotations/send`, {
      annotationIds: [n.id, empty.id],
      botId: s.bot.id,
    })
    expect(sent.statusCode).toBe(200)
    const note = await s.note((sent.json() as MessageDto).id)
    expect(note).toContain(`1. screens/home.html 区域 (0,40,200,120)（x,y,w,h，屏幕 CSS 像素）内：${H1},${P}`)
    expect(note).toContain(
      '   - screens/home.html 第 4 行（区块 data-section="hero"）：<h1 class="t">报名</h1>',
    )
    expect(note).toContain('   - screens/home.html 第 5 行（区块 data-section="hero"）：<p>本周活动</p>')
    expect(note).toContain(
      '2. screens/home.html 区域 (0,500,10,10)（x,y,w,h，屏幕 CSS 像素）内：（没有元素，指这块空白区域）',
    )
    expect(note).toContain('   框选区域')
    expect(note).not.toContain('选择器：\n')
  })
})

describe('queued runs (R04)', () => {
  it('marks the artifact queued while its bot waits offline, and pushes its card as that changes', async () => {
    const s = await setup()
    expect(await s.detail()).toMatchObject({ queued: false, queuedRunCount: 0 })
    const seen: WebEvent[] = []
    t.ctx.bus.attach(s.li.id, (e) => seen.push(e))
    const res = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '改一下',
      clientId: 'client-0001',
      artifactContext: { artifactId: s.a.id },
    })
    expect(res.statusCode).toBe(200)
    const [run] = await t.db
      .select()
      .from(runs)
      .where(eq(runs.triggerMessageId, (res.json() as MessageDto).id))
    expect(run?.status).toBe('offline_wait')
    expect(await s.detail()).toMatchObject({ queued: true, queuedRunCount: 1, running: false })
    const list = (await s.req('GET', `/api/groups/${s.g.id}/artifacts`)).json() as ArtifactDto[]
    expect(list[0]).toMatchObject({ queued: true, queuedRunCount: 1 })
    const cardEdits = () => seen.filter((e) => e.t === 'message.edited' && e.message.id === s.card.id).length
    expect(cardEdits()).toBe(1)

    const { publishRuns } = await import('../src/modules/runs/dto.js')
    const [same] = await t.db.select().from(runs).where(eq(runs.id, run!.id))
    await publishRuns(t.ctx, [same!])
    expect(cardEdits()).toBe(1)
    const [done] = await t.db.update(runs).set({ status: 'expired' }).where(eq(runs.id, run!.id)).returning()
    await publishRuns(t.ctx, [done!])
    expect(cardEdits()).toBe(2)
    expect(await s.detail()).toMatchObject({ queued: false, queuedRunCount: 0 })
  })
})

describe('thumbnails (R11, G01)', () => {
  it('a local version without a thumbnail shows its nearest ancestor one, marked stale', async () => {
    const s = await setup()
    const put = (vid: string, path = 'thumbnail') =>
      t.app.inject({
        method: 'PUT',
        url: `${s.base(s.prev.id, s.a.id)}/versions/${vid}/${path}`,
        headers: { ...s.auth(), 'content-type': 'image/png' },
        payload: PNG,
      })
    expect((await put(s.v1.versionId)).statusCode).toBe(204)
    const run = await s.run([s.a.id])
    const local = (
      await s.submit(
        run.id,
        s.a.id,
        { ...L1, 'screens/home.html': `${HOME}<!-- 本机 -->` },
        {
          parent: s.v1.versionId,
          source: 'local',
        },
      )
    ).json() as ArtifactSubmitRes
    const v1Thumb = `/api/artifacts/${s.a.id}/versions/${s.v1.versionId}/thumbnail`
    const versions = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions`)
    ).json() as ArtifactVersionSummary[]
    expect(versions.map((v) => [v.n, v.thumbnailUrl, v.thumbnailStale])).toEqual([
      [2, v1Thumb, true],
      [1, v1Thumb, undefined],
    ])
    expect(await s.cardOf()).toMatchObject({ versionN: 2, thumbnailUrl: v1Thumb, thumbnailStale: true })
    expect((await s.detail()).head).toMatchObject({ thumbnailUrl: v1Thumb, thumbnailStale: true })

    const own = await t.app.inject({
      method: 'PUT',
      url: `${s.base(run.id, s.a.id)}/versions/${local.versionId}/thumbnail`,
      headers: { ...s.auth(), 'content-type': 'image/png' },
      payload: PNG,
    })
    expect(own.statusCode).toBe(204)
    const card = await s.cardOf()
    expect(card.thumbnailUrl).toBe(`/api/artifacts/${s.a.id}/versions/${local.versionId}/thumbnail`)
    expect(card.thumbnailStale).toBeUndefined()
  })

  it('takes one PNG per manifest screen from the daemon and serves it to members', async () => {
    const s = await setup()
    const put = (screen: string, payload: Buffer = PNG) =>
      t.app.inject({
        method: 'PUT',
        url: `${s.base(s.prev.id, s.a.id)}/versions/${s.v1.versionId}/screens/${screen}/thumbnail`,
        headers: { ...s.auth(), 'content-type': 'image/png' },
        payload,
      })
    expect((await put('nope')).statusCode).toBe(404)
    expect((await put('Home')).statusCode).toBe(404)
    expect((await put('home', Buffer.from('old'))).statusCode).toBe(204)
    expect((await put('home')).statusCode).toBe(204)
    expect((await put('done')).statusCode).toBe(204)
    const v = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions/${s.v1.versionId}`)
    ).json() as ArtifactVersionDetail
    const url = (id: string) => `/api/artifacts/${s.a.id}/versions/${s.v1.versionId}/screens/${id}/thumbnail`
    expect(v.screenThumbs).toEqual([
      { screenId: 'home', url: url('home') },
      { screenId: 'done', url: url('done') },
    ])
    const got = await s.req('GET', url('home'))
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('image/png')
    expect(got.rawPayload.equals(PNG)).toBe(true)
    expect((await s.req('GET', url('gone'))).statusCode).toBe(404)
    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await t.app.inject({ url: url('home'), headers: { cookie: outsider } })).statusCode).toBe(404)
  })
})
