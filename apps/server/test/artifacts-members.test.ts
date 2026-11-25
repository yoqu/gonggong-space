import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactDto, ArtifactMemberDto, WorkDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { groupMembers } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

/** 设计群: wang (admin, bot owner) and li (created the work); zhang is in the team, not the group. */
async function setup() {
  const w = await artifactWorld(t)
  const zhang = await t.seed.user({ name: '张三' })
  const a = await w.artifact({ createdBy: w.li.id })
  const cookies = {
    wang: await t.seed.cookie(w.wang.id),
    li: await t.seed.cookie(w.li.id),
    zhang: await t.seed.cookie(zhang.id),
  }
  type Who = keyof typeof cookies
  const req = (who: Who, method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie: cookies[who] }, payload })
  const open = async (who: Who) => {
    const res = await req(who, 'GET', `/api/artifacts/${a.id}`)
    return res.statusCode === 200 ? (res.json() as ArtifactDto) : res.statusCode
  }
  const work = async (who: Who) =>
    ((await req(who, 'GET', '/api/works')).json() as WorkDto[]).find((x) => x.id === a.id)
  const grant = (who: Who, userId: string, role: 'view' | 'edit') =>
    req(who, 'PUT', `/api/artifacts/${a.id}/members/${userId}`, { role })
  return { ...w, zhang, a, req, open, work, grant }
}

describe('who may open and change a work', () => {
  it('lets its creator change it after leaving its group', async () => {
    const s = await setup()
    await t.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, s.g.id), eq(groupMembers.userId, s.li.id)))
    expect(await s.open('li')).toMatchObject({ access: 'edit', canManage: true })
    expect((await s.work('li'))?.access).toBe('edit')
    const renamed = await s.req('li', 'PATCH', `/api/artifacts/${s.a.id}`, { title: '湖山俱乐部' })
    expect(renamed.statusCode).toBe(200)
  })

  it('lets its creator give a team member outside the group view or edit access, and take it back', async () => {
    const s = await setup()
    expect(await s.open('zhang')).toBe(404)
    expect(await s.work('zhang')).toBeUndefined()

    const viewed = await s.grant('li', s.zhang.id, 'view')
    expect(viewed.statusCode).toBe(200)
    expect(viewed.json() as ArtifactMemberDto[]).toEqual([
      { userId: s.zhang.id, name: '张三', avatar: null, role: 'view' },
    ])
    expect(await s.open('zhang')).toMatchObject({ access: 'view', canManage: false })
    expect((await s.work('zhang'))?.access).toBe('view')
    expect((await s.req('zhang', 'PATCH', `/api/artifacts/${s.a.id}`, { title: 'x' })).statusCode).toBe(403)

    expect((await s.grant('li', s.zhang.id, 'edit')).statusCode).toBe(200)
    expect(await s.open('zhang')).toMatchObject({ access: 'edit' })
    expect((await s.work('zhang'))?.access).toBe('edit')
    expect(
      (await s.req('zhang', 'PATCH', `/api/artifacts/${s.a.id}`, { title: '协作改名' })).statusCode,
    ).toBe(200)

    const listed = await s.req('zhang', 'GET', `/api/artifacts/${s.a.id}/members`)
    expect((listed.json() as ArtifactMemberDto[]).map((m) => m.role)).toEqual(['edit'])

    const removed = await s.req('li', 'DELETE', `/api/artifacts/${s.a.id}/members/${s.zhang.id}`)
    expect(removed.json()).toEqual([])
    expect(await s.open('zhang')).toBe(404)
  })

  it('lets only its managers grant, and only to people in its team', async () => {
    const s = await setup()
    expect((await s.grant('zhang', s.zhang.id, 'edit')).statusCode).toBe(404)
    expect((await s.grant('wang', s.zhang.id, 'view')).statusCode).toBe(200)
    expect((await s.grant('zhang', s.zhang.id, 'edit')).statusCode).toBe(403)
    const stranger = await t.seed.user({
      name: '外人',
      teamId: (await t.seed.team({ ownerId: s.wang.id })).id,
    })
    expect((await s.grant('li', stranger.id, 'view')).statusCode).toBe(404)
    expect((await s.grant('li', s.li.id, 'view')).statusCode).toBe(409)
    expect(await s.open('wang')).toMatchObject({ canManage: true })
  })

  it('shows a private work to those given access', async () => {
    const s = await setup()
    await s.req('li', 'PUT', `/api/artifacts/${s.a.id}/visibility`, { visibility: 'private' })
    expect(await s.open('zhang')).toBe(404)
    await s.grant('li', s.zhang.id, 'view')
    expect(await s.open('zhang')).toMatchObject({ access: 'view' })
  })
})
