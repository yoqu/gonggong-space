import {
  type AgentCatalog,
  type BotDto,
  type GroupBotStateDto,
  type MessageDto,
  PROTOCOL_VERSION,
  type RunDto,
  type ServerToDaemon,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const level = (value: string) => ({ value, name: value[0]!.toUpperCase() + value.slice(1) })
const CATALOG: AgentCatalog = {
  current: null,
  efforts: ['low', 'medium', 'high'].map(level),
  effort: 'medium',
  models: [
    { value: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'].map(level), effort: 'medium' },
    { value: 'opus', name: 'Opus', efforts: ['low', 'medium', 'high', 'max'].map(level), effort: 'high' },
    { value: 'haiku', name: 'Haiku', efforts: [], effort: null },
  ],
}
const AGENTS = [
  {
    kind: 'claude',
    available: true,
    version: '2.1.4',
    path: '/bin/claude',
    minVersion: '2.0.0',
    catalog: CATALOG,
  },
]

async function daemon(token: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token,
    daemonVersion: '0.1.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: AGENTS,
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  const start = async () => {
    const m = await box.next<ServerToDaemon>()
    if (m.t !== 'run.start') throw new Error(`unexpected ${m.t}`)
    return m
  }
  const done = (runId: string) =>
    send({
      t: 'run.done',
      runId,
      outcome: 'completed',
      reply: 'ok',
      filesChanged: 0,
      usage: null,
      sessionId: 's1',
      newSessionReason: null,
      error: null,
      git: null,
      patch: null,
      appendsApplied: 0,
    })
  return { send, start, done }
}

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const admin = await t.seed.user({ name: '陈晨' })
  const member = await t.seed.user({ name: '李雷' })
  const { machine, token } = await t.seed.machine(owner.id, { agents: AGENTS })
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const group = await t.seed.group({
    createdBy: admin.id,
    memberIds: [owner.id, member.id],
    botIds: [bot.id],
  })
  const as = async (id: string) => client(t, await t.seed.cookie(id))
  const [owners, admins, members] = [await as(owner.id), await as(admin.id), await as(member.id)]
  const setGroup = (c: typeof owners, model: string | null, effort: string | null) =>
    c.put(`/api/groups/${group.id}/bots/${bot.id}/config`, { model, effort })
  const say = (c: typeof owners, runOptions?: object) =>
    c.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@cc 构建',
      clientId: crypto.randomUUID(),
      ...(runOptions && { runOptions }),
    })
  return { owner, admin, member, machine, bot, group, owners, admins, members, setGroup, say, token }
}

const events = async (groupId: string) =>
  (await t.db.select().from(messages).where(eq(messages.groupId, groupId)))
    .filter((m) => m.kind === 'event')
    .map((m) => m.body)

describe('bot defaults', () => {
  it('are validated against the catalog of the bound machine', async () => {
    const w = await world()
    const created = await w.owners.post<BotDto>('/api/bots', {
      name: 'cc2',
      ownerId: w.owner.id,
      agentKind: 'claude',
      machineId: w.machine.id,
      model: 'opus',
      effort: 'max',
    })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ model: 'opus', effort: 'max', catalog: CATALOG })
    const url = `/api/bots/${created.body.id}`
    expect((await w.owners.patch(url, { effort: 'turbo' })).status).toBe(400)
    expect((await w.owners.patch(url, { model: 'gpt-x' })).status).toBe(400)
    expect((await w.owners.patch(url, { model: 'haiku', effort: 'max' })).status).toBe(400)
    // A level the new model lacks is dropped; one it offers is kept.
    const patched = await w.owners.patch<BotDto>(url, { model: 'haiku' })
    expect(patched.body).toMatchObject({ model: 'haiku', effort: null })
    await w.owners.patch(url, { model: 'opus', effort: 'low' })
    expect((await w.owners.patch<BotDto>(url, { model: 'sonnet' })).body.effort).toBe('low')
  })

  it('stay unset for a bot without a machine', async () => {
    const w = await world()
    const nomachine = await t.seed.user({ name: '韩梅梅' })
    const c = client(t, await t.seed.cookie(nomachine.id))
    const req = { name: 'mm', ownerId: nomachine.id, agentKind: 'claude', machineId: null }
    expect((await c.post('/api/bots', { ...req, model: 'opus' })).status).toBe(400)
    const ok = await c.post<BotDto>('/api/bots', req)
    expect(ok.body).toMatchObject({ model: null, effort: null, catalog: null })
    expect(w.bot.id).toBeTruthy()
  })
})

