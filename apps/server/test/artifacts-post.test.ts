import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactCard, ArtifactSubmitRes } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, messages } from '../src/db/schema.js'
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

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const done = await w.run([a.id], { status: 'succeeded' })
  ;(await w.submit(done.id, a.id, L1)).json() as ArtifactSubmitRes
  const other = await t.seed.group({ createdBy: w.li.id, name: '评审群', memberIds: [w.wang.id] })
  const wang = await t.seed.cookie(w.wang.id)
  const li = await t.seed.cookie(w.li.id)
  const outsider = await t.seed.cookie(w.outsider.id)
  const post = (cookie: string, groupId: string, id = a.id) =>
    t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${id}/post`,
      headers: { cookie },
      payload: { groupId },
    })
  return { ...w, a, other, wang, li, outsider, post }
}

const sharedIn = (groupId: string) =>
  t.db
    .select()
    .from(messages)
    .where(and(eq(messages.groupId, groupId), eq(messages.kind, 'event')))

describe('sharing a work into a group chat', () => {
  it('posts the work card in its own group, by the sharer', async () => {
    const s = await setup()
    const res = await s.post(s.li, s.g.id)
    expect(res.statusCode).toBe(204)
    const [m] = (await sharedIn(s.g.id)).filter((m) => (m.meta as MessageMeta).card)
    expect(m?.body).toBe('李建国 分享了作品「活动报名」')
    const card = (m!.meta as MessageMeta).card as ArtifactCard
    expect(card).toMatchObject({ type: 'artifact', artifactId: s.a.id, title: '活动报名', versionN: 1 })
  })

  it('shares into another group of the team once the work is visible to the team', async () => {
    const s = await setup()
    const hidden = await s.post(s.wang, s.other.id)
    expect(hidden.statusCode).toBe(409)
    expect((await sharedIn(s.other.id)).length).toBe(0)

    await t.db.update(artifacts).set({ visibility: 'team' }).where(eq(artifacts.id, s.a.id))
    expect((await s.post(s.wang, s.other.id)).statusCode).toBe(204)
    const cards = (await sharedIn(s.other.id)).filter((m) => (m.meta as MessageMeta).card)
    expect(cards.length).toBe(1)
    const [home] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(home?.messageId).not.toBe(cards[0]?.id)
  })

  it('refuses groups the sharer is not in and works they cannot open', async () => {
    const s = await setup()
    expect((await s.post(s.wang, s.g2.id)).statusCode).toBe(404)
    expect((await s.post(s.outsider, s.g2.id)).statusCode).toBe(404)
    await t.db.update(artifacts).set({ archivedAt: new Date() }).where(eq(artifacts.id, s.a.id))
    expect((await s.post(s.wang, s.g.id)).statusCode).toBe(409)
  })
})
