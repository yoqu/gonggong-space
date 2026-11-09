import type { MessageDto, ToolCallRes, WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
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
  const bot = await t.seed.bot({ ownerId: wang.id, name: '部署 Bot', machineId: machine.id })
  const other = await t.seed.bot({ ownerId: wang.id, name: '另一个 Bot', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id, other.id] })
  const elsewhere = await t.seed.group({ createdBy: wang.id, botIds: [bot.id] })
  const runOf = async (botId: string, groupId = group.id) => {
    const [trigger] = await t.db
      .insert(messages)
      .values({ groupId, kind: 'user', authorUserId: wang.id, body: '@部署 Bot 部署到 test' })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({ groupId, botId, triggerMessageId: trigger!.id, originUserId: wang.id, status: 'running' })
      .returning()
    return run!
  }
  const run = await runOf(bot.id)
  const seen: WebEvent[] = []
  t.ctx.bus.attach(li.id, (e) => seen.push(e))
  const call = async (name: string, args: unknown, runId = run.id) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${runId}/tools/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    expect(res.statusCode).toBe(200)
    return res.json<ToolCallRes>()
  }
  return { bot, other, group, elsewhere, run, runOf, seen, call }
}

const STAGES = [
  { name: '排队', status: 'done' },
  { name: '构建', status: 'running' },
  { name: '部署', status: 'pending' },
]

const cardId = (res: ToolCallRes) => /id：([0-9a-f-]{36})/.exec(res.text)?.[1] as string

const progressOf = async (id: string) => {
  const [m] = await t.db.select().from(messages).where(eq(messages.id, id))
  return m
}

describe('progress_card', () => {
  it('posts a live card to the group and returns its id', async () => {
    const w = await world()
    const res = await w.call('progress_card', {
      title: '部署 luke-server 到 test',
      stages: STAGES,
      percent: 40,
      detail: '构建号 #128',
    })
    expect(res.isError).toBe(false)
    const id = cardId(res)
    expect(id).toBeTruthy()
    const posted = w.seen.find((e) => e.t === 'message.new') as { message: MessageDto } | undefined
    expect(posted?.message).toMatchObject({
      id,
      kind: 'event',
      body: '部署 Bot 的进度：部署 luke-server 到 test',
      progress: {
        id,
        botId: w.bot.id,
        runId: w.run.id,
        title: '部署 luke-server 到 test',
        stages: STAGES,
        percent: 40,
        detail: '构建号 #128',
        link: null,
        status: 'running',
      },
    })
  })

  it('updates only the fields given and derives the overall status', async () => {
    const w = await world()
    const id = cardId(await w.call('progress_card', { title: '部署', stages: STAGES, detail: '构建号 #128' }))
    w.seen.length = 0
    const done = STAGES.map((s) => ({ ...s, status: 'done' }))
    const res = await w.call('progress_card', {
      id,
      stages: done,
      percent: 100,
      link: { label: '预览二维码', url: 'https://example.com/qr.png' },
    })
    expect(res.isError).toBe(false)
    const edited = w.seen.find((e) => e.t === 'message.edited') as { message: MessageDto } | undefined
    expect(edited?.message.progress).toMatchObject({
      title: '部署',
      stages: done,
      percent: 100,
      detail: '构建号 #128',
      link: { label: '预览二维码', url: 'https://example.com/qr.png' },
      status: 'done',
    })

    await w.call('progress_card', {
      id,
      stages: [{ name: '部署', status: 'failed' }],
      detail: '健康检查失败',
      percent: null,
    })
    const m = await progressOf(id)
    expect((m!.meta as { progress: MessageDto['progress'] }).progress).toMatchObject({
      status: 'failed',
      detail: '健康检查失败',
      percent: null,
    })
  })

  it('lets a later run of the same bot keep updating it', async () => {
    const w = await world()
    const id = cardId(await w.call('progress_card', { title: '部署', stages: STAGES }))
    const next = await w.runOf(w.bot.id)
    const res = await w.call('progress_card', { id, percent: 80 }, next.id)
    expect(res.isError).toBe(false)
    // The card moves to the run card of the run that last updated it.
    const m = await progressOf(id)
    expect((m!.meta as { progress: MessageDto['progress'] }).progress?.runId).toBe(next.id)
  })

  it('refuses a new card without title and stages, and cards it may not touch', async () => {
    const w = await world()
    expect((await w.call('progress_card', { title: '部署' })).isError).toBe(true)
    const id = cardId(await w.call('progress_card', { title: '部署', stages: STAGES }))
    const theirs = await w.runOf(w.other.id)
    expect((await w.call('progress_card', { id, percent: 50 }, theirs.id)).text).toContain(
      '不是本 Bot 的进度卡片',
    )
    const away = await w.runOf(w.bot.id, w.elsewhere.id)
    expect((await w.call('progress_card', { id, percent: 50 }, away.id)).isError).toBe(true)
    expect((await w.call('progress_card', { id: crypto.randomUUID(), percent: 50 })).isError).toBe(true)
  })
})