describe('group default', () => {
  it('is set by the bot owner or a group admin, announced, and cleared with nulls', async () => {
    const w = await world()
    expect((await w.setGroup(w.members, 'opus', 'high')).status).toBe(403)
    expect((await w.setGroup(w.owners, 'opus', 'turbo')).status).toBe(400)
    expect((await w.setGroup(w.owners, 'opus', 'high')).status).toBe(204)
    const states = await w.owners.get<GroupBotStateDto[]>(`/api/groups/${w.group.id}/bot-states`)
    expect(states.body[0]).toMatchObject({ model: 'opus', effort: 'high' })
    expect((await w.setGroup(w.admins, null, null)).status).toBe(204)
    expect(await events(w.group.id)).toEqual([
      '王磊 将 cc 在本群的模型设为 Opus · 高',
      '陈晨 将 cc 在本群的模型恢复为跟随 Bot 默认',
    ])
  })
})

describe('run config', () => {
  it('follows the group default, else the bot default, with an effort the model offers', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await w.owners.patch(`/api/bots/${w.bot.id}`, { model: 'sonnet', effort: 'low' })
    const turn = async () => {
      await w.say(w.owners)
      const start = await d.start()
      d.done(start.runId)
      return [start.bot.model, start.bot.effort]
    }
    expect(await turn()).toEqual(['sonnet', 'low'])
    await w.setGroup(w.owners, 'opus', null)
    // The bot's low fits opus too.
    expect(await turn()).toEqual(['opus', 'low'])
    await w.setGroup(w.owners, 'haiku', null)
    expect(await turn()).toEqual(['haiku', null])
    await w.owners.patch(`/api/bots/${w.bot.id}`, { model: null, effort: null })
    await w.setGroup(w.owners, null, null)
    // The adapter's default model, with its own starting level spelled out.
    expect(await turn()).toEqual([null, 'medium'])
  })

  it('takes a one-shot pick for the mentioned bot on that message only', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await w.setGroup(w.owners, 'sonnet', 'medium')
    expect((await w.say(w.owners, { [w.bot.id]: { model: 'opus', effort: 'max' } })).status).toBe(200)
    const first = await d.start()
    expect([first.bot.model, first.bot.effort]).toEqual(['opus', 'max'])
    d.send({ t: 'session.config', runId: first.runId, model: 'opus', effort: 'max' })
    d.done(first.runId)
    await expect
      .poll(async () => (await w.owners.get<{ run: RunDto }>(`/api/runs/${first.runId}`)).body.run)
      .toMatchObject({ model: 'opus', effort: 'max', status: 'completed' })

    // Effort only: the model follows the defaults.
    await w.say(w.admins, { [w.bot.id]: { effort: 'low' } })
    const second = await d.start()
    expect([second.bot.model, second.bot.effort]).toEqual(['sonnet', 'low'])
    d.done(second.runId)
    await w.say(w.owners)
    const third = await d.start()
    expect([third.bot.model, third.bot.effort]).toEqual(['sonnet', 'medium'])
  })

  it('refuses picks from members who may not switch, and values the catalog lacks', async () => {
    const w = await world()
    expect((await w.say(w.members, { [w.bot.id]: { model: 'opus' } })).status).toBe(403)
    expect((await w.say(w.owners, { [w.bot.id]: { model: 'gpt-x' } })).status).toBe(400)
    expect((await w.say(w.owners, { [w.bot.id]: { model: 'opus', effort: 'turbo' } })).status).toBe(400)
  })
})
