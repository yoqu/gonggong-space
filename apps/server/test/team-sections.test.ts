import type {
  DirectoryGroupDto,
  GroupDto,
  JoinRequestDto,
  TeamSectionsDto,
  WebEvent,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupMembers, messages, notifications } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

/** 王磊 owns the team; 李建国 runs a group; 赵敏 is a plain member; 外队成员 is in another team. */
async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const other = await t.seed.team({ ownerId: (await t.seed.user({ name: '外队', teamId: null })).id })
  const stranger = await t.seed.user({ name: '外队成员', teamId: other.id })
  const g = await t.seed.group({ createdBy: li.id, name: '支付' })
  return {
    wang,
    li,
    zhao,
    g,
    as: {
      wang: client(t, await t.seed.cookie(wang.id)),
      li: client(t, await t.seed.cookie(li.id)),
      zhao: client(t, await t.seed.cookie(zhao.id)),
      stranger: client(t, await t.seed.cookie(stranger.id)),
    },
  }
}

const notes = (userId: string, type: string) =>
  t.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)))

describe('team sections', () => {
  it('lets team admins manage them and everyone in the team see them', async () => {
    const w = await world()
    expect((await w.as.zhao.post('/api/team-sections', { name: '支付线' })).status).toBe(403)
    const a = await w.as.wang.post<{ id: string }>('/api/team-sections', { name: '支付线' })
    const b = await w.as.wang.post<{ id: string }>('/api/team-sections', { name: '平台' })
    const seen = await w.as.zhao.get<TeamSectionsDto>('/api/team-sections')
    expect(seen.body).toEqual({
      sections: [
        { id: a.body.id, name: '支付线' },
        { id: b.body.id, name: '平台' },
      ],
      canManage: false,
    })
    expect((await w.as.wang.get<TeamSectionsDto>('/api/team-sections')).body.canManage).toBe(true)
    expect((await w.as.zhao.patch(`/api/team-sections/${a.body.id}`, { name: 'x' })).status).toBe(403)
    await w.as.wang.patch(`/api/team-sections/${a.body.id}`, { name: '支付与结算' })
    const order = await w.as.wang.put<{ name: string }[]>('/api/team-sections/order', {
      ids: [b.body.id, a.body.id],
    })
    expect(order.body.map((s) => s.name)).toEqual(['平台', '支付与结算'])
    expect((await w.as.stranger.get<TeamSectionsDto>('/api/team-sections')).body.sections).toEqual([])
  })

  it('files a group for group admins and team admins only, telling the group and the team', async () => {
    const w = await world()
    const sec = (await w.as.wang.post<{ id: string }>('/api/team-sections', { name: '支付线' })).body
    await t.db.insert(groupMembers).values({ groupId: w.g.id, userId: w.zhao.id })
    expect(
      (await w.as.zhao.put(`/api/groups/${w.g.id}/team-section`, { teamSectionId: sec.id })).status,
    ).toBe(403)
    const got: WebEvent[] = events(t, w.zhao.id)
    const res = await w.as.li.put<GroupDto>(`/api/groups/${w.g.id}/team-section`, { teamSectionId: sec.id })
    expect(res.body.teamSectionId).toBe(sec.id)
    expect(got.some((e) => e.t === 'directory.changed')).toBe(true)
    const [event] = await t.db.select().from(messages).where(eq(messages.groupId, w.g.id))
    expect(event?.body).toBe('李建国 将本群归入团队分区「支付线」')
    // A team admin outside the group can still file it (here: take it out).
    await t.db.insert(groupMembers).values({ groupId: w.g.id, userId: w.wang.id })
    const out = await w.as.wang.put<GroupDto>(`/api/groups/${w.g.id}/team-section`, { teamSectionId: null })
    expect(out.body.teamSectionId).toBeNull()
    const dm = await t.seed.group({ createdBy: w.li.id, kind: 'dm' })
    expect((await w.as.li.put(`/api/groups/${dm.id}/team-section`, { teamSectionId: sec.id })).status).toBe(
      400,
    )
  })

  it('shows filed groups I am not in, without messages, and drops them when unfiled or the section goes', async () => {
    const w = await world()
    const sec = (await w.as.wang.post<{ id: string }>('/api/team-sections', { name: '支付线' })).body
    await w.as.li.put(`/api/groups/${w.g.id}/team-section`, { teamSectionId: sec.id })
    const dir = await w.as.zhao.get<DirectoryGroupDto[]>('/api/team-directory')
    expect(dir.body).toEqual([
      {
        id: w.g.id,
        name: '支付',
        avatar: null,
        notice: '',
        memberCount: 1,
        visibility: 'private',
        teamSectionId: sec.id,
        admins: ['李建国'],
        requestId: null,
      },
    ])
    expect((await w.as.zhao.get<DirectoryGroupDto>(`/api/groups/${w.g.id}/preview`)).body.name).toBe('支付')
    expect((await w.as.zhao.get(`/api/groups/${w.g.id}/messages`)).status).toBe(404)
    expect((await w.as.li.get<DirectoryGroupDto[]>('/api/team-directory')).body).toEqual([])
    expect((await w.as.stranger.get(`/api/groups/${w.g.id}/preview`)).status).toBe(404)
    await w.as.wang.del(`/api/team-sections/${sec.id}`)
    expect((await w.as.zhao.get<DirectoryGroupDto[]>('/api/team-directory')).body).toEqual([])
    const g = await w.as.li.get<GroupDto>(`/api/groups/${w.g.id}`)
    expect(g.body.teamSectionId).toBeNull()
  })
})

