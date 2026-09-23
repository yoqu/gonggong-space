import type { MessageDto, RunStart, ServerToDaemon } from '@aiws/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, groupRepos, groups, messages, runs } from '../src/db/schema.js'
import { onCdResult } from '../src/modules/commands/cd.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world(o: { online?: boolean } = {}) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id] })
  // Joined later, so usage examples deterministically name the first bot.
  await t.db.insert(groupBots).values({ groupId: g.id, botId: codex.id })
  await t.db
    .insert(groupRepos)
    .values({ groupId: g.id, url: 'git@example.com:team/pay.git', baseBranch: 'main' })
  const sent: ServerToDaemon[] = []
  if (o.online !== false) t.ctx.hub.register(machine.id, { send: (m) => sent.push(m), close() {} })
  const asWang = client(t, await t.seed.cookie(wang.id))
  const asLi = client(t, await t.seed.cookie(li.id))
  let n = 0
  const say = (c: typeof asWang, body: string, clientId = `cmd-client-${++n}`) =>
    c.post<MessageDto>(`/api/groups/${g.id}/messages`, { body, clientId })
  const eventsText = async () =>
    (
      await t.db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.groupId, g.id), eq(messages.kind, 'event')))
        .orderBy(asc(messages.seq))
    ).map((m) => m.body)
  const gb = async (botId: string) =>
    (
      await t.db
        .select()
        .from(groupBots)
        .where(and(eq(groupBots.groupId, g.id), eq(groupBots.botId, botId)))
    )[0]!
  const allRuns = () => t.db.select().from(runs).where(eq(runs.groupId, g.id))
  return { wang, li, machine, claude, codex, g, sent, asWang, asLi, say, eventsText, gb, allRuns }
}

describe('system commands', () => {
  it('/new: stores the message, triggers no run, resets the session and audits', async () => {
    const w = await world()
    await t.db.update(groupBots).set({ sessionId: 'sess-0' }).where(eq(groupBots.botId, w.claude.id))
    const res = await w.say(w.asLi, '/new @小王的 Claude')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ kind: 'user', body: '/new @小王的 Claude', mentions: [w.claude.id] })
    expect(await w.eventsText()).toEqual(['小王的 Claude 下一轮将开新会话'])
    expect(await w.allRuns()).toEqual([])
    expect(await w.gb(w.claude.id)).toMatchObject({ sessionId: null, newSessionReason: 'requested' })
    const [log] = await t.db.select().from(auditLogs)
    expect(log).toMatchObject({ actorUserId: w.li.id, action: 'command.new', groupId: w.g.id })
  })

  it('/new without a bot explains the usage', async () => {
    const w = await world()
    await w.say(w.asWang, '/new')
    expect(await w.eventsText()).toEqual(['/new 需要同时 @ 一个 bot，如 /new @小王的 Claude'])
  })

  it('the next dispatch opens a requested new session once, without the command in its context', async () => {
    const w = await world()
    await t.db.update(groupBots).set({ sessionId: 'sess-0' }).where(eq(groupBots.botId, w.claude.id))
    await w.say(w.asWang, '先聊点别的')
    await w.say(w.asWang, '/new @小王的 Claude')
    await w.say(w.asWang, '@小王的 Claude 开始')
    const start = w.sent.find((m): m is RunStart => m.t === 'run.start')!
    expect(start).toMatchObject({ resumeSessionId: null, newSessionReason: 'requested' })
    expect(start.prompt.context.map((c) => c.body)).toEqual(['先聊点别的'])
    expect((await w.gb(w.claude.id)).newSessionReason).toBeNull()
  })

  it('unknown or differently-cased commands are normal messages', async () => {
    const w = await world()
    await w.say(w.asWang, '/New @小王的 Claude')
    await w.say(w.asWang, '/review @小王的 Claude')
    expect(await w.eventsText()).toEqual([])
    expect(await w.allRuns()).toHaveLength(2)
  })

  it('runs a command once per clientId', async () => {
    const w = await world()
    await w.say(w.asWang, '/new @小王的 Claude', 'same-client-id')
    await w.say(w.asWang, '/new @小王的 Claude', 'same-client-id')
    expect(await w.eventsText()).toHaveLength(1)
  })

  it('/hold and /release are force-sync only; /stop reports nothing running', async () => {
    const w = await world()
    await w.say(w.asWang, '/hold')
    await w.say(w.asWang, '/release')
    await w.say(w.asWang, '/stop')
    expect(await w.eventsText()).toEqual([
      '/hold 仅在强制同步群可用',
      '/release 仅在强制同步群可用',
      '没有运行中的轮次',
    ])
  })
})

