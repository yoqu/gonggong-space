import type {
  InstallDto,
  ListingSummary,
  MarketListingDetailDto,
  MarketListingDto,
  MyListingDto,
  PublishRes,
  RepoDto,
  ReviewItemDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupRepos, installs, repos, teamMembers } from '../src/db/schema.js'
import { fetchGithubSkill, upstreamCommit } from '../src/modules/market/github.js'
import { enabledSkills } from '../src/modules/skills/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

vi.mock('../src/modules/market/github.js', () => ({ fetchGithubSkill: vi.fn(), upstreamCommit: vi.fn() }))

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

/**
 * Team A: own (owner), bob (admin), ann (author), mia (member), eve (admin of group A). Team B: carol (owner), dan.
 * root is a teamless sysadmin.
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
  return { own, bob, ann, mia, eve, carol, dan, root, teamA, teamB, groupA, api }
}
type World = Awaited<ReturnType<typeof world>>
type Api = World['api']['root']

const publish = (api: Api, teamId: string, files: object[], visibility = 'team') =>
  api.post<PublishRes>('/api/market', { teamId, visibility, files })

const submit = (api: Api, l: MyListingDto, changelog = '更新') =>
  api.post<MyListingDto>(`/api/market/${l.id}/versions/${l.latest.id}/submit`, { changelog })

const review = (api: Api, l: MyListingDto, body: object) =>
  api.post(`/api/market/${l.id}/versions/${l.latest.id}/review`, body)

/** Published, submitted and approved by `reviewer`. */
async function approved(
  api: Api,
  reviewer: Api,
  teamId: string,
  name: string,
  visibility = 'team',
  body?: string,
) {
  const { listing } = (await publish(api, teamId, skill(name, body), visibility)).body
  expect((await submit(api, listing)).status).toBe(200)
  expect((await review(reviewer, listing, { approve: true })).status).toBe(204)
  return listing
}

const mine = async (api: Api) => (await api.get<MyListingDto[]>('/api/market/mine')).body
const effective = async (groupId: string) =>
  Object.fromEntries((await enabledSkills(t.db, groupId)).map((s) => [s.name, s.versionId]))

describe('publishing', () => {
  it('saves drafts in a team the author is in, a new version for the same name', async () => {
    const w = await world()
    const made = await publish(w.api.ann, w.teamA, skill('wiki'))
    expect(made.status).toBe(201)
    expect(made.body).toEqual({
      listing: expect.objectContaining({
        type: 'skill',
        name: 'wiki',
        layer: 'team',
        status: 'listed',
        visibility: 'team',
        teamId: w.teamA,
        listedVersionId: null,
        ghSource: null,
        revision: 1,
        latest: expect.objectContaining({
          revision: 1,
          reviewStatus: 'draft',
          changelog: '',
          createdBy: '安',
        }),
      }),
      warnings: [],
    })
    const next = await publish(w.api.ann, w.teamA, skill('wiki', 'v2'))
    expect(next.status).toBe(200)
    expect(next.body.listing).toMatchObject({
      id: made.body.listing.id,
      latest: { revision: 2, reviewStatus: 'draft' },
    })
    expect((await publish(w.api.ann, w.teamA, skill('wiki', 'v2'))).body.listing.latest.revision).toBe(2)

    expect((await publish(w.api.carol, w.teamA, skill('other'))).status).toBe(403)
    expect((await publish(w.api.bob, w.teamA, skill('wiki'))).status).toBe(409)
    await w.api.bob.post(`/api/teams/${w.teamA}/plugins`, { files: skill('lint') })
    expect((await publish(w.api.ann, w.teamA, skill('lint'))).status).toBe(409)
    expect((await w.api.bob.post(`/api/teams/${w.teamA}/plugins`, { files: skill('wiki') })).status).toBe(409)
    expect((await mine(w.api.ann)).map((l) => l.name)).toEqual(['wiki'])
    expect(
      (await w.api.eve.get<ListingSummary[]>(`/api/groups/${w.groupA.id}/installable`)).body.map(
        (l) => l.name,
      ),
    ).toEqual(['lint'])
  })

  it('locks the visibility once a version is approved, so team review cannot publish it', async () => {
    const w = await world()
    const draft = (await publish(w.api.ann, w.teamA, skill('draft'))).body.listing
    const patch = (l: MyListingDto) => w.api.ann.patch(`/api/market/${l.id}`, { visibility: 'public' })
    expect((await patch(draft)).status).toBe(200)
    const listed = await approved(w.api.ann, w.api.bob, w.teamA, 'listed')
    expect((await patch(listed)).status).toBe(409)
    expect((await w.api.ann.patch(`/api/market/${listed.id}`, { status: 'unlisted' })).status).toBe(200)
  })

  it('warns about secrets and absolute paths without refusing', async () => {
    const w = await world()
    const files = [
      ...skill('keys', 'Use sk-abcdefghijklmnopqrstuvwx to call.'),
      { path: 'notes.md', content: 'see /Users/ann/projects/x', encoding: 'utf8' },
    ]
    const res = await publish(w.api.ann, w.teamA, files)
    expect(res.status).toBe(201)
    expect(res.body.warnings).toHaveLength(2)
    expect(res.body.warnings.join('\n')).toMatch(/SKILL\.md[\s\S]*notes\.md/)
  })
})

