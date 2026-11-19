import { mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactCard, ArtifactDto, ArtifactShareDto, ArtifactSubmitRes } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, messages, previews, runs } from '../src/db/schema.js'
import { artifactBlobs, artifactQuota } from '../src/modules/artifacts/blobs.js'
import type { MessageMeta } from '../src/modules/messages/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'
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

type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string }
function get(host: string, path: string, headers: Record<string, string> = {}) {
  const port = Number(new URL(t.url('/')).port)
  return new Promise<Res>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host, ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

const PNG = 'png-thumbnail-bytes'

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const done = await w.run([a.id], { status: 'succeeded' })
  const v1 = (await w.submit(done.id, a.id, L1)).json() as ArtifactSubmitRes
  const v2 = (
    await w.submit(done.id, a.id, { ...L1, 'screens/home.html': '<p>v2</p>' }, { parent: v1.versionId })
  ).json() as ArtifactSubmitRes
  const shot = await t.app.inject({
    method: 'PUT',
    url: `${w.base(done.id, a.id)}/versions/${v2.versionId}/thumbnail`,
    headers: { ...w.auth(), 'content-type': 'image/png' },
    payload: Buffer.from(PNG),
  })
  expect(shot.statusCode).toBe(204)
  const target = await t.seed.group({ createdBy: w.wang.id, name: '目标群', memberIds: [w.li.id] })
  const wang = await t.seed.cookie(w.wang.id)
  const li = await t.seed.cookie(w.li.id)
  const req = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  const move = (cookie: string, groupId: string, id = a.id) =>
    req(cookie, 'POST', `/api/artifacts/${id}/move`, { groupId })
  return { ...w, a, v1, v2, target, wang, li, req, move }
}

const eventsOf = (groupId: string) =>
  t.db
    .select()
    .from(messages)
    .where(and(eq(messages.groupId, groupId), eq(messages.kind, 'event')))

describe('moving an artifact to another group', () => {
  it('keeps its versions, blobs, share link and previews, and posts its card in the target group', async () => {
    const s = await setup()
    const share = (
      await s.req(s.wang, 'POST', `/api/artifacts/${s.a.id}/share`, { enabled: true })
    ).json() as ArtifactShareDto
    expect(share.enabled).toBe(true)
    await t.db
      .update(artifacts)
      .set({ checkoutBotIds: [s.bot.id] })
      .where(eq(artifacts.id, s.a.id))

    const res = await s.move(s.wang, s.target.id)
    expect(res.statusCode).toBe(200)
    const moved = res.json() as ArtifactDto
    expect(moved).toMatchObject({
      id: s.a.id,
      groupId: s.target.id,
      dir: s.a.dir,
      headVersionId: s.v2.versionId,
    })
    // The bot stays: artifact previews hang off it (their machine is never asked, they are served from blobs).
    expect(moved.botId).toBe(s.bot.id)

    const versions = (await s.req(s.li, 'GET', `/api/artifacts/${s.a.id}/versions`)).json() as { n: number }[]
    expect(versions.map((v) => v.n)).toEqual([2, 1])
    const old = await s.req(
      s.li,
      'GET',
      `/api/artifacts/${s.a.id}/files/screens/home.html?version=${s.v1.versionId}`,
    )
    expect(old.body).toBe(L1['screens/home.html'])
    expect((await s.req(s.li, 'GET', `/api/artifacts/${s.a.id}/files/screens/home.html`)).body).toBe(
      '<p>v2</p>',
    )
    const thumb = await s.req(s.li, 'GET', `/api/artifacts/${s.a.id}/versions/${s.v2.versionId}/thumbnail`)
    expect(thumb.body).toBe(PNG)
    expect(await artifactBlobs.size(s.target.id, sha(PNG))).toBe(PNG.length)
    expect(await artifactBlobs.size(s.target.id, sha(L1['gg-artifact.json']))).not.toBeNull()

    const [row] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(row!.checkoutBotIds).toEqual([])
    expect(row!.shareToken).not.toBeNull()
    const ps = await t.db.select().from(previews).where(eq(previews.artifactId, s.a.id))
    expect(ps.length).toBeGreaterThan(0)
    expect(ps.every((p) => p.groupId === s.target.id)).toBe(true)

    // The public link still opens and shows the artifact.
    const link = new URL(share.url!)
    const visit = await get(link.host, link.pathname)
    expect(visit.status).toBe(302)
    const cookie = (visit.headers['set-cookie'] as string[])[0]!.split(';')[0]!
    expect((await get(link.host, '/screens/home.html', { cookie })).text).toBe('<p>v2</p>')
    expect(
      ((await s.req(s.wang, 'GET', `/api/artifacts/${s.a.id}/share`)).json() as ArtifactShareDto).url,
    ).toBe(share.url)

    const card = (await eventsOf(s.target.id)).find((m) => m.id === row!.messageId)
    expect(card?.body).toBe('产物「活动报名」从群「设计群」移入')
    expect((card!.meta as MessageMeta).card as ArtifactCard).toMatchObject({
      artifactId: s.a.id,
      versionN: 2,
    })
    expect((await eventsOf(s.g.id)).map((m) => m.body)).toContain('产物「活动报名」已移到群「目标群」')

    // Gone from the source group's list, in the target's.
    const src = (await s.req(s.li, 'GET', `/api/groups/${s.g.id}/artifacts`)).json() as ArtifactDto[]
    expect(src.map((x) => x.id)).not.toContain(s.a.id)
    const dst = (await s.req(s.li, 'GET', `/api/groups/${s.target.id}/artifacts`)).json() as ArtifactDto[]
    expect(dst.map((x) => x.id)).toContain(s.a.id)
  })

  it('is for managers of the artifact who are members of the target group', async () => {
    const s = await setup()
    // li is a member of both groups but neither its creator, its bot's owner nor an admin.
    expect((await s.move(s.li, s.target.id)).statusCode).toBe(403)
    // wang manages it but is not in 别的群.
    expect((await s.move(s.wang, s.g2.id)).statusCode).toBe(404)
    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await s.move(outsider, s.g2.id)).statusCode).toBe(404)
    expect((await s.move(s.wang, 'not-a-group')).statusCode).toBe(400)
    const [row] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(row!.groupId).toBe(s.g.id)
  })

  it('refuses the same group, an archived artifact, a taken folder and one a run has checked out', async () => {
    const s = await setup()
    expect((await s.move(s.wang, s.g.id)).statusCode).toBe(409)

    const taken = await s.artifact({ groupId: s.target.id, dir: s.a.dir })
    const conflict = await s.move(s.wang, s.target.id)
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().message).toContain('目标群已有同一目录的产物')
    await t.db
      .update(artifacts)
      .set({ dir: `${taken.dir}-x` })
      .where(eq(artifacts.id, taken.id))

    const live = await s.run([s.a.id])
    expect((await s.move(s.wang, s.target.id)).statusCode).toBe(409)
    await t.db.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, live.id))

    await s.req(s.wang, 'POST', `/api/artifacts/${s.a.id}/archive`)
    expect((await s.move(s.wang, s.target.id)).statusCode).toBe(409)
  })

  it("refuses when the target group's artifact storage is full, leaving the artifact where it was", async () => {
    const s = await setup()
    const quota = artifactQuota.bytes
    artifactQuota.bytes = 10
    try {
      const res = await s.move(s.wang, s.target.id)
      expect(res.statusCode).toBe(413)
    } finally {
      artifactQuota.bytes = quota
    }
    const [row] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(row!.groupId).toBe(s.g.id)
  })
})
