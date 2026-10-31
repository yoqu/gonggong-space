import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactCard, ArtifactDto, ArtifactSubmitRes, WorkDto, WorkGroupDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, groupMembers, groupPlugins, messages, plugins } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { cardOf } from '../src/modules/artifacts/service.js'
import { BUILTIN_PLUGINS, syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
})
afterEach(() => t.close())

/**
 * 设计群: wang (bot owner, group admin), li (created the artifact) and zhao (a plain member); outsider is in the
 * same team but not in the group.
 */
async function setup() {
  const w = await artifactWorld(t)
  await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
  const [p] = await t.db.select().from(plugins).where(eq(plugins.name, 'web-prototype'))
  const zhao = await t.seed.user({ name: '赵六' })
  await t.db.insert(groupMembers).values({ groupId: w.g.id, userId: zhao.id })
  const a = await w.artifact({ pluginId: p!.id, pluginVersionId: p!.versionId, createdBy: w.li.id })
  const run = await w.run([a.id])
  const v1 = (await w.submit(run.id, a.id, L1)).json() as ArtifactSubmitRes
  const [card] = await t.db
    .insert(messages)
    .values({ groupId: w.g.id, kind: 'event', body: '产物', meta: { card: await cardOf(t.db, a) } })
    .returning()
  await t.db.update(artifacts).set({ messageId: card!.id }).where(eq(artifacts.id, a.id))
  const cookies = {
    wang: await t.seed.cookie(w.wang.id),
    li: await t.seed.cookie(w.li.id),
    zhao: await t.seed.cookie(zhao.id),
    outsider: await t.seed.cookie(w.outsider.id),
  }
  type Who = keyof typeof cookies
  const req = (who: Who, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie: cookies[who] }, payload })
  const setVisibility = (who: Who, visibility: string) =>
    req(who, 'PUT', `/api/artifacts/${a.id}/visibility`, { visibility })
  const works = async (who: Who) => (await req(who, 'GET', '/api/works')).json() as WorkDto[]
  return { ...w, p: p!, zhao, a, v1, card: card!, req, setVisibility, works }
}

