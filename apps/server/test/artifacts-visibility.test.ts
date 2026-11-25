import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactCard, ArtifactDto, ArtifactSubmitRes, WorkDto, WorkGroupDto } from '@gonggong/protocol'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, groupMembers, installs, messages, plugins } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { cardOf } from '../src/modules/artifacts/service.js'
import { openSite } from '../src/modules/artifacts/sites.js'
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
  const req = (
    who: Who,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: object,
    extra: Record<string, string> = {},
  ) => t.app.inject({ method, url, headers: { cookie: cookies[who], ...extra }, payload })
  const setVisibility = (who: Who, visibility: string) =>
    req(who, 'PUT', `/api/artifacts/${a.id}/visibility`, { visibility })
  const works = async (who: Who, teamId?: string) =>
    (
      await req(who, 'GET', '/api/works', undefined, teamId ? { 'x-gg-team': teamId } : {})
    ).json() as WorkDto[]
  return { ...w, p: p!, zhao, a, v1, card: card!, req, setVisibility, works }
}

describe('artifact visibility', () => {
  it('starts at group: members edit, the rest of the team cannot see it', async () => {
    const s = await setup()
    const mine = (await s.req('zhao', 'GET', `/api/artifacts/${s.a.id}`)).json() as ArtifactDto
    expect(mine).toMatchObject({
      visibility: 'group',
      createdBy: s.li.id,
      access: 'edit',
      teamId: s.g.teamId,
    })
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
    expect(seen).toMatchObject({ visibility: 'team', access: 'view', teamId: s.g.teamId })
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

  it('rejects all visibility and isolates team-visible artifacts from other teams and teamless users', async () => {
    const s = await setup()
    expect((await s.setVisibility('li', 'all')).statusCode).toBe(400)
    await s.setVisibility('li', 'team')

    const otherOwner = await t.seed.user({ name: '他队成员', teamId: null })
    const otherTeam = await t.seed.team({ ownerId: otherOwner.id, name: '其他团队' })
    const otherCookie = await t.seed.cookie(otherOwner.id)
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/artifacts/${s.a.id}`,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/works',
          headers: { cookie: otherCookie, 'x-gg-team': otherTeam.id },
        })
      ).json(),
    ).toEqual([])

    const teamless = await t.seed.user({ name: '无团队', teamId: null })
    const teamlessCookie = await t.seed.cookie(teamless.id)
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/artifacts/${s.a.id}`,
          headers: { cookie: teamlessCookie },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/works', headers: { cookie: teamlessCookie } }))
        .statusCode,
    ).toBe(403)
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/works/groups', headers: { cookie: teamlessCookie } }))
        .statusCode,
    ).toBe(403)
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
    const on = {
      listingId: s.p.id,
      scope: 'group',
      scopeId: s.g.id,
      resolvedVersionId: s.p.versionId!,
      enabled: true,
    }
    await t.db.insert(installs).values(on)
    expect(await groups('zhao')).toEqual([])
    const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
    await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
    await t.db.delete(installs)
    expect(await groups('zhao')).toEqual([])
    await t.db.insert(installs).values(on)
    expect(await groups('zhao')).toEqual([{ id: s.g.id, title: '设计群', kind: 'group' }])
    expect(await groups('outsider')).toEqual([])
  })

  it('offers private chats with bots for 新建, where creation plugins are on without a group', async () => {
    const s = await setup()
    const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
    await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
    const dm = await t.seed.group({ createdBy: s.g.createdBy, kind: 'dm', name: '私聊', botIds: [s.bot.id] })
    const listed = (await s.req('wang', 'GET', '/api/works/groups')).json() as WorkGroupDto[]
    expect(listed).toEqual([{ id: dm.id, title: '小王的 Claude', kind: 'dm' }])
  })

  it('names the plugin and leaves archived artifacts out', async () => {
    const s = await setup()
    const [w] = await s.works('li')
    expect(w).toMatchObject({
      pluginTitle: '产品原型',
      thumbnailUrl: null,
      visibility: 'group',
      groupKind: 'group',
      groupVisibility: 'private',
    })
    await t.db.update(artifacts).set({ archivedAt: new Date() }).where(eq(artifacts.id, s.a.id))
    expect(await s.works('li')).toEqual([])
  })

  it('scopes GET /api/works and GET /api/works/groups to X-GG-Team', async () => {
    const s = await setup()
    const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
    await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
    const teamB = await t.seed.team({ ownerId: s.wang.id, name: '团队B', memberIds: [s.li.id] })
    const botB = await t.seed.bot({
      ownerId: s.wang.id,
      teamId: teamB.id,
      name: 'B团队Bot',
      machineId: s.A.machine.id,
    })
    const gB = await t.seed.group({
      createdBy: s.wang.id,
      teamId: teamB.id,
      name: 'B团队设计群',
      memberIds: [s.li.id],
      botIds: [botB.id],
    })
    await s.artifact({ groupId: gB.id, title: 'B团队原型', botId: botB.id, createdBy: s.li.id })
    await t.db.insert(installs).values([
      {
        listingId: s.p.id,
        scope: 'group',
        scopeId: s.g.id,
        resolvedVersionId: s.p.versionId!,
        enabled: true,
      },
      {
        listingId: s.p.id,
        scope: 'group',
        scopeId: gB.id,
        resolvedVersionId: s.p.versionId!,
        enabled: true,
      },
    ])

    expect((await s.works('li', s.g.teamId)).map((x) => x.title)).toEqual(['活动报名'])
    expect((await s.works('li', teamB.id)).map((x) => x.title)).toEqual(['B团队原型'])

    const groupsIn = async (teamId: string) =>
      (
        await s.req('li', 'GET', '/api/works/groups', undefined, { 'x-gg-team': teamId })
      ).json() as WorkGroupDto[]
    expect(await groupsIn(s.g.teamId)).toEqual([{ id: s.g.id, title: '设计群', kind: 'group' }])
    expect(await groupsIn(teamB.id)).toEqual([{ id: gB.id, title: 'B团队设计群', kind: 'group' }])
  })

  it('defaults DM sites to private, masks DM groupTitle from other team members, and exposes group metadata', async () => {
    const s = await setup()
    const pub = await t.seed.group({
      createdBy: s.wang.id,
      name: '公开设计群',
      visibility: 'public',
      botIds: [s.bot.id],
    })
    await s.artifact({ groupId: pub.id, title: '公开原型', visibility: 'team', createdBy: s.wang.id })

    const dm = await t.seed.group({
      createdBy: s.wang.id,
      kind: 'dm',
      name: '王磊的秘密私聊名',
      botIds: [s.bot.id],
    })
    const dmSite = await openSite(t.ctx, {
      groupId: dm.id,
      botId: s.bot.id,
      siteDir: 'dist',
      title: '我的小工具',
      userId: s.wang.id,
      threadRootId: null,
    })
    expect(dmSite.visibility).toBe('private')

    // Outsider cannot see private DM site yet.
    expect((await s.works('outsider')).map((x) => x.title)).toEqual(['公开原型'])

    // Share DM site with team: owner still sees dynamic DM title; outsider sees groupTitle masked.
    expect(
      (await s.req('wang', 'PUT', `/api/artifacts/${dmSite.id}/visibility`, { visibility: 'team' }))
        .statusCode,
    ).toBe(200)
    const ownerDm = (await s.works('wang')).find((x) => x.id === dmSite.id)
    expect(ownerDm).toMatchObject({
      title: '我的小工具',
      groupKind: 'dm',
      groupTitle: '小王的 Claude',
      access: 'edit',
    })
    const outsiderList = await s.works('outsider')
    expect(outsiderList.find((x) => x.id === dmSite.id)).toMatchObject({
      title: '我的小工具',
      groupKind: 'dm',
      groupVisibility: 'private',
      groupTitle: '',
      creatorName: '王磊',
      access: 'view',
    })
    expect(outsiderList.find((x) => x.title === '公开原型')).toMatchObject({
      groupKind: 'group',
      groupVisibility: 'public',
      groupTitle: '公开设计群',
      access: 'view',
    })
  })

  it('0119 migration downgrades legacy all visibility on artifacts and message cards to team', async () => {
    const s = await setup()
    await t.db.update(artifacts).set({ visibility: 'all' }).where(eq(artifacts.id, s.a.id))
    await t.db
      .update(messages)
      .set({
        meta: { card: { ...(s.card.meta as { card: ArtifactCard }).card, visibility: 'all' as never } },
      })
      .where(eq(messages.id, s.card.id))

    const migration = readFileSync(
      new URL('../drizzle/0119_artifact_visibility_team.sql', import.meta.url),
      'utf8',
    )
    for (const stmt of migration.split('--> statement-breakpoint'))
      if (stmt.trim()) await t.db.execute(sql.raw(stmt))

    const [a] = await t.db.select().from(artifacts).where(eq(artifacts.id, s.a.id))
    expect(a?.visibility).toBe('team')
    const [m] = await t.db.select().from(messages).where(eq(messages.id, s.card.id))
    expect((m?.meta as { card?: ArtifactCard } | undefined)?.card?.visibility).toBe('team')
  })
})
