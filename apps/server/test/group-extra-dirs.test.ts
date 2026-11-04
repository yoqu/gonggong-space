import { type GroupBotStateDto, PROTOCOL_VERSION, type ServerToDaemon } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, messages } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '陈晨' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const g1 = await t.seed.group({ createdBy: member.id, memberIds: [owner.id], botIds: [bot.id] })
  const g2 = await t.seed.group({ createdBy: member.id, memberIds: [owner.id], botIds: [bot.id] })
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.1.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  const owners = client(t, await t.seed.cookie(owner.id))
  const members = client(t, await t.seed.cookie(member.id))
  const setDirs = (c: typeof owners, groupId: string, dirs: string[]) =>
    c.put(`/api/groups/${groupId}/bots/${bot.id}/extra-dirs`, { dirs })
  const trigger = async (groupId: string) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId,
        kind: 'user',
        authorUserId: owner.id,
        body: '@cc 看下',
        meta: { mentions: [bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const s = await box.next<ServerToDaemon>()
    if (s.t !== 'run.start') throw new Error(`unexpected ${s.t}`)
    return s
  }
  return { owner, bot, g1, g2, owners, members, setDirs, trigger }
}

describe('additional directories of a bot in a group', () => {
  it('only the bot owner sets them; they reach run.start in that group and start a new session', async () => {
    const w = await world()
    expect((await w.setDirs(w.members, w.g1.id, ['/Users/wl/sdk'])).status).toBe(403)
    expect((await w.setDirs(w.owners, w.g1.id, ['sdk'])).status).toBe(400)
    await t.db
      .update(groupBots)
      .set({ sessionId: 'sess-1', contextUsage: { used: 9000, size: 200000 } })
      .where(and(eq(groupBots.groupId, w.g1.id), eq(groupBots.botId, w.bot.id)))

    const dirs = ['/Users/wl/sdk/', '/Users/wl/sdk', 'C:\\work\\docs']
    expect((await w.setDirs(w.owners, w.g1.id, dirs)).status).toBe(204)
    const states = await w.owners.get<GroupBotStateDto[]>(`/api/groups/${w.g1.id}/bot-states`)
    expect(states.body[0]!.extraDirs).toEqual(['/Users/wl/sdk', 'C:\\work\\docs'])
    expect(states.body[0]!.context).toBeNull()
    const events = await t.db.select().from(messages).where(eq(messages.groupId, w.g1.id))
    expect(events.map((m) => m.body)).toContain(
      '王磊 将 cc 在本群的自带目录设为 /Users/wl/sdk、C:\\work\\docs',
    )

    const s1 = await w.trigger(w.g1.id)
    expect(s1.workspace.extraDirs).toEqual(['/Users/wl/sdk', 'C:\\work\\docs'])
    expect(s1.resumeSessionId).toBeNull()
    expect(s1.newSessionReason).toBe('config_changed')
    const s2 = await w.trigger(w.g2.id)
    expect(s2.workspace.extraDirs).toEqual([])

    // Unchanged: no event, the session is kept.
    const count = async () => (await t.db.select().from(messages).where(eq(messages.groupId, w.g1.id))).length
    const before = await count()
    expect((await w.setDirs(w.owners, w.g1.id, ['/Users/wl/sdk', 'C:\\work\\docs'])).status).toBe(204)
    expect(await count()).toBe(before)

    expect((await w.setDirs(w.owners, w.g1.id, [])).status).toBe(204)
    const cleared = await w.owners.get<GroupBotStateDto[]>(`/api/groups/${w.g1.id}/bot-states`)
    expect(cleared.body[0]!.extraDirs).toEqual([])
    const last = await t.db.select().from(messages).where(eq(messages.groupId, w.g1.id))
    expect(last.map((m) => m.body)).toContain('王磊 清空了 cc 在本群的自带目录')
  })
})
