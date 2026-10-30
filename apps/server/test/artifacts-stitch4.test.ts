import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AnnotationDto,
  ArtifactCard,
  ArtifactDto,
  ArtifactSubmitRes,
  ArtifactVersionDetail,
  MessageDto,
  ServerToDaemon,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DaemonConn } from '../src/daemon/hub.js'
import { artifacts, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'
import { gif, jpeg, png, webp } from './support/images.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const PNG = png()

async function setup() {
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
  const v1 = (await w.submit(prev.id, a.id, L1)).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const req = (method: 'GET' | 'POST', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  const detail = async () => (await req('GET', `/api/artifacts/${a.id}`)).json() as ArtifactDto
  const edit = async (ops: object[]) =>
    req('POST', `/api/artifacts/${a.id}/edits`, { baseVersionId: (await detail()).headVersionId, ops })
  const version = async (vid: string) =>
    (await req('GET', `/api/artifacts/${a.id}/versions/${vid}`)).json() as ArtifactVersionDetail
  const cardOf = async () =>
    ((await t.db.select().from(messages).where(eq(messages.id, card!.id)))[0]!.meta as { card: ArtifactCard })
      .card
  /** PUT a screenshot over the machine routes (artifact.snapshot), with machine `token`. */
  const shot = (vid: string, path: string, token?: string) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/daemon/artifacts/${a.id}/versions/${vid}/${path}`,
      headers: { ...w.auth(token), 'content-type': 'image/png' },
      payload: PNG,
    })
  /** The bot's machine online with `features`; what it is sent. */
  let conn: DaemonConn | undefined
  const online = (features = ['artifacts', 'artifactSnapshot']) => {
    const sent: ServerToDaemon[] = []
    conn = { send: (m) => sent.push(m), close() {} }
    t.ctx.hub.register(w.A.machine.id, conn, features)
    return sent
  }
  const offline = () => conn && t.ctx.hub.unregister(w.A.machine.id, conn)
  return { ...w, a, prev, v1, req, detail, edit, version, cardOf, shot, online, offline }
}

const settle = () => new Promise((r) => setTimeout(r, 50))
const snapshots = (sent: ServerToDaemon[]) => sent.filter((m) => m.t === 'artifact.snapshot')

describe('thumbnails of versions the daemon did not make (P1-01)', () => {
  it("an edit shows its nearest ancestor's thumbnail and screen PNGs, stale, until its own arrive", async () => {
    const s = await setup()
    const v1 = s.v1.versionId
    expect((await s.shot(v1, 'thumbnail')).statusCode).toBe(204)
    expect((await s.shot(v1, 'screens/home/thumbnail')).statusCode).toBe(204)
    const edited = (
      await s.edit([{ kind: 'manifest', op: 'duplicate', screenId: 'home' }])
    ).json() as ArtifactDto
    const v2 = edited.headVersionId!
    const url = (vid: string, screen: string) =>
      `/api/artifacts/${s.a.id}/versions/${vid}/screens/${screen}/thumbnail`
    const own = `/api/artifacts/${s.a.id}/versions/${v2}/thumbnail`
    const old = `/api/artifacts/${s.a.id}/versions/${v1}/thumbnail`
    expect(edited.head).toMatchObject({ source: 'edit', thumbnailUrl: old, thumbnailStale: true })
    // `done` and the copy were never shot: no PNG to fall back to.
    expect(edited.head?.screenThumbs).toEqual([{ screenId: 'home', url: url(v1, 'home'), stale: true }])
    expect(await s.cardOf()).toMatchObject({ thumbnailUrl: old, thumbnailStale: true })

    expect((await s.shot(v2, 'screens/done/thumbnail')).statusCode).toBe(204)
    expect((await s.version(v2)).screenThumbs).toEqual([
      { screenId: 'done', url: url(v2, 'done') },
      { screenId: 'home', url: url(v1, 'home'), stale: true },
    ])
    expect((await s.shot(v2, 'thumbnail')).statusCode).toBe(204)
    const card = await s.cardOf()
    expect(card.thumbnailUrl).toBe(own)
    expect(card.thumbnailStale).toBeUndefined()
  })

  it('asks the bot machine to screenshot an edit when it is online, else when it comes back or after a run', async () => {
    const s = await setup()
    const sent = s.online()
    const v2 = (
      (await s.edit([{ kind: 'file', path: 'tokens.css', content: ':root{}' }])).json() as ArtifactDto
    ).headVersionId!
    expect(snapshots(sent)).toEqual([{ t: 'artifact.snapshot', artifactId: s.a.id, versionId: v2 }])

    // Offline: nothing sent, asked again when the machine comes online.
    s.offline()
    const v3 = (
      (await s.edit([{ kind: 'file', path: 'tokens.css', content: ':root{--a:1}' }])).json() as ArtifactDto
    ).headVersionId!
    const back = s.online()
    await settle()
    expect(snapshots(back)).toEqual([{ t: 'artifact.snapshot', artifactId: s.a.id, versionId: v3 }])

    // An older daemon without the feature is never sent one.
    const old = s.online(['artifacts'])
    await settle()
    expect(snapshots(old)).toEqual([])

    // After a run of the bot ends, a head still without its thumbnail is asked for.
    const again = s.online()
    await settle()
    again.length = 0
    const { publishRuns } = await import('../src/modules/runs/dto.js')
    const run = await s.run([s.a.id])
    await publishRuns(t.ctx, [run])
    expect(snapshots(again)).toEqual([])
    const [done] = await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, run.id)).returning()
    await publishRuns(t.ctx, [done!])
    expect(snapshots(again)).toEqual([{ t: 'artifact.snapshot', artifactId: s.a.id, versionId: v3 }])

    // Once shot it is not asked for again; run versions are the daemon's own business.
    expect((await s.shot(v3, 'thumbnail')).statusCode).toBe(204)
    const later = s.online()
    await settle()
    expect(snapshots(later)).toEqual([])
  })

  it("lets the bot's machine read the version and upload its PNGs outside any run, and no other machine", async () => {
    const s = await setup()
    const v2 = (
      (await s.edit([{ kind: 'file', path: 'tokens.css', content: ':root{}' }])).json() as ArtifactDto
    ).headVersionId!
    const get = (path: string, token?: string) =>
      t.app.inject({ url: `/api/daemon/artifacts/${s.a.id}/${path}`, headers: s.auth(token) })
    const m = await get(`versions/${v2}`)
    expect(m.statusCode).toBe(200)
    const tokens = (m.json() as { files: { path: string; hash: string }[] }).files.find(
      (f) => f.path === 'tokens.css',
    )!
    const blob = await get(`blobs/${tokens.hash}`)
    expect([blob.statusCode, blob.body]).toEqual([200, ':root{}'])
    expect((await get(`blobs/${'0'.repeat(64)}`)).statusCode).toBe(404)
    expect((await s.shot(v2, 'screens/home/thumbnail')).statusCode).toBe(204)
    expect((await s.shot(v2, 'screens/nope/thumbnail')).statusCode).toBe(404)

    expect((await get(`versions/${v2}`, s.B.token)).statusCode).toBe(403)
    expect((await get(`blobs/${tokens.hash}`, s.B.token)).statusCode).toBe(403)
    expect((await s.shot(v2, 'thumbnail', s.B.token)).statusCode).toBe(403)
  })
})

describe('annotations on one element (P2-02)', () => {
  it('name the element once in the message', async () => {
    const s = await setup()
    const ggId = String(L1['screens/home.html'].indexOf('<a'))
    const ids: string[] = []
    for (const note of ['颜色太浅', '字号大一点', '换个文案']) {
      const r = await s.req('POST', `/api/artifacts/${s.a.id}/annotations`, {
        versionId: s.v1.versionId,
        file: 'screens/home.html',
        ggId,
        selector: 'a',
        rect: { x: 0, y: 0, w: 10, h: 10 },
        note,
      })
      ids.push((r.json() as AnnotationDto).id)
    }
    const sent = await s.req('POST', `/api/artifacts/${s.a.id}/annotations/send`, {
      annotationIds: ids,
      botId: s.bot.id,
    })
    expect(sent.statusCode).toBe(200)
    expect((sent.json() as MessageDto).canvas?.elements).toEqual([
      { file: 'screens/home.html', ggId, label: '颜色太浅' },
    ])
    const msg = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '改一下',
      clientId: 'client-0001',
      artifactContext: {
        artifactId: s.a.id,
        elements: [
          { file: 'screens/home.html', ggId, label: '报名' },
          { file: 'screens/home.html', ggId, label: '报名' },
        ],
      },
    })
    expect(msg.statusCode, msg.body).toBe(200)
    expect((msg.json() as MessageDto).canvas?.elements).toHaveLength(1)
  })
})

describe('image uploads (P2-15)', () => {
  it('accepts whole PNG, JPEG, GIF and WebP images and refuses damaged ones', async () => {
    const s = await setup()
    const cookie = await t.seed.cookie(s.li.id)
    const upload = (body: Buffer, type: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/artifacts/${s.a.id}/uploads`,
        headers: { cookie, 'content-type': type },
        payload: body,
      })
    for (const [body, type] of [
      [png(3, 2), 'image/png'],
      [jpeg(4, 3), 'image/jpeg'],
      [gif(), 'image/gif'],
      [webp(5, 5), 'image/webp'],
    ] as const)
      expect((await upload(body, type)).statusCode, type).toBe(200)

    const good = png()
    const flipped = Buffer.from(good)
    flipped.writeUInt8(flipped.readUInt8(good.length - 20) ^ 0xff, good.length - 20)
    for (const [body, type] of [
      [Buffer.concat([good.subarray(0, 8), Buffer.from('garbage bytes here')]), 'image/png'],
      [good.subarray(0, good.length - 12), 'image/png'],
      [flipped, 'image/png'],
      [png(0, 2), 'image/png'],
      [jpeg().subarray(0, 8), 'image/jpeg'],
      [jpeg(0, 0), 'image/jpeg'],
      [gif(0, 1), 'image/gif'],
      [gif().subarray(0, 20), 'image/gif'],
      [webp().subarray(0, 24), 'image/webp'],
    ] as const) {
      const res = await upload(body, type)
      expect(res.statusCode, `${type} ${body.length}`).toBe(400)
      expect(res.json().message).toBe('图片无法读取，文件可能已损坏')
    }
  })
})
