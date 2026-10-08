import type { UserCardDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ account: 'wanglei', name: '王磊' })
  const li = await t.seed.user({ account: 'lijianguo', name: '李建国' })
  const outsider = await t.seed.user({ account: 'zhaomin', name: '赵敏' })
  const root = await t.seed.user({ account: 'root', name: '陈晨', role: 'sysadmin' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id] })
  const other = await t.seed.group({ createdBy: outsider.id })
  return {
    wang,
    li,
    g,
    other,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asOutsider: client(t, await t.seed.cookie(outsider.id)),
    asRoot: client(t, await t.seed.cookie(root.id)),
  }
}

const card = (userId: string, groupId?: string) =>
  `/api/users/${userId}/card${groupId ? `?groupId=${groupId}` : ''}`

describe('user card', () => {
  it('returns only non-sensitive fields, with group admin and online state', async () => {
    const s = await setup()
    const res = await s.asLi.get<UserCardDto>(card(s.wang.id, s.g.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: s.wang.id,
      name: '王磊',
      account: 'wanglei',
      avatar: null,
      role: 'member',
      groupAdmin: true,
      online: false,
    })
    t.ctx.bus.attach(s.li.id, () => {})
    const li = await s.asWang.get<UserCardDto>(card(s.li.id, s.g.id))
    expect(li.body).toMatchObject({ groupAdmin: false, online: true })
  })

  it('without a group, is visible to anyone sharing some group', async () => {
    const s = await setup()
    expect((await s.asLi.get<UserCardDto>(card(s.wang.id))).body).toMatchObject({ groupAdmin: false })
  })

  it('hides users who share no group with the requester', async () => {
    const s = await setup()
    expect((await s.asOutsider.get(card(s.wang.id))).status).toBe(404)
    expect((await s.asOutsider.get(card(s.wang.id, s.g.id))).status).toBe(404)
    expect((await s.asOutsider.get(card(s.wang.id, s.other.id))).status).toBe(404)
    expect((await s.asWang.get(card('not-a-uuid'))).status).toBe(404)
    expect((await t.app.inject({ method: 'GET', url: card(s.wang.id) })).statusCode).toBe(401)
  })

  it('lets a sysadmin see anyone', async () => {
    const s = await setup()
    const res = await s.asRoot.get<UserCardDto>(card(s.wang.id, s.g.id))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: '王磊', groupAdmin: true })
  })
})
