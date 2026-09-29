import type { UserDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

describe('PATCH /api/me · display name', () => {
  it('renames only the caller, trimmed, and refreshes their groups for every member', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const li = await t.seed.user({ name: '李建国' })
    const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id] })
    const seen = events(t, li.id)
    const asWang = client(t, await t.seed.cookie(wang.id))

    const res = await asWang.patch<UserDto>('/api/me', { name: '  王小磊 ' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: wang.id, name: '王小磊', gitProtocol: 'auto' })
    expect((await asWang.get<UserDto>('/api/me')).body.name).toBe('王小磊')
    expect(seen).toContainEqual({
      t: 'group.updated',
      group: expect.objectContaining({
        id: g.id,
        members: expect.arrayContaining([expect.objectContaining({ userId: wang.id, name: '王小磊' })]),
      }),
    })
    const liSelf = (await client(t, await t.seed.cookie(li.id)).get<UserDto>('/api/me')).body
    expect(liSelf.name).toBe('李建国')
  })

  it('keeps gitProtocol updates working on their own', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const res = await client(t, await t.seed.cookie(wang.id)).patch<UserDto>('/api/me', {
      gitProtocol: 'ssh',
    })
    expect(res.body).toMatchObject({ name: '王磊', gitProtocol: 'ssh' })
  })

  it('rejects blank or overlong names', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const asWang = client(t, await t.seed.cookie(wang.id))
    for (const name of ['   ', 'x'.repeat(41)])
      expect((await asWang.patch('/api/me', { name })).status).toBe(400)
    expect((await asWang.get<UserDto>('/api/me')).body.name).toBe('王磊')
  })

  it('requires a session', async () => {
    const res = await t.app.inject({ method: 'PATCH', url: '/api/me', payload: { name: 'x' } })
    expect(res.statusCode).toBe(401)
  })
})
