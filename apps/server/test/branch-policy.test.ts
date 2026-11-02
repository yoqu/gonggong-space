import { type GroupDto, PROTOCOL_VERSION, type ServerToDaemon, type TimelineDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groupRepos, groups, messages } from '../src/db/schema.js'
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

describe('禁止直推基准分支', () => {
  it('is on for new groups; existing groups keep it off', async () => {
    const w = await world()
    const created = await w.as.owner.post<GroupDto>('/api/groups', {
      name: '新群',
      kind: 'group',
      botIds: [],
    })
    expect(created.body.protectBase).toBe(true)
    const old = await t.seed.group({ createdBy: w.owner.id })
    expect((await w.as.owner.get<GroupDto>(`/api/groups/${old.id}`)).body.protectBase).toBe(false)
  })

  it('only admins switch it, and the group is told', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.owner.id, memberIds: [w.member.id] })
    const url = `/api/groups/${g.id}`
    expect((await w.as.member.patch(url, { protectBase: true })).status).toBe(403)
    expect((await w.as.owner.patch<GroupDto>(url, { protectBase: true })).body.protectBase).toBe(true)
    await w.as.owner.patch(url, { protectBase: false })
    const bodies = (await w.as.member.get<TimelineDto>(`${url}/timeline`)).body.messages.map((m) => m.body)
    expect(bodies.slice(-2)).toEqual(['王磊 开启了「禁止直推基准分支」', '王磊 关闭了「禁止直推基准分支」'])
  })

  it('tells the daemon and the agent when the group has a repo and the policy is on', async () => {
    const w = await world()
    const g = await t.seed.group({ createdBy: w.owner.id, botIds: [w.bot.id] })
    await t.db
      .insert(groupRepos)
      .values({ groupId: g.id, url: 'git@git.corp:pay/pay.git', baseBranch: 'release' })
    await t.db.update(groupBots).set({ workspaceState: 'ready' }).where(eq(groupBots.groupId, g.id))
    const off = await runStart(w, g.id)
    expect(off.workspace.protectBase).toBe(false)
    expect(off.bot.systemPrompt).not.toContain('release')

    await t.db.update(groups).set({ protectBase: true }).where(eq(groups.id, g.id))
    const on = await runStart(w, g.id)
    expect(on.workspace).toMatchObject({ protectBase: true, repo: { branch: 'release' } })
    expect(on.bot.systemPrompt).toContain('never commit or push to the base branch release')
    // Only the base branch is off limits: an existing branch (e.g. feature-756) is worked on as is, names are free.
    expect(on.bot.systemPrompt).toContain('already on another branch, work, commit and push there')
    expect(on.bot.systemPrompt).not.toContain('feat/')
  })
})
