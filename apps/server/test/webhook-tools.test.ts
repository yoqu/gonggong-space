import type { ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, runs, webhooks } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-11-19T06:00:00Z') })
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const catalog = {
    current: null,
    efforts: [],
    effort: null,
    models: [{ value: 'opus', name: 'Opus', efforts: [{ value: 'high', name: 'High' }], effort: 'high' }],
  }
  const agents = [
    { kind: 'claude', available: true, version: '2.1.4', path: null, minVersion: null, catalog },
  ]
  const { machine, token } = await t.seed.machine(wang.id, { agents })
  const claude = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: wang.id, name: 'Codex', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id, codex.id] })
  const runOf = async (originUserId: string) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: originUserId,
        body: '@Claude 建个 webhook',
        meta: {},
      })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: claude.id,
        triggerMessageId: m!.id,
        originUserId,
        status: 'running',
      })
      .returning()
    return r!
  }
  const call = async (runId: string, name: string, args: unknown = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${runId}/tools/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    return res.json<ToolCallRes>()
  }
  return { wang, li, claude, codex, group, runOf, call }
}

describe('webhook MCP tools', () => {
  it('webhook_create requires group admin and creates without exposing a token', async () => {
    const w = await world()
    const liRun = await w.runOf(w.li.id)
    const denied = await w.call(liRun.id, 'webhook_create', { name: 'Jenkins 部署', bots: ['Codex'] })
    expect(denied.isError).toBe(true)

    const wangRun = await w.runOf(w.wang.id)
    const res = await w.call(wangRun.id, 'webhook_create', {
      name: 'Jenkins 部署',
      bots: ['Codex', 'Claude'],
      run_options: [{ bot: 'Claude', model: 'opus', effort: 'high' }],
    })
    expect(res.isError).toBe(false)
    expect(res.text).toContain('Jenkins 部署')
    expect(res.text).toContain('Codex → Claude')
    expect(res.text).toContain('Claude 使用：opus · high')
    expect(res.text).not.toContain('gwh_')

    const [row] = await t.db.select().from(webhooks)
    expect(row).toMatchObject({
      ownerId: w.wang.id,
      createdByBotId: w.claude.id,
      tokenHash: null,
      botIds: [w.codex.id, w.claude.id],
      runOptions: { [w.claude.id]: { model: 'opus', effort: 'high' } },
      enabled: true,
    })

    const listed = await w.call(wangRun.id, 'webhook_list')
    expect(listed.isError).toBe(false)
    expect(listed.text).toContain(row!.id)
    expect(listed.text).toContain('待生成令牌')

    const updated = await w.call(wangRun.id, 'webhook_update', {
      id: row!.id,
      name: 'CI 部署',
      run_options: [],
      enabled: false,
    })
    expect(updated.isError).toBe(false)
    expect(updated.text).toContain('CI 部署')
    const [afterUpdate] = await t.db.select().from(webhooks).where(eq(webhooks.id, row!.id))
    expect(afterUpdate?.runOptions).toEqual({})

    const deleted = await w.call(wangRun.id, 'webhook_delete', { id: row!.id })
    expect(deleted.isError).toBe(false)
    const [after] = await t.db.select().from(webhooks).where(eq(webhooks.id, row!.id))
    expect(after?.deletedAt).not.toBeNull()
  })
})
