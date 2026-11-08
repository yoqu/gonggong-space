import type { GroupDto, MeDto, MessageDto, NotificationDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupMembers, pushSubscriptions } from '../src/db/schema.js'
import { inQuietTime } from '../src/modules/notifications/suppress.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const push = vi.hoisted(() => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'PUB', privateKey: 'PRIV' })),
  sendNotification: vi.fn(async (_sub: { endpoint: string }, _body: string, _opts: unknown) => ({
    statusCode: 201,
  })),
}))
vi.mock('web-push', () => ({ default: push }))
vi.mock('../src/modules/runs/trigger.js', () => ({ triggerRuns: vi.fn(async () => {}) }))

let t: TestApp
beforeEach(async () => {
  push.sendNotification.mockClear()
  vi.mocked(triggerRuns).mockClear()
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const chen = await t.seed.user({ name: '陈晨' })
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id, chen.id], botIds: [claude.id] })
  const as = async (id: string) => client(t, await t.seed.cookie(id))
  return {
    wang,
    li,
    chen,
    claude,
    g,
    asWang: await as(wang.id),
    asLi: await as(li.id),
    asChen: await as(chen.id),
  }
}

const send = (c: ReturnType<typeof client>, groupId: string, body: string, o: object = {}) =>
  c.post<MessageDto>(`/api/groups/${groupId}/messages`, { body, clientId: `c-${Math.random()}`, ...o })
const notes = async (c: ReturnType<typeof client>) =>
  (await c.get<NotificationDto[]>('/api/notifications')).body
const groupOf = async (c: ReturnType<typeof client>, id: string) =>
  (await c.get<GroupDto[]>('/api/groups')).body.find((g) => g.id === id)
const subscribe = (userId: string) =>
  t.db.insert(pushSubscriptions).values({
    userId,
    endpoint: `https://push.test/${userId}`,
    keys: { p256dh: 'k', auth: 'a' },
    locale: 'zh',
  })
const pushedTo = (userId: string) =>
  push.sendNotification.mock.calls
    .filter(([sub]) => sub.endpoint === `https://push.test/${userId}`)
    .map(([, body]) => JSON.parse(body) as { title: string; body: string; url: string })

describe('@所有人', () => {
  it('an admin @s every member but themselves, without triggering bots', async () => {
    const s = await setup()
    const res = await send(s.asWang, s.g.id, '@所有人 下午三点发版')
    expect(res.body.userMentions?.toSorted()).toEqual([s.li.id, s.chen.id].toSorted())
    expect(triggerRuns).not.toHaveBeenCalled()
    expect((await notes(s.asLi))[0]).toMatchObject({ type: 'mention', payload: { messageId: res.body.id } })
    expect(await notes(s.asChen)).toHaveLength(1)
    expect(await notes(s.asWang)).toEqual([])
    expect((await groupOf(s.asChen, s.g.id))?.mentionCount).toBe(1)
  })

  it('is plain text from a non-admin, in code or in a thread reply', async () => {
    const s = await setup()
    expect((await send(s.asLi, s.g.id, '@所有人 看下')).body.userMentions).toEqual([])
    expect((await send(s.asWang, s.g.id, '`@所有人` 是个写法')).body.userMentions).toEqual([])
    const root = (await send(s.asWang, s.g.id, '根')).body
    const reply = await send(s.asWang, s.g.id, '@所有人 话题里', { threadRootId: root.id })
    expect(reply.body.userMentions).toEqual([])
    expect(await notes(s.asChen)).toEqual([])
  })

  it('a group admin other than the owner may use it', async () => {
    const s = await setup()
    await t.db.update(groupMembers).set({ isAdmin: true }).where(eq(groupMembers.userId, s.li.id))
    const res = await send(s.asLi, s.g.id, '@所有人 看下')
    expect(res.body.userMentions?.toSorted()).toEqual([s.wang.id, s.chen.id].toSorted())
  })
})

