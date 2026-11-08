import type { ChannelDto, GroupDto, SidebarSectionDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const other = await t.seed.team({ ownerId: (await t.seed.user({ name: '外队', teamId: null })).id })
  const stranger = await t.seed.user({ name: '外队成员', teamId: other.id })
  return {
    wang,
    li,
    stranger,
    other,
    as: {
      wang: client(t, await t.seed.cookie(wang.id)),
      li: client(t, await t.seed.cookie(li.id)),
      stranger: client(t, await t.seed.cookie(stranger.id)),
    },
  }
}

describe('sidebar sections', () => {
  it('creates, renames, reorders and deletes my own sections', async () => {
    const w = await world()
    const a = await w.as.wang.post<SidebarSectionDto>('/api/sidebar-sections', { name: '发版' })
    const b = await w.as.wang.post<SidebarSectionDto>('/api/sidebar-sections', { name: '运维' })
    expect(a.status).toBe(200)
    expect(
      (await w.as.wang.get<SidebarSectionDto[]>('/api/sidebar-sections')).body.map((s) => s.name),
    ).toEqual(['发版', '运维'])
    await w.as.wang.patch(`/api/sidebar-sections/${a.body.id}`, { name: '发版 & 运维' })
    const order = await w.as.wang.put<SidebarSectionDto[]>('/api/sidebar-sections/order', {
      ids: [b.body.id, a.body.id],
    })
    expect(order.body.map((s) => s.name)).toEqual(['运维', '发版 & 运维'])
    // Someone else's sections are not mine to see or touch.
    expect((await w.as.li.get<SidebarSectionDto[]>('/api/sidebar-sections')).body).toEqual([])
    expect((await w.as.li.patch(`/api/sidebar-sections/${a.body.id}`, { name: 'x' })).status).toBe(404)
    expect((await w.as.li.del(`/api/sidebar-sections/${a.body.id}`)).status).toBe(404)
    expect((await w.as.wang.del(`/api/sidebar-sections/${b.body.id}`)).status).toBe(204)
    expect((await w.as.wang.get<SidebarSectionDto[]>('/api/sidebar-sections')).body.map((s) => s.id)).toEqual(
      [a.body.id],
    )
  })

  it('nests my sections three deep, only under my own, and deletes a subtree at once', async () => {
    const w = await world()
    const post = (name: string, parentId?: string) =>
      w.as.wang.post<SidebarSectionDto>('/api/sidebar-sections', { name, parentId })
    const a = (await post('研发')).body
    const b = (await post('支付线', a.id)).body
    const c = (await post('结算', b.id)).body
    expect(c.parentId).toBe(b.id)
    expect((await post('太深', c.id)).status).toBe(400)
    expect((await w.as.li.post('/api/sidebar-sections', { name: 'x', parentId: a.id })).status).toBe(404)
    const g = await t.seed.group({ createdBy: w.wang.id })
    await w.as.wang.put(`/api/groups/${g.id}/prefs`, { sectionId: c.id })
    await w.as.wang.del(`/api/sidebar-sections/${a.id}`)
    expect((await w.as.wang.get<SidebarSectionDto[]>('/api/sidebar-sections')).body).toEqual([])
    const mine = await w.as.wang.get<GroupDto[]>('/api/groups')
    expect(mine.body.find((x) => x.id === g.id)?.sectionId).toBeNull()
  })

  it('files a conversation under my section for me only, and deleting the section sends it back', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.wang.id, memberIds: [w.li.id] })
    const sec = (await w.as.wang.post<SidebarSectionDto>('/api/sidebar-sections', { name: '发版' })).body
    const got = events(t, w.wang.id)
    const res = await w.as.wang.put<GroupDto>(`/api/groups/${g.id}/prefs`, { sectionId: sec.id })
    expect(res.body.sectionId).toBe(sec.id)
    expect(got.some((e) => e.t === 'group.updated' && e.group.sectionId === sec.id)).toBe(true)
    const lis = await w.as.li.get<GroupDto[]>('/api/groups')
    expect(lis.body.find((x) => x.id === g.id)?.sectionId).toBeNull()
    // Not into someone else's section.
    const liSec = (await w.as.li.post<SidebarSectionDto>('/api/sidebar-sections', { name: '李的' })).body
    expect((await w.as.wang.put(`/api/groups/${g.id}/prefs`, { sectionId: liSec.id })).status).toBe(404)
    await w.as.wang.del(`/api/sidebar-sections/${sec.id}`)
    const mine = await w.as.wang.get<GroupDto[]>('/api/groups')
    expect(mine.body.find((x) => x.id === g.id)?.sectionId).toBeNull()
  })
})

describe('public channels', () => {
  it('lists the team public channels in 浏览频道 and lets anyone in the team join', async () => {
    const w = await world()
    const pub = await t.seed.group({ createdBy: w.wang.id, name: '公告', visibility: 'public' })
    await t.seed.group({ createdBy: w.wang.id, name: '机密' })
    const list = await w.as.li.get<ChannelDto[]>('/api/channels')
    expect(list.body.map((c) => [c.name, c.joined, c.memberCount])).toEqual([['公告', false, 1]])
    expect((await w.as.li.get<ChannelDto[]>('/api/channels?q=机')).body).toEqual([])
    const got = events(t, w.li.id)
    const joined = await w.as.li.post<GroupDto>(`/api/groups/${pub.id}/join`)
    expect(joined.status).toBe(200)
    expect(joined.body.members.map((m) => m.name).sort()).toEqual(['李建国', '王磊'].sort())
    expect(got.some((e) => e.t === 'group.updated')).toBe(true)
    expect((await w.as.li.get<ChannelDto[]>('/api/channels')).body[0]?.joined).toBe(true)
    // Joining twice is harmless.
    expect((await w.as.li.post(`/api/groups/${pub.id}/join`)).status).toBe(200)
  })

  it('keeps private groups and other teams out of reach', async () => {
    const w = await world()
    const priv = await t.seed.group({ createdBy: w.wang.id, name: '机密' })
    const pub = await t.seed.group({ createdBy: w.wang.id, name: '公告', visibility: 'public' })
    expect((await w.as.li.post(`/api/groups/${priv.id}/join`)).status).toBe(404)
    expect((await w.as.stranger.post(`/api/groups/${pub.id}/join`)).status).toBe(404)
    expect((await w.as.stranger.get<ChannelDto[]>('/api/channels')).body).toEqual([])
  })

  it('lets a group admin switch a group between public and private, and creates public ones', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.wang.id, memberIds: [w.li.id] })
    expect((await w.as.li.patch(`/api/groups/${g.id}`, { visibility: 'public' })).status).toBe(403)
    const res = await w.as.wang.patch<GroupDto>(`/api/groups/${g.id}`, { visibility: 'public' })
    expect(res.body.visibility).toBe('public')
    const made = await w.as.wang.post<GroupDto>('/api/groups', {
      name: '新频道',
      kind: 'group',
      visibility: 'public',
    })
    expect(made.body.visibility).toBe('public')
    const dm = await w.as.wang.post<GroupDto>('/api/groups', {
      name: '私聊',
      kind: 'dm',
      visibility: 'public',
    })
    expect(dm.body.visibility).toBe('private')
    expect((await w.as.wang.patch(`/api/groups/${dm.body.id}`, { visibility: 'public' })).status).toBe(400)
  })
})