describe('join requests', () => {
  async function filed() {
    const w = await world()
    const sec = (await w.as.wang.post<{ id: string }>('/api/team-sections', { name: '支付线' })).body
    await w.as.li.put(`/api/groups/${w.g.id}/team-section`, { teamSectionId: sec.id })
    return { ...w, sec }
  }

  it('asks the group admins, who let the requester in', async () => {
    const w = await filed()
    const res = await w.as.zhao.post<JoinRequestDto>(`/api/groups/${w.g.id}/join-requests`, {
      note: '想跟进退款',
    })
    expect(res.status).toBe(200)
    expect((await w.as.zhao.post(`/api/groups/${w.g.id}/join-requests`, {})).status).toBe(409)
    expect((await w.as.zhao.get<DirectoryGroupDto[]>('/api/team-directory')).body[0]?.requestId).toBe(
      res.body.id,
    )
    const [n] = await notes(w.li.id, 'join_request')
    expect(n?.payload).toMatchObject({
      requestId: res.body.id,
      groupId: w.g.id,
      byName: '赵敏',
      note: '想跟进退款',
    })
    expect((await w.as.zhao.get(`/api/groups/${w.g.id}/join-requests`)).status).toBe(404)
    const list = await w.as.li.get<JoinRequestDto[]>(`/api/groups/${w.g.id}/join-requests`)
    expect(list.body.map((r) => [r.userName, r.note])).toEqual([['赵敏', '想跟进退款']])
    expect((await w.as.zhao.post(`/api/join-requests/${res.body.id}/approve`)).status).toBe(404)

    const ok = await w.as.li.post<GroupDto>(`/api/join-requests/${res.body.id}/approve`)
    expect(ok.body.members.map((m) => m.name).sort()).toEqual(['李建国', '赵敏'].sort())
    expect((await w.as.zhao.get<GroupDto[]>('/api/groups')).body.map((g) => g.id)).toContain(w.g.id)
    const [decided] = await notes(w.zhao.id, 'join_decided')
    expect(decided?.payload).toMatchObject({ approved: true, byName: '李建国' })
    expect((await notes(w.li.id, 'join_request'))[0]?.resolvedAt).not.toBeNull()
    const bodies = (await t.db.select().from(messages).where(eq(messages.groupId, w.g.id))).map((m) => m.body)
    expect(bodies).toContain('李建国 同意 赵敏 加入群')
    expect((await w.as.li.post(`/api/join-requests/${res.body.id}/reject`)).status).toBe(404)
  })

  it('declines, cancels, and turns away public groups and outsiders', async () => {
    const w = await filed()
    const r1 = (await w.as.zhao.post<JoinRequestDto>(`/api/groups/${w.g.id}/join-requests`, {})).body
    expect((await w.as.li.post(`/api/join-requests/${r1.id}/reject`)).status).toBe(204)
    expect((await notes(w.zhao.id, 'join_decided'))[0]?.payload).toMatchObject({ approved: false })
    // Declined: may ask again, and take it back.
    const r2 = (await w.as.zhao.post<JoinRequestDto>(`/api/groups/${w.g.id}/join-requests`, {})).body
    expect((await w.as.wang.del(`/api/join-requests/${r2.id}`)).status).toBe(404)
    expect((await w.as.zhao.del(`/api/join-requests/${r2.id}`)).status).toBe(204)
    expect((await w.as.stranger.post(`/api/groups/${w.g.id}/join-requests`, {})).status).toBe(404)
    await w.as.li.patch(`/api/groups/${w.g.id}`, { visibility: 'public' })
    expect((await w.as.zhao.post(`/api/groups/${w.g.id}/join-requests`, {})).status).toBe(400)
    expect((await w.as.zhao.post(`/api/groups/${w.g.id}/join`)).status).toBe(200)
  })

  it('voids pending requests when the group leaves its section', async () => {
    const w = await filed()
    const r = (await w.as.zhao.post<JoinRequestDto>(`/api/groups/${w.g.id}/join-requests`, {})).body
    await w.as.li.put(`/api/groups/${w.g.id}/team-section`, { teamSectionId: null })
    expect((await w.as.li.post(`/api/join-requests/${r.id}/approve`)).status).toBe(404)
    expect((await notes(w.li.id, 'join_request'))[0]?.resolvedAt).not.toBeNull()
    expect((await w.as.zhao.post(`/api/groups/${w.g.id}/join-requests`, {})).status).toBe(404)
  })
})
