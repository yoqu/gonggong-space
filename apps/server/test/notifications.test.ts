import type { NotificationDto, NotificationUnreadDto, WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages, notifications, pushSubscriptions, runs, systemParams } from '../src/db/schema.js'
import { notify, resolveNotifications } from '../src/modules/notifications/notify.js'
import { isNotificationSuppressed } from '../src/modules/notifications/suppress.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
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
/** Notifications are about a group of the recipients' team. */
const someGroup = async (createdBy: string) => (await t.seed.group({ createdBy })).id

async function seedRun(
  userId: string,
  groupId: string,
  o: { parentRunId?: string; continuationOf?: string } = {},
) {
  const bot = await t.seed.bot({ ownerId: userId })
  const [message] = await t.db
    .insert(messages)
    .values({ groupId, kind: 'user', authorUserId: userId, body: '@bot' })
    .returning()
  const [run] = await t.db
    .insert(runs)
    .values({
      groupId,
      botId: bot.id,
      triggerMessageId: message!.id,
      originUserId: userId,
      status: 'completed',
      parentRunId: o.parentRunId,
      continuationOf: o.continuationOf,
    })
    .returning()
  return run!
}

describe('notification center', () => {
  it('marks all of my notifications read, leaving other users alone', async () => {
    const a = await login()
    const b = await login()
    const g = await someGroup(a.user.id)
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: g, hops: 2 })
    await notify(t.ctx, a.user.id, 'offline_expired', { groupId: g })
    await notify(t.ctx, b.user.id, 'chain_done', { groupId: g, hops: 2 })
    expect((await a.api.post('/api/notifications/read-all')).status).toBe(204)
    const mine = (await a.api.get<NotificationDto[]>('/api/notifications')).body
    expect(mine).toHaveLength(2)
    expect(mine.every((n) => n.readAt)).toBe(true)
    const theirs = (await b.api.get<NotificationDto[]>('/api/notifications')).body
    expect(theirs[0]!.readAt).toBeNull()
  })

  it('deletes one of my notifications, but not someone else’s', async () => {
    const a = await login()
    const b = await login()
    const g = await someGroup(a.user.id)
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: g, hops: 2 })
    await notify(t.ctx, b.user.id, 'chain_done', { groupId: g, hops: 2 })
    const [mine] = (await a.api.get<NotificationDto[]>('/api/notifications')).body
    const [theirs] = (await b.api.get<NotificationDto[]>('/api/notifications')).body
    expect((await a.api.del(`/api/notifications/${theirs!.id}`)).status).toBe(404)
    expect((await a.api.del(`/api/notifications/${mine!.id}`)).status).toBe(204)
    expect((await a.api.get<NotificationDto[]>('/api/notifications')).body).toEqual([])
    expect((await b.api.get<NotificationDto[]>('/api/notifications')).body).toHaveLength(1)
  })

  it('skips notifications of retired types (the lock era)', async () => {
    const a = await login()
    const g = await someGroup(a.user.id)
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: g, hops: 2 })
    const [kept] = await t.db.select().from(notifications)
    await t.db
      .insert(notifications)
      .values({ userId: a.user.id, teamId: kept!.teamId, type: 'lock', payload: { groupId: g } })
    const list = (await a.api.get<NotificationDto[]>('/api/notifications')).body
    expect(list.map((n) => n.type)).toEqual(['chain_done'])
    const me = (await a.api.get<{ teams: { unread: number }[] }>('/api/me')).body
    expect(me.teams.map((x) => x.unread)).toEqual([1])
  })

  it('clears my read notifications, keeping unread ones', async () => {
    const a = await login()
    const b = await login()
    const g = await someGroup(a.user.id)
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: g, hops: 2 })
    await notify(t.ctx, b.user.id, 'chain_done', { groupId: g, hops: 2 })
    await a.api.post('/api/notifications/read-all')
    await b.api.post('/api/notifications/read-all')
    await notify(t.ctx, a.user.id, 'offline_expired', { groupId: g })
    expect((await a.api.del('/api/notifications/read')).status).toBe(204)
    const left = (await a.api.get<NotificationDto[]>('/api/notifications')).body
    expect(left.map((n) => n.type)).toEqual(['offline_expired'])
    expect((await b.api.get<NotificationDto[]>('/api/notifications')).body).toHaveLength(1)
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

