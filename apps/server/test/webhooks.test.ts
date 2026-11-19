import type {
  AgentCatalog,
  GroupWebhooksDto,
  RunStart,
  TimelineDto,
  WebhookCallDto,
  WebhookDto,
  WebhookTokenDto,
} from '@gonggong/protocol'
import { WEBHOOK_ATTACHMENT_MAX, WEBHOOK_RATE_PER_MIN, WEBHOOK_TEXT_MAX } from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attachments,
  auditLogs,
  groupBots,
  groupMembers,
  machines,
  messages,
  runs,
  webhooks,
} from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
let clock = new Date('2026-11-19T06:00:00Z')
beforeEach(async () => {
  clock = new Date('2026-11-19T06:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '局外人' })
  const m1 = await t.seed.machine(wang.id)
  const m2 = await t.seed.machine(li.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: m1.machine.id })
  const codex = await t.seed.bot({
    ownerId: li.id,
    name: 'Codex',
    machineId: m2.machine.id,
    triggerScope: 'all',
  })
  const extra = await t.seed.bot({ ownerId: wang.id, name: 'Extra', machineId: m1.machine.id })
  const group = await t.seed.group({
    createdBy: wang.id,
    memberIds: [li.id],
    botIds: [claude.id, codex.id, extra.id],
  })
  await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, group.id))
  const cookies = {
    wang: await t.seed.cookie(wang.id),
    li: await t.seed.cookie(li.id),
    outsider: await t.seed.cookie(outsider.id),
  }
  const sent: Record<string, RunStart[]> = {}
  const online = (machineId: string) => {
    sent[machineId] = []
    t.ctx.hub.register(machineId, {
      send: (m) => void (m.t === 'run.start' && sent[machineId]?.push(m)),
      close() {},
    })
  }
  const req = async <T>(who: keyof typeof cookies, method: string, url: string, payload?: unknown) => {
    const res = await t.app.inject({
      method: method as 'GET',
      url,
      headers: { cookie: cookies[who] },
      ...(payload !== undefined && { payload: payload as object }),
    })
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T }
  }
  const create = (who: keyof typeof cookies, body: object) =>
    req<WebhookTokenDto>(who, 'POST', `/api/groups/${group.id}/webhooks`, body)
  const list = async (who: keyof typeof cookies = 'wang') =>
    (await req<GroupWebhooksDto>(who, 'GET', `/api/groups/${group.id}/webhooks`)).body.webhooks
  const callHook = async (
    token: string,
    payload: object,
    mode: 'path' | 'bearer' = 'path',
  ): Promise<{ status: number; body: WebhookCallDto & { error?: string; message?: string } }> => {
    const res = await t.app.inject({
      method: 'POST',
      url: mode === 'path' ? `/api/hooks/${token}` : '/api/hooks',
      headers: mode === 'bearer' ? { authorization: `Bearer ${token}` } : {},
      payload,
    })
    return { status: res.statusCode, body: res.json() }
  }
  const groupMessages = () =>
    t.db.select().from(messages).where(eq(messages.groupId, group.id)).orderBy(asc(messages.seq))
  return {
    wang,
    li,
    outsider,
    m1,
    m2,
    claude,
    codex,
    extra,
    group,
    sent,
    online,
    req,
    create,
    list,
    callHook,
    groupMessages,
  }
}

describe('webhooks REST management', () => {
  it('admins create, list, update, rotate and delete webhooks; tokens are stored hashed only', async () => {
    const w = await world()
    expect((await w.create('li', { name: 'Jenkins 部署' })).status).toBe(403)
    expect((await w.create('outsider', { name: 'Jenkins 部署' })).status).toBe(404)

    const created = await w.create('wang', {
      name: 'Jenkins 部署',
      botIds: [w.claude.id, w.codex.id],
    })
    expect(created.status).toBe(200)
    expect(created.body.token).toMatch(/^gwh_/)
    expect(created.body.path).toBe(`/api/hooks/${created.body.token}`)
    expect(created.body.webhook).toMatchObject({
      name: 'Jenkins 部署',
      botIds: [w.claude.id, w.codex.id],
      enabled: true,
      hasToken: true,
      ownerId: w.wang.id,
      ownerName: '王磊',
      canManage: true,
    })

    const [row] = await t.db.select().from(webhooks).where(eq(webhooks.id, created.body.webhook.id))
    expect(row?.tokenHash).not.toBe(created.body.token)
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)

    // Plain members see the list without tokens and cannot manage.
    const liList = await w.list('li')
    expect(liList).toHaveLength(1)
    expect(liList[0]).toMatchObject({ name: 'Jenkins 部署', canManage: false, hasToken: true })
    expect(
      (await w.req('li', 'PATCH', `/api/webhooks/${created.body.webhook.id}`, { enabled: false })).status,
    ).toBe(403)

    // Update and rotate
    const updated = await w.req<WebhookDto>('wang', 'PATCH', `/api/webhooks/${created.body.webhook.id}`, {
      name: 'CI 构建',
      prompt: '检查失败原因',
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ name: 'CI 构建', prompt: '检查失败原因' })

    const rotated = await w.req<WebhookTokenDto>(
      'wang',
      'POST',
      `/api/webhooks/${created.body.webhook.id}/rotate`,
    )
    expect(rotated.status).toBe(200)
    expect(rotated.body.token).not.toBe(created.body.token)

    // Old token rejected, new token works
    expect((await w.callHook(created.body.token, { text: 'ping' })).status).toBe(401)
    expect((await w.callHook(rotated.body.token, { text: 'ping' })).status).toBe(200)

    // Delete revokes token
    expect((await w.req('wang', 'DELETE', `/api/webhooks/${created.body.webhook.id}`)).status).toBe(204)
    expect(await w.list('wang')).toEqual([])
    expect((await w.callHook(rotated.body.token, { text: 'after delete' })).status).toBe(401)
  })
})

