import type { ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupKnowledge, groupKnowledgeVersions, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id] })
  const other = await t.seed.group({ createdBy: wang.id, botIds: [claude.id] })
  const runOf = async (originUserId = li.id, groupId = group.id) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId, kind: 'user', authorUserId: originUserId, body: '@Claude 记一下', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({ groupId, botId: claude.id, triggerMessageId: m!.id, originUserId, status: 'running' })
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
  return { wang, li, claude, group, other, runOf, call }
}

describe('knowledge base tools', () => {
  it('bots create, list, read, search and update entries of their run’s group as themselves', async () => {
    const w = await world()
    const run = await w.runOf()
    expect((await w.call(run.id, 'kb_list')).text).toBe('本群知识库还没有条目')
    const created = await w.call(run.id, 'kb_create', {
      title: '测试环境',
      body: '地址 https://test.example.com，账号找王磊',
      tags: ['环境'],
    })
    expect(created.isError).toBe(false)
    const [e] = await t.db.select().from(groupKnowledge)
    expect(e).toMatchObject({ groupId: w.group.id, updatedByBotId: w.claude.id, updatedByUserId: null })
    expect(created.text).toBe(`已新建知识库条目「测试环境」（id ${e!.id}，v1）`)

    expect((await w.call(run.id, 'kb_list')).text).toBe(
      `本群知识库（1 条）：\n- 测试环境（id ${e!.id} · v1 · 标签：环境）`,
    )
    expect((await w.call(run.id, 'kb_list', { tag: '部署' })).text).toBe('本群知识库没有带标签「部署」的条目')
    const got = await w.call(run.id, 'kb_get', { id: e!.id })
    expect(got.text).toContain('「测试环境」（id')
    expect(got.text).toMatch(/v1 · 标签：环境 · Claude 修改于 [\d-]+ [\d:]+ UTC）/)
    expect(got.text).toContain('地址 https://test.example.com，账号找王磊')
    const hit = await w.call(run.id, 'kb_search', { query: '账号' })
    expect(hit.text).toContain(`命中「账号」1 条：\n- 测试环境（id ${e!.id} · v1）：地址`)

    const updated = await w.call(run.id, 'kb_update', { id: e!.id, base_version: 1, body: '地址已迁移' })
    expect(updated.text).toBe('已更新知识库条目「测试环境」，当前 v2')
    const stale = await w.call(run.id, 'kb_update', { id: e!.id, base_version: 1, body: '旧' })
    expect(stale).toMatchObject({
      isError: true,
      text: '条目已被修改，当前是 v2：请先用 kb_get 读取最新内容，合并你的改动后以 base_version=2 重试',
    })
    const versions = await t.db
      .select()
      .from(groupKnowledgeVersions)
      .where(eq(groupKnowledgeVersions.entryId, e!.id))
    expect(versions.map((v) => [v.version, v.byBotId])).toEqual([
      [1, w.claude.id],
      [2, w.claude.id],
    ])
    const [card] = await t.db
      .select({ body: messages.body })
      .from(messages)
      .where(eq(messages.kind, 'event'))
      .orderBy(messages.seq)
    expect(card!.body).toBe('Claude 新建了知识库条目「测试环境」')
  })

  it('stays in the run’s group and deletes only for a group admin', async () => {
    const w = await world()
    const elsewhere = await w.runOf(w.wang.id, w.other.id)
    await w.call(elsewhere.id, 'kb_create', { title: '别的群', body: 'x' })
    const [foreign] = await t.db.select().from(groupKnowledge)
    const run = await w.runOf()
    expect(await w.call(run.id, 'kb_get', { id: foreign!.id })).toMatchObject({
      isError: true,
      text: `本群知识库没有 id 为 ${foreign!.id} 的条目，请用 kb_list 查看`,
    })
    await w.call(run.id, 'kb_create', { title: '本群', body: 'y' })
    const [mine] = await t.db.select().from(groupKnowledge).where(eq(groupKnowledge.groupId, w.group.id))
    expect(await w.call(run.id, 'kb_delete', { id: mine!.id })).toMatchObject({
      isError: true,
      text: '删除条目需要发起本轮的人是本群管理员；内容有误时用 kb_update 修正',
    })
    const byAdmin = await w.runOf(w.wang.id)
    expect((await w.call(byAdmin.id, 'kb_delete', { id: mine!.id })).text).toBe('已删除知识库条目「本群」')
    expect((await w.call(run.id, 'kb_list')).text).toBe('本群知识库还没有条目')
  })
})
