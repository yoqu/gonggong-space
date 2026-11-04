import {
  type GroupPluginDto,
  type InheritedSkillDto,
  type InstallDto,
  type ListingSummary,
  type PluginDto,
  repoKey,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, groupRepos, installs, plugins, repos, teamMembers } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { runPlugins } from '../src/modules/plugins/service.js'
import { enabledSkills, setInherited } from '../src/modules/skills/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const md = (name: string, body = 'Do it.') =>
  `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}\n`
const skill = (name: string, body?: string) => [{ path: 'SKILL.md', content: md(name, body) }]

const pluginFiles = (name: string, o: Record<string, unknown> = {}) => [
  {
    path: 'gonggong-plugin.json',
    content: JSON.stringify({
      name,
      version: '1.0.0',
      title: `插件 ${name}`,
      description: `${name} plugin`,
      category: 'web',
      agents: ['claude'],
      minDaemon: '0.5.0',
      entry: name,
      ...o,
    }),
  },
  { path: `skills/${name}/SKILL.md`, content: md(name) },
]

const URL = 'https://github.com/acme/app.git'

/**
 * Team A: bob (team admin), eve (admin of group A, bound to repo acme/app), mia (plain member of group A); group A2
 * has no repo. Team B: carol, group B. root is a teamless sysadmin.
 */
async function world() {
  const bob = await t.seed.user({ name: '鲍勃' })
  const eve = await t.seed.user({ name: '伊芙' })
  const mia = await t.seed.user({ name: '米娅' })
  const carol = await t.seed.user({ name: '卡罗尔', teamId: null })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
  const teamB = await t.seed.team({ ownerId: carol.id, name: '团队B' })
  const groupA = await t.seed.group({ createdBy: eve.id, name: 'A 群', memberIds: [mia.id] })
  const groupA2 = await t.seed.group({ createdBy: eve.id, name: 'A2 群' })
  const groupB = await t.seed.group({ createdBy: carol.id, name: 'B 群', teamId: teamB.id })
  const teamA = groupA.teamId
  await t.db.insert(groupRepos).values({ groupId: groupA.id, url: URL, baseBranch: 'main' })
  const [repo] = await t.db
    .insert(repos)
    .values({ teamId: teamA, key: repoKey(URL)!, url: URL, name: 'app' })
    .returning()
  const [repoB] = await t.db
    .insert(repos)
    .values({ teamId: teamB.id, key: repoKey(URL)!, url: URL, name: 'app' })
    .returning()
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  const api = { root: await as(root), bob: await as(bob), eve: await as(eve), mia: await as(mia) }
  const paths = {
    group: `/api/groups/${groupA.id}`,
    team: `/api/teams/${teamA}`,
    repo: `/api/teams/${teamA}/repos/${repo!.id}`,
  }
  return {
    bob,
    eve,
    mia,
    carol,
    root,
    teamA,
    teamB,
    groupA,
    groupA2,
    groupB,
    repo: repo!,
    repoB: repoB!,
    as,
    api,
    paths,
  }
}
type World = Awaited<ReturnType<typeof world>>
type Api = World['api']['root']

/** A skill listing uploaded to a layer's plugin endpoint. */
async function listing(api: Api, base: string, name: string, body?: string) {
  const res = await api.post<ListingSummary>(`${base}/plugins`, { files: skill(name, body) })
  expect(res.status).toBeLessThan(300)
  return res.body
}

const install = (api: Api, path: string, id: string, body: object = { enabled: true }) =>
  api.put<InstallDto>(`${path}/installs/${id}`, body)

const effective = async (groupId: string) =>
  Object.fromEntries((await enabledSkills(t.db, groupId)).map((s) => [s.name, s.versionId]))

