import type { ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, groupRepos, groups, messages, questionSets, runs } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const at = (min: number) => new Date(Date.UTC(2026, 8, 23, 10, min))

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const other = await t.seed.machine(li.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const codex = await t.seed.bot({
    ownerId: li.id,
    name: '老李的 Codex',
    agentKind: 'codex',
    machineId: other.machine.id,
  })
  const pay = await t.seed.group({
    createdBy: wang.id,
    name: '支付服务重构',
    memberIds: [li.id],
    botIds: [claude.id, codex.id],
  })
  await t.db.update(groups).set({ notice: '退款 v1 下周一下线' }).where(eq(groups.id, pay.id))
  await t.db
    .insert(groupRepos)
    .values({ groupId: pay.id, url: 'git@example.com:team/pay.git', baseBranch: 'main' })
  const data = await t.seed.group({ createdBy: wang.id, name: '数据平台', botIds: [claude.id] })
  const old = await t.seed.group({ createdBy: wang.id, name: '旧版后台', botIds: [claude.id] })
  await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.groupId, old.id))
  const archived = await t.seed.group({ createdBy: wang.id, name: '已归档', botIds: [claude.id] })
  await t.db.update(groups).set({ archivedAt: new Date() }).where(eq(groups.id, archived.id))
  const dm = await t.seed.group({ createdBy: wang.id, kind: 'dm', name: 'dm', botIds: [claude.id] })
  const foreign = await t.seed.group({ createdBy: li.id, name: '老李的群', botIds: [codex.id] })

  let minute = 0
  const say = async (
    groupId: string,
    body: string,
    o: { userId?: string; botId?: string; meta?: object; kind?: string; runId?: string } = {},
  ) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId,
        kind: o.kind ?? (o.botId ? 'bot' : 'user'),
        authorUserId: o.botId ? null : (o.userId ?? wang.id),
        authorBotId: o.botId ?? null,
        body,
        meta: o.meta ?? {},
        runId: o.runId ?? null,
        createdAt: at(minute++),
      })
      .returning()
    return m!
  }
  const run = async (
    groupId: string,
    botId: string,
    status = 'running',
    o: Partial<typeof runs.$inferInsert> = {},
  ) => {
    const trigger = await say(groupId, '@Bot 干活')
    const [r] = await t.db
      .insert(runs)
      .values({ groupId, botId, triggerMessageId: trigger.id, originUserId: wang.id, status, ...o })
      .returning()
    return r!
  }
  const call = async (runId: string, name: string, args: unknown = {}, tk = token) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${runId}/tools/${name}`,
      headers: { authorization: `Bearer ${tk}` },
      payload: { arguments: args },
    })
    return { status: res.statusCode, body: res.json<ToolCallRes>() }
  }
  return { wang, li, token, other, claude, codex, pay, data, old, archived, dm, foreign, say, run, call }
}

describe('gonggong tool calls', () => {
  it('only answers the calling machine during a live run', async () => {
    const w = await world()
    const live = await w.run(w.pay.id, w.claude.id)
    expect((await w.call(live.id, 'get_group_info', {}, w.other.token)).status).toBe(404)
    expect((await w.call('not-a-uuid', 'get_group_info')).status).toBe(404)
    expect((await w.call(live.id, 'nope')).status).toBe(404)
    const ended = await w.run(w.pay.id, w.claude.id, 'completed')
    expect((await w.call(ended.id, 'get_group_info')).body).toMatchObject({
      isError: true,
      text: '当前不在运行中，无法查询',
    })
    const bad = await w.call(live.id, 'list_messages', { before: 1, after: 2 })
    expect(bad.body.isError).toBe(true)
    expect(bad.body.text).toContain('参数无效')
  })

  it('list_messages pages through the conversation by #seq', async () => {
    const w = await world()
    const said = []
    for (let i = 1; i <= 5; i++) said.push(await w.say(w.pay.id, `消息${i}`, { userId: w.li.id }))
    await w.say(w.pay.id, '/new @小王的 Claude', { meta: { command: 'new' } })
    await w.say(w.pay.id, '王磊 加入了群', { kind: 'event' })
    const reply = await w.say(w.pay.id, `接口已改好${'长'.repeat(2100)}`, {
      botId: w.codex.id,
      meta: { attachments: [{ id: 'a1', name: 'diff.png', size: 1, mime: 'image/png', messageId: 'x' }] },
    })
    const live = await w.run(w.pay.id, w.claude.id)
    const s = (m: { seq: number }) => m.seq
    const last = s(reply) + 1

    const latest = (await w.call(live.id, 'list_messages', { limit: 3 })).body
    expect(latest.isError).toBe(false)
    const lines = latest.text.split('\n')
    expect(lines[0]).toMatch(new RegExp(`^群「支付服务重构」#${s(said[4]!)}–#\\d+（3 条）$`))
    expect(lines[1]).toBe(`[#${s(said[4]!)} 2026-09-23 10:04] 李建国: 消息5`)
    expect(lines[2]).toMatch(
      new RegExp(
        `^\\[#${s(reply)} 2026-09-23 10:07\\] 老李的 Codex: 接口已改好长+…（已截断，共 2105 字）（附件：diff.png）$`,
      ),
    )
    expect(lines[3]).toMatch(/王磊: @Bot 干活$/)
    expect(latest.text).not.toContain('/new')
    expect(latest.text).not.toContain('加入了群')
    expect(lines.at(-1)).toBe(`更早：before=${s(said[4]!)}`)

    const before = (await w.call(live.id, 'list_messages', { before: s(said[2]!) })).body.text
    expect(before).toContain('消息1')
    expect(before).toContain('消息2')
    expect(before).not.toContain('消息3')

    const after = (await w.call(live.id, 'list_messages', { after: s(said[2]!), limit: 1 })).body.text
    expect(after.split('\n')[1]).toContain('消息4')

    const around = (await w.call(live.id, 'list_messages', { around: s(said[2]!), limit: 3 })).body.text
    expect(around.match(/消息\d/g)).toEqual(['消息2', '消息3', '消息4'])

    const byAuthor = (await w.call(live.id, 'list_messages', { author: 'codex' })).body.text
    expect(byAuthor.match(/^\[#/gm)).toHaveLength(1)

    const empty = (await w.call(live.id, 'list_messages', { after: last + 1000 })).body
    expect(empty).toEqual({ isError: false, text: '没有符合条件的消息', attachments: [] })
  })

  it('reads the groups the bot is in, never removed, archived, foreign or other private chats', async () => {
    const w = await world()
    await w.say(w.data.id, '数据平台的退款报表')
    await w.say(w.old.id, '旧版后台的退款')
    await w.say(w.archived.id, '归档群的退款')
    await w.say(w.dm.id, '私聊里的退款')
    await w.say(w.foreign.id, '老李群的退款')
    await w.say(w.pay.id, '支付群的退款')
    const live = await w.run(w.pay.id, w.claude.id)

    const all = (await w.call(live.id, 'search_messages', { query: '退款', group: 'all' })).body.text
    expect(all).toContain('数据平台 · 王磊: 数据平台的退款报表')
    expect(all).toContain('支付服务重构 · 王磊: 支付群的退款')
    for (const hidden of ['旧版后台', '归档群', '私聊里', '老李群']) expect(all).not.toContain(hidden)

    const here = (await w.call(live.id, 'search_messages', { query: '退款' })).body.text
    expect(here).not.toContain('数据平台')

    for (const g of [w.old, w.archived, w.dm, w.foreign])
      expect((await w.call(live.id, 'list_messages', { group: g.id })).body).toMatchObject({
        isError: true,
        text: `无权读取该群或群不存在：${g.id}`,
      })
    expect((await w.call(live.id, 'list_messages', { group: w.data.id })).body.text).toContain(
      '数据平台的退款报表',
    )

    const inDm = await w.run(w.dm.id, w.claude.id)
    expect((await w.call(inDm.id, 'list_messages')).body.text).toContain('私聊里的退款')

    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'tool.cross_group_read'))
      .orderBy(auditLogs.id)
    expect(logs.map((l) => [l.category, l.groupId, l.detail])).toEqual([
      ['run', w.pay.id, { runId: live.id, tool: 'search_messages', groups: [w.data.id] }],
      ['run', w.pay.id, { runId: live.id, tool: 'list_messages', groups: [w.data.id] }],
    ])
  })

  it('get_group_info describes the group, its members and the other readable groups', async () => {
    const w = await world()
    const live = await w.run(w.pay.id, w.claude.id)
    t.ctx.hub.isOnline = (id) => id === w.other.machine.id
    const text = (await w.call(live.id, 'get_group_info')).body.text
    expect(text).toContain('群「支付服务重构」（群聊 · 分区模式）')
    expect(text).toContain('公告：退款 v1 下周一下线')
    expect(text).toContain('仓库：git@example.com:team/pay.git（main）')
    expect(text).toContain('- 王磊（管理员）')
    expect(text).toContain('- 李建国')
    expect(text).toContain('- 小王的 Claude（你） · 主人 王磊 · claude · 离线')
    expect(text).toContain('- 老李的 Codex · 主人 李建国 · codex · 在线')
    expect(text).toContain(`- 数据平台（id: ${w.data.id}）`)
    expect(text).not.toContain('旧版后台')
    expect(text).not.toContain(`（id: ${w.dm.id}`)
  })

  it('get_run shows another bot turn with its questions, files and diff', async () => {
    const w = await world()
    const patch = 'diff --git a/server/refund.ts b/server/refund.ts\n+ok\n'
    const codexRun = await w.run(w.pay.id, w.codex.id, 'completed', {
      summary: '签名兼容已完成',
      step: '',
      filesChanged: 1,
      usage: { totalTokens: 1500 },
      patch: seal(patch),
    })
    const reply = await w.say(w.pay.id, '已完成签名兼容', { botId: w.codex.id, runId: codexRun.id })
    await t.db.insert(questionSets).values({
      runId: codexRun.id,
      requestId: 'q',
      questions: [
        { id: 'q1', type: 'single', title: '用哪种语言？', options: ['Python', 'Go'], recommended: 0 },
        { id: 'q2', type: 'text', title: '还有什么？', options: [], recommended: null },
      ],
      status: 'answered',
      answers: [
        { questionId: 'q1', choices: [1], text: null },
        { questionId: 'q2', choices: [], text: '注意幂等' },
      ],
      answeredBy: w.li.id,
      expiresAt: new Date(),
    })
    const live = await w.run(w.pay.id, w.claude.id)

    const text = (await w.call(live.id, 'get_run', { message: reply.seq })).body.text
    expect(text).toContain(`运行 ${codexRun.id} · 老李的 Codex · 群「支付服务重构」`)
    expect(text).toContain('状态：completed')
    expect(text).toContain('摘要：签名兼容已完成')
    expect(text).toContain('改动文件：server/refund.ts')
    expect(text).toContain('用量：1500 tokens')
    expect(text).toContain(
      '李建国 的回答：\n1. 用哪种语言？（单选）→ Go\n2. 还有什么？（自由文本）→ 注意幂等',
    )
    expect(text).toContain(`回复（#${reply.seq}）：已完成签名兼容`)
    expect(text).not.toContain('+ok')
    expect((await w.call(live.id, 'get_run', { run: codexRun.id, include_patch: true })).body.text).toContain(
      patch,
    )

    await t.db.update(runs).set({ purgedAt: new Date(), patch: null }).where(eq(runs.id, codexRun.id))
    expect((await w.call(live.id, 'get_run', { run: codexRun.id, include_patch: true })).body.text).toContain(
      '运行过程已过期',
    )
    const foreignRun = await w.run(w.foreign.id, w.codex.id, 'completed')
    expect((await w.call(live.id, 'get_run', { run: foreignRun.id })).body.isError).toBe(true)
  })

  it('list_questions lists past cards with their answers', async () => {
    const w = await world()
    const earlier = await w.run(w.pay.id, w.codex.id, 'completed')
    await t.db.insert(questionSets).values({
      runId: earlier.id,
      requestId: 'q',
      questions: [
        { id: 'q1', type: 'yesno', title: '改 fixture 吗？', options: ['是', '否'], recommended: null },
      ],
      status: 'expired',
      expiresAt: new Date(),
    })
    const live = await w.run(w.pay.id, w.claude.id)
    const text = (await w.call(live.id, 'list_questions')).body.text
    expect(text).toContain('老李的 Codex 提问（超时未答）')
    expect(text).toContain('1. 改 fixture 吗？（是/否）')
  })

  it('fetch_attachments returns the attachments of a message for the daemon to download', async () => {
    const w = await world()
    const att = { id: 'a1', name: 'spec.pdf', size: 3, mime: 'application/pdf', messageId: 'm' }
    const m = await w.say(w.data.id, '规格见附件', { meta: { attachments: [att] } })
    const plain = await w.say(w.pay.id, '无附件')
    const live = await w.run(w.pay.id, w.claude.id)
    expect((await w.call(live.id, 'fetch_attachments', { message: m.seq })).body).toEqual({
      isError: false,
      text: `#${m.seq} 的附件：`,
      attachments: [att],
    })
    expect((await w.call(live.id, 'fetch_attachments', { message: plain.seq })).body).toMatchObject({
      isError: true,
      text: `#${plain.seq} 没有附件`,
    })
  })
})