describe('unread badge', () => {
  const unread = async (api: ReturnType<typeof client>) =>
    (await api.get<NotificationUnreadDto>('/api/notifications/unread')).body

  it('counts unread notifications in the list’s scope: the open team and platform notices', async () => {
    const a = await login()
    const b = await login()
    const other = await t.seed.team({ ownerId: a.user.id })
    const g = await someGroup(a.user.id)
    const otherGroup = (await t.seed.group({ createdBy: a.user.id, teamId: other.id })).id
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: g, hops: 2 })
    await notify(t.ctx, a.user.id, 'offline_expired', { groupId: g })
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: otherGroup, hops: 2 })
    await notify(t.ctx, a.user.id, 'bot_confirm', { botName: 'B', byName: '陈晨' })
    await notify(t.ctx, b.user.id, 'chain_done', { groupId: g, hops: 2 })
    const [kept] = await t.db.select().from(notifications).where(eq(notifications.type, 'offline_expired'))
    await t.db
      .insert(notifications)
      .values({ userId: a.user.id, teamId: kept!.teamId, type: 'lock', payload: {} })
    await a.api.post(`/api/notifications/${kept!.id}/read`)

    expect(await unread(a.api)).toEqual({ n: 2 })
    const inOther = client(t, await t.seed.cookie(a.user.id), other.id)
    expect(await unread(inOther)).toEqual({ n: 2 })
    await inOther.post('/api/notifications/read-all')
    expect(await unread(inOther)).toEqual({ n: 0 })
    expect(await unread(a.api)).toEqual({ n: 1 })
  })

  it('stops counting at 100, which the badge shows as 99+', async () => {
    const a = await login()
    const g = await someGroup(a.user.id)
    await notify(t.ctx, a.user.id, 'chain_done', { groupId: g, hops: 2 })
    const [first] = await t.db.select().from(notifications)
    await t.db.insert(notifications).values(
      Array.from({ length: 120 }, () => ({
        userId: a.user.id,
        teamId: first!.teamId,
        type: 'chain_done',
        payload: { groupId: g },
      })),
    )
    expect(await unread(a.api)).toEqual({ n: 100 })
  })
})

