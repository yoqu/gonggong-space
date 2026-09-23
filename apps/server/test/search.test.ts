import type { SearchResultDto } from '@aiws/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupRepos, messages, runEvents, runs } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { sealEvent } from '../src/modules/runs/sealed.js'
import { createTestApp, type TestApp } from './support/app.js'
import { bareRepo } from './support/git.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const PATCH = `diff --git a/server/refund/v2/handler.go b/server/refund/v2/handler.go
--- a/server/refund/v2/handler.go
+++ b/server/refund/v2/handler.go
@@ -1 +1 @@
-a
+b
diff --git a/docs/api.md b/docs/api.md
`

async function world() {
  const me = await t.seed.user({ name: '王磊' })
  const stranger = await t.seed.user({ name: '外人' })
  const bot = await t.seed.bot({ ownerId: me.id, name: '小王的 Claude' })
  const mine = await t.seed.group({ createdBy: me.id, name: '支付服务重构', botIds: [bot.id] })
  const theirs = await t.seed.group({ createdBy: stranger.id, name: '别人的群', botIds: [bot.id] })
  let at = Date.parse('2026-09-23T10:00:00Z')
  const tick = () => {
    at += 1000
    return new Date(at)
  }
  const say = async (groupId: string, body: string, o: { botId?: string; runId?: string } = {}) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId,
        kind: o.botId ? 'bot' : 'user',
        authorUserId: o.botId ? null : me.id,
        authorBotId: o.botId ?? null,
        body,
        runId: o.runId ?? null,
        createdAt: tick(),
      })
      .returning()
    return m!
  }
  const run = async (groupId: string, o: Partial<typeof runs.$inferInsert> = {}) => {
    const trigger = await say(groupId, '@小王的 Claude 迁移退款接口')
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId,
        botId: bot.id,
        triggerMessageId: trigger.id,
        triggerUserId: me.id,
        originUserId: me.id,
        status: 'completed',
        queuedAt: tick(),
        ...o,
      })
      .returning()
    return r!
  }
  const api = client(t, await t.seed.cookie(me.id))
  const search = async (q: string, tab: string) =>
    (await api.get<SearchResultDto[]>(`/api/search?q=${encodeURIComponent(q)}&tab=${tab}`)).body
  return { me, bot, mine, theirs, say, run, api, search }
}

describe('⌘K search', () => {
  it('finds messages only in my groups, newest first, treating LIKE wildcards literally', async () => {
    const w = await world()
    const old = await w.say(w.mine.id, '退款 v1 下周一下线')
    const r = await w.run(w.mine.id)
    const reply = await w.say(w.mine.id, '退款字段变化如下', { botId: w.bot.id, runId: r.id })
    await w.say(w.theirs.id, '退款 秘密')
    await w.say(w.mine.id, '100% 完成')

    const hits = await w.search('退款', 'msg')
    expect(hits.map((h) => h.messageId)).toEqual([reply.id, expect.any(String), old.id])
    expect(hits[0]).toEqual({
      kind: 'msg',
      title: '退款字段变化如下',
      sub: '小王的 Claude 最终回复 · 支付服务重构',
      groupId: w.mine.id,
      messageId: reply.id,
      runId: r.id,
    })
    expect(hits[2]!.sub).toBe('王磊 · 支付服务重构')
    expect((await w.search('%', 'msg')).map((h) => h.title)).toEqual(['100% 完成'])
    expect((await w.api.get('/api/search?q=&tab=msg')).status).toBe(400)
  })

  it('finds files touched by runs from their patch headers, once per group and path', async () => {
    const w = await world()
    const a = await w.run(w.mine.id, { patch: PATCH })
    await w.run(w.mine.id, { patch: PATCH })
    await w.run(w.theirs.id, { patch: PATCH })
    const hits = await w.search('HANDLER', 'file')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'file',
      title: 'server/refund/v2/handler.go',
      sub: '小王的 Claude 工作区 · 支付服务重构',
      groupId: w.mine.id,
      runId: expect.any(String),
    })
    expect(hits[0]!.runId).not.toBe(a.id)
    expect((await w.search('api.md', 'file')).map((h) => h.title)).toEqual(['docs/api.md'])
  })

  it('reads file paths from sealed patches', async () => {
    const w = await world()
    const r = await w.run(w.mine.id, { patch: seal(PATCH) })
    expect((await w.search('handler', 'file')).map((h) => [h.title, h.runId])).toEqual([
      ['server/refund/v2/handler.go', r.id],
    ])
  })

  it('also finds base-branch files from the mirror of my groups, after workspace changes', async () => {
    const w = await world()
    const remote = bareRepo()
    remote.commit('server/refund/v1/handler.go', 'package v1\n')
    remote.commit('server/refund/v2/handler.go', 'package v2\n')
    for (const groupId of [w.mine.id, w.theirs.id])
      await t.db.insert(groupRepos).values({ groupId, url: remote.url, baseBranch: 'main' })
    const run = await w.run(w.mine.id, { patch: PATCH })
    const hits = await w.search('handler', 'file')
    expect(hits.map((h) => [h.title, h.sub, h.runId])).toEqual([
      ['server/refund/v2/handler.go', '小王的 Claude 工作区 · 支付服务重构', run.id],
      ['server/refund/v1/handler.go', 'main 镜像 · 支付服务重构', null],
    ])
  })

  it('finds runs by bot, step, reply or process; expired processes only by their card summary', async () => {
    const w = await world()
    const live = await w.run(w.mine.id, { step: '正在编译', filesChanged: 4 })
    await t.db
      .insert(runEvents)
      .values({ runId: live.id, kind: 'tool', payload: { title: 'go build ./refund/...' } })
    const expired = await w.run(w.mine.id, { step: '首页埋点改造', purgedAt: new Date() })
    await t.db
      .insert(runEvents)
      .values({ runId: expired.id, kind: 'tool', payload: { title: 'go build ./legacy/...' } })
    await w.say(w.mine.id, '埋点已改完', { botId: w.bot.id, runId: expired.id })
    await w.run(w.theirs.id, { step: '正在编译' })

    const sealed = await w.run(w.mine.id, { step: '' })
    await t.db.insert(runEvents).values({
      runId: sealed.id,
      kind: 'text',
      payload: sealEvent({ kind: 'text', delta: '私密输出 go build' }),
    })
    expect((await w.search('go build', 'run')).map((h) => h.runId)).toEqual([live.id])
    expect((await w.search('编译', 'run'))[0]).toEqual({
      kind: 'run',
      title: '小王的 Claude · 迁移退款接口',
      sub: '支付服务重构 · 正在编译 · 改动 4 文件',
      groupId: w.mine.id,
      messageId: null,
      runId: live.id,
    })
    const exp = await w.search('埋点', 'run')
    expect(exp.map((h) => h.runId)).toEqual([expired.id])
    expect(exp[0]!.sub).toBe('支付服务重构 · 首页埋点改造 · 运行过程已过期，仅保留卡片摘要')
    expect((await w.search('小王', 'run')).map((h) => h.runId)).toEqual([sealed.id, expired.id, live.id])
    // Ciphertext never matches: sealed output is not searchable.
    expect(await w.search('v1:', 'run')).toEqual([])
  })
})