describe('skill listings', () => {
  it('stores a bare SKILL.md folder as a skill listing, kept out of the plugin lists', async () => {
    const w = await world()
    const made = await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: skill('review') })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({
      type: 'skill',
      name: 'review',
      title: 'review',
      description: 'review helper',
      layer: 'platform',
      status: 'listed',
      revision: 1,
    })
    const same = await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: skill('review') })
    expect(same.status).toBe(200)
    expect(same.body).toMatchObject({ id: made.body.id, revision: 1 })
    const next = await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: skill('review', 'v2') })
    expect(next.body).toMatchObject({ id: made.body.id, revision: 2 })
    expect((await w.api.root.post('/api/admin/plugins', { files: skill('Bad Name') })).body).toMatchObject({
      error: 'invalid',
    })
    expect((await w.api.root.get<PluginDto[]>('/api/admin/plugins')).body).toEqual([])
    const [row] = await t.db.select().from(plugins)
    expect(row).toMatchObject({ type: 'skill', authorId: w.root.id })
  })

  it('takes plugins without a license', async () => {
    const w = await world()
    const made = await w.api.root.post<PluginDto>('/api/admin/plugins', { files: pluginFiles('deck') })
    expect(made.status).toBe(201)
    expect(made.body.manifest.license).toBeUndefined()
  })

  it('refuses a skill listing named like a plugin of the same layer', async () => {
    const w = await world()
    await w.api.root.post('/api/admin/plugins', { files: pluginFiles('deck') })
    expect((await w.api.root.post('/api/admin/plugins', { files: skill('deck') })).status).toBe(409)
  })
})

describe('installs', () => {
  it('lets members read and admins change each scope', async () => {
    const w = await world()
    const l = await listing(w.api.root, '/api/admin', 'wiki')
    const { group, team, repo } = w.paths
    expect((await w.api.mia.get<InstallDto[]>(`${group}/installs`)).body).toEqual([])
    expect((await install(w.api.mia, group, l.id)).status).toBe(403)
    const made = await install(w.api.eve, group, l.id)
    expect(made.status).toBe(200)
    expect(made.body).toMatchObject({
      listing: { id: l.id, type: 'skill', name: 'wiki', layer: 'platform', versionId: l.versionId },
      scope: 'group',
      enabled: true,
      pinVersionId: null,
      resolvedVersionId: l.versionId,
      resolvedRevision: 1,
      updatedBy: '伊芙',
    })
    expect((await w.api.mia.get<InstallDto[]>(`${group}/installs`)).body.map((i) => i.listing.id)).toEqual([
      l.id,
    ])

    for (const path of [team, repo]) {
      expect((await w.api.eve.get(`${path}/installs`)).status).toBe(403)
      expect((await install(w.api.eve, path, l.id)).status).toBe(403)
      expect((await install(w.api.bob, path, l.id, { enabled: false })).body).toMatchObject({
        enabled: false,
      })
      expect((await w.api.bob.get<InstallDto[]>(`${path}/installs`)).body).toHaveLength(1)
    }
    expect((await w.api.bob.get(`${team}/repos/${w.repoB.id}/installs`)).status).toBe(404)

    expect((await w.api.mia.del(`${group}/installs/${l.id}`)).status).toBe(403)
    expect((await w.api.eve.del(`${group}/installs/${l.id}`)).status).toBe(204)
    expect((await w.api.eve.del(`${group}/installs/${l.id}`)).status).toBe(404)
    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, w.eve.id))
    expect(log.map((r) => r.action)).toEqual(['install.put', 'install.delete'])
  })

  it('offers the platform, team and group listings visible to a scope, listed and not yet installed', async () => {
    const w = await world()
    const platform = await listing(w.api.root, '/api/admin', 'wiki')
    const team = await listing(w.api.bob, `/api/teams/${w.teamA}`, 'lint')
    await saveSysParams(t.ctx, { pluginsEnabled: true }, w.root.id)
    const own = await listing(w.api.eve, w.paths.group, 'docs')
    const carol = await w.as(w.carol)
    const other = await listing(carol, `/api/teams/${w.teamB.id}`, 'secret')
    const hidden = await listing(w.api.root, '/api/admin', 'old')
    await t.db.update(plugins).set({ status: 'unlisted' }).where(eq(plugins.id, hidden.id))

    const ids = async (api: Api, path: string) =>
      (await api.get<ListingSummary[]>(`${path}/installable`)).body.map((l) => l.name)
    expect(await ids(w.api.mia, w.paths.group)).toEqual(['docs', 'lint', 'wiki'])
    expect(await ids(w.api.bob, w.paths.team)).toEqual(['lint', 'wiki'])
    expect(await ids(w.api.bob, w.paths.repo)).toEqual(['lint', 'wiki'])
    await install(w.api.eve, w.paths.group, team.id)
    expect(await ids(w.api.mia, w.paths.group)).toEqual(['docs', 'wiki'])

    expect((await install(w.api.eve, w.paths.group, other.id)).status).toBe(404)
    expect((await install(w.api.bob, w.paths.team, own.id)).status).toBe(404)
    expect((await install(w.api.eve, w.paths.group, hidden.id)).status).toBe(409)
    expect((await install(w.api.eve, w.paths.group, platform.id)).status).toBe(200)
  })
})