describe('web push', () => {
  it('suppresses delivery only while the recipient is reading the notification group', () => {
    const isReading = (_userId: string, groupId: string) => groupId === 'g1'
    const notification = (payload: Record<string, unknown>) => ({ payload }) as NotificationDto
    expect(isNotificationSuppressed(isReading, 'u1', notification({ groupId: 'g1' }))).toBe(true)
    expect(isNotificationSuppressed(isReading, 'u1', notification({ groupId: 'g2' }))).toBe(false)
    expect(isNotificationSuppressed(isReading, 'u1', notification({}))).toBe(false)
  })

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
    const g = (await t.seed.group({ createdBy: user.id, name: '支付' })).id
    await api.post('/api/push/subscriptions', sub('https://push.test/a'))
    await api.post('/api/push/subscriptions', sub('https://push.test/b'))
    await notify(t.ctx, user.id, 'bot_confirm', { botName: 'B', byName: '陈晨' })
    await notify(t.ctx, user.id, 'approval', {
      groupId: g,
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
      url: `/g/${g}?run=r1`,
    })
    expect(opts.vapidDetails.publicKey).toBe('PUB')
  })

  it('drops subscriptions the push service reports as gone (404/410) and keeps them on other errors', async () => {
    const { user, api } = await login()
    const g = await someGroup(user.id)
    await api.post('/api/push/subscriptions', sub('https://push.test/gone'))
    await api.post('/api/push/subscriptions', sub('https://push.test/flaky'))
    push.sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      throw Object.assign(new Error('push failed'), { statusCode: s.endpoint.endsWith('gone') ? 410 : 500 })
    })
    await notify(t.ctx, user.id, 'chain_done', { groupId: g, hops: 2 })
    await vi.waitFor(async () => {
      const rows = await t.db.select().from(pushSubscriptions)
      expect(rows.map((r) => r.endpoint)).toEqual(['https://push.test/flaky'])
    })
    expect(await t.db.select().from(notifications)).toHaveLength(1)
    push.sendNotification.mockImplementation(async () => ({ statusCode: 201 }))
  })

  it('stays quiet while the user is reading that group on a visible, focused page', async () => {
    const { user, api } = await login()
    const g = await someGroup(user.id)
    await api.post('/api/push/subscriptions', sub('https://push.test/read'))
    const ws = t.ws('/ws/web', {
      cookie: await t.seed.cookie(user.id),
      origin: `http://${new URL(t.url('/')).host}`,
    })
    await inbox(ws).opened
    await expect.poll(() => t.ctx.bus.isConnected(user.id)).toBe(true)
    const say = async (msg: object) => {
      ws.send(JSON.stringify(msg))
      await new Promise((r) => {
        ws.once('pong', r)
        ws.ping()
      })
    }
    const send = () =>
      notify(t.ctx, user.id, 'approval', {
        groupId: g,
        runId: 'r1',
        botName: 'codex',
        title: 'go build',
      })

    await say({ t: 'focus', groupId: g })
    await say({ t: 'visible', visible: true })
    await send()
    await new Promise((r) => setTimeout(r, 50))
    expect(push.sendNotification).not.toHaveBeenCalled()

    await say({ t: 'visible', visible: false })
    await send()
    await vi.waitFor(() => expect(push.sendNotification).toHaveBeenCalledTimes(1))
    ws.close()
  })

  it('uses one task tag across continuations, relay hops and chain completion', async () => {
    const { user, api } = await login()
    const g = await someGroup(user.id)
    const root = await seedRun(user.id, g)
    const continuation = await seedRun(user.id, g, { continuationOf: root.id })
    const relay = await seedRun(user.id, g, { parentRunId: root.id })
    await api.post('/api/push/subscriptions', sub('https://push.test/task'))

    await notify(t.ctx, user.id, 'approval', {
      groupId: g,
      runId: continuation.id,
      botName: 'codex',
      title: 'go build',
    })
    await notify(t.ctx, user.id, 'question', {
      groupId: g,
      runId: relay.id,
      botName: 'codex',
      count: 1,
    })
    await notify(t.ctx, user.id, 'chain_done', {
      groupId: g,
      rootRunId: root.id,
      hops: 2,
    })

    await vi.waitFor(() => expect(push.sendNotification).toHaveBeenCalledTimes(3))
    const tags = push.sendNotification.mock.calls.map((call) => JSON.parse(call[1] as string).tag)
    expect(tags).toEqual([`task:${root.id}`, `task:${root.id}`, `task:${root.id}`])
  })

  it('does not merge notifications without the same stable business key', async () => {
    const { user, api } = await login()
    const botA = await t.seed.bot({ ownerId: user.id, name: 'A' })
    const botB = await t.seed.bot({ ownerId: user.id, name: 'B' })
    await api.post('/api/push/subscriptions', sub('https://push.test/objects'))

    await notify(t.ctx, user.id, 'bot_share_request', {
      requestId: 'share-a',
      botId: botA.id,
      botName: 'A',
    })
    await notify(t.ctx, user.id, 'bot_share_request', {
      requestId: 'share-b',
      botId: botB.id,
      botName: 'B',
    })
    await notify(t.ctx, user.id, 'bot_share_decided', {
      botId: botA.id,
      botName: 'A',
      byName: '王磊',
      approved: false,
    })

    await vi.waitFor(() => expect(push.sendNotification).toHaveBeenCalledTimes(3))
    const payloads = push.sendNotification.mock.calls.map((call) => JSON.parse(call[1] as string))
    const tags = payloads.flatMap((body) => (body.tag === undefined ? [] : [body.tag]))
    expect(tags).toHaveLength(2)
    expect(tags).toEqual(expect.arrayContaining(['bot-share-request:share-a', 'bot-share-request:share-b']))
    expect(payloads.filter((body) => body.tag === undefined)).toHaveLength(1)
  })
})
