import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AnnotationDto,
  ArtifactSubmitRes,
  ArtifactThreadDto,
  DaemonArtifactRef,
  MessageDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, artifactVersions, messages } from '../src/db/schema.js'
import { runArtifacts } from '../src/modules/artifacts/service.js'
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

const SITE = { kind: 'site', path: '/about', point: { x: 120, y: 340 } } as const

async function setup() {
  const w = await artifactWorld(t)
  const site = await w.artifact({ siteDir: 'dist', title: '官网' })
  const [v] = await t.db
    .insert(artifactVersions)
    .values({ artifactId: site.id, n: 1, source: 'host', files: [], digest: 'd' })
    .returning()
  await t.db.update(artifacts).set({ headVersionId: v!.id }).where(eq(artifacts.id, site.id))
  const li = await t.seed.cookie(w.li.id)
  const wang = await t.seed.cookie(w.wang.id)
  const outsider = await t.seed.cookie(w.outsider.id)
  const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie = li, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  const thread = (o: object = {}, cookie = li) =>
    req('POST', `/api/artifacts/${site.id}/threads`, cookie, {
      versionId: v!.id,
      anchor: SITE,
      text: '按钮再大一点',
      ...o,
    })
  return { ...w, site, v: v!, li: w.li, liCookie: li, wangCookie: wang, outsider, req, thread }
}