describe('notify levels', () => {
  it('「关闭」 gets no @ notification or push, but still counts the @', async () => {
    const s = await setup()
    await subscribe(s.li.id)
    await s.asLi.put(`/api/groups/${s.g.id}/prefs`, { notifyLevel: 'off' })
    await send(s.asWang, s.g.id, '@李建国 看下')
    expect(await notes(s.asLi)).toEqual([])
    expect(pushedTo(s.li.id)).toEqual([])
    expect((await groupOf(s.asLi, s.g.id))?.mentionCount).toBe(1)
  })

  it('「全部」 pushes every new message without filling the notification list', async () => {
    const s = await setup()
    await subscribe(s.li.id)
    await subscribe(s.chen.id)
    await s.asLi.put(`/api/groups/${s.g.id}/prefs`, { notifyLevel: 'all' })
    await send(s.asWang, s.g.id, '普通消息')
    await vi.waitFor(() =>
      expect(pushedTo(s.li.id)).toEqual([
        expect.objectContaining({ body: expect.stringContaining('普通消息'), url: `/g/${s.g.id}` }),
      ]),
    )
    expect(await notes(s.asLi)).toEqual([])
    expect(pushedTo(s.chen.id)).toEqual([])
    // Own messages and thread-only replies never push.
    const root = (await send(s.asLi, s.g.id, '我自己说的')).body
    await send(s.asWang, s.g.id, '话题回复', { threadRootId: root.id })
    expect(pushedTo(s.li.id)).toHaveLength(1)
  })

  it('a DM notifies everything by default', async () => {
    const s = await setup()
    const dm = await s.asWang.post<GroupDto>('/api/groups', { name: 'x', kind: 'dm', botIds: [s.claude.id] })
    expect(dm.body.notifyLevel).toBe('all')
  })
})

describe('勿扰', () => {
  it('pausing holds back push but keeps the notification', async () => {
    const s = await setup()
    await subscribe(s.li.id)
    const until = new Date(Date.now() + 3600_000).toISOString()
    const me = await s.asLi.patch<MeDto>('/api/me', { notifyPrefs: { pausedUntil: until } })
    expect(me.body.notifyPrefs).toEqual({ pausedUntil: until })
    await send(s.asWang, s.g.id, '@李建国 看下')
    expect(await notes(s.asLi)).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 50))
    expect(pushedTo(s.li.id)).toEqual([])

    await s.asLi.patch('/api/me', { notifyPrefs: { pausedUntil: null } })
    await send(s.asWang, s.g.id, '@李建国 再看下')
    await vi.waitFor(() => expect(pushedTo(s.li.id)).toHaveLength(1))
  })

  it('quiet hours may cross midnight, in the user’s time zone', () => {
    const quietHours = { start: '22:00', end: '08:00', timezone: 'Asia/Shanghai' }
    // 15:30Z = 23:30 in Shanghai; 03:00Z = 11:00.
    expect(inQuietTime({ quietHours }, new Date('2026-11-08T15:30:00Z'))).toBe(true)
    expect(inQuietTime({ quietHours }, new Date('2026-11-08T23:59:00Z'))).toBe(true)
    expect(inQuietTime({ quietHours }, new Date('2026-11-08T03:00:00Z'))).toBe(false)
    const day = { start: '12:00', end: '13:30', timezone: 'Asia/Shanghai' }
    expect(inQuietTime({ quietHours: day }, new Date('2026-11-08T04:10:00Z'))).toBe(true)
    expect(inQuietTime({ quietHours: day }, new Date('2026-11-08T05:30:00Z'))).toBe(false)
    expect(inQuietTime({ pausedUntil: '2026-11-08T10:00:00Z' }, new Date('2026-11-08T09:00:00Z'))).toBe(true)
    expect(inQuietTime({ pausedUntil: '2026-11-08T10:00:00Z' }, new Date('2026-11-08T11:00:00Z'))).toBe(false)
    expect(inQuietTime({}, new Date())).toBe(false)
  })
})
