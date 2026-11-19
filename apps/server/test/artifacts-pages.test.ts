import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ArtifactHistoryItem,
  ArtifactSubmitRes,
  GgArtifactManifest,
  MessageDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, messages, runs } from '../src/db/schema.js'
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
  const prev = await w.run([a.id], { status: 'completed' })
  const v1 = (await w.submit(prev.id, a.id, L1)).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const req = (method: 'GET' | 'POST', url: string, payload?: object, c = cookie) =>
    t.app.inject({ method, url, headers: { cookie: c }, payload })
  const head = async () =>
    (await t.db.select().from(artifacts).where(eq(artifacts.id, a.id)))[0]!.headVersionId!
  const manifest = async () =>
    JSON.parse((await req('GET', `/api/artifacts/${a.id}/files/gg-artifact.json`)).body) as GgArtifactManifest
  return { ...w, a, prev, v1, req, head, manifest }
}

describe('page list (多级分类)', () => {
  it('groups, nests, moves and reorders pages in one op', async () => {
    const s = await setup()
    const groups = [
      { id: 'flow', title: '报名流程' },
      { id: 'result', title: '结果页', parent: 'flow' },
    ]
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/edits`, {
      baseVersionId: s.v1.versionId,
      ops: [{ kind: 'pages', groups, screens: [{ id: 'done', group: 'result' }, { id: 'home' }] }],
    })
    expect(res.statusCode).toBe(200)
    let m = await s.manifest()
    expect(m.groups).toEqual(groups)
    expect(m.screens.map((x) => [x.id, x.group])).toEqual([
      ['done', 'result'],
      ['home', undefined],
    ])

    // Deleting every group puts the pages back at the top level.
    expect(
      (
        await s.req('POST', `/api/artifacts/${s.a.id}/edits`, {
          baseVersionId: await s.head(),
          ops: [{ kind: 'pages', groups: [], screens: [{ id: 'home' }, { id: 'done' }] }],
        })
      ).statusCode,
    ).toBe(200)
    m = await s.manifest()
    expect(m.groups).toBeUndefined()
    expect(m.screens.map((x) => [x.id, x.group])).toEqual([
      ['home', undefined],
      ['done', undefined],
    ])
  })

  it('refuses an unknown group, a cycle, too deep a tree or a different set of pages', async () => {
    const s = await setup()
    const g = (id: string, parent?: string) => ({ id, title: id, ...(parent && { parent }) })
    const chain = (n: number) => Array.from({ length: n }, (_, i) => g(`f${i}`, i ? `f${i - 1}` : undefined))
    const bad = [
      { groups: [], screens: [{ id: 'home', group: 'nope' }, { id: 'done' }] },
      { groups: [g('a', 'b'), g('b', 'a')], screens: [{ id: 'home' }, { id: 'done' }] },
      { groups: chain(8), screens: [{ id: 'home' }, { id: 'done' }] },
      { groups: [], screens: [{ id: 'home' }] },
      { groups: [], screens: [{ id: 'home' }, { id: 'home' }] },
    ]
    for (const op of bad) {
      const res = await s.req('POST', `/api/artifacts/${s.a.id}/edits`, {
        baseVersionId: s.v1.versionId,
        ops: [{ kind: 'pages', ...op }],
      })
      expect([op, res.statusCode]).toEqual([op, 400])
    }
  })

  it('nests folders up to 7 levels, like 墨刀', async () => {
    const s = await setup()
    const groups = Array.from({ length: 7 }, (_, i) => ({
      id: `f${i}`,
      title: `f${i}`,
      ...(i && { parent: `f${i - 1}` }),
    }))
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/edits`, {
      baseVersionId: s.v1.versionId,
      ops: [{ kind: 'pages', groups, screens: [{ id: 'home', group: 'f6' }, { id: 'done' }] }],
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('command history (命令记录)', () => {
  it('lists the commands sent about the artifact with their runs and versions, latest first', async () => {
    const s = await setup()
    const sent = (
      await s.req('POST', `/api/artifacts/${s.a.id}/commands`, {
        command: 'regenerate',
        botId: s.bot.id,
        screenIds: ['home'],
      })
    ).json() as MessageDto
    const [run] = await t.db
      .update(runs)
      .set({ status: 'completed', summary: '首页重做了', artifacts: [s.a.id] })
      .where(eq(runs.triggerMessageId, sent.id))
      .returning()
    const v2 = (
      await s.submit(
        run!.id,
        s.a.id,
        { ...L1, 'screens/done.html': '<h1>好了</h1>' },
        { parent: s.v1.versionId },
      )
    ).json()
    await t.db.insert(messages).values({ groupId: s.g.id, kind: 'user', authorUserId: s.li.id, body: '无关' })

    const res = await s.req('GET', `/api/artifacts/${s.a.id}/history`)
    expect(res.statusCode).toBe(200)
    const items = res.json() as ArtifactHistoryItem[]
    expect(items.map((i) => i.messageId)).toEqual([sent.id, s.prev.triggerMessageId])
    expect(items[0]).toMatchObject({
      authorName: '李建国',
      screens: [{ id: 'home', title: '首页' }],
      runs: [
        {
          id: run!.id,
          botName: '小王的 Claude',
          status: 'completed',
          summary: '首页重做了',
          versions: [{ id: (v2 as ArtifactSubmitRes).versionId, n: 2, candidate: false }],
        },
      ],
    })
    expect(items[1]?.runs[0]?.versions.map((v) => v.n)).toEqual([1])

    // Only the group's members: a visitor of a shared artifact does not read the group's messages.
    await t.db.update(artifacts).set({ visibility: 'all' }).where(eq(artifacts.id, s.a.id))
    const outsider = await t.seed.cookie(s.outsider.id)
    expect((await s.req('GET', `/api/artifacts/${s.a.id}/history`, undefined, outsider)).statusCode).toBe(403)
  })
})