describe('skill merge', () => {
  it('delivers group over repo over team over platform', async () => {
    const w = await world()
    const manual = (
      await w.api.root.post<{ versionId: string }>('/api/admin/skills', { files: skill('wiki', 'manual') })
    ).body
    const lp = await listing(w.api.root, '/api/admin', 'wiki', 'platform listing')
    const lt = await listing(w.api.bob, `/api/teams/${w.teamA}`, 'wiki', 'team listing')
    await saveSysParams(t.ctx, { pluginsEnabled: true }, w.root.id)
    const lg = await listing(w.api.eve, w.paths.group, 'wiki', 'group listing')

    await install(w.api.bob, w.paths.team, lp.id)
    await install(w.api.bob, w.paths.repo, lt.id)
    await install(w.api.eve, w.paths.group, lg.id)
    expect(await effective(w.groupA.id)).toEqual({ wiki: lg.versionId })
    expect(await effective(w.groupA2.id)).toEqual({ wiki: lp.versionId })
    expect(await effective(w.groupB.id)).toEqual({ wiki: manual.versionId })

    await install(w.api.eve, w.paths.group, lg.id, { enabled: false })
    expect(await effective(w.groupA.id)).toEqual({ wiki: lt.versionId })
    await w.api.bob.del(`${w.paths.repo}/installs/${lt.id}`)
    expect(await effective(w.groupA.id)).toEqual({ wiki: lp.versionId })
    await w.api.bob.del(`${w.paths.team}/installs/${lp.id}`)
    expect(await effective(w.groupA.id)).toEqual({ wiki: manual.versionId })
  })

  it('refuses a same-named skill within one scope, both ways', async () => {
    const w = await world()
    const lp = await listing(w.api.root, '/api/admin', 'wiki')
    const lt = await listing(w.api.bob, `/api/teams/${w.teamA}`, 'wiki')
    const docs = await listing(w.api.root, '/api/admin', 'docs')
    const lint = await listing(w.api.root, '/api/admin', 'lint')
    const { group, team, repo } = w.paths

    expect((await install(w.api.eve, group, lp.id)).status).toBe(200)
    expect((await install(w.api.eve, group, lt.id)).body).toMatchObject({ error: 'conflict' })
    expect((await install(w.api.eve, group, lp.id, { enabled: false })).status).toBe(200)
    expect((await install(w.api.bob, team, lt.id)).status).toBe(200)
    expect((await install(w.api.bob, repo, lp.id)).status).toBe(200)
    expect((await install(w.api.bob, repo, lt.id)).status).toBe(409)

    await w.api.eve.post(`${group}/skills`, { files: skill('docs') })
    expect((await install(w.api.eve, group, docs.id)).status).toBe(409)
    expect((await install(w.api.bob, repo, docs.id)).status).toBe(200)
    await w.api.bob.post(`${team}/skills`, { files: skill('lint') })
    expect((await install(w.api.bob, team, lint.id)).status).toBe(409)

    expect((await w.api.eve.post(`${group}/skills`, { files: skill('wiki') })).body).toMatchObject({
      error: 'conflict',
    })
    const own = await w.api.eve.post<{ id: string }>(`${group}/skills`, { files: skill('other') })
    expect((await w.api.eve.patch(`${group}/skills/${own.body.id}`, { files: skill('wiki') })).status).toBe(
      409,
    )
    expect((await w.api.bob.post(`${team}/skills`, { files: skill('wiki') })).status).toBe(409)
    expect((await w.api.root.post('/api/admin/skills', { files: skill('wiki') })).status).toBe(201)
  })

  it('follows new uploads unless pinned', async () => {
    const w = await world()
    const v1 = await listing(w.api.root, '/api/admin', 'wiki', 'one')
    await install(w.api.eve, w.paths.group, v1.id)
    const pinned = await install(w.api.bob, w.paths.team, v1.id, {
      enabled: true,
      pinVersionId: v1.versionId,
    })
    expect(pinned.body).toMatchObject({ pinVersionId: v1.versionId, resolvedVersionId: v1.versionId })
    const v2 = await listing(w.api.root, '/api/admin', 'wiki', 'two')
    expect(v2.revision).toBe(2)

    const one = async (api: Api, path: string) => (await api.get<InstallDto[]>(`${path}/installs`)).body[0]!
    expect(await one(w.api.mia, w.paths.group)).toMatchObject({
      listing: { versionId: v2.versionId, revision: 2 },
      pinVersionId: null,
      resolvedVersionId: v2.versionId,
      resolvedRevision: 2,
    })
    expect(await one(w.api.bob, w.paths.team)).toMatchObject({
      resolvedVersionId: v1.versionId,
      resolvedRevision: 1,
    })
    expect(await effective(w.groupA.id)).toEqual({ wiki: v2.versionId })
    expect(await effective(w.groupA2.id)).toEqual({ wiki: v1.versionId })

    const other = await listing(w.api.root, '/api/admin', 'lint')
    expect(
      (await install(w.api.eve, w.paths.group, v1.id, { enabled: true, pinVersionId: other.versionId }))
        .status,
    ).toBe(404)
    await install(w.api.eve, w.paths.group, v1.id, { enabled: true, pinVersionId: v1.versionId })
    expect(await effective(w.groupA.id)).toEqual({ wiki: v1.versionId })
    await install(w.api.eve, w.paths.group, v1.id, { enabled: true, pinVersionId: null })
    expect(await effective(w.groupA.id)).toEqual({ wiki: v2.versionId })
  })

  it('keeps delivering unlisted listings and stops banned ones', async () => {
    const w = await world()
    const l = await listing(w.api.root, '/api/admin', 'wiki')
    await install(w.api.eve, w.paths.group, l.id)
    const status = (s: string) => t.db.update(plugins).set({ status: s }).where(eq(plugins.id, l.id))
    await status('unlisted')
    expect(await effective(w.groupA.id)).toEqual({ wiki: l.versionId })
    expect((await install(w.api.eve, w.paths.group, l.id, { enabled: true })).status).toBe(200)
    expect((await install(w.api.bob, w.paths.team, l.id)).status).toBe(409)
    await status('banned')
    expect(await effective(w.groupA.id)).toEqual({})
  })

  it('lets a group turn an inherited skill listing off for itself', async () => {
    const w = await world()
    const wiki = await listing(w.api.root, '/api/admin', 'wiki')
    const docs = await listing(w.api.root, '/api/admin', 'docs')
    await install(w.api.bob, w.paths.repo, wiki.id)
    await install(w.api.eve, w.paths.group, docs.id)
    const url = `${w.paths.group}/inherited-skills`
    const listed = async () =>
      (await w.api.mia.get<InheritedSkillDto[]>(url)).body.map((s) => [s.name, s.scope, s.enabledInGroup])
    expect(await listed()).toEqual([['wiki', 'team', true]])
    expect((await w.api.eve.put(`${url}/wiki`, { enabled: false })).status).toBe(200)
    expect(await listed()).toEqual([['wiki', 'team', false]])
    await setInherited(t.ctx, w.groupA.id, 'docs', false, w.eve.id)
    expect(await effective(w.groupA.id)).toEqual({ docs: docs.versionId })
  })
})

