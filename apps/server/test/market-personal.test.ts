import {
  type CommandCandidatesDto,
  type InstallDto,
  type ListingSummary,
  type MarketListingDetailDto,
  type MarketListingDto,
  PROTOCOL_VERSION,
  type PublishRes,
  type RunDetailDto,
  type RunStart,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, plugins, runs, teamMembers } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { enabledSkills, setInherited } from '../src/modules/skills/service.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const md = (name: string, body = 'Do it.') =>
  `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}\n`
const skill = (name: string, body?: string) => [
  { path: 'SKILL.md', content: md(name, body), encoding: 'utf8' },
]
const pluginFiles = (name: string) => [
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
    }),
  },
  { path: `skills/${name}/SKILL.md`, content: md(name) },
]

/**
 * Team A: own (owner), bob (admin), ann (author), mia (member); group A (eve's) has a bot on `machine`.
 * Team B: carol (owner), dan, ann, group B with the same bot. root is a teamless sysadmin.
 */
async function world() {
  const own = await t.seed.user({ name: '欧文' })
  const bob = await t.seed.user({ name: '鲍勃' })
  const ann = await t.seed.user({ name: '安' })
  const mia = await t.seed.user({ name: '米娅' })
  const eve = await t.seed.user({ name: '伊芙' })
  const carol = await t.seed.user({ name: '卡罗尔', teamId: null })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
  const teamB = await t.seed.team({ ownerId: carol.id, name: '团队B', memberIds: [ann.id] })
  const dan = await t.seed.user({ name: '丹', teamId: teamB.id })
  const { machine, token } = await t.seed.machine(own.id)
  const bot = await t.seed.bot({ ownerId: own.id, machineId: machine.id, binding: 'bound' })
  const groupA = await t.seed.group({
    createdBy: eve.id,
    name: 'A 群',
    memberIds: [ann.id, mia.id],
    botIds: [bot.id],
  })
  const groupB = await t.seed.group({
    createdBy: carol.id,
    name: 'B 群',
    teamId: teamB.id,
    memberIds: [ann.id],
    botIds: [bot.id],
  })
  const teamA = groupA.teamId
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  const api = {
    own: await as(own),
    bob: await as(bob),
    ann: await as(ann),
    mia: await as(mia),
    eve: await as(eve),
    carol: await as(carol),
    dan: await as(dan),
    root: await as(root),
  }
  return { own, bob, ann, mia, eve, carol, root, teamA, teamB, groupA, groupB, machine, token, bot, api }
}
type Api = Awaited<ReturnType<typeof world>>['api']['root']

const publish = async (api: Api, teamId: string, name: string, visibility = 'team', body?: string) => {
  const res = await api.post<PublishRes>('/api/market', { teamId, visibility, files: skill(name, body) })
  expect(res.status).toBeLessThan(300)
  return res.body.listing
}

/** Published, submitted and approved by `reviewer`. */
async function approved(api: Api, reviewer: Api, teamId: string, name: string, visibility = 'team') {
  const l = await publish(api, teamId, name, visibility)
  expect(
    (await api.post(`/api/market/${l.id}/versions/${l.latest.id}/submit`, { changelog: '首版' })).status,
  ).toBe(200)
  expect(
    (await reviewer.post(`/api/market/${l.id}/versions/${l.latest.id}/review`, { approve: true })).status,
  ).toBe(204)
  return l
}

const mine = (api: Api, id: string, body: object = { enabled: true }) =>
  api.put<InstallDto>(`/api/me/installs/${id}`, body)

const effective = async (groupId: string, originUserId?: string) =>
  Object.fromEntries((await enabledSkills(t.db, groupId, originUserId)).map((s) => [s.name, s.versionId]))

