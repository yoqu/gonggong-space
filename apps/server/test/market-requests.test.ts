import type {
  InstallDto,
  InstallRequestDto,
  ListingSummary,
  MarketListingDetailDto,
  MarketListingDto,
  MyListingDto,
  PublishRes,
  VersionDiffDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notifications, repos, teamMembers } from '../src/db/schema.js'
import { enabledSkills } from '../src/modules/skills/service.js'
import { createTestApp, type TestApp } from './support/app.js'
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
const b64 = (s: string) => Buffer.from(s).toString('base64')
const pluginFiles = (name: string, body?: string) => [
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
    encoding: 'utf8',
  },
  { path: `skills/${name}/SKILL.md`, content: md(name, body), encoding: 'utf8' },
]

/**
 * Team A: own (owner), bob (admin), ann (author), mia (member), eve (admin of group A), repo `app`.
 * Team B: carol (owner), dan. root is a teamless sysadmin.
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
  const teamB = await t.seed.team({ ownerId: carol.id, name: '团队B' })
  const dan = await t.seed.user({ name: '丹', teamId: teamB.id })
  const groupA = await t.seed.group({ createdBy: eve.id, name: 'A 群', memberIds: [mia.id] })
  const teamA = groupA.teamId
  const [repo] = await t.db
    .insert(repos)
    .values({
      teamId: teamA,
      key: 'github.com/acme/app',
      url: 'https://github.com/acme/app.git',
      name: 'app',
    })
    .returning()
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
  return { own, bob, ann, mia, eve, carol, dan, root, teamA, teamB, groupA, repo: repo!, api }
}
type Api = Awaited<ReturnType<typeof world>>['api']['root']

const publish = async (api: Api, teamId: string, files: object[], visibility = 'team') => {
  const res = await api.post<PublishRes>('/api/market', { teamId, visibility, files })
  expect(res.status).toBeLessThan(300)
  return res.body.listing
}
const submit = (api: Api, l: MyListingDto) =>
  api.post<MyListingDto>(`/api/market/${l.id}/versions/${l.latest.id}/submit`, { changelog: '更新' })
const review = (api: Api, l: MyListingDto, body: object) =>
  api.post(`/api/market/${l.id}/versions/${l.latest.id}/review`, body)

async function approved(api: Api, reviewer: Api, teamId: string, files: object[], visibility = 'team') {
  const l = await publish(api, teamId, files, visibility)
  expect((await submit(api, l)).status).toBe(200)
  expect((await review(reviewer, l, { approve: true })).status).toBe(204)
  return l
}

const effective = async (groupId: string, originUserId?: string) =>
  Object.fromEntries((await enabledSkills(t.db, groupId, originUserId)).map((s) => [s.name, s.versionId]))
const noticesOf = async (userId: string, type: string) =>
  (
    await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type)))
      .orderBy(notifications.createdAt)
  ).map((n) => ({ ...n, payload: n.payload as Record<string, unknown> }))

describe('version diff', () => {
  it('compares a version with the latest approved one before it, changed files only', async () => {
    const w = await world()
    const v1Files = [
      ...skill('wiki', 'one'),
      { path: 'keep.md', content: 'same', encoding: 'utf8' },
      { path: 'old.md', content: 'old', encoding: 'utf8' },
      { path: 'logo.png', content: b64('png-1'), encoding: 'base64' },
    ]
    const v1 = await publish(w.api.ann, w.teamA, v1Files)
    const diff = (api: Api, l: MyListingDto) =>
      api.get<VersionDiffDto>(`/api/market/${l.id}/versions/${l.latest.id}/diff`)

    const first = await diff(w.api.bob, v1)
    expect(first.status).toBe(200)
    expect(first.body.base).toBeNull()
    expect(first.body.files).toEqual([
      { path: 'SKILL.md', status: 'added', binary: false, before: null, after: md('wiki', 'one') },
      { path: 'keep.md', status: 'added', binary: false, before: null, after: 'same' },
      { path: 'logo.png', status: 'added', binary: true, before: null, after: null },
      { path: 'old.md', status: 'added', binary: false, before: null, after: 'old' },
    ])
    await submit(w.api.ann, v1)
    await review(w.api.bob, v1, { approve: true })

    const v2Files = [
      ...skill('wiki', 'two'),
      { path: 'keep.md', content: 'same', encoding: 'utf8' },
      { path: 'logo.png', content: b64('png-2'), encoding: 'base64' },
    ]
    await publish(w.api.ann, w.teamA, v2Files)
    const v3 = await publish(w.api.ann, w.teamA, [
      ...skill('wiki', 'three'),
      { path: 'keep.md', content: 'same', encoding: 'utf8' },
      { path: 'logo.png', content: b64('png-2'), encoding: 'base64' },
      { path: 'new.md', content: 'new', encoding: 'utf8' },
    ])
    const third = await diff(w.api.ann, v3)
    expect(third.status).toBe(200)
    expect(third.body.base).toEqual({ versionId: v1.latest.id, revision: 1 })
    expect(third.body.files).toEqual([
      {
        path: 'SKILL.md',
        status: 'modified',
        binary: false,
        before: md('wiki', 'one'),
        after: md('wiki', 'three'),
      },
      { path: 'logo.png', status: 'modified', binary: true, before: null, after: null },
      { path: 'new.md', status: 'added', binary: false, before: null, after: 'new' },
      { path: 'old.md', status: 'removed', binary: false, before: 'old', after: null },
    ])
    expect((await diff(w.api.bob, v1)).body.base).toBeNull()
    expect((await diff(w.api.mia, v3)).status).toBe(403)
    expect((await diff(w.api.root, v3)).status).toBe(403)
  })
})

describe('ban', () => {
  it('stops delivery in every scope and new installs until unbanned, by its reviewers only', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki'))
    const group = `/api/groups/${w.groupA.id}`
    expect((await w.api.eve.put(`${group}/installs/${wiki.id}`, { enabled: true })).status).toBe(200)
    expect((await w.api.mia.put(`/api/me/installs/${wiki.id}`, { enabled: true })).status).toBe(200)
    expect(await effective(w.groupA.id, w.mia.id)).toEqual({ wiki: wiki.latest.id })
    const ban = `/api/market/${wiki.id}/ban`

    expect((await w.api.mia.post(ban, { reason: '恶意' })).status).toBe(403)
    expect((await w.api.ann.post(ban, { reason: '恶意' })).status).toBe(403)
    expect((await w.api.root.post(ban, { reason: '恶意' })).status).toBe(403)
    expect((await w.api.bob.post(ban, { reason: '' })).status).toBe(400)
    expect((await w.api.bob.post(ban, { reason: '含恶意脚本' })).status).toBe(204)

    expect(await effective(w.groupA.id, w.mia.id)).toEqual({})
    expect(await effective(w.groupA.id)).toEqual({})
    expect((await w.api.mia.get<MarketListingDto[]>('/api/market')).body).toEqual([])
    const zoe = client(t, await t.seed.cookie((await t.seed.user({ name: '佐伊' })).id))
    expect((await zoe.get(`/api/market/${wiki.id}`)).status).toBe(404)
    expect((await w.api.mia.get<MarketListingDetailDto>(`/api/market/${wiki.id}`)).body).toMatchObject({
      status: 'banned',
      banReason: '含恶意脚本',
      installedIn: [{ scope: 'user' }, { scope: 'group' }],
    })
    expect((await w.api.eve.get<InstallDto[]>(`${group}/installs`)).body[0]).toMatchObject({
      listing: { status: 'banned' },
      banReason: '含恶意脚本',
    })
    expect((await w.api.own.put(`/api/me/installs/${wiki.id}`, { enabled: true })).status).toBe(409)
    expect((await w.api.bob.get<ListingSummary[]>(`/api/teams/${w.teamA}/installable`)).body).toEqual([])
    const seen = (await w.api.ann.get<MarketListingDetailDto>(`/api/market/${wiki.id}`)).body
    expect(seen).toMatchObject({ status: 'banned', banReason: '含恶意脚本', canReview: false })
    expect((await w.api.ann.get<MyListingDto[]>('/api/market/mine')).body[0]).toMatchObject({
      status: 'banned',
      banReason: '含恶意脚本',
    })
    expect((await w.api.bob.get<MarketListingDetailDto>(`/api/market/${wiki.id}`)).body.canReview).toBe(true)

    expect((await w.api.mia.del(ban)).status).toBe(403)
    expect((await w.api.bob.del(ban)).status).toBe(204)
    expect(await effective(w.groupA.id, w.mia.id)).toEqual({ wiki: wiki.latest.id })
    expect((await w.api.mia.get<MarketListingDto[]>('/api/market')).body.map((l) => l.name)).toEqual(['wiki'])
    expect((await w.api.ann.get<MarketListingDetailDto>(`/api/market/${wiki.id}`)).body).toMatchObject({
      status: 'listed',
      banReason: null,
    })
    expect((await w.api.eve.get<InstallDto[]>(`${group}/installs`)).body[0]!.banReason).toBeNull()
  })

  it('leaves public and platform listings to sysadmins', async () => {
    const w = await world()
    const pub = await approved(w.api.ann, w.api.root, w.teamA, skill('pub'), 'public')
    const official = (
      await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: skill('official') })
    ).body
    for (const id of [pub.id, official.id]) {
      expect((await w.api.bob.post(`/api/market/${id}/ban`, { reason: '违规' })).status).toBe(403)
      expect((await w.api.root.post(`/api/market/${id}/ban`, { reason: '违规' })).status).toBe(204)
    }
    expect((await w.api.dan.get<MarketListingDto[]>('/api/market')).body).toEqual([])
  })
})

describe('review notices and details', () => {
  it('tells the maintainer the review result', async () => {
    const w = await world()
    const l = await publish(w.api.ann, w.teamA, skill('wiki'))
    await submit(w.api.ann, l)
    await review(w.api.bob, l, { approve: false, note: '缺说明' })
    await submit(w.api.ann, l)
    await review(w.api.bob, l, { approve: true })
    expect((await noticesOf(w.ann.id, 'listing_reviewed')).map((n) => n.payload)).toEqual([
      { listingId: l.id, listingName: 'wiki', revision: 1, approved: false, note: '缺说明' },
      { listingId: l.id, listingName: 'wiki', revision: 1, approved: true, note: '' },
    ])
    expect(await noticesOf(w.bob.id, 'listing_reviewed')).toEqual([])
  })

  it('tells the reviewers a version waits for them, and clears it once reviewed', async () => {
    const w = await world()
    const l = await publish(w.api.ann, w.teamA, pluginFiles('web'))
    await submit(w.api.ann, l)
    const waiting = {
      listingId: l.id,
      versionId: l.latest.id,
      listingName: '插件 web',
      revision: 1,
      byName: '安',
    }
    expect((await noticesOf(w.bob.id, 'listing_submitted')).map((n) => n.payload)).toEqual([waiting])
    expect(await noticesOf(w.own.id, 'listing_submitted')).toHaveLength(1)
    expect(await noticesOf(w.ann.id, 'listing_submitted')).toEqual([])
    expect(await noticesOf(w.root.id, 'listing_submitted')).toEqual([])

    await review(w.api.bob, l, { approve: true })
    expect((await noticesOf(w.own.id, 'listing_submitted'))[0]!.resolvedAt).not.toBeNull()
    expect((await noticesOf(w.ann.id, 'listing_reviewed'))[0]!.payload.listingName).toBe('插件 web')

    const pub = await publish(w.api.ann, w.teamA, skill('pub'), 'public')
    await submit(w.api.ann, pub)
    expect((await noticesOf(w.root.id, 'listing_submitted')).map((n) => n.payload)).toEqual([
      { listingId: pub.id, versionId: pub.latest.id, listingName: 'pub', revision: 1, byName: '安' },
    ])
  })

  it('tells the maintainers when their listing is banned or unbanned', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki'))
    await w.api.bob.post(`/api/market/${wiki.id}/ban`, { reason: '含恶意脚本' })
    await w.api.bob.del(`/api/market/${wiki.id}/ban`)
    expect((await noticesOf(w.ann.id, 'listing_banned')).map((n) => n.payload)).toEqual([
      { listingId: wiki.id, listingName: 'wiki', banned: true, reason: '含恶意脚本' },
      { listingId: wiki.id, listingName: 'wiki', banned: false, reason: '' },
    ])
    expect(await noticesOf(w.bob.id, 'listing_banned')).toEqual([])
  })

  it('tells installers when a following install is upgraded, not pinned ones or maintainers', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki', 'one'))
    expect(
      (await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${wiki.id}`, { enabled: true })).status,
    ).toBe(200)
    await w.api.mia.put(`/api/me/installs/${wiki.id}`, { enabled: true })
    await w.api.ann.put(`/api/me/installs/${wiki.id}`, { enabled: true })
    await w.api.bob.put(`/api/teams/${w.teamA}/installs/${wiki.id}`, {
      enabled: true,
      pinVersionId: wiki.latest.id,
    })
    const v2 = await publish(w.api.ann, w.teamA, skill('wiki', 'two'))
    await submit(w.api.ann, v2)
    expect((await review(w.api.bob, v2, { approve: true })).status).toBe(204)

    const upgraded = { listingId: wiki.id, listingName: 'wiki', revision: 2, changelog: '更新' }
    const eve = await noticesOf(w.eve.id, 'listing_upgraded')
    expect(eve.map((n) => [n.payload, n.teamId])).toEqual([[{ ...upgraded, targets: ['A 群'] }, w.teamA]])
    const mia = await noticesOf(w.mia.id, 'listing_upgraded')
    expect(mia.map((n) => [n.payload, n.teamId])).toEqual([[{ ...upgraded, targets: [''] }, null]])
    expect(await noticesOf(w.bob.id, 'listing_upgraded')).toEqual([])
    expect(await noticesOf(w.ann.id, 'listing_upgraded')).toEqual([])
  })

  it('tells installers of a ban and its lifting, with where they installed it', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki'))
    await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${wiki.id}`, { enabled: true })
    await w.api.own.put(`/api/teams/${w.teamA}/repos/${w.repo.id}/installs/${wiki.id}`, {
      enabled: true,
      pinVersionId: wiki.latest.id,
    })
    await w.api.bob.post(`/api/market/${wiki.id}/ban`, { reason: '含恶意脚本' })
    await w.api.bob.del(`/api/market/${wiki.id}/ban`)
    const banned = { listingId: wiki.id, listingName: 'wiki', banned: true, reason: '含恶意脚本' }
    const lifted = { listingId: wiki.id, listingName: 'wiki', banned: false, reason: '' }
    expect((await noticesOf(w.eve.id, 'listing_banned')).map((n) => [n.payload, n.teamId])).toEqual([
      [{ ...banned, targets: ['A 群'] }, w.teamA],
      [{ ...lifted, targets: ['A 群'] }, w.teamA],
    ])
    const repoLabel = `${(await noticesOf(w.own.id, 'listing_banned'))[0]!.payload.targets}`
    expect(repoLabel).toMatch(/ \/ app$/)
    expect((await noticesOf(w.ann.id, 'listing_banned')).map((n) => n.teamId)).toEqual([w.teamA, w.teamA])
  })

  it('files market notices under the team they concern', async () => {
    const w = await world()
    const l = await publish(w.api.ann, w.teamA, skill('wiki'))
    await submit(w.api.ann, l)
    expect((await noticesOf(w.bob.id, 'listing_submitted'))[0]!.teamId).toBe(w.teamA)
    await review(w.api.bob, l, { approve: true })
    expect((await noticesOf(w.ann.id, 'listing_reviewed'))[0]!.teamId).toBe(w.teamA)
    const pub = await publish(w.api.ann, w.teamA, skill('pub'), 'public')
    await submit(w.api.ann, pub)
    expect((await noticesOf(w.root.id, 'listing_submitted'))[0]!.teamId).toBeNull()

    await w.api.mia.post('/api/install-requests', { listingId: l.id, scope: 'group', scopeId: w.groupA.id })
    expect((await noticesOf(w.eve.id, 'install_request'))[0]!.teamId).toBe(w.teamA)
  })

  it('gives null as the listed version of a never approved listing', async () => {
    const w = await world()
    const l = await publish(w.api.ann, w.teamA, skill('draft'))
    expect((await w.api.ann.get<MarketListingDetailDto>(`/api/market/${l.id}`)).body).toMatchObject({
      listedVersionId: null,
      listedRevision: null,
    })
  })
})

describe('plugin files', () => {
  it('serves an installed cross-team public plugin at its resolved version', async () => {
    const w = await world()
    const web = await approved(w.api.dan, w.api.root, w.teamB.id, pluginFiles('web', 'one'), 'public')
    await publish(w.api.dan, w.teamB.id, pluginFiles('web', 'two'), 'public')
    const url = `/api/plugins/${web.id}/files/skills/web/SKILL.md`
    expect((await w.api.mia.get(url)).status).toBe(404)
    expect(
      (await w.api.eve.put<InstallDto>(`/api/groups/${w.groupA.id}/installs/${web.id}`, { enabled: true }))
        .status,
    ).toBe(200)
    const res = await t.app.inject({ url, headers: { cookie: await t.seed.cookie(w.mia.id) } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(md('web', 'one'))
    expect((await w.api.root.get(url)).status).toBe(404)
    const dan = await t.app.inject({ url, headers: { cookie: await t.seed.cookie(w.dan.id) } })
    expect(dan.body).toBe(md('web', 'two'))
  })
})

describe('install requests', () => {
  const ask = (api: Api, body: object) => api.post<InstallRequestDto>('/api/install-requests', body)
  const list = async (api: Api, view: 'mine' | 'todo') =>
    (await api.get<InstallRequestDto[]>(`/api/install-requests?view=${view}`)).body
  const decide = (api: Api, id: string, body: object) =>
    api.post<InstallRequestDto>(`/api/install-requests/${id}/decide`, body)

  it('lets members ask, admins be told, and checks who may ask', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki'))
    const bsecret = await approved(w.api.dan, w.api.carol, w.teamB.id, skill('bsecret'))
    const pub = await approved(w.api.dan, w.api.root, w.teamB.id, skill('pub'), 'public')

    const made = await ask(w.api.mia, {
      listingId: wiki.id,
      scope: 'group',
      scopeId: w.groupA.id,
      note: '要用',
    })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({
      listing: { id: wiki.id, name: 'wiki' },
      scope: 'group',
      scopeId: w.groupA.id,
      targetLabel: 'A 群',
      pinVersionId: null,
      note: '要用',
      status: 'pending',
      requester: '米娅',
      decidedBy: null,
      decisionNote: null,
      decidedAt: null,
    })
    expect((await ask(w.api.mia, { listingId: wiki.id, scope: 'group', scopeId: w.groupA.id })).status).toBe(
      409,
    )
    const [notice] = await noticesOf(w.eve.id, 'install_request')
    expect(notice).toMatchObject({
      payload: { requestId: made.body.id, requesterName: '米娅', listingName: 'wiki', targetLabel: 'A 群' },
      resolvedAt: null,
    })

    const team = await ask(w.api.mia, { listingId: pub.id, scope: 'team', scopeId: w.teamA })
    expect(team.status).toBe(201)
    expect((await noticesOf(w.bob.id, 'install_request')).map((n) => n.payload.requestId)).toEqual([
      team.body.id,
    ])
    expect(await noticesOf(w.own.id, 'install_request')).toHaveLength(1)
    expect(await noticesOf(w.mia.id, 'install_request')).toEqual([])
    const repo = await ask(w.api.mia, { listingId: wiki.id, scope: 'repo', scopeId: w.repo.id })
    expect(repo.body.targetLabel).toMatch(/ \/ app$/)

    expect((await ask(w.api.dan, { listingId: pub.id, scope: 'group', scopeId: w.groupA.id })).status).toBe(
      404,
    )
    expect((await ask(w.api.dan, { listingId: pub.id, scope: 'team', scopeId: w.teamA })).status).toBe(404)
    expect((await ask(w.api.mia, { listingId: bsecret.id, scope: 'team', scopeId: w.teamA })).status).toBe(
      404,
    )
    await w.api.bob.put(`/api/teams/${w.teamA}/installs/${wiki.id}`, { enabled: true })
    expect((await ask(w.api.mia, { listingId: wiki.id, scope: 'team', scopeId: w.teamA })).status).toBe(409)

    expect((await list(w.api.mia, 'mine')).map((r) => r.id).sort()).toEqual(
      [made.body.id, team.body.id, repo.body.id].sort(),
    )
    expect((await list(w.api.mia, 'todo')).map((r) => r.id)).toEqual([])
    expect((await list(w.api.eve, 'todo')).map((r) => r.id)).toEqual([made.body.id])
    expect((await list(w.api.bob, 'todo')).map((r) => r.id).sort()).toEqual(
      [team.body.id, repo.body.id].sort(),
    )
  })

  it('installs on approval, keeps a conflict pending, needs a reason to reject and can be cancelled', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki'))
    const pub = await approved(w.api.dan, w.api.root, w.teamB.id, skill('pub'), 'public')
    const g = await ask(w.api.mia, { listingId: wiki.id, scope: 'group', scopeId: w.groupA.id })
    const team = await ask(w.api.mia, {
      listingId: pub.id,
      scope: 'team',
      scopeId: w.teamA,
      pinVersionId: pub.latest.id,
    })
    const repo = await ask(w.api.mia, { listingId: wiki.id, scope: 'repo', scopeId: w.repo.id })

    expect((await decide(w.api.mia, g.body.id, { approve: true })).status).toBe(403)
    expect((await decide(w.api.bob, g.body.id, { approve: true })).status).toBe(404)
    expect((await decide(w.api.eve, team.body.id, { approve: true })).status).toBe(403)

    const official = (await w.api.root.post<ListingSummary>('/api/admin/plugins', { files: skill('wiki') }))
      .body
    await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${official.id}`, { enabled: true })
    expect((await decide(w.api.eve, g.body.id, { approve: true })).status).toBe(409)
    expect((await list(w.api.mia, 'mine')).find((r) => r.id === g.body.id)?.status).toBe('pending')
    expect((await noticesOf(w.eve.id, 'install_request'))[0]!.resolvedAt).toBeNull()

    expect((await decide(w.api.eve, g.body.id, { approve: false })).status).toBe(400)
    const rejected = await decide(w.api.eve, g.body.id, { approve: false, note: '已有同名' })
    expect(rejected.status).toBe(200)
    expect(rejected.body).toMatchObject({ status: 'rejected', decidedBy: '伊芙', decisionNote: '已有同名' })
    expect((await noticesOf(w.eve.id, 'install_request'))[0]!.resolvedAt).not.toBeNull()
    const again = await decide(w.api.eve, g.body.id, { approve: true })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ message: '这条申请已经处理过了' })

    const ok = await decide(w.api.bob, team.body.id, { approve: true })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('approved')
    const installed = (await w.api.bob.get<InstallDto[]>(`/api/teams/${w.teamA}/installs`)).body
    expect(installed).toEqual([
      expect.objectContaining({
        listing: expect.objectContaining({ id: pub.id }),
        enabled: true,
        pinVersionId: pub.latest.id,
      }),
    ])
    for (const n of await noticesOf(w.own.id, 'install_request'))
      if (n.payload.requestId === team.body.id) expect(n.resolvedAt).not.toBeNull()
    expect((await noticesOf(w.mia.id, 'install_request_decided')).map((n) => n.payload)).toEqual([
      { listingName: 'wiki', targetLabel: 'A 群', approved: false, note: '已有同名' },
      { listingName: 'pub', targetLabel: expect.any(String), approved: true, note: '' },
    ])

    const cancel = (api: Api) => api.del(`/api/install-requests/${repo.body.id}`)
    expect((await cancel(w.api.bob)).status).toBe(403)
    expect((await cancel(w.api.mia)).status).toBe(204)
    expect((await cancel(w.api.mia)).status).toBe(409)
    expect((await list(w.api.mia, 'mine')).find((r) => r.id === repo.body.id)?.status).toBe('cancelled')
    expect((await list(w.api.bob, 'todo')).map((r) => r.id)).toEqual([])
    const repoNotices = (await noticesOf(w.bob.id, 'install_request')).filter(
      (n) => n.payload.requestId === repo.body.id,
    )
    expect(repoNotices.map((n) => [n.resolvedAt !== null, n.payload.cancelled])).toEqual([[true, true]])
    expect((await ask(w.api.mia, { listingId: wiki.id, scope: 'repo', scopeId: w.repo.id })).status).toBe(201)
  })

  it('shows pending requests on the detail to members of their target, and who asked on a repeat', async () => {
    const w = await world()
    const pub = await approved(w.api.dan, w.api.root, w.teamB.id, skill('pub'), 'public')
    const requested = async (api: Api) =>
      (await api.get<MarketListingDetailDto>(`/api/market/${pub.id}`)).body.requestedIn
    const g = await ask(w.api.mia, { listingId: pub.id, scope: 'group', scopeId: w.groupA.id })
    await ask(w.api.mia, { listingId: pub.id, scope: 'repo', scopeId: w.repo.id })

    expect(await requested(w.api.mia)).toEqual([
      { scope: 'group', scopeId: w.groupA.id, requester: '米娅', mine: true },
      { scope: 'repo', scopeId: w.repo.id, requester: '米娅', mine: true },
    ])
    expect(await requested(w.api.eve)).toEqual([
      { scope: 'group', scopeId: w.groupA.id, requester: '米娅', mine: false },
      { scope: 'repo', scopeId: w.repo.id, requester: '米娅', mine: false },
    ])
    expect(await requested(w.api.bob)).toEqual([
      { scope: 'repo', scopeId: w.repo.id, requester: '米娅', mine: false },
    ])
    expect(await requested(w.api.dan)).toEqual([])

    const repeat = await ask(w.api.bob, { listingId: pub.id, scope: 'repo', scopeId: w.repo.id })
    expect(repeat.status).toBe(409)
    expect(repeat.body).toMatchObject({ message: '米娅 已经申请过了，正在等管理员处理' })

    await w.api.mia.del(`/api/install-requests/${g.body.id}`)
    expect((await requested(w.api.eve))?.map((r) => r.scope)).toEqual(['repo'])
  })
})

describe('same-named skills', () => {
  it('lists where the caller could install the listing but a same-named skill is already there', async () => {
    const w = await world()
    const wiki = await approved(w.api.ann, w.api.bob, w.teamA, skill('wiki'))
    const pub = await approved(w.api.dan, w.api.root, w.teamB.id, skill('wiki'), 'public')
    const taken = async (api: Api, id = wiki.id) =>
      (await api.get<MarketListingDetailDto>(`/api/market/${id}`)).body.nameTakenIn
    expect(await taken(w.api.mia)).toEqual([])

    await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${pub.id}`, { enabled: true })
    await w.api.mia.put(`/api/me/installs/${pub.id}`, { enabled: true })
    await w.api.bob.post(`/api/teams/${w.teamA}/skills`, { files: skill('wiki') })
    expect(await taken(w.api.mia)).toEqual([
      { scope: 'user', scopeId: w.mia.id },
      { scope: 'group', scopeId: w.groupA.id },
      { scope: 'team', scopeId: w.teamA },
    ])
    expect(await taken(w.api.bob)).toEqual([{ scope: 'team', scopeId: w.teamA }])
    expect(await taken(w.api.mia, pub.id)).toEqual([{ scope: 'team', scopeId: w.teamA }])

    const installable = async (path: string) =>
      (await w.api.bob.get<(ListingSummary & { nameTaken?: boolean })[]>(`${path}/installable`)).body.find(
        (l) => l.id === wiki.id,
      )?.nameTaken
    expect(await installable(`/api/teams/${w.teamA}`)).toBe(true)
    expect(await installable(`/api/teams/${w.teamA}/repos/${w.repo.id}`)).toBe(false)
  })
})