describe('review', () => {
  it('goes draft → pending → rejected with a reason → pending → approved, by a team admin', async () => {
    const w = await world()
    const { listing } = (await publish(w.api.ann, w.teamA, skill('wiki'))).body
    expect((await review(w.api.bob, listing, { approve: true })).status).toBe(409)
    expect((await submit(w.api.mia, listing)).status).toBe(403)
    const sent = await submit(w.api.ann, listing, '首版')
    expect(sent.body.latest).toMatchObject({ reviewStatus: 'pending', changelog: '首版' })

    expect((await w.api.mia.get(`/api/market/reviews?teamId=${w.teamA}`)).status).toBe(403)
    expect((await w.api.root.get<ReviewItemDto[]>('/api/market/reviews')).body).toEqual([])
    const queue = (await w.api.bob.get<ReviewItemDto[]>(`/api/market/reviews?teamId=${w.teamA}`)).body
    expect(queue).toEqual([
      expect.objectContaining({
        listing: expect.objectContaining({
          id: listing.id,
          name: 'wiki',
          author: '安',
          listedVersionId: null,
        }),
        version: expect.objectContaining({
          id: listing.latest.id,
          reviewStatus: 'pending',
          changelog: '首版',
        }),
      }),
    ])

    expect((await review(w.api.bob, listing, { approve: false })).status).toBe(400)
    expect((await review(w.api.root, listing, { approve: false, note: '不行' })).status).toBe(403)
    expect((await review(w.api.bob, listing, { approve: false, note: '缺说明' })).status).toBe(204)
    expect((await mine(w.api.ann))[0]).toMatchObject({
      listedVersionId: null,
      latest: { reviewStatus: 'rejected', reviewNote: '缺说明' },
    })
    expect((await submit(w.api.ann, listing, '补了说明')).status).toBe(200)
    expect((await review(w.api.own, listing, { approve: true })).status).toBe(204)
    expect((await mine(w.api.ann))[0]).toMatchObject({
      listedVersionId: listing.latest.id,
      latest: { reviewStatus: 'approved' },
    })
    expect((await submit(w.api.ann, listing)).status).toBe(409)
  })

  it('leaves public listings to sysadmins and never lets authors review themselves', async () => {
    const w = await world()
    const pub = (await publish(w.api.ann, w.teamA, skill('pub'), 'public')).body.listing
    await submit(w.api.ann, pub)
    expect((await w.api.bob.get<ReviewItemDto[]>(`/api/market/reviews?teamId=${w.teamA}`)).body).toEqual([])
    expect((await review(w.api.bob, pub, { approve: true })).status).toBe(403)
    expect(
      (await w.api.root.get<ReviewItemDto[]>('/api/market/reviews')).body.map((r) => r.listing.name),
    ).toEqual(['pub'])
    expect((await w.api.bob.get('/api/market/reviews')).status).toBe(403)
    expect((await review(w.api.root, pub, { approve: true })).status).toBe(204)

    const own = (await publish(w.api.bob, w.teamA, skill('docs'))).body.listing
    await submit(w.api.bob, own)
    expect((await review(w.api.bob, own, { approve: true })).status).toBe(403)
    expect((await review(w.api.own, own, { approve: true })).status).toBe(204)

    await t.db.insert(teamMembers).values({ teamId: w.teamB.id, userId: w.root.id })
    const rootPub = (await publish(w.api.root, w.teamB.id, skill('rooted'), 'public')).body.listing
    await submit(w.api.root, rootPub)
    expect((await review(w.api.root, rootPub, { approve: true })).status).toBe(204)
    await t.db.insert(teamMembers).values({ teamId: w.teamA, userId: w.root.id, role: 'admin' })
    const rootTeam = (await publish(w.api.root, w.teamA, skill('rooted-team'))).body.listing
    await submit(w.api.root, rootTeam)
    expect((await review(w.api.root, rootTeam, { approve: true })).status).toBe(403)
  })

  it('moves following installs on approval only, leaving pinned ones', async () => {
    const w = await world()
    const l = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki', 'team', 'one')
    const v1 = l.latest.id
    const group = `/api/groups/${w.groupA.id}`
    expect((await w.api.eve.put(`${group}/installs/${l.id}`, { enabled: true })).status).toBe(200)
    await w.api.bob.put(`/api/teams/${w.teamA}/installs/${l.id}`, { enabled: true, pinVersionId: v1 })

    const v2 = (await publish(w.api.ann, w.teamA, skill('wiki', 'two'))).body.listing
    expect(
      (await w.api.eve.put(`${group}/installs/${l.id}`, { enabled: true, pinVersionId: v2.latest.id }))
        .status,
    ).toBe(404)
    expect(await effective(w.groupA.id)).toEqual({ wiki: v1 })
    expect((await w.api.eve.get<InstallDto[]>(`${group}/installs`)).body[0]).toMatchObject({
      listing: { versionId: v1, revision: 1 },
      resolvedVersionId: v1,
    })
    await submit(w.api.ann, v2)
    expect(await effective(w.groupA.id)).toEqual({ wiki: v1 })
    await review(w.api.bob, v2, { approve: true })
    expect(await effective(w.groupA.id)).toEqual({ wiki: v2.latest.id })
    const rows = await t.db
      .select({ scope: installs.scope, resolved: installs.resolvedVersionId })
      .from(installs)
      .orderBy(installs.scope)
    expect(rows).toEqual([
      { scope: 'group', resolved: v2.latest.id },
      { scope: 'team', resolved: v1 },
    ])
  })
})