describe('artifact visibility', () => {
  it('starts at group: members edit, the rest of the team cannot see it', async () => {
    const s = await setup()
    const mine = (await s.req('zhao', 'GET', `/api/artifacts/${s.a.id}`)).json() as ArtifactDto
    expect(mine).toMatchObject({ visibility: 'group', createdBy: s.li.id, access: 'edit' })
    expect((await s.req('outsider', 'GET', `/api/artifacts/${s.a.id}`)).statusCode).toBe(404)
    expect(await s.works('outsider')).toEqual([])
    expect((await s.works('zhao')).map((x) => [x.title, x.access, x.groupTitle, x.creatorName])).toEqual([
      ['活动报名', 'edit', '设计群', '李建国'],
    ])
  })

  it('team: the rest of the team views and presents, read-only', async () => {
    const s = await setup()
    const res = await s.setVisibility('li', 'team')
    expect(res.statusCode).toBe(200)
    expect((res.json() as ArtifactDto).visibility).toBe('team')

    const seen = (await s.req('outsider', 'GET', `/api/artifacts/${s.a.id}`)).json() as ArtifactDto
    expect(seen).toMatchObject({ visibility: 'team', access: 'view' })
    expect((await s.req('outsider', 'GET', `/api/artifacts/${s.a.id}/versions`)).statusCode).toBe(200)
    expect(
      (await s.req('outsider', 'GET', `/api/artifacts/${s.a.id}/versions/${s.v1.versionId}`)).statusCode,
    ).toBe(200)
    const opened = await s.req('outsider', 'POST', `/api/artifacts/${s.a.id}/preview`, {})
    expect(opened.statusCode).toBe(200)
    const hop = await s.req('outsider', 'GET', (opened.json() as { url: string }).url)
    expect(hop.statusCode).toBe(302)

    const edit = await s.req('outsider', 'POST', `/api/artifacts/${s.a.id}/edits`, {
      baseVersionId: s.v1.versionId,
      ops: [],
    })
    expect(edit.statusCode).toBe(403)
    expect((await s.req('outsider', 'GET', `/api/artifacts/${s.a.id}/annotations`)).statusCode).toBe(403)
    expect((await s.req('outsider', 'GET', `/api/artifacts/${s.a.id}/export.zip`)).statusCode).toBe(403)
    expect((await s.setVisibility('outsider', 'group')).statusCode).toBe(403)
    expect((await s.works('outsider')).map((x) => [x.title, x.access, x.visibility])).toEqual([
      ['活动报名', 'view', 'team'],
    ])
  })

  it('private: only the creator, the bot owner and group admins open it; the card says so', async () => {
    const s = await setup()
    expect((await s.setVisibility('li', 'private')).statusCode).toBe(200)
    expect((await s.req('li', 'GET', `/api/artifacts/${s.a.id}`)).statusCode).toBe(200)
    expect((await s.req('wang', 'GET', `/api/artifacts/${s.a.id}`)).statusCode).toBe(200)
    const denied = await s.req('zhao', 'GET', `/api/artifacts/${s.a.id}`)
    expect(denied.statusCode).toBe(403)
    expect(denied.json().message).toContain('仅创建人可见')
    expect(
      (await s.req('zhao', 'GET', `/api/artifacts/${s.a.id}/versions/${s.v1.versionId}/thumbnail`))
        .statusCode,
    ).toBe(403)
    expect(await s.works('zhao')).toEqual([])
    expect((await s.req('zhao', 'GET', `/api/groups/${s.g.id}/artifacts`)).json()).toEqual([])
    expect(
      ((await s.req('wang', 'GET', `/api/groups/${s.g.id}/artifacts`)).json() as ArtifactDto[]).length,
    ).toBe(1)
    expect((await s.works('outsider')).length).toBe(0)

    const [card] = await t.db.select().from(messages).where(eq(messages.id, s.card.id))
    expect((card!.meta as { card: ArtifactCard }).card).toMatchObject({
      visibility: 'private',
      createdBy: s.li.id,
    })
    const events = await t.db.select().from(messages).where(eq(messages.groupId, s.g.id))
    expect(events.map((m) => m.body)).toContain('李建国 把「活动报名」设为仅创建人可见')
  })

  it('only the creator, the bot owner or a group admin changes it', async () => {
    const s = await setup()
    const res = await s.setVisibility('zhao', 'team')
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toContain('只有创建人、Bot 主人或群管理员能修改可见范围')
    expect((await s.setVisibility('wang', 'team')).statusCode).toBe(200)
    expect((await s.setVisibility('li', 'nobody')).statusCode).toBe(400)
  })
})

describe('works', () => {
  it('lists the groups with a creation plugin on, for 作品 and its 新建', async () => {
    const s = await setup()
    const groups = async (who: 'zhao' | 'outsider') =>
      (await s.req(who, 'GET', '/api/works/groups')).json() as WorkGroupDto[]
    await t.db.insert(groupPlugins).values({ groupId: s.g.id, pluginId: s.p.id, enabled: true })
    expect(await groups('zhao')).toEqual([])
    const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
    await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
    await t.db.delete(groupPlugins)
    expect(await groups('zhao')).toEqual([])
    await t.db.insert(groupPlugins).values({ groupId: s.g.id, pluginId: s.p.id, enabled: true })
    expect(await groups('zhao')).toEqual([{ id: s.g.id, title: '设计群' }])
    expect(await groups('outsider')).toEqual([])
  })

  it('names the plugin and leaves archived artifacts out', async () => {
    const s = await setup()
    const [w] = await s.works('li')
    expect(w).toMatchObject({ pluginTitle: '产品原型', thumbnailUrl: null, visibility: 'group' })
    await t.db.update(artifacts).set({ archivedAt: new Date() }).where(eq(artifacts.id, s.a.id))
    expect(await s.works('li')).toEqual([])
  })
})
