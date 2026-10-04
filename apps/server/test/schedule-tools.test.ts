import type { ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, runs, schedules } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-10-05T00:30:00Z') })
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({
    ownerId: wang.id,
    name: 'Claude',
    machineId: machine.id,
    systemPrompt: '前端专家，擅长 React 与界面走查',
  })
  const codex = await t.seed.bot({ ownerId: wang.id, name: 'Codex', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id, codex.id] })
  const runOf = async (botId: string) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: li.id, body: '@Bot 每天提醒我', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({ groupId: group.id, botId, triggerMessageId: m!.id, originUserId: li.id, status: 'running' })
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

describe('schedule tools', () => {
  it('schedule_create makes a live task owned by whoever started the run', async () => {
    const w = await world()
    const run = await w.runOf(w.claude.id)
    const res = await w.call(run.id, 'schedule_create', {
      name: '日报',
      prompt: '汇总昨天合并的 PR',
      cron: '0 9 * * 1-5',
      bots: ['Codex', 'Claude'],
    })
    expect(res.isError).toBe(false)
    const [s] = await t.db.select().from(schedules)
    expect(s).toMatchObject({
      ownerId: w.li.id,
      createdByBotId: w.claude.id,
      createdByRunId: run.id,
      botIds: [w.codex.id, w.claude.id],
      timezone: 'Asia/Shanghai',
      enabled: true,
    })
    expect(res.text).toContain(`已创建定时任务「日报」（id ${s!.id}）`)
    expect(res.text).toContain('每个工作日 09:00')
    expect(res.text).toContain('候选 Bot：Codex → Claude')
    expect(res.text).toContain('2026-10-05 09:00、2026-10-06 09:00、2026-10-07 09:00')
    const [card] = await t.db.select().from(messages).where(eq(messages.id, s!.messageId!))
    expect(card!.body).toBe('Claude 创建了定时任务「日报」')
  })

  it('defaults to the calling bot and reports mistakes as tool errors', async () => {
    const w = await world()
    const run = await w.runOf(w.claude.id)
    const once = await w.call(run.id, 'schedule_create', {
      name: '提醒',
      prompt: '检查发布',
      at: '2026-10-05T10:00:00+08:00',
    })
    expect(once.isError).toBe(false)
    expect(once.text).toContain('仅一次 · 2026-10-05 10:00')
    const [s] = await t.db.select().from(schedules)
    expect(s!.botIds).toEqual([w.claude.id])
    const unknown = await w.call(run.id, 'schedule_create', {
      name: 'a',
      prompt: 'b',
      cron: '0 9 * * *',
      bots: ['GPT'],
    })
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.text).toMatch(/^本群没有叫「GPT」的 Bot，可选的有：(Claude、Codex|Codex、Claude)$/)
    const tooOften = await w.call(run.id, 'schedule_create', { name: 'a', prompt: 'b', cron: '* * * * *' })
    expect(tooOften).toMatchObject({ isError: true, text: '执行间隔不能小于 5 分钟' })
  })

  it('lists, pauses and deletes only the tasks the bot created or runs', async () => {
    const w = await world()
    const mine = await w.runOf(w.claude.id)
    await w.call(mine.id, 'schedule_create', { name: '日报', prompt: 'x', cron: '0 9 * * *' })
    const theirs = await w.runOf(w.codex.id)
    await w.call(theirs.id, 'schedule_create', { name: '周报', prompt: 'y', cron: '0 18 * * 5' })
    const [daily, weekly] = await t.db.select().from(schedules).orderBy(schedules.createdAt)
    const listed = await w.call(mine.id, 'schedule_list')
    expect(listed.text).toContain(
      `「日报」（id ${daily!.id}）· 每天 09:00 · 候选 Claude · 启用中 · 下次 2026-10-05 09:00`,
    )
    expect(listed.text).toContain(`「周报」（id ${weekly!.id}）· 每周五 18:00 · 候选 Codex`)
    const denied = await w.call(mine.id, 'schedule_update', { id: weekly!.id, enabled: false })
    expect(denied).toMatchObject({ isError: true, text: '只能修改你创建的、或候选里有你的定时任务' })
    const paused = await w.call(mine.id, 'schedule_update', { id: daily!.id, enabled: false })
    expect(paused.text).toContain('已暂停')
    expect((await w.call(mine.id, 'schedule_delete', { id: daily!.id })).text).toBe('已删除定时任务「日报」')
    expect((await w.call(mine.id, 'schedule_delete', { id: daily!.id })).isError).toBe(true)
  })

  it('get_group_info tells what each bot is good at', async () => {
    const w = await world()
    const run = await w.runOf(w.codex.id)
    const info = await w.call(run.id, 'get_group_info')
    expect(info.text).toContain(
      '- Claude · 主人 王磊 · claude · 离线 · 介绍：前端专家，擅长 React 与界面走查',
    )
  })
})