describe('market', () => {
  it('shows listed approved listings: official, my teams and other teams public ones', async () => {
    const w = await world()
    await w.api.root.post('/api/admin/plugins', { files: skill('official') })
    await w.api.bob.post(`/api/teams/${w.teamA}/plugins`, { files: skill('teamtool') })
    await approved(w.api.ann, w.api.bob, w.teamA, 'wiki')
    const pub = await approved(w.api.ann, w.api.root, w.teamA, 'pub', 'public')
    await publish(w.api.ann, w.teamA, skill('draft'))
    const gone = await approved(w.api.ann, w.api.root, w.teamA, 'gone', 'public')
    expect((await w.api.mia.patch(`/api/market/${gone.id}`, { status: 'unlisted' })).status).toBe(403)
    expect((await w.api.ann.patch(`/api/market/${gone.id}`, { status: 'unlisted' })).status).toBe(200)
    await approved(w.api.dan, w.api.carol, w.teamB.id, 'bsecret')
    const bpub = await approved(w.api.dan, w.api.root, w.teamB.id, 'bpub', 'public')

    const names = async (api: Api, query = '') =>
      (await api.get<MarketListingDto[]>(`/api/market${query}`)).body
        .map((l) => `${l.name}:${l.source}`)
        .sort()
    expect(await names(w.api.mia)).toEqual([
      'bpub:public',
      'official:official',
      'pub:team',
      'teamtool:team',
      'wiki:team',
    ])
    expect(await names(w.api.dan)).toEqual(['bpub:team', 'bsecret:team', 'official:official', 'pub:public'])
    expect(await names(w.api.mia, '?source=public')).toEqual(['bpub:public'])
    expect(await names(w.api.mia, '?type=plugin')).toEqual([])
    expect(await names(w.api.mia, '?q=WIK')).toEqual(['wiki:team'])
    const [wiki] = (await w.api.mia.get<MarketListingDto[]>('/api/market?q=wiki')).body
    expect(wiki).toMatchObject({
      visibility: 'team',
      teamName: expect.any(String),
      author: '安',
      agents: [],
      listedRevision: 1,
      installs: 0,
    })

    const group = `/api/groups/${w.groupA.id}`
    expect(
      (await w.api.eve.get<ListingSummary[]>(`${group}/installable`)).body.map((l) => l.name).sort(),
    ).toEqual(['bpub', 'official', 'pub', 'teamtool', 'wiki'])
    expect((await w.api.eve.put(`${group}/installs/${bpub.id}`, { enabled: true })).status).toBe(200)
    expect(await effective(w.groupA.id)).toEqual({ bpub: bpub.latest.id })
    const bsecret = (await mine(w.api.dan)).find((l) => l.name === 'bsecret')!
    expect((await w.api.eve.put(`${group}/installs/${bsecret.id}`, { enabled: true })).status).toBe(404)
    expect((await w.api.mia.get<MarketListingDto[]>('/api/market?q=bpub')).body[0]!.installs).toBe(1)
    expect((await w.api.mia.get(`/api/market/${pub.id}`)).status).toBe(200)
  })

  it('details a listing: readme, files and versions; drafts only for its maintainer', async () => {
    const w = await world()
    const l = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki', 'team', 'one')
    const v2 = (await publish(w.api.ann, w.teamA, skill('wiki', 'two'))).body.listing
    const url = `/api/market/${l.id}`
    const seen = (await w.api.mia.get<MarketListingDetailDto>(url)).body
    expect(seen).toMatchObject({
      id: l.id,
      versionId: l.latest.id,
      readme: md('wiki', 'one'),
      files: [{ path: 'SKILL.md', size: Buffer.byteLength(md('wiki', 'one')) }],
      ghSource: null,
      canEdit: false,
    })
    expect(seen.versions.map((v) => [v.revision, v.reviewStatus])).toEqual([[1, 'approved']])
    const authored = (await w.api.ann.get<MarketListingDetailDto>(url)).body
    expect(authored.canEdit).toBe(true)
    expect(authored.versions.map((v) => [v.revision, v.reviewStatus])).toEqual([
      [2, 'draft'],
      [1, 'approved'],
    ])
    expect(
      (await w.api.ann.get<MarketListingDetailDto>(`${url}?versionId=${v2.latest.id}`)).body.readme,
    ).toBe(md('wiki', 'two'))
    expect((await w.api.mia.get(`${url}?versionId=${v2.latest.id}`)).status).toBe(404)
    expect((await w.api.dan.get(url)).status).toBe(404)
  })

  it('hands a listing to the team admins when its author leaves the team (D13)', async () => {
    const w = await world()
    const l = await approved(w.api.ann, w.api.bob, w.teamA, 'wiki')
    expect((await w.api.bob.patch(`/api/market/${l.id}`, { status: 'unlisted' })).status).toBe(403)
    expect(await mine(w.api.bob)).toEqual([])
    await t.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.userId, w.ann.id), eq(teamMembers.teamId, w.teamA)))
    expect((await w.api.ann.patch(`/api/market/${l.id}`, { status: 'unlisted' })).status).toBe(403)
    expect((await w.api.bob.patch(`/api/market/${l.id}`, { status: 'unlisted' })).status).toBe(200)
    expect((await mine(w.api.bob)).map((m) => [m.name, m.status])).toEqual([['wiki', 'unlisted']])
    expect((await w.api.bob.get<MarketListingDetailDto>(`/api/market/${l.id}`)).body.canEdit).toBe(true)
    expect((await publish(w.api.bob, w.teamA, skill('wiki', 'v2'))).body.listing.latest.revision).toBe(2)
  })
})