describe('personal installs', () => {
  it('installs visible skill listings for the caller only, unique by name, plugins refused', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki')
    const other = await approved(w.api.dan, w.api.carol, w.teamB.id, 'secret')
    const official = (
      await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: skill('wiki', 'official') })
    ).body
    const plugin = (
      await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: pluginFiles('web') })
    ).body

    const offered = (await w.api.mia.get<ListingSummary[]>('/api/me/installable')).body.map((l) => l.id)
    expect(offered.sort()).toEqual([wiki.id, official.id].sort())

    const put = await mine(w.api.mia, wiki.id)
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ scope: 'user', enabled: true, resolvedVersionId: wiki.latest.id })
    const clash = await mine(w.api.mia, official.id)
    expect([clash.status, clash.body]).toEqual([
      409,
      expect.objectContaining({ message: '这里已经有同名的 Skill「wiki」，先移除它再引入' }),
    ])
    expect((await mine(w.api.mia, plugin.id)).status).toBe(400)
    expect((await mine(w.api.mia, other.id)).status).toBe(404)

    expect((await w.api.mia.get<InstallDto[]>('/api/me/installs')).body.map((i) => i.listing.id)).toEqual([
      wiki.id,
    ])
    expect((await w.api.bob.get<InstallDto[]>('/api/me/installs')).body).toEqual([])
    expect((await w.api.mia.get<ListingSummary[]>('/api/me/installable')).body.map((l) => l.id)).toEqual([
      official.id,
    ])
    expect((await w.api.mia.del(`/api/me/installs/${wiki.id}`)).status).toBe(204)
    expect((await w.api.mia.get<InstallDto[]>('/api/me/installs')).body).toEqual([])
    expect((await t.app.inject({ url: '/api/me/installs' })).statusCode).toBe(401)
  })

  it('lets a maintainer install a draft that follows the latest upload; others never see it', async () => {
    const w = await world()
    const v1 = await publish(w.api.ann, w.teamA, 'draft', 'team', 'one')
    expect((await w.api.ann.get<ListingSummary[]>('/api/me/installable')).body.map((l) => l.id)).toEqual([
      v1.id,
    ])
    expect((await w.api.mia.get<ListingSummary[]>('/api/me/installable')).body).toEqual([])
    expect((await mine(w.api.mia, v1.id)).status).toBe(404)

    expect((await mine(w.api.ann, v1.id)).body).toMatchObject({ resolvedVersionId: v1.latest.id })
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ draft: v1.latest.id })
    const v2 = await publish(w.api.ann, w.teamA, 'draft', 'team', 'two')
    expect(v2.latest.id).not.toBe(v1.latest.id)
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ draft: v2.latest.id })
    expect((await w.api.ann.get<InstallDto[]>('/api/me/installs')).body[0]).toMatchObject({
      resolvedVersionId: v2.latest.id,
      resolvedRevision: 2,
    })
    // Pinning: own drafts for the maintainer.
    expect((await mine(w.api.ann, v1.id, { enabled: true, pinVersionId: v1.latest.id })).status).toBe(200)
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ draft: v1.latest.id })
  })
})

describe('personal layer in runs', () => {
  it('applies only to runs the installer originates', async () => {
    const w = await world()
    const x = await approved(w.api.ann, w.api.bob, w.teamA, 'x')
    await mine(w.api.ann, x.id)
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ x: x.latest.id })
    expect(await effective(w.groupA.id, w.mia.id)).toEqual({})
    expect(await effective(w.groupA.id)).toEqual({})
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ x: x.latest.id })
    expect((await enabledSkills(t.db, w.groupA.id, w.ann.id)).map((s) => s.personal)).toEqual([true])

    await mine(w.api.ann, x.id, { enabled: false })
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({})
  })

  it('keeps team-only skills inside their team, while the originator stays in it', async () => {
    const w = await world()
    const local = await approved(w.api.ann, w.api.bob, w.teamA, 'local')
    const shared = await approved(w.api.ann, w.api.root, w.teamA, 'shared', 'public')
    await mine(w.api.ann, local.id)
    await mine(w.api.ann, shared.id)
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({
      local: local.latest.id,
      shared: shared.latest.id,
    })
    // A hand_off into team B's group keeps the originator and is checked again there.
    expect(await effective(w.groupB.id, w.ann.id)).toEqual({ shared: shared.latest.id })

    await t.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.userId, w.ann.id), eq(teamMembers.teamId, w.teamA)))
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ shared: shared.latest.id })

    await t.db.update(plugins).set({ status: 'unlisted' }).where(eq(plugins.id, shared.id))
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ shared: shared.latest.id })
    await t.db.update(plugins).set({ status: 'banned' }).where(eq(plugins.id, shared.id))
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({})
  })

  it('overrides a same-named group skill and ignores the group turning inherited skills off', async () => {
    const w = await world()
    const own = (
      await w.api.eve.post<{ versionId: string }>(`/api/groups/${w.groupA.id}/skills`, {
        files: skill('wiki'),
      })
    ).body
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki')
    await mine(w.api.ann, wiki.id)
    expect(await effective(w.groupA.id, w.mia.id)).toEqual({ wiki: own.versionId })
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ wiki: wiki.latest.id })

    const docs = await approved(w.api.ann, w.api.bob, w.teamA, 'docs')
    await mine(w.api.ann, docs.id)
    await setInherited(t.ctx, w.groupA.id, 'docs', false, w.eve.id)
    expect(await effective(w.groupA.id, w.ann.id)).toEqual({ wiki: wiki.latest.id, docs: docs.latest.id })
  })

  it('sends personal skills in run.start and counts them on the run', async () => {
    const w = await world()
    const x = await approved(w.api.ann, w.api.bob, w.teamA, 'x')
    await mine(w.api.ann, x.id)
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: w.token,
        daemonVersion: '0.1.0',
        machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
        agents: [],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: w.groupA.id,
        kind: 'user',
        authorUserId: w.ann.id,
        body: '@bot hi',
        meta: { mentions: [w.bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const start = await box.next<RunStart>()
    expect(start.skills).toEqual([{ name: 'x', versionId: x.latest.id, digest: expect.any(String) }])
    const [run] = await t.db.select().from(runs).where(eq(runs.id, start.runId))
    expect(run!.personalSkills).toBe(1)
    const detail = await w.api.ann.get<RunDetailDto>(`/api/runs/${run!.id}`)
    expect(detail.body.run.personalSkills).toBe(1)
    ws.close()
  })
})