describe('skill listings for the daemon', () => {
  it('serves an installed version to machines hosting a group it applies to', async () => {
    const w = await world()
    const { machine, token } = await t.seed.machine(w.eve.id)
    const bot = await t.seed.bot({ ownerId: w.eve.id, machineId: machine.id, binding: 'bound' })
    await t.db.insert(groupBots).values({ groupId: w.groupA.id, botId: bot.id })
    const idle = await t.seed.machine(w.eve.id)
    const v1 = await listing(w.api.root, '/api/admin', 'wiki', 'one')
    const get = (versionId: string, as = token) =>
      t.app.inject({ url: `/api/daemon/skills/${versionId}`, headers: { authorization: `Bearer ${as}` } })

    expect((await get(v1.versionId)).statusCode).toBe(403)
    await install(w.api.bob, w.paths.repo, v1.id)
    const res = await get(v1.versionId)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      files: [{ path: 'SKILL.md', content: md('wiki', 'one'), encoding: 'utf8' }],
    })
    expect((await get(v1.versionId, idle.token)).statusCode).toBe(403)
    const v2 = await listing(w.api.root, '/api/admin', 'wiki', 'two')
    expect((await get(v2.versionId)).statusCode).toBe(200)
    expect((await get(v1.versionId)).statusCode).toBe(403)
    await t.db.update(plugins).set({ status: 'banned' }).where(eq(plugins.id, v1.id))
    expect((await get(v2.versionId)).statusCode).toBe(403)
  })
})