describe('github import', () => {
  const source = (commit: string) => ({ url: 'https://github.com/acme/skills', ref: null, path: '', commit })

  it('imports a draft and checks upstream for a new commit', async () => {
    const w = await world()
    vi.mocked(fetchGithubSkill).mockResolvedValue({ files: skill('gh') as never, source: source('c1') })
    const res = await w.api.ann.post<PublishRes>('/api/market/import/github', {
      teamId: w.teamA,
      visibility: 'public',
      url: 'https://github.com/acme/skills',
    })
    expect(res.status).toBe(201)
    expect(vi.mocked(fetchGithubSkill).mock.calls[0]![0]).toBe('https://github.com/acme/skills')
    expect(res.body.listing).toMatchObject({ name: 'gh', visibility: 'public', ghSource: source('c1') })
    const check = (api: Api) => api.post(`/api/market/${res.body.listing.id}/check-upstream`)

    vi.mocked(upstreamCommit).mockResolvedValue('c1')
    expect((await check(w.api.ann)).body).toEqual({ changed: false, commit: 'c1' })
    expect((await check(w.api.mia)).status).toBe(403)
    vi.mocked(upstreamCommit).mockResolvedValue('c2')
    vi.mocked(fetchGithubSkill).mockResolvedValue({
      files: skill('gh', 'new') as never,
      source: source('c2'),
    })
    expect((await check(w.api.ann)).body).toEqual({ changed: true, commit: 'c2' })
    expect(vi.mocked(fetchGithubSkill).mock.lastCall![0]).toBe('https://github.com/acme/skills')
    expect((await mine(w.api.ann))[0]).toMatchObject({
      ghSource: source('c2'),
      latest: { revision: 2, reviewStatus: 'draft' },
    })

    const plain = (await publish(w.api.ann, w.teamA, skill('plain'))).body.listing
    expect((await w.api.ann.post(`/api/market/${plain.id}/check-upstream`)).status).toBe(400)
  })
})

describe('team repos', () => {
  it('lists the team repos to its members', async () => {
    const w = await world()
    const url = 'https://github.com/acme/app.git'
    await t.db.insert(groupRepos).values({ groupId: w.groupA.id, url, baseBranch: 'main' })
    await t.db.insert(repos).values({ teamId: w.teamA, key: 'github.com/acme/app', url, name: 'app' })
    const list = await w.api.mia.get<RepoDto[]>(`/api/teams/${w.teamA}/repos`)
    expect(list.body.map((r) => [r.name, r.groups])).toEqual([['app', 1]])
    expect((await w.api.dan.get(`/api/teams/${w.teamA}/repos`)).status).toBe(404)
  })
})