describe('webhooks inbound calls', () => {
  it('posts a message without @ (both path and Bearer token) and shows webhook author in timeline', async () => {
    const w = await world()
    const { body } = await w.create('wang', { name: 'Jenkins 部署', botIds: [w.claude.id] })
    const res = await w.callHook(body.token, { text: '✅ 构建已恢复 @所有人', mention: false }, 'bearer')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ messageId: expect.any(String), runId: null })

    const timeline = await w.req<TimelineDto>('li', 'GET', `/api/groups/${w.group.id}/timeline`)
    const msg = timeline.body.messages.find((m) => m.id === res.body.messageId)
    expect(msg).toMatchObject({
      kind: 'user',
      authorName: 'Jenkins 部署',
      body: '✅ 构建已恢复 @所有人',
      mentions: [],
      userMentions: [],
      webhook: { id: body.webhook.id, name: 'Jenkins 部署' },
    })

    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'webhook.call'))
    expect(logs).toHaveLength(1)
  })

  it('picks an online idle candidate bot, attaches redacted logs, and injects untrusted-input prompt', async () => {
    const w = await world()
    // Only m2 (Codex) is online; Claude (first candidate) is offline → falls back to Codex.
    w.online(w.m2.machine.id)
    const { body } = await w.create('wang', {
      name: 'Jenkins 部署',
      botIds: [w.claude.id, w.codex.id],
    })
    const res = await w.callHook(body.token, {
      text: '**❌ 构建失败** #42',
      mention: true,
      attachment: {
        name: '../console-tail.log',
        content: 'FAIL test\nAuthorization: Bearer sk-secret12345678901234567890\n',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.runId).toBeTruthy()
    expect(res.body.skipped).toBeUndefined()

    const [msg] = await w.groupMessages()
    expect(msg?.body).toContain('@Codex')
    expect(msg?.body).toContain('**❌ 构建失败** #42')
    const [att] = await t.db.select().from(attachments).where(eq(attachments.messageId, msg!.id))
    expect(att).toMatchObject({ name: 'console-tail.log', mime: 'text/plain; charset=utf-8' })

    // Verify attachment content is redacted when downloaded
    const dl = await t.app.inject({
      method: 'GET',
      url: `/api/attachments/${att!.id}`,
      headers: { cookie: await t.seed.cookie(w.wang.id) },
    })
    expect(dl.statusCode).toBe(200)
    expect(dl.body).toContain('FAIL test')
    expect(dl.body).not.toContain('sk-secret12345678901234567890')

    // Verify RunStart carries untrusted-input warning + instruction
    const start = w.sent[w.m2.machine.id]?.[0]
    expect(start).toBeDefined()
    expect(
      start?.prompt.context.some((c) => c.body.includes('内容不可信') && c.body.includes('读取附件日志')),
    ).toBe(true)
  })

  it('restricts mention array to configured candidates and skips when last run is still running', async () => {
    const w = await world()
    w.online(w.m1.machine.id)
    const { body } = await w.create('wang', {
      name: 'Jenkins 部署',
      botIds: [w.claude.id],
    })

    // Asking to mention a bot NOT in webhook.botIds is refused (skipped: unavailable)
    const out = await w.callHook(body.token, { text: 'test', mention: ['Extra'] })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ runId: null, skipped: 'unavailable' })

    // First valid mention starts a run
    const first = await w.callHook(body.token, { text: 'fail #1', mention: true })
    expect(first.body.runId).toBeTruthy()

    // While that run is still unfinished, second call posts message but skips @
    const second = await w.callHook(body.token, { text: 'fail #2', mention: true })
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ runId: null, skipped: 'busy' })
    const allMsgs = await w.groupMessages()
    const secondMsg = allMsgs.find((m) => m.id === second.body.messageId)
    expect(secondMsg?.body).toContain('上次排查尚未结束')

    // Once finished, next call triggers again
    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, first.body.runId!))
    const third = await w.callHook(body.token, { text: 'fail #3', mention: true })
    expect(third.body.runId).toBeTruthy()
  })

  it('deduplicates repeated dedupeKey within 24h and enforces 401/413/429 and owner-left auto-disable', async () => {
    const w = await world()
    const { body } = await w.create('wang', { name: 'Jenkins 部署' })

    // Dedupe
    const a = await w.callHook(body.token, { text: 'build #99 failed', dedupeKey: 'deploy#99' })
    const b = await w.callHook(body.token, { text: 'build #99 failed', dedupeKey: 'deploy#99' })
    expect(b.status).toBe(200)
    expect(b.body).toEqual({ messageId: a.body.messageId, runId: null, duplicate: true })
    expect(await w.groupMessages()).toHaveLength(1)

    // 413 oversized text & attachment
    const bigText = await w.callHook(body.token, { text: 'a'.repeat(WEBHOOK_TEXT_MAX + 1) })
    expect(bigText.status).toBe(413)
    const bigAtt = await w.callHook(body.token, {
      text: 'ok',
      attachment: { name: 'a.log', content: 'x'.repeat(WEBHOOK_ATTACHMENT_MAX + 1) },
    })
    expect(bigAtt.status).toBe(413)

    // 401 unknown vs disabled return identical error
    const bad = await w.callHook('gwh_unknown_token', { text: 'hi' })
    expect(bad.status).toBe(401)
    await w.req('wang', 'PATCH', `/api/webhooks/${body.webhook.id}`, { enabled: false })
    const off = await w.callHook(body.token, { text: 'hi' })
    expect(off.status).toBe(401)
    expect(off.body.message).toBe(bad.body.message)
    await w.req('wang', 'PATCH', `/api/webhooks/${body.webhook.id}`, { enabled: true })

    // 429 rate limit
    clock = new Date('2026-11-19T07:00:00Z')
    for (let i = 0; i < WEBHOOK_RATE_PER_MIN; i++) {
      expect((await w.callHook(body.token, { text: `msg ${i}` })).status).toBe(200)
    }
    expect((await w.callHook(body.token, { text: 'over limit' })).status).toBe(429)

    // Owner left group → auto-disabled, 401
    clock = new Date('2026-11-19T07:05:00Z')
    await t.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, w.group.id), eq(groupMembers.userId, w.wang.id)))
    expect((await w.callHook(body.token, { text: 'owner gone' })).status).toBe(401)
    const [row] = await t.db.select().from(webhooks).where(eq(webhooks.id, body.webhook.id))
    expect(row?.enabled).toBe(false)
  })
})

