import {
  SKILL_MAX_BYTES,
  type SkillDetailDto,
  type SkillDto,
  type SkillVersionDetailDto,
  type SkillVersionDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, skillVersions, teamMembers } from '../src/db/schema.js'
import { enabledSkills } from '../src/modules/skills/routes.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const md = (name: string, body = 'Do the thing.', description = `${name} helper`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`
const skill = (name: string, body?: string) => [{ path: 'SKILL.md', content: md(name, body) }]

/** Team A: bob (admin), eve (member, admin of group A); team B owns group B. Root is a teamless sysadmin. */
async function world() {
  const bob = await t.seed.user({ name: '鲍勃' })
  const eve = await t.seed.user({ name: '伊芙' })
  const carol = await t.seed.user({ name: '卡罗尔', teamId: null })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  const teamB = await t.seed.team({ ownerId: carol.id, name: '团队B' })
  const groupA = await t.seed.group({ createdBy: eve.id, name: 'A 群' })
  const groupB = await t.seed.group({ createdBy: carol.id, name: 'B 群', teamId: teamB.id })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  return { bob, eve, root, teamA: groupA.teamId, groupA, groupB, as }
}

describe('platform skills', () => {
  it('lets only the sysadmin manage skills read from SKILL.md, with unique names, audited', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const eve = await w.as(w.eve)
    expect((await eve.get('/api/admin/skills')).status).toBe(403)
    expect((await eve.post('/api/admin/skills', { files: skill('review') })).status).toBe(403)

    const files = [
      { path: 'SKILL.md', content: md('review', 'Review it.', '"Reviews: diffs"') },
      { path: 'scripts/run.sh', content: 'echo hi\n' },
      { path: 'assets/logo.png', content: Buffer.from([0, 1, 2]).toString('base64'), encoding: 'base64' },
    ]
    const made = await root.post<SkillDetailDto>('/api/admin/skills', { files })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({
      name: 'review',
      description: 'Reviews: diffs',
      enabled: true,
      version: 1,
      size: md('review', 'Review it.', '"Reviews: diffs"').length + 8 + 3,
      updatedBy: '根',
    })
    expect(made.body.files.map((f) => f.path)).toEqual(['SKILL.md', 'assets/logo.png', 'scripts/run.sh'])
    expect((await root.post('/api/admin/skills', { files: skill('review') })).body).toMatchObject({
      error: 'conflict',
    })

    const list = await root.get<SkillDto[]>('/api/admin/skills')
    expect(list.body.map((s) => [s.name, s.version])).toEqual([['review', 1]])
    expect('files' in list.body[0]!).toBe(false)
    const detail = await root.get<SkillDetailDto>(`/api/admin/skills/${made.body.id}`)
    expect(detail.body.files).toEqual(made.body.files)

    expect((await root.del(`/api/admin/skills/${made.body.id}`)).status).toBe(204)
    expect((await root.get<SkillDto[]>('/api/admin/skills')).body).toEqual([])
    expect(await t.db.select().from(skillVersions)).toEqual([])
    expect((await root.del(`/api/admin/skills/${made.body.id}`)).status).toBe(404)

    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, w.root.id))
    expect(log.map((l) => [l.category, l.action])).toEqual([
      ['admin', 'skill.create'],
      ['admin', 'skill.delete'],
    ])
    expect(log[0]!.detail).toMatchObject({ name: 'review', layer: 'platform', version: 1 })
  })

  it('rejects folders without a valid SKILL.md, unsafe paths and oversized skills', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const bad = async (files: unknown) => (await root.post('/api/admin/skills', { files })).body
    expect(await bad([{ path: 'README.md', content: 'x' }])).toMatchObject({ error: 'invalid' })
    expect(await bad([{ path: 'SKILL.md', content: 'no frontmatter' }])).toMatchObject({ error: 'invalid' })
    expect(await bad([{ path: 'SKILL.md', content: '---\nname: x\n---\n' }])).toMatchObject({
      error: 'invalid',
    })
    expect(await bad(skill('Bad Name'))).toMatchObject({ error: 'invalid' })
    for (const path of ['../x', '/etc/x', 'a/../../x', 'a\\b', 'a//b', './x'])
      expect(await bad([...skill('ok'), { path, content: '' }])).toMatchObject({ error: 'invalid' })
    expect(await bad([...skill('ok'), ...skill('ok')])).toMatchObject({ error: 'invalid' })
    expect(
      await bad([...skill('ok'), { path: 'big.txt', content: 'a'.repeat(SKILL_MAX_BYTES) }]),
    ).toMatchObject({
      error: 'invalid',
    })
    expect((await root.get<SkillDto[]>('/api/admin/skills')).body).toEqual([])
  })
})