describe('personal skills in the / picker', () => {
  it("lists the caller's own personal skills, marked as theirs", async () => {
    const w = await world()
    const x = await approved(w.api.ann, w.api.bob, w.teamA, 'x')
    await mine(w.api.ann, x.id)
    const url = `/api/groups/${w.groupA.id}/candidates/commands`
    expect((await w.api.ann.get<CommandCandidatesDto>(url)).body.skill).toEqual([
      { name: 'gonggong-team:x', hint: 'x helper', personal: true },
    ])
    expect((await w.api.mia.get<CommandCandidatesDto>(url)).body.skill).toEqual([])
  })
})

describe('where a listing is installed', () => {
  it('shows the caller the installs they can see: personal, their groups, teams and repos', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki')
    await mine(w.api.mia, wiki.id)
    expect(
      (await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${wiki.id}`, { enabled: true })).status,
    ).toBe(200)
    expect((await w.api.bob.put(`/api/teams/${w.teamA}/installs/${wiki.id}`, { enabled: true })).status).toBe(
      200,
    )
    const listed = async (api: Api) =>
      (await api.get<MarketListingDto[]>('/api/market')).body.find((l) => l.id === wiki.id)?.installedIn
    const team = { scope: 'team', scopeId: w.teamA, label: expect.any(String) }
    const group = { scope: 'group', scopeId: w.groupA.id, label: 'A 群' }
    expect(await listed(w.api.mia)).toEqual([{ scope: 'user', scopeId: w.mia.id, label: '' }, group, team])
    expect(await listed(w.api.bob)).toEqual([team])
    expect((await w.api.mia.get<MarketListingDetailDto>(`/api/market/${wiki.id}`)).body.installedIn).toEqual([
      { scope: 'user', scopeId: w.mia.id, label: '' },
      group,
      team,
    ])
  })
})

describe('personal skills for the daemon', () => {
  it('serves a personal version only while its installer originates a live run on the machine', async () => {
    const w = await world()
    const x = await approved(w.api.ann, w.api.bob, w.teamA, 'x')
    await mine(w.api.ann, x.id)
    const idle = await t.seed.machine(w.own.id)
    const get = (as = w.token) =>
      t.app.inject({ url: `/api/daemon/skills/${x.latest.id}`, headers: { authorization: `Bearer ${as}` } })

    expect((await get()).statusCode).toBe(403)
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: w.groupA.id, kind: 'user', authorUserId: w.ann.id, body: '@bot hi' })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.groupA.id,
        botId: w.bot.id,
        triggerMessageId: m!.id,
        originUserId: w.ann.id,
        status: 'running',
      })
      .returning()
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ files: skill('x') })
    expect((await get(idle.token)).statusCode).toBe(403)

    await t.db.update(runs).set({ status: 'completed', endedAt: new Date() }).where(eq(runs.id, run!.id))
    expect((await get()).statusCode).toBe(403)
  })
})

describe('desktop read-only Skill page (machine token)', () => {
  it("lists the machine owner's personal installs and market", async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki')
    await approved(w.api.dan, w.api.carol, w.teamB.id, 'secret')
    expect((await mine(w.api.own, wiki.id)).status).toBe(200)
    const get = (url: string, token?: string) =>
      t.app.inject({ url, headers: token ? { authorization: `Bearer ${token}` } : {} })

    expect((await get('/api/daemon/me/installs')).statusCode).toBe(401)
    expect((await get('/api/daemon/market')).statusCode).toBe(401)
    const installs = (await get('/api/daemon/me/installs', w.token)).json<InstallDto[]>()
    expect(installs.map((i) => [i.listing.id, i.scope])).toEqual([[wiki.id, 'user']])
    const market = await get('/api/daemon/market?q=wi', w.token)
    expect(market.json<MarketListingDto[]>().map((l) => l.id)).toEqual([wiki.id])

    const revoked = await t.seed.machine(w.own.id, { revokedAt: new Date() })
    expect((await get('/api/daemon/me/installs', revoked.token)).statusCode).toBe(401)
  })
})
