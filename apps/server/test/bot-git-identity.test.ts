import { type BotDto, PROTOCOL_VERSION, type ServerToDaemon } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages } from '../src/db/schema.js'
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
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const owners = client(t, await t.seed.cookie(owner.id))
  const admins = client(t, await t.seed.cookie(admin.id))
  return { owner, token, bot, owners, admins }
}

async function runStart(w: Awaited<ReturnType<typeof world>>) {
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
  const g = await t.seed.group({ createdBy: w.owner.id, botIds: [w.bot.id] })
  const [m] = await t.db
    .insert(messages)
    .values({
      groupId: g.id,
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

describe('bot git identity', () => {
  it('defaults to the bot name and a generated email', async () => {
    const w = await world()
    const res = await w.owners.get<BotDto>(`/api/bots/${w.bot.id}`)
    expect(res.body).toMatchObject({
      gitName: null,
      gitEmail: null,
      gitDefaultEmail: `${w.bot.id.slice(0, 8)}@bots.gonggong.local`,
    })
    const start = await runStart(w)
    expect(start.bot.git).toEqual({ name: 'cc', email: `${w.bot.id.slice(0, 8)}@bots.gonggong.local` })
  })

  it('the owner sets a custom name and email, carried by run.start', async () => {
    const w = await world()
    const res = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, {
      gitName: ' CC Bot ',
      gitEmail: 'cc@corp.com',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ gitName: 'CC Bot', gitEmail: 'cc@corp.com' })
    const start = await runStart(w)
    expect(start.bot.git).toEqual({ name: 'CC Bot', email: 'cc@corp.com' })
  })

  it('null clears back to the defaults', async () => {
    const w = await world()
    await w.owners.patch(`/api/bots/${w.bot.id}`, { gitName: 'x', gitEmail: 'x@corp.com' })
    const res = await w.owners.patch<BotDto>(`/api/bots/${w.bot.id}`, { gitName: null, gitEmail: null })
    expect(res.body).toMatchObject({ gitName: null, gitEmail: null })
  })

  it('rejects an invalid email', async () => {
    const w = await world()
    const res = await w.owners.patch(`/api/bots/${w.bot.id}`, { gitEmail: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  it('only the owner may change it', async () => {
    const w = await world()
    for (const body of [{ gitName: 'x' }, { gitEmail: 'x@corp.com' }]) {
      const res = await w.admins.patch(`/api/bots/${w.bot.id}`, body)
      expect(res.status).toBe(403)
    }
  })
})