describe('skill versions', () => {
  it('saves new files as a new version, rolls back to any version and keeps the history', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const url = '/api/admin/skills'
    const v1 = (await root.post<SkillDetailDto>(url, { files: skill('review', 'one') })).body
    const id = v1.id

    const same = await root.patch<SkillDetailDto>(`${url}/${id}`, { files: skill('review', 'one') })
    expect(same.body.version).toBe(1)
    const off = await root.patch<SkillDetailDto>(`${url}/${id}`, { enabled: false })
    expect(off.body).toMatchObject({ enabled: false, version: 1 })
    const v2 = await root.patch<SkillDetailDto>(`${url}/${id}`, { files: skill('review', 'two') })
    expect(v2.body).toMatchObject({ enabled: false, version: 2 })
    expect(v2.body.files[0]!.content).toBe(md('review', 'two'))

    const versions = async () => (await root.get<SkillVersionDto[]>(`${url}/${id}/versions`)).body
    expect((await versions()).map((v) => [v.version, v.current, v.createdBy])).toEqual([
      [2, true, '根'],
      [1, false, '根'],
    ])
    const old = await root.get<SkillVersionDetailDto>(`${url}/${id}/versions/${v1.versionId}`)
    expect(old.body.files[0]!.content).toBe(md('review', 'one'))

    const back = await root.post<SkillDetailDto>(`${url}/${id}/rollback`, { versionId: v1.versionId })
    expect(back.body).toMatchObject({ version: 1, versionId: v1.versionId })
    expect(back.body.files[0]!.content).toBe(md('review', 'one'))
    expect((await versions()).map((v) => [v.version, v.current])).toEqual([
      [2, false],
      [1, true],
    ])
    const v3 = await root.patch<SkillDetailDto>(`${url}/${id}`, { files: skill('review', 'three') })
    expect(v3.body.version).toBe(3)

    const other = (await root.post<SkillDetailDto>(url, { files: skill('lint') })).body
    expect((await root.post(`${url}/${id}/rollback`, { versionId: other.versionId })).status).toBe(404)
    expect((await root.get(`${url}/${id}/versions/${other.versionId}`)).status).toBe(404)
    expect((await root.patch(`${url}/${id}`, { files: skill('lint') })).body).toMatchObject({
      error: 'conflict',
    })

    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, w.root.id))
    expect(log.map((l) => l.action)).toEqual([
      'skill.create',
      'skill.update',
      'skill.update',
      'skill.update',
      'skill.rollback',
      'skill.update',
      'skill.create',
    ])
  })
})

describe('skill layers', () => {
  it('team admins manage the team layer and group admins the group layer, isolated from each other', async () => {
    const w = await world()
    const teamUrl = `/api/teams/${w.teamA}/skills`
    const groupUrl = `/api/groups/${w.groupA.id}/skills`
    const bob = await w.as(w.bob)
    const eve = await w.as(w.eve)
    expect((await eve.post(teamUrl, { files: skill('review') })).status).toBe(403)
    const team = await bob.post<SkillDetailDto>(teamUrl, { files: skill('review') })
    expect(team.status).toBe(201)
    const group = await eve.post<SkillDetailDto>(groupUrl, { files: skill('review') })
    expect(group.status).toBe(201)
    expect((await eve.patch(`${groupUrl}/${team.body.id}`, { enabled: false })).status).toBe(404)
    expect((await eve.get(`${groupUrl}/${team.body.id}/versions`)).status).toBe(404)
    expect((await (await w.as(w.root)).get<SkillDto[]>('/api/admin/skills')).body).toEqual([])
    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.teamId, w.teamA))
    expect(log.map((l) => [l.action, l.groupId])).toEqual([
      ['skill.create', null],
      ['skill.create', w.groupA.id],
    ])
  })

  it('merges enabled skills for a group: group over team over platform by name', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const ids: Record<string, string> = {}
    const add = async (api: Awaited<ReturnType<typeof w.as>>, url: string, key: string, enabled = true) => {
      const name = key.split('@')[0]!
      ids[key] = (await api.post<SkillDetailDto>(url, { enabled, files: skill(name, key) })).body.versionId
    }
    await add(root, '/api/admin/skills', 'wiki@platform')
    await add(root, '/api/admin/skills', 'docs@platform')
    await add(root, '/api/admin/skills', 'jira@platform')
    const bob = await w.as(w.bob)
    await add(bob, `/api/teams/${w.teamA}/skills`, 'wiki@team')
    await add(bob, `/api/teams/${w.teamA}/skills`, 'docs@team')
    await add(bob, `/api/teams/${w.teamA}/skills`, 'jira@team', false)
    await add(await w.as(w.eve), `/api/groups/${w.groupA.id}/skills`, 'docs@group')

    const merged = async (groupId: string) =>
      Object.fromEntries((await enabledSkills(t.db, groupId)).map((s) => [s.name, s.versionId]))
    expect(await merged(w.groupA.id)).toEqual({
      docs: ids['docs@group'],
      jira: ids['jira@platform'],
      wiki: ids['wiki@team'],
    })
    expect(await merged(w.groupB.id)).toEqual({
      docs: ids['docs@platform'],
      jira: ids['jira@platform'],
      wiki: ids['wiki@platform'],
    })
    const [first] = await enabledSkills(t.db, w.groupA.id)
    expect(first!.digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