describe('plugin installs', () => {
  it('keeps the group switch on group installs and takes the highest scope that installed a plugin', async () => {
    const w = await world()
    await saveSysParams(t.ctx, { pluginsEnabled: true }, w.root.id)
    const deck = (await w.api.root.post<PluginDto>('/api/admin/plugins', { files: pluginFiles('deck') })).body
    const page = (await w.api.root.post<PluginDto>('/api/admin/plugins', { files: pluginFiles('page') })).body
    const base = `${w.paths.group}/plugins`
    const on = async () =>
      (await w.api.mia.get<GroupPluginDto[]>(base)).body
        .filter((p) => p.enabledInGroup)
        .map((p) => p.manifest.name)

    expect((await w.api.eve.put<GroupPluginDto>(`${base}/${deck.id}`, { enabled: true })).body).toMatchObject(
      {
        enabledInGroup: true,
      },
    )
    expect(await t.db.select({ scope: installs.scope, enabled: installs.enabled }).from(installs)).toEqual([
      { scope: 'group', enabled: true },
    ])
    await install(w.api.bob, w.paths.team, page.id)
    expect(await on()).toEqual(['deck', 'page'])
    await install(w.api.bob, w.paths.repo, page.id, { enabled: false })
    expect(await on()).toEqual(['deck'])
    await w.api.eve.put(`${base}/${page.id}`, { enabled: true })
    expect(await on()).toEqual(['deck', 'page'])

    const { machine } = await t.seed.machine(w.eve.id, { daemonVersion: '0.9.0' })
    const pinned = await install(w.api.bob, w.paths.team, deck.id, {
      enabled: true,
      pinVersionId: deck.versionId,
    })
    expect(pinned.status).toBe(200)
    const deck2 = (
      await w.api.root.post<PluginDto>('/api/admin/plugins', {
        files: pluginFiles('deck', { version: '1.1.0' }),
      })
    ).body
    const refs = await runPlugins(t.db, w.groupA.id, { agentKind: 'claude' }, machine.id, ['plugins'], {})
    expect(refs.map((r) => [r.name, r.versionId])).toEqual([
      ['deck', deck2.versionId],
      ['page', page.versionId],
    ])
  })
})
