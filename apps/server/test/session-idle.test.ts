import type { MessageDto, RunStart, ServerToDaemon } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, runs, systemParams } from '../src/db/schema.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const HOUR = 3600_000

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const { machine } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const g = await t.seed.group({ createdBy: wang.id, botIds: [claude.id] })
  await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, g.id))
  const sent: ServerToDaemon[] = []
  t.ctx.hub.register(machine.id, { send: (m) => sent.push(m), close() {} })
  const asWang = client(t, await t.seed.cookie(wang.id))
  let n = 0
  const ask = (body: string) =>
    asWang.post<MessageDto>(`/api/groups/${g.id}/messages`, { body, clientId: `idle-client-${++n}` })
  const starts = () => sent.filter((m): m is RunStart => m.t === 'run.start')
  /** Ends every run `hoursAgo` and leaves the bot with a session to resume. */
  const finishAll = async (hoursAgo: number) => {
    await t.db
      .update(runs)
      .set({ status: 'completed', endedAt: new Date(Date.now() - hoursAgo * HOUR) })
      .where(eq(runs.groupId, g.id))
    await t.db.update(groupBots).set({ sessionId: 'sess-0' }).where(eq(groupBots.groupId, g.id))
  }
  return { ask, starts, finishAll }
}

describe('idle session reset', () => {
  it('opens a new session when the bot last finished a turn here over 6 hours ago', async () => {
    const w = await world()
    await w.ask('@小王的 Claude 第一轮')
    await w.finishAll(7)
    await w.ask('@小王的 Claude 第二天接着聊')
    expect(w.starts()[1]).toMatchObject({ resumeSessionId: null, newSessionReason: 'idle' })
  })

  it('resumes the session after a shorter break', async () => {
    const w = await world()
    await w.ask('@小王的 Claude 第一轮')
    await w.finishAll(2)
    await w.ask('@小王的 Claude 午饭回来')
    expect(w.starts()[1]).toMatchObject({ resumeSessionId: 'sess-0', newSessionReason: null })
  })

  it('follows the sessionIdleHours system param', async () => {
    await t.db.insert(systemParams).values({ key: 'sessionIdleHours', value: 1 })
    forgetSysParams(t.db)
    const w = await world()
    await w.ask('@小王的 Claude 第一轮')
    await w.finishAll(2)
    await w.ask('@小王的 Claude 开会回来')
    expect(w.starts()[1]).toMatchObject({ resumeSessionId: null, newSessionReason: 'idle' })
  })

  it('does not count scheduled turns, which run in sessions of their own', async () => {
    const w = await world()
    await w.ask('@小王的 Claude 第一轮')
    await w.finishAll(7)
    const [first] = await t.db.select().from(runs)
    await t.db.insert(runs).values({
      ...first!,
      id: undefined,
      newSessionReason: 'schedule',
      endedAt: new Date(Date.now() - HOUR),
    })
    await w.ask('@小王的 Claude 接着聊')
    expect(w.starts()[1]).toMatchObject({ resumeSessionId: null, newSessionReason: 'idle' })
  })
})