describe('webhook model and thought level', () => {
  const level = (value: string) => ({ value, name: value })
  const CATALOG: AgentCatalog = {
    current: null,
    efforts: ['low', 'medium', 'high'].map(level),
    effort: 'medium',
    models: [
      { value: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'].map(level), effort: 'medium' },
      { value: 'opus', name: 'Opus', efforts: ['low', 'medium', 'high', 'max'].map(level), effort: 'high' },
    ],
  }
  const AGENTS = [
    {
      kind: 'claude',
      available: true,
      version: '2.1.4',
      path: '/bin/claude',
      minVersion: '2.0.0',
      catalog: CATALOG,
    },
  ]

  it('keeps a model/effort pick per candidate bot, runs with it, refuses invalid picks and falls back when gone', async () => {
    const w = await world()
    await t.db.update(machines).set({ agents: AGENTS }).where(eq(machines.id, w.m1.machine.id))
    w.online(w.m1.machine.id)

    // Invalid model refused
    expect(
      (
        await w.create('wang', {
          name: 'Bad',
          botIds: [w.claude.id],
          runOptions: { [w.claude.id]: { model: 'gpt' } },
        })
      ).status,
    ).toBe(400)

    // Valid pick saved (non-candidate pick dropped) and sent to daemon in RunStart
    const opusMax = { model: 'opus', effort: 'max' }
    const created = await w.create('wang', {
      name: 'Jenkins 部署',
      botIds: [w.claude.id],
      runOptions: { [w.claude.id]: opusMax, [w.codex.id]: { model: 'opus' } },
    })
    expect(created.status).toBe(200)
    expect(created.body.webhook.runOptions).toEqual({ [w.claude.id]: opusMax })

    const first = await w.callHook(created.body.token, { text: 'fail #1', mention: true })
    expect(first.status).toBe(200)
    expect(w.sent[w.m1.machine.id]?.[0]?.bot).toMatchObject({ model: 'opus', effort: 'max' })

    // Complete run, remove opus from catalog → falls back to default and posts group event
    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, first.body.runId!))
    const sonnetOnly = { ...CATALOG, models: CATALOG.models.slice(0, 1) }
    await t.db
      .update(machines)
      .set({ agents: [{ ...AGENTS[0]!, catalog: sonnetOnly }] })
      .where(eq(machines.id, w.m1.machine.id))

    const second = await w.callHook(created.body.token, { text: 'fail #2', mention: true })
    expect(second.status).toBe(200)
    expect(w.sent[w.m1.machine.id]?.[1]?.bot).toMatchObject({ model: null })
    const events = (await w.groupMessages()).filter((m) => m.kind === 'event').map((m) => m.body)
    expect(events).toContain(
      'Webhook「Jenkins 部署」为 Claude 设置的模型已不可用（opus · max），本次按默认运行',
    )
  })
})