describe('artifact threads', () => {
  it('anchor on the artifact kind, list by version, take replies and edits of their own author', async () => {
    const s = await setup()
    const made = await s.thread()
    expect(made.statusCode).toBe(200)
    const th = made.json() as ArtifactThreadDto
    expect(th).toMatchObject({
      artifactId: s.site.id,
      versionId: s.v.id,
      anchor: SITE,
      status: 'open',
      sentMessageId: null,
      createdBy: s.li.id,
      createdByName: '李建国',
    })
    expect(th.messages).toMatchObject([
      { authorKind: 'user', authorId: s.li.id, authorName: '李建国', text: '按钮再大一点', editedAt: null },
    ])
    // A prototype's anchor on a site, or a broken anchor, is refused.
    const proto = {
      kind: 'prototype',
      file: 'index.html',
      ggId: null,
      selector: '',
      rect: { x: 0, y: 0, w: 1, h: 1 },
    }
    expect((await s.thread({ anchor: proto })).statusCode).toBe(400)
    expect((await s.thread({ anchor: { kind: 'site', path: '/' } })).statusCode).toBe(400)

    const list = await s.req('GET', `/api/artifacts/${s.site.id}/threads?version=${s.v.id}`)
    expect((list.json() as ArtifactThreadDto[]).map((x) => x.id)).toEqual([th.id])

    const replied = await s.req('POST', `/api/artifact-threads/${th.id}/messages`, s.wangCookie, {
      text: '同意',
      to: [s.bot.id],
    })
    expect(replied.statusCode).toBe(200)
    const two = (replied.json() as ArtifactThreadDto).messages
    expect(two.map((m) => [m.authorName, m.text, m.to])).toEqual([
      ['李建国', '按钮再大一点', []],
      ['王磊', '同意', [s.bot.id]],
    ])
    const reply = two[1]!
    const editUrl = `/api/artifact-threads/${th.id}/messages/${reply.id}`
    expect((await s.req('PATCH', editUrl, s.liCookie, { text: '改' })).statusCode).toBe(403)
    const edited = await s.req('PATCH', editUrl, s.wangCookie, { text: '同意，再圆一点' })
    expect((edited.json() as ArtifactThreadDto).messages[1]).toMatchObject({ text: '同意，再圆一点' })
    expect((edited.json() as ArtifactThreadDto).messages[1]!.editedAt).not.toBeNull()
    expect((await s.req('DELETE', editUrl, s.liCookie)).statusCode).toBe(403)
    expect((await s.req('DELETE', editUrl, s.wangCookie)).statusCode).toBe(200)

    const moved = await s.req('PATCH', `/api/artifact-threads/${th.id}`, s.wangCookie, {
      status: 'resolved',
      anchor: { ...SITE, point: { x: 1, y: 2 } },
    })
    expect(moved.json()).toMatchObject({
      status: 'resolved',
      resolvedBy: s.wang.id,
      resolvedByName: '王磊',
      anchor: { point: { x: 1, y: 2 } },
    })
    const reopened = await s.req('PATCH', `/api/artifact-threads/${th.id}`, s.liCookie, { status: 'open' })
    expect(reopened.json()).toMatchObject({ status: 'open', resolvedBy: null, resolvedByName: null })
    expect(
      (await s.req('PATCH', `/api/artifact-threads/${th.id}`, s.wangCookie, { anchor: proto })).statusCode,
    ).toBe(400)

    // Reactions add and remove the caller cleanly.
    const reactUrl = `/api/artifact-threads/${th.id}/messages/${th.messages[0]!.id}/reactions`
    const reacted = await s.req('POST', reactUrl, s.wangCookie, { emoji: '👍', on: true })
    expect(reacted.statusCode).toBe(200)
    expect((reacted.json() as ArtifactThreadDto).messages[0]!.reactions).toEqual([
      { emoji: '👍', userIds: [s.wang.id], authors: [{ id: s.wang.id, name: '王磊' }] },
    ])
    const unreacted = await s.req('POST', reactUrl, s.wangCookie, { emoji: '👍', on: false })
    expect((unreacted.json() as ArtifactThreadDto).messages[0]!.reactions).toEqual([])

    expect((await s.req('DELETE', `/api/artifact-threads/${th.id}`, s.wangCookie)).statusCode).toBe(403)
    expect((await s.req('DELETE', `/api/artifact-threads/${th.id}`)).statusCode).toBe(204)
    expect((await s.req('GET', `/api/artifacts/${s.site.id}/threads`)).json()).toEqual([])
  })

  it('stores opaque string anchors verbatim with label, detail and location for editors', async () => {
    const s = await setup()
    const slides = await s.artifact({ kind: 'slides', title: '汇报' })
    const [sv] = await t.db
      .insert(artifactVersions)
      .values({ artifactId: slides.id, n: 1, source: 'edit', files: [], digest: 'd' })
      .returning()
    await t.db.update(artifacts).set({ headVersionId: sv!.id }).where(eq(artifacts.id, slides.id))
    const raw = '{"slide":"s2","el":"h1","x":0.42,"y":0.18}'
    const res = await s.req('POST', `/api/artifacts/${slides.id}/threads`, s.liCookie, {
      anchor: raw,
      label: 'Slide 2 · Heading',
      detail: 'Q3 Revenue',
      location: { slide: 's2', x: 0.42, y: 0.18 },
      text: '数字再核对一下',
    })
    expect(res.statusCode).toBe(200)
    const th = res.json() as ArtifactThreadDto
    expect(th).toMatchObject({
      versionId: sv!.id,
      anchor: raw,
      label: 'Slide 2 · Heading',
      detail: 'Q3 Revenue',
      location: { slide: 's2', x: 0.42, y: 0.18 },
      resolvedBy: null,
      resolvedByName: null,
    })
    const sent = await s.req('POST', `/api/artifacts/${slides.id}/threads/send`, s.liCookie, {
      threadIds: [th.id],
      botId: s.bot.id,
    })
    expect(sent.statusCode).toBe(200)
    const [row] = await t.db
      .select()
      .from(messages)
      .where(eq(messages.id, (sent.json() as MessageDto).id))
    const note = (row!.meta as { artifactNote: string }).artifactNote
    expect(note).toContain('Slide 2 · Heading（Q3 Revenue）')
    expect(note).toContain('"slide":"s2"')
  })

  it('go away with their first message', async () => {
    const s = await setup()
    const th = (await s.thread()).json() as ArtifactThreadDto
    const res = await s.req('DELETE', `/api/artifact-threads/${th.id}/messages/${th.messages[0]!.id}`)
    expect(res.statusCode).toBe(204)
    expect((await s.req('GET', `/api/artifacts/${s.site.id}/threads`)).json()).toEqual([])
  })

  it('are read-only to people outside the group and hidden from strangers', async () => {
    const s = await setup()
    const th = (await s.thread()).json() as ArtifactThreadDto
    expect((await s.req('GET', `/api/artifacts/${s.site.id}/threads`, s.outsider)).statusCode).toBe(404)
    await t.db.update(artifacts).set({ visibility: 'team' }).where(eq(artifacts.id, s.site.id))
    const seen = await s.req('GET', `/api/artifacts/${s.site.id}/threads`, s.outsider)
    expect((seen.json() as ArtifactThreadDto[]).map((x) => x.id)).toEqual([th.id])
    expect((await s.thread({}, s.outsider)).statusCode).toBe(403)
    const url = `/api/artifact-threads/${th.id}`
    expect((await s.req('POST', `${url}/messages`, s.outsider, { text: 'x' })).statusCode).toBe(403)
    expect((await s.req('PATCH', url, s.outsider, { status: 'resolved' })).statusCode).toBe(403)
    expect((await s.req('DELETE', url, s.outsider)).statusCode).toBe(403)
    const send = await s.req('POST', `/api/artifacts/${s.site.id}/threads/send`, s.outsider, {
      threadIds: [th.id],
      botId: s.bot.id,
    })
    expect(send.statusCode).toBe(403)
  })

  it('are sent to the bot as an @ message with their place and replies, then become sent', async () => {
    const s = await setup()
    const th = (await s.thread()).json() as ArtifactThreadDto
    await s.req('POST', `/api/artifact-threads/${th.id}/messages`, s.wangCookie, { text: '颜色也换掉' })
    const res = await s.req('POST', `/api/artifacts/${s.site.id}/threads/send`, s.liCookie, {
      threadIds: [th.id],
      botId: s.bot.id,
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg).toMatchObject({ authorId: s.li.id, mentions: [s.bot.id] })
    expect(msg.body).toMatch(/^@小王的 Claude 按 1 条批注修改/)
    const [row] = await t.db.select().from(messages).where(eq(messages.id, msg.id))
    const note = (row!.meta as { artifactNote: string }).artifactNote
    expect(note).toContain(`请按以下批注修改产物「官网」（目录 ${s.site.dir}/，当前版本 v1）`)
    expect(note).toContain('1. 页面 /about 坐标 (120,340)（页面 CSS 像素）')
    expect(note).toContain('意见：按钮再大一点')
    expect(note).toContain('王磊 补充：颜色也换掉')
    const after = (await s.req('GET', `/api/artifacts/${s.site.id}/threads`)).json() as ArtifactThreadDto[]
    expect(after.map((x) => [x.status, x.sentMessageId])).toEqual([['sent', msg.id]])

    const other = await s.artifact()
    const foreign = await s.req('POST', `/api/artifacts/${other.id}/threads/send`, s.liCookie, {
      threadIds: [th.id],
      botId: s.bot.id,
    })
    expect(foreign.statusCode).toBe(404)
  })

  it('include the annotations made on prototypes the old way', async () => {
    const s = await setup()
    const a = await s.artifact()
    const prev = await s.run([a.id], { status: 'succeeded' })
    const v1 = (await s.submit(prev.id, a.id, L1)).json() as ArtifactSubmitRes
    const n = (
      await s.req('POST', `/api/artifacts/${a.id}/annotations`, s.liCookie, {
        versionId: v1.versionId,
        file: 'screens/done.html',
        ggId: null,
        selector: 'h1',
        rect: { x: 1, y: 2, w: 3, h: 4 },
        note: '字大一点',
      })
    ).json() as AnnotationDto
    const [th] = (await s.req('GET', `/api/artifacts/${a.id}/threads`)).json() as ArtifactThreadDto[]
    expect(th).toMatchObject({
      id: n.id,
      anchor: { kind: 'prototype', file: 'screens/done.html', ggId: null, selector: 'h1', snippet: '' },
      messages: [{ text: '字大一点' }],
    })
  })
})

describe('run start', () => {
  it('tells the daemon each artifact kind', async () => {
    const s = await setup()
    const a = await s.artifact({ kind: 'slides' })
    const { refs } = await t.db.transaction((tx) =>
      runArtifacts(tx, s.g.id, s.bot.id, { mentions: [s.bot.id], artifactRefs: [a.id] }),
    )
    expect(refs.map((r: DaemonArtifactRef) => [r.id, r.kind])).toEqual([[a.id, 'slides']])
  })
})
