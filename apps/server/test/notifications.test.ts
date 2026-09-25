import type { NotificationDto, WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifications, pushSubscriptions, systemParams } from '../src/db/schema.js'
import { notify, resolveNotifications } from '../src/modules/notifications/notify.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const push = vi.hoisted(() => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'PUB', privateKey: 'PRIV' })),
  sendNotification: vi.fn(async (_sub: { endpoint: string }, _body: string, _opts: unknown) => ({
    statusCode: 201,
  })),
}))
vi.mock('web-push', () => ({ default: push }))

let t: TestApp
beforeEach(async () => {
  push.sendNotification.mockClear()
  push.generateVAPIDKeys.mockClear()
  t = await createTestApp()
})
afterEach(() => t.close())

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } })

async function login() {
  const user = await t.seed.user()
  return { user, api: client(t, await t.seed.cookie(user.id)) }
}

describe('notification center', () => {
  it('marks all of my notifications read, leaving other users alone', async () => {
    const a = await login()
    const b = await login()
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: 'g', hops: 2 })
    await notify(t.ctx, a.user.id, 'offline_expired', { groupId: 'g' })
    await notify(t.ctx, b.user.id, 'chain_done', { groupId: 'g', hops: 2 })
    expect((await a.api.post('/api/notifications/read-all')).status).toBe(204)
    const mine = (await a.api.get<NotificationDto[]>('/api/notifications')).body
    expect(mine).toHaveLength(2)
    expect(mine.every((n) => n.readAt)).toBe(true)
    const theirs = (await b.api.get<NotificationDto[]>('/api/notifications')).body
    expect(theirs[0]!.readAt).toBeNull()
  })

  it('resolves the notifications of a settled request for every recipient and tells them live', async () => {
    const a = await login()
    const b = await login()
    const seen: WebEvent[] = []
    t.ctx.bus.attach(a.user.id, (e) => seen.push(e))
    await notify(t.ctx, a.user.id, 'question', { questionSetId: 'q1' })
    await notify(t.ctx, a.user.id, 'question', { questionSetId: 'q2' })
    await notify(t.ctx, b.user.id, 'question', { questionSetId: 'q1' })
    await notify(t.ctx, a.user.id, 'approval', { approvalId: 'q1' })
    await b.api.post('/api/notifications/read-all')
    const [bRead] = (await b.api.get<NotificationDto[]>('/api/notifications')).body

    await resolveNotifications(t.ctx, 'question', 'questionSetId', ['q1'])
    const mine = (await a.api.get<NotificationDto[]>('/api/notifications')).body
    const q1 = mine.find((n) => n.payload.questionSetId === 'q1')!
    expect(q1.resolvedAt).not.toBeNull()
    expect(q1.readAt).toBe(q1.resolvedAt)
    expect(mine.filter((n) => n.id !== q1.id).every((n) => !n.resolvedAt && !n.readAt)).toBe(true)
    const [theirs] = (await b.api.get<NotificationDto[]>('/api/notifications')).body
    expect(theirs).toMatchObject({ readAt: bRead!.readAt, resolvedAt: expect.any(String) })
    expect(seen.filter((e) => e.t === 'notification.resolved')).toEqual([
      { t: 'notification.resolved', notifications: [q1], unread: 2 },
    ])

    await resolveNotifications(t.ctx, 'question', 'questionSetId', ['q1'])
    expect(seen.filter((e) => e.t === 'notification.resolved')).toHaveLength(1)
  })
})

describe('web push', () => {
  it('generates the VAPID key pair once and keeps it in system params', async () => {
    const { api } = await login()
    expect((await api.get('/api/push/key')).body).toEqual({ publicKey: 'PUB' })
    expect((await api.get('/api/push/key')).body).toEqual({ publicKey: 'PUB' })
    expect(push.generateVAPIDKeys).toHaveBeenCalledTimes(1)
    const [row] = await t.db.select().from(systemParams).where(eq(systemParams.key, 'vapidKeys'))
    expect(row?.value).toEqual({ publicKey: 'PUB', privateKey: 'PRIV' })
  })

  it('stores subscriptions per browser endpoint and removes only my own', async () => {
    const a = await login()
    const b = await login()
    expect((await a.api.post('/api/push/subscriptions', { endpoint: 'nope', keys: {} })).status).toBe(400)
    expect((await a.api.post('/api/push/subscriptions', sub('https://push.test/1'))).status).toBe(204)
    // The same browser logging in as someone else moves the subscription over.
    expect((await b.api.post('/api/push/subscriptions', sub('https://push.test/1'))).status).toBe(204)
    let rows = await t.db.select().from(pushSubscriptions)
    expect(rows.map((r) => r.userId)).toEqual([b.user.id])
    const q = `?endpoint=${encodeURIComponent('https://push.test/1')}`
    expect((await a.api.del(`/api/push/subscriptions${q}`)).status).toBe(204)
    expect(await t.db.select().from(pushSubscriptions)).toHaveLength(1)
    expect((await b.api.del(`/api/push/subscriptions${q}`)).status).toBe(204)
    rows = await t.db.select().from(pushSubscriptions)
    expect(rows).toHaveLength(0)
  })

  it('pushes only actionable types, with the notification text and link', async () => {
    const { user, api } = await login()
    await api.post('/api/push/subscriptions', sub('https://push.test/a'))
    await api.post('/api/push/subscriptions', sub('https://push.test/b'))
    await notify(t.ctx, user.id, 'bot_confirm', { botName: 'B', byName: '陈晨' })
    await notify(t.ctx, user.id, 'approval', {
      groupId: 'g1',
      groupName: '支付',
      runId: 'r1',
      botName: '小王的 Claude',
      title: 'go build',
    })
    await vi.waitFor(() => expect(push.sendNotification).toHaveBeenCalledTimes(2))
    const [target, body, opts] = push.sendNotification.mock.calls[0] as unknown as [
      { endpoint: string },
      string,
      { vapidDetails: { publicKey: string } },
    ]
    expect(target.endpoint).toMatch(/^https:\/\/push\.test\//)
    expect(JSON.parse(body)).toEqual({
      title: '待审批 · 支付',
      body: '小王的 Claude 请求执行 go build',
      url: '/g/g1?run=r1',
    })
    expect(opts.vapidDetails.publicKey).toBe('PUB')
  })

  it('drops subscriptions the push service reports as gone (404/410) and keeps them on other errors', async () => {
    const { user, api } = await login()
    await api.post('/api/push/subscriptions', sub('https://push.test/gone'))
    await api.post('/api/push/subscriptions', sub('https://push.test/flaky'))
    push.sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      throw Object.assign(new Error('push failed'), { statusCode: s.endpoint.endsWith('gone') ? 410 : 500 })
    })
    await notify(t.ctx, user.id, 'chain_done', { groupId: 'g', hops: 2 })
    await vi.waitFor(async () => {
      const rows = await t.db.select().from(pushSubscriptions)
      expect(rows.map((r) => r.endpoint)).toEqual(['https://push.test/flaky'])
    })
    expect(await t.db.select().from(notifications)).toHaveLength(1)
    push.sendNotification.mockImplementation(async () => ({ statusCode: 201 }))
  })
})
