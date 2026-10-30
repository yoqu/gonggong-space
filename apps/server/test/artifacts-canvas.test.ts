import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AnnotationDto,
  ArtifactCard,
  ArtifactDto,
  ArtifactSubmitRes,
  MessageDto,
  RunDto,
  TimelineDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, artifactVersions, messages } from '../src/db/schema.js'
import { runArtifacts } from '../src/modules/artifacts/service.js'
import type { MessageMeta } from '../src/modules/messages/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1, MANIFEST } from './support/artifacts.js'

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
  <h1 class="t">立即报名</h1>
</section>
</body></html>
`
const H1 = String(HOME.indexOf('<h1'))

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const prev = await w.run([a.id], { status: 'succeeded' })
  const v1 = (await w.submit(prev.id, a.id, { ...L1, 'screens/home.html': HOME })).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload })
  const meta = async (id: string) =>
    (await t.db.select().from(messages).where(eq(messages.id, id)))[0]!.meta as MessageMeta
  return { ...w, a, prev, v1, req, meta }
}

describe('message canvas context (G11)', () => {
  it('shows the composer selection on the message', async () => {
    const s = await setup()
    const res = await s.req('POST', `/api/groups/${s.g.id}/messages`, {
      body: '标题再醒目些',
      clientId: 'client-0001',
      artifactContext: {
        artifactId: s.a.id,
        screenIds: ['home', 'gone'],
        elements: [{ file: 'screens/home.html', ggId: H1, label: '标题' }],
      },
    })
    expect(res.statusCode).toBe(200)
    const canvas = {
      artifactId: s.a.id,
      title: '活动报名',
      screens: [
        { id: 'home', title: '首页' },
        { id: 'gone', title: 'gone' },
      ],
      elements: [{ file: 'screens/home.html', ggId: H1, label: '标题' }],
    }
    expect((res.json() as MessageDto).canvas).toEqual(canvas)
    const timeline = (await s.req('GET', `/api/groups/${s.g.id}/timeline`)).json() as TimelineDto
    expect(timeline.messages.at(-1)?.canvas).toEqual(canvas)
  })

  it('posts a menu command as a short sentence and hands the full instruction to the agent only', async () => {
    const s = await setup()
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, {
      command: 'variations',
      botId: s.bot.id,
      screenIds: ['home'],
      ggIds: [{ file: 'screens/home.html', ggId: H1 }],
      count: 2,
      text: '换个布局',
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg.body).toBe('@小王的 Claude 生成 2 个变体：换个布局\n「活动报名」 › 首页 › 立即报名')
    expect(msg.canvas).toEqual({
      artifactId: s.a.id,
      title: '活动报名',
      screens: [{ id: 'home', title: '首页' }],
      elements: [{ file: 'screens/home.html', ggId: H1, label: '立即报名' }],
    })
    const note = (await s.meta(msg.id)).artifactNote ?? ''
    expect(note).toContain('为选中的每个屏幕各出 2 个变体')
    expect(note).toContain(`产物「活动报名」，目录 ${s.a.dir}/，当前版本 v1。`)
    expect(note).toContain('- home（首页，screens/home.html）')
    expect(note).toContain('遵守产品原型插件 SKILL.md 的约定')
    expect(msg.body).not.toContain('gg-artifact.json')

    const en = await t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${s.a.id}/commands`,
      headers: { cookie: await t.seed.cookie(s.li.id), 'accept-language': 'en' },
      payload: { command: 'regenerate', botId: s.bot.id, screenIds: ['home'] },
    })
    expect((en.json() as MessageDto).body).toBe('@小王的 Claude Regenerate\n「活动报名」 › 首页')
  })

  it('posts sent annotations as a short sentence with the list in the agent note', async () => {
    const s = await setup()
    const n = (
      await s.req('POST', `/api/artifacts/${s.a.id}/annotations`, {
        versionId: s.v1.versionId,
        file: 'screens/home.html',
        ggId: H1,
        selector: 'section > h1',
        rect: { x: 1, y: 2, w: 3, h: 4 },
        note: '字大一点',
      })
    ).json() as AnnotationDto
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/annotations/send`, {
      annotationIds: [n.id],
      botId: s.bot.id,
      extra: '整体更活泼',
    })
    const msg = res.json() as MessageDto
    expect(msg.body).toBe('@小王的 Claude 按 1 条批注修改：整体更活泼\n「活动报名」 › 首页 › 字大一点')
    expect(msg.canvas?.elements).toEqual([{ file: 'screens/home.html', ggId: H1, label: '字大一点' }])
    const note = (await s.meta(msg.id)).artifactNote ?? ''
    expect(note).toContain('意见：字大一点')
    expect(note).toContain('补充说明：整体更活泼')
  })
})

describe('run artifacts (G11)', () => {
  it('lists the versions a run made with the screens they changed, on its card and in the timeline', async () => {
    const s = await setup()
    const run = await s.run([s.a.id])
    const seen: WebEvent[] = []
    t.ctx.bus.attach(s.wang.id, (e) => seen.push(e))
    const manifest = JSON.parse(MANIFEST) as { screens: object[] }
    manifest.screens.push({ id: 'new', title: '新屏', file: 'screens/new.html' })
    const v2 = (
      await s.submit(
        run.id,
        s.a.id,
        {
          ...L1,
          'gg-artifact.json': JSON.stringify(manifest),
          'screens/home.html': `${HOME}<!-- v2 -->`,
          'screens/new.html': '<!doctype html><p>新</p>',
        },
        { parent: s.v1.versionId },
      )
    ).json() as ArtifactSubmitRes
    const made = [
      {
        artifactId: s.a.id,
        title: '活动报名',
        versionId: v2.versionId,
        n: 2,
        changedScreens: [
          { id: 'home', title: '首页' },
          { id: 'new', title: '新屏' },
        ],
      },
    ]
    const updated = seen.find((e) => e.t === 'run.updated') as { run: RunDto } | undefined
    expect(updated?.run).toMatchObject({ id: run.id, artifacts: made })
    const timeline = (await s.req('GET', `/api/groups/${s.g.id}/timeline`)).json() as TimelineDto
    expect(timeline.runs.find((r) => r.id === run.id)?.artifacts).toEqual(made)
    // A local version uploaded before the run is not the run's work.
    const local = await s.run([s.a.id])
    await s.submit(local.id, s.a.id, { ...L1, 'x.txt': 'x' }, { parent: v2.versionId, source: 'local' })
    const after = (await s.req('GET', `/api/groups/${s.g.id}/timeline`)).json() as TimelineDto
    expect(after.runs.find((r) => r.id === local.id)?.artifacts).toBeUndefined()
  })
})

describe('artifact menu (G18)', () => {
  const cardMessage = async (s: Awaited<ReturnType<typeof setup>>, artifactId: string) => {
    const [a] = await t.db.select().from(artifacts).where(eq(artifacts.id, artifactId))
    return (await t.db.select().from(messages).where(eq(messages.id, a!.messageId!)))[0]!
  }
  const withCard = async (s: Awaited<ReturnType<typeof setup>>) => {
    const [card] = await t.db
      .insert(messages)
      .values({
        groupId: s.g.id,
        kind: 'event',
        body: '产物「活动报名」',
        meta: { i18n: { key: '产物「{title}」', params: { title: '活动报名' } } },
      })
      .returning()
    await t.db.update(artifacts).set({ messageId: card!.id }).where(eq(artifacts.id, s.a.id))
  }

  it('renames an artifact and its card', async () => {
    const s = await setup()
    await withCard(s)
    const res = await s.req('PATCH', `/api/artifacts/${s.a.id}`, { title: ' 报名小程序 ' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as ArtifactDto).title).toBe('报名小程序')
    const card = await cardMessage(s, s.a.id)
    expect(card.body).toBe('产物「报名小程序」')
    expect((card.meta as MessageMeta).card).toMatchObject({ type: 'artifact', title: '报名小程序' })
    expect((card.meta as MessageMeta).i18n?.params).toEqual({ title: '报名小程序' })
    expect((await s.req('PATCH', `/api/artifacts/${s.a.id}`, { title: '' })).statusCode).toBe(400)
    const outsider = await t.app.inject({
      method: 'PATCH',
      url: `/api/artifacts/${s.a.id}`,
      headers: { cookie: await t.seed.cookie(s.outsider.id) },
      payload: { title: 'x' },
    })
    expect(outsider.statusCode).toBe(404)
  })

  it('duplicates the head as v1 of a new artifact with its own folder and card', async () => {
    const s = await setup()
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/duplicate`)
    expect(res.statusCode).toBe(200)
    const copy = res.json() as ArtifactDto
    expect(copy).toMatchObject({
      groupId: s.g.id,
      title: '活动报名（副本）',
      botId: s.bot.id,
      head: { n: 1, parentVersionId: null, source: 'edit', authorName: '李建国' },
      manifest: JSON.parse(MANIFEST),
    })
    expect(copy.id).not.toBe(s.a.id)
    expect(copy.dir).not.toBe(s.a.dir)
    expect(copy.dir.startsWith(`${s.a.dir}-copy-`)).toBe(true)
    const [orig] = await t.db.select().from(artifactVersions).where(eq(artifactVersions.id, s.v1.versionId))
    const [made] = await t.db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.id, copy.headVersionId!))
    expect(made!.files).toEqual(orig!.files)
    expect(made!.digest).toBe(orig!.digest)
    const file = await s.req('GET', `/api/artifacts/${copy.id}/files/screens/home.html`)
    expect(file.body).toBe(HOME)
    const card = await cardMessage(s, copy.id)
    expect(card).toMatchObject({ kind: 'event', body: '产物「活动报名（副本）」' })
    expect((card.meta as MessageMeta).card as ArtifactCard).toMatchObject({
      artifactId: copy.id,
      versionN: 1,
      status: 'ready',
    })
    const empty = await s.artifact()
    expect((await s.req('POST', `/api/artifacts/${empty.id}/duplicate`)).statusCode).toBe(404)
  })

  it('drops an archived artifact from the list and from what runs check out', async () => {
    const s = await setup()
    expect((await s.req('POST', `/api/artifacts/${s.a.id}/archive`)).statusCode).toBe(200)
    const list = (await s.req('GET', `/api/groups/${s.g.id}/artifacts`)).json() as ArtifactDto[]
    expect(list.map((x) => x.id)).not.toContain(s.a.id)
    const picked = await t.db.transaction((tx) =>
      runArtifacts(tx, s.g.id, s.bot.id, { artifactRefs: [s.a.id] }),
    )
    expect(picked.refs).toEqual([])
    expect(picked.exclude).toContain(s.a.dir)
    expect((await s.req('GET', `/api/artifacts/${s.a.id}`)).statusCode).toBe(200)
  })
})
