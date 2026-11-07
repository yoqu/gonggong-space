import { type GroupDto, PROTOCOL_VERSION, type ServerToDaemon } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groups, messages } from '../src/db/schema.js'
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
  const member = await t.seed.user({ name: '李娜' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const as = {
    owner: client(t, await t.seed.cookie(owner.id)),
    member: client(t, await t.seed.cookie(member.id)),
  }
  return { owner, member, token, bot, as }
}

async function runStart(w: Awaited<ReturnType<typeof world>>, groupId: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token: w.token,
      daemonVersion: '0.1.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  const [m] = await t.db
    .insert(messages)
    .values({
      groupId,
      kind: 'user',
      authorUserId: w.owner.id,
      body: '@cc 提交',
      meta: { mentions: [w.bot.id] },
    })
    .returning()
  await triggerRuns(t.ctx, m!)
  const start = await box.next<ServerToDaemon>()
  ws.close()
  if (start.t !== 'run.start') throw new Error(`unexpected ${start.t}`)
  return start
}

describe('回复风格', () => {
  it('is business for new groups; existing groups stay tech', async () => {
    const w = await world()
    const created = await w.as.owner.post<GroupDto>('/api/groups', {
      name: '新群',
      kind: 'group',
      botIds: [],
    })
    expect(created.body.replyStyle).toBe('business')
    const old = await t.seed.group({ createdBy: w.owner.id })
    expect((await w.as.owner.get<GroupDto>(`/api/groups/${old.id}`)).body.replyStyle).toBe('tech')
  })

  it('only admins switch it; other params stay', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.owner.id, memberIds: [w.member.id] })
    await t.db
      .update(groups)
      .set({ params: { chainMaxHops: 5 } })
      .where(eq(groups.id, g.id))
    const url = `/api/groups/${g.id}`
    expect((await w.as.member.patch(url, { replyStyle: 'business' })).status).toBe(403)
    expect((await w.as.owner.patch(url, { replyStyle: 'casual' })).status).toBe(400)
    expect((await w.as.owner.patch<GroupDto>(url, { replyStyle: 'business' })).body.replyStyle).toBe(
      'business',
    )
    const [row] = await t.db.select({ params: groups.params }).from(groups).where(eq(groups.id, g.id))
    expect(row?.params).toEqual({ chainMaxHops: 5, replyStyle: 'business' })
  })

  it('tells the agent to answer in business tone only in business groups', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.owner.id, botIds: [w.bot.id] })
    await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, g.id))
    const tech = await runStart(w, g.id)
    expect(tech.bot.systemPrompt).not.toContain('**依据**')

    await t.db
      .update(groups)
      .set({ params: { replyStyle: 'business' } })
      .where(eq(groups.id, g.id))
    const business = await runStart(w, g.id)
    expect(business.bot.systemPrompt).toContain('conclusion first')
    expect(business.bot.systemPrompt).toContain('**依据**')
    expect(business.bot.systemPrompt).toContain('**Basis**')
  })
})