describe('/cd', () => {
  it('asks the owner machine to bind a local dir (paths with spaces) and to reset', async () => {
    const w = await world()
    await w.say(w.asWang, '/cd @小王的 Claude /Users/wang/code/pay api')
    await w.say(w.asWang, '/cd @小王的 Claude --reset')
    const repo = { id: expect.any(String), url: 'git@example.com:team/pay.git', branch: 'main' }
    expect(w.sent).toEqual([
      expect.objectContaining({
        t: 'workspace.cd',
        groupId: w.g.id,
        botId: w.claude.id,
        repo,
        path: '/Users/wang/code/pay api',
      }),
      expect.objectContaining({ t: 'workspace.cd', path: null }),
    ])
    expect(await w.eventsText()).toEqual([
      '已请求 小王的 Claude 绑定到 /Users/wang/code/pay api，等待本机校验…',
      '已请求 小王的 Claude 恢复托管工作区，等待本机确认…',
    ])
    expect(await t.db.select().from(auditLogs)).toHaveLength(2)
  })

  it('rejects non-owners, bad targets, relative paths and groups without a partition repo', async () => {
    const w = await world()
    await w.say(w.asLi, '/cd @小王的 Claude /tmp/x')
    await w.say(w.asWang, '/cd /tmp/x')
    await w.say(w.asWang, '/cd @小王的 Claude @老李的 Codex /tmp/x')
    await w.say(w.asWang, '/cd @小王的 Claude code/x')
    await w.say(w.asWang, '/cd @小王的 Claude')
    await t.db.update(groups).set({ mode: 'force' }).where(eq(groups.id, w.g.id))
    await w.say(w.asWang, '/cd @小王的 Claude /tmp/x')
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.g.id))
    await t.db.delete(groupRepos).where(eq(groupRepos.groupId, w.g.id))
    await w.say(w.asWang, '/cd @小王的 Claude /tmp/x')
    const usage =
      '/cd 需要 @ 一个 bot，如 /cd @小王的 Claude /本机/绝对路径，或 /cd @小王的 Claude --reset 回到托管'
    expect(await w.eventsText()).toEqual([
      '只有 bot 主人可以使用 /cd',
      usage,
      usage,
      '/cd 需要本机绝对路径，如 /Users/me/code/repo',
      usage,
      '/cd 仅分区模式可用；强制同步群里非托管工作区的 bot 为「不参与」',
      '未绑定仓库的群不能使用 /cd',
    ])
    expect(w.sent).toEqual([])
  })

  it('reports an offline machine', async () => {
    const w = await world({ online: false })
    await w.say(w.asWang, '/cd @小王的 Claude /tmp/x')
    expect(await w.eventsText()).toEqual(['小王的 Claude 离线，无法执行 /cd'])
  })

  it('onCdResult posts the outcome', async () => {
    const w = await world()
    const base = {
      t: 'workspace.state',
      groupId: w.g.id,
      botId: w.claude.id,
      requestId: 'r',
      git: null,
    } as const
    await onCdResult(t.ctx, { ...base, state: 'ready', path: '/tmp/x', error: null }, false)
    await onCdResult(t.ctx, { ...base, state: 'ready', path: '/managed/p', error: null }, true)
    await onCdResult(t.ctx, { ...base, state: 'failed', path: null, error: 'remote 与群仓库不一致' }, false)
    expect(await w.eventsText()).toEqual([
      '✓ 小王的 Claude 已绑定到 /tmp/x（/cd 绑定）',
      '✓ 小王的 Claude 已恢复托管工作区',
      '小王的 Claude /cd 失败：remote 与群仓库不一致',
    ])
  })
})
