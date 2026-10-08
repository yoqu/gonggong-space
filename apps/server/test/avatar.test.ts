import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GroupDto, MeDto, TeamMemberDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const FEISHU_AVATAR = 'https://s1-imfile.feishucdn.com/static-resource/v1/avatar~?image_size=240x240'

async function image(cookie: string, url: string) {
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie } })
  return { status: res.statusCode, type: res.headers['content-type'], body: res.rawPayload }
}

async function upload(cookie: string, data: Buffer, type = 'image/png', name = 'me.png') {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(data)], { type }), name)
  const res = await fetch(t.url('/api/me/avatar'), { method: 'PUT', headers: { cookie }, body: form })
  return { status: res.status, body: (await res.json()) as MeDto }
}

describe('个人头像 · upload', () => {
  it('stores an uploaded image, serves it to signed-in users and shows it wherever the user appears', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const li = await t.seed.user({ name: '李建国' })
    const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id] })
    const seen = events(t, li.id)
    const cookie = await t.seed.cookie(wang.id)

    const res = await upload(cookie, PNG)
    expect(res.status).toBe(200)
    const avatar = res.body.avatar
    expect(avatar).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}\.png$/)

    const img = await image(await t.seed.cookie(li.id), avatar!)
    expect(img.status).toBe(200)
    expect(img.type).toBe('image/png')
    expect(img.body).toEqual(PNG)
    expect((await t.app.inject({ method: 'GET', url: avatar! })).statusCode).toBe(401)

    const asLi = client(t, await t.seed.cookie(li.id))
    expect((await asLi.get<UserBriefDto[]>('/api/users')).body).toContainEqual(
      expect.objectContaining({ id: wang.id, avatar }),
    )
    expect((await asLi.get<UserBriefDto>(`/api/users/${wang.id}/card`)).body.avatar).toBe(avatar)
    const team = (await asLi.get<MeDto>('/api/me')).body.teams[0]!
    expect((await asLi.get<TeamMemberDto[]>(`/api/teams/${team.id}/members`)).body).toContainEqual(
      expect.objectContaining({ userId: wang.id, avatar }),
    )
    expect(
      (await asLi.get<GroupDto[]>('/api/groups')).body.find((x) => x.id === g.id)?.members,
    ).toContainEqual(expect.objectContaining({ userId: wang.id, avatar }))
    expect(seen).toContainEqual({
      t: 'group.updated',
      group: expect.objectContaining({
        members: expect.arrayContaining([expect.objectContaining({ userId: wang.id, avatar })]),
      }),
    })
  })

  it('replaces the previous file and can be cleared', async () => {
    const wang = await t.seed.user()
    const cookie = await t.seed.cookie(wang.id)
    const http = client(t, cookie)
    const first = (await upload(cookie, PNG)).body.avatar!
    const second = (await upload(cookie, PNG)).body.avatar!
    expect(second).not.toBe(first)
    expect((await image(cookie, first)).status).toBe(404)
    expect((await http.del<UserDto>('/api/me/avatar')).body.avatar).toBeNull()
    expect((await image(cookie, second)).status).toBe(404)
  })

  it('accepts only images up to 2 MB', async () => {
    const cookie = await t.seed.cookie((await t.seed.user()).id)
    expect((await upload(cookie, Buffer.from('hello'), 'text/plain', 'a.txt')).status).toBe(400)
    expect((await upload(cookie, Buffer.from('<svg/>'), 'image/svg+xml', 'a.svg')).status).toBe(400)
    expect((await upload(cookie, Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png')).status).toBe(400)
  })
})

describe('个人头像 · 飞书', () => {
  it('adopts the linked Feishu avatar, and refuses without one', async () => {
    const wang = await t.seed.user()
    const http = client(t, await t.seed.cookie(wang.id))
    expect((await http.post('/api/me/avatar/feishu')).status).toBe(400)
    await t.db
      .insert(feishuIdentities)
      .values({ userId: wang.id, unionId: 'on_1', openId: 'ou_1', name: '王磊', avatar: FEISHU_AVATAR })
    const res = await http.post<UserDto>('/api/me/avatar/feishu')
    expect(res.status).toBe(200)
    expect(res.body.avatar).toBe(FEISHU_AVATAR)
  })
})

describe('PATCH /api/me · email', () => {
  it('sets, normalises and clears the email', async () => {
    const http = client(t, await t.seed.cookie((await t.seed.user()).id))
    expect((await http.patch<UserDto>('/api/me', { email: ' Wang@Corp.com ' })).body.email).toBe(
      'wang@corp.com',
    )
    expect((await http.patch('/api/me', { email: 'nope' })).status).toBe(400)
    expect((await http.patch<UserDto>('/api/me', { email: '' })).body.email).toBeNull()
  })
})
