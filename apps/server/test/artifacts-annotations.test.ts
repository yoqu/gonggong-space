import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnnotationDto, ArtifactSubmitRes, MessageDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifactAnnotations, messages, runs } from '../src/db/schema.js'
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
</section>
<script>document.body.append(document.createElement('div'))</script>
</body></html>
`
const H1 = String(HOME.indexOf('<h1'))

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const prev = await w.run([a.id], { status: 'succeeded' })
  const v1 = (await w.submit(prev.id, a.id, { ...L1, 'screens/home.html': HOME })).json() as ArtifactSubmitRes
  const li = await t.seed.cookie(w.li.id)
  const wang = await t.seed.cookie(w.wang.id)
  const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie = li, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  const annotate = (
    o: Partial<{ ggId: string | null; note: string; versionId: string; file: string }> = {},
  ) =>
    req('POST', `/api/artifacts/${a.id}/annotations`, li, {
      versionId: v1.versionId,
      file: 'screens/home.html',
      ggId: H1,
      selector: 'section > h1',
      rect: { x: 1, y: 2, w: 3, h: 4 },
      snippet: '<h1 class="t">报名</h1>',
      note: '字大一点',
      ...o,
    })
  const trigger = async (messageId: string) =>
    t.db.select().from(runs).where(eq(runs.triggerMessageId, messageId))
  return { ...w, a, v1, li: w.li, liCookie: li, wangCookie: wang, req, annotate, trigger }
}

describe('annotations', () => {
  it('are created, listed by version, edited by their author and resolved by anyone', async () => {
    const s = await setup()
    const made = await s.annotate()
    expect(made.statusCode).toBe(200)
    const n = made.json() as AnnotationDto
    expect(n).toMatchObject({ authorId: s.li.id, authorName: '李建国', status: 'open', ggId: H1 })
    const list = await s.req('GET', `/api/artifacts/${s.a.id}/annotations?version=${s.v1.versionId}`)
    expect((list.json() as AnnotationDto[]).map((x) => x.id)).toEqual([n.id])

    expect((await s.req('PATCH', `/api/annotations/${n.id}`, s.wangCookie, { note: '改' })).statusCode).toBe(
      403,
    )
    const resolved = await s.req('PATCH', `/api/annotations/${n.id}`, s.wangCookie, { status: 'resolved' })
    expect((resolved.json() as AnnotationDto).status).toBe('resolved')
    const noted = await s.req('PATCH', `/api/annotations/${n.id}`, s.liCookie, { note: '再大一点' })
    expect((noted.json() as AnnotationDto).note).toBe('再大一点')

    expect((await s.req('DELETE', `/api/annotations/${n.id}`, s.wangCookie)).statusCode).toBe(403)
    expect((await s.req('DELETE', `/api/annotations/${n.id}`)).statusCode).toBe(204)
    expect((await s.req('GET', `/api/artifacts/${s.a.id}/annotations`)).json()).toEqual([])
  })

  it('refuse files outside the version, and outsiders', async () => {
    const s = await setup()
    expect((await s.annotate({ file: 'screens/nope.html' })).statusCode).toBe(400)
    expect((await s.annotate({ file: '../x.html' })).statusCode).toBe(400)
    const n = (await s.annotate()).json() as AnnotationDto
    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await s.req('GET', `/api/artifacts/${s.a.id}/annotations`, outsider)).statusCode).toBe(404)
    expect(
      (await s.req('PATCH', `/api/annotations/${n.id}`, outsider, { status: 'resolved' })).statusCode,
    ).toBe(404)
  })

  it('are sent to the bot as an @ message from the member with their place in the source', async () => {
    const s = await setup()
    const one = (await s.annotate()).json() as AnnotationDto
    const two = (
      await s.annotate({ ggId: null, note: '这个浮层去掉', file: 'screens/home.html' })
    ).json() as AnnotationDto
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/annotations/send`, s.liCookie, {
      annotationIds: [one.id, two.id],
      botId: s.bot.id,
      extra: '整体更活泼',
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg).toMatchObject({ authorId: s.li.id, mentions: [s.bot.id] })
    expect(msg.body).toContain(
      `@小王的 Claude 请按以下批注修改产物「活动报名」（目录 ${s.a.dir}/，当前版本 v1）`,
    )
    expect(msg.body).toContain(
      '1. screens/home.html 第 4 行（区块 data-section="hero"）：<h1 class="t">报名</h1>',
    )
    expect(msg.body).toContain('选择器：section > h1')
    expect(msg.body).toContain('意见：字大一点')
    expect(msg.body).toContain('2. screens/home.html（脚本生成的元素，源码里没有对应位置）')
    expect(msg.body).toContain('补充说明：整体更活泼')
    const [row] = await t.db.select().from(messages).where(eq(messages.id, msg.id))
    expect(row!.meta).toMatchObject({ artifactRefs: [s.a.id], mentions: [s.bot.id] })
    expect(await s.trigger(msg.id)).toHaveLength(1)
    const after = await t.db
      .select()
      .from(artifactAnnotations)
      .where(eq(artifactAnnotations.artifactId, s.a.id))
    expect(after.map((n) => [n.status, n.sentMessageId])).toEqual([
      ['sent', msg.id],
      ['sent', msg.id],
    ])
  })

  it("refuse to send other artifacts' annotations or to a bot outside the group", async () => {
    const s = await setup()
    const other = await s.artifact()
    const n = (await s.annotate()).json() as AnnotationDto
    const send = (artifactId: string, botId: string) =>
      s.req('POST', `/api/artifacts/${artifactId}/annotations/send`, s.liCookie, {
        annotationIds: [n.id],
        botId,
      })
    expect((await send(other.id, s.bot.id)).statusCode).toBe(404)
    expect((await send(s.a.id, s.other.id)).statusCode).toBe(400)
  })
})

