import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactSubmitRes, MessageDto, RunDto, TimelineDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, messages, runs } from '../src/db/schema.js'
import { runArtifacts } from '../src/modules/artifacts/service.js'
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
  const a = await w.artifact({ title: '外卖' })
  const b = await w.artifact({ title: '会员卡' })
  const cookie = await t.seed.cookie(w.li.id)
  const send = (payload: object) =>
    t.app.inject({ method: 'POST', url: `/api/groups/${w.g.id}/messages`, headers: { cookie }, payload })
  const meta = async (id: string) =>
    (await t.db.select().from(messages).where(eq(messages.id, id)))[0]!.meta as MessageMeta
  return { ...w, a, b, cookie, send, meta }
}

describe('foreground artifact (plan 原型协作 P1)', () => {
  it('keeps the open artifact as a hint on a message with an @, never as an addressee', async () => {
    const s = await setup()
    const at = (
      await s.send({
        body: '@小王的 Claude 按钮改圆角',
        clientId: 'client-0001',
        foregroundArtifactId: s.a.id,
      })
    ).json() as MessageDto
    expect(await s.meta(at.id)).toMatchObject({ mentions: [s.bot.id], artifactForeground: s.a.id })
    expect((await s.meta(at.id)).artifactRefs).toBeUndefined()

    const plain = (
      await s.send({ body: '按钮改圆角', clientId: 'client-0002', foregroundArtifactId: s.a.id })
    ).json() as MessageDto
    expect(await s.meta(plain.id)).toMatchObject({ mentions: [] })
    expect((await s.meta(plain.id)).artifactForeground).toBeUndefined()
  })

  it('drops a foreground artifact of another group or an archived one, and yields to the canvas context', async () => {
    const s = await setup()
    const elsewhere = await s.artifact({ groupId: s.g2.id })
    const archived = await s.artifact({ archivedAt: new Date() })
    for (const [i, id] of [elsewhere.id, archived.id, 'not-a-uuid'].entries()) {
      const res = await s.send({
        body: '@小王的 Claude 改',
        clientId: `client-100${i}`,
        foregroundArtifactId: id,
      })
      expect(res.statusCode).toBe(200)
      expect((await s.meta((res.json() as MessageDto).id)).artifactForeground).toBeUndefined()
    }
    const prev = await s.run([s.b.id], { status: 'succeeded' })
    await s.submit(prev.id, s.b.id, L1)
    const withCanvas = (
      await s.send({
        body: '@小王的 Claude 改',
        clientId: 'client-2000',
        foregroundArtifactId: s.a.id,
        artifactContext: { artifactId: s.b.id },
      })
    ).json() as MessageDto
    expect(await s.meta(withCanvas.id)).toMatchObject({ artifactRefs: [s.b.id] })
    expect((await s.meta(withCanvas.id)).artifactForeground).toBeUndefined()
  })

  it('checks the foreground artifact out first and names it to the agent', async () => {
    const s = await setup()
    const out = await t.db.transaction((tx) =>
      runArtifacts(tx, s.g.id, s.bot.id, { mentions: [s.bot.id], artifactForeground: s.b.id }, s.wang.id),
    )
    expect(out.refs[0]?.id).toBe(s.b.id)
    expect(out.note).toContain(`用户正在工作台看着产物「会员卡」（${s.b.dir}/）`)
    expect(out.note).not.toContain('只改')
  })
})

describe('run targets', () => {
  it('tells the agent to change only the artifacts the message points at, with their issues only', async () => {
    const s = await setup()
    const prev = await s.run([s.a.id, s.b.id], { status: 'succeeded' })
    const bad = { ...L1, 'screens/home.html': '<p style="color:#f00">x</p>' }
    await s.submit(prev.id, s.a.id, bad)
    await s.submit(prev.id, s.b.id, bad)
    const out = await t.db.transaction((tx) =>
      runArtifacts(tx, s.g.id, s.bot.id, { mentions: [s.bot.id], artifactRefs: [s.b.id] }, s.wang.id),
    )
    expect(out.refs.map((r) => r.id)).toEqual([s.b.id, s.a.id])
    expect(out.note).toContain(`本轮只改产物「会员卡」（${s.b.dir}/）`)
    expect(out.note).toContain(`${s.b.dir}/screens/home.html`)
    expect(out.note).not.toContain(`${s.a.dir}/screens/home.html`)
  })

  it("keeps a run's upload of an artifact it was not pointed at as a candidate, and says so on its card", async () => {
    const s = await setup()
    const prev = await s.run([s.a.id, s.b.id], { status: 'succeeded' })
    const a1 = (await s.submit(prev.id, s.a.id, L1)).json() as ArtifactSubmitRes
    const b1 = (await s.submit(prev.id, s.b.id, L1)).json() as ArtifactSubmitRes
    const live = await s.run([s.a.id, s.b.id])
    await t.db
      .update(messages)
      .set({ meta: { mentions: [s.bot.id], artifactRefs: [s.b.id] } })
      .where(eq(messages.id, live.triggerMessageId as string))
    const changed = { ...L1, 'screens/done.html': '<!doctype html><h1>好了</h1>' }

    const off = (
      await s.submit(live.id, s.a.id, changed, { parent: a1.versionId })
    ).json() as ArtifactSubmitRes
    expect(off).toMatchObject({ head: false, stale: true })
    const [aRow] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(aRow!.headVersionId).toBe(a1.versionId)
    const on = (
      await s.submit(live.id, s.b.id, changed, { parent: b1.versionId })
    ).json() as ArtifactSubmitRes
    expect(on).toMatchObject({ head: true, stale: false })
    // Changes found on the machine before the run are not the run's: they go on as before.
    const local = (
      await s.submit(
        live.id,
        s.a.id,
        { ...L1, 'tokens.css': ':root{}' },
        { parent: a1.versionId, source: 'local' },
      )
    ).json() as ArtifactSubmitRes
    expect(local.head).toBe(true)

    const timeline = (
      await t.app.inject({
        method: 'GET',
        url: `/api/groups/${s.g.id}/timeline`,
        headers: { cookie: s.cookie },
      })
    ).json() as TimelineDto
    const card = timeline.runs.find((r: RunDto) => r.id === live.id)
    expect(card?.artifacts?.find((x) => x.artifactId === s.a.id)).toMatchObject({ candidate: true })
    expect(card?.artifacts?.find((x) => x.artifactId === s.b.id)?.candidate).toBeUndefined()
    const [run] = await t.db.select().from(runs).where(eq(runs.id, live.id))
    expect(run!.artifacts).toEqual([s.a.id, s.b.id])
  })
})