describe('AI commands', () => {
  it('post the command with the selected screens and elements as context', async () => {
    const s = await setup()
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, s.liCookie, {
      command: 'variations',
      botId: s.bot.id,
      screenIds: ['home'],
      count: 2,
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg.body).toMatch(/^@小王的 Claude 为选中的每个屏幕各出 2 个变体/)
    expect(msg.body).toContain('gg-artifact.json')
    expect(msg.body).toContain(`产物「活动报名」，目录 ${s.a.dir}/，当前版本 v1。`)
    expect(msg.body).toContain('- home（首页，screens/home.html）')
    expect(await s.trigger(msg.id)).toHaveLength(1)

    const edit = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, s.liCookie, {
      command: 'edit-with-ai',
      botId: s.bot.id,
      ggIds: [{ file: 'screens/home.html', ggId: H1 }],
      text: '改成渐变标题',
    })
    const body = (edit.json() as MessageDto).body
    expect(body).toContain('只修改下面选中的元素，要求：改成渐变标题')
    expect(body).toContain('- screens/home.html 第 4 行（区块 data-section="hero"）：<h1 class="t">报名</h1>')

    const brief = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, s.liCookie, {
      command: 'project-brief',
      botId: s.bot.id,
    })
    expect((brief.json() as MessageDto).body).toContain(`${s.a.dir}/brief.md`)
    const missing = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, s.liCookie, {
      command: 'edit-with-ai',
      botId: s.bot.id,
    })
    expect(missing.statusCode).toBe(400)
  })
})

describe('composer context', () => {
  it('refers the message to the artifact and keeps the selection for the agent', async () => {
    const s = await setup()
    const res = await s.req('POST', `/api/groups/${s.g.id}/messages`, s.liCookie, {
      body: '@小王的 Claude 标题再醒目些',
      clientId: 'client-0001',
      artifactContext: {
        artifactId: s.a.id,
        screenIds: ['home'],
        elements: [{ file: 'screens/home.html', ggId: H1, label: '标题' }],
      },
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg.body).toBe('@小王的 Claude 标题再醒目些')
    const [row] = await t.db.select().from(messages).where(eq(messages.id, msg.id))
    const meta = row!.meta as { artifactRefs: string[]; artifactNote: string }
    expect(meta.artifactRefs).toEqual([s.a.id])
    expect(meta.artifactNote).toContain('[画布上下文')
    expect(meta.artifactNote).toContain('- home（首页，screens/home.html）')
    expect(meta.artifactNote).toContain(
      '- screens/home.html 第 4 行（区块 data-section="hero"）：<h1 class="t">报名</h1>（标题）',
    )

    const other = await s.artifact({ groupId: s.g2.id })
    const foreign = await s.req('POST', `/api/groups/${s.g.id}/messages`, s.liCookie, {
      body: 'x',
      clientId: 'client-0002',
      artifactContext: { artifactId: other.id },
    })
    expect(foreign.statusCode).toBe(404)
  })
})
