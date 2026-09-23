import { type McpServerDto, PROTOCOL_VERSION, type RunStart } from '@aiws/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupBots, messages } from '../src/db/schema.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const echo = {
  transport: 'stdio' as const,
  name: 'aiws-echo',
  command: 'node',
  args: ['server.js'],
  env: { WIKI_TOKEN: 'x' },
}
const wiki = { transport: 'http' as const, name: 'wiki', url: 'https://mcp.corp/wiki', headers: {} }

async function admin() {
  const user = await t.seed.user({ role: 'sysadmin', name: '陈晨' })
  return { user, api: client(t, await t.seed.cookie(user.id)) }
}

describe('global MCP servers', () => {
  it('lets only the sysadmin manage the list, with unique names and the built-in name reserved, audited', async () => {
    const { user, api } = await admin()
    const member = client(t, await t.seed.cookie((await t.seed.user()).id))
    expect((await member.get('/api/admin/mcp')).status).toBe(403)
    expect((await member.post('/api/admin/mcp', { enabled: true, config: echo })).status).toBe(403)

    const created = await api.post<McpServerDto>('/api/admin/mcp', { enabled: true, config: echo })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ enabled: true, config: echo })
    expect(
      (await api.post('/api/admin/mcp', { enabled: false, config: { ...wiki, name: 'aiws-echo' } })).body,
    ).toMatchObject({ error: 'conflict' })
    expect(
      (await api.post('/api/admin/mcp', { enabled: true, config: { ...wiki, name: 'aiws' } })).body,
    ).toMatchObject({ error: 'invalid' })
    expect((await api.post('/api/admin/mcp', { enabled: true, config: { ...wiki, name: ' ' } })).status).toBe(
      400,
    )

    const id = created.body.id
    const updated = await api.patch<McpServerDto>(`/api/admin/mcp/${id}`, { enabled: false, config: echo })
    expect(updated.body.enabled).toBe(false)
    expect((await api.get<McpServerDto[]>('/api/admin/mcp')).body.map((s) => s.config.name)).toEqual([
      'aiws-echo',
    ])
    expect((await api.del(`/api/admin/mcp/${id}`)).status).toBe(204)
    expect((await api.get<McpServerDto[]>('/api/admin/mcp')).body).toEqual([])
    expect((await api.del(`/api/admin/mcp/${id}`)).status).toBe(404)

    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, user.id))
    expect(log.map((l) => [l.category, l.action])).toEqual([
      ['admin', 'mcp.create'],
      ['admin', 'mcp.update'],
      ['admin', 'mcp.delete'],
    ])
    expect(log[0]!.detail).toMatchObject({ name: 'aiws-echo', enabled: true, forceNewSession: false })
  })

  it('forcing a new session marks every bot for a config_changed session; running turns keep going', async () => {
    const { api } = await admin()
    const owner = await t.seed.user()
    const bot = await t.seed.bot({ ownerId: owner.id })
    const other = await t.seed.bot({ ownerId: owner.id })
    const g1 = await t.seed.group({ createdBy: owner.id, botIds: [bot.id, other.id] })
    const g2 = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
    await t.db.update(groupBots).set({ sessionId: 'sess-1' })

    await api.post('/api/admin/mcp', { enabled: true, config: echo })
    expect((await t.db.select().from(groupBots)).map((g) => g.newSessionReason)).toEqual([null, null, null])

    await api.post('/api/admin/mcp', { enabled: true, config: wiki, forceNewSession: true })
    const rows = await t.db.select().from(groupBots)
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r).toMatchObject({ newSessionReason: 'config_changed', sessionId: null })
    expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([g1.id, g2.id]))
  })

  it('injects enabled servers into run.start and the config_changed reason into the next dispatch', async () => {
    const { api } = await admin()
    const owner = await t.seed.user({ name: '王磊' })
    const { machine, token } = await t.seed.machine(owner.id)
    const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, binding: 'bound' })
    const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
    await api.post('/api/admin/mcp', { enabled: true, config: echo })
    await api.post('/api/admin/mcp', { enabled: false, config: wiki, forceNewSession: true })

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
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: owner.id,
        body: '@bot hi',
        meta: { mentions: [bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const start = await box.next<RunStart>()
    expect(start).toMatchObject({ t: 'run.start', newSessionReason: 'config_changed', resumeSessionId: null })
    expect(start.mcpServers).toEqual([echo])
    const [gb] = await t.db
      .select()
      .from(groupBots)
      .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
    expect(gb!.newSessionReason).toBeNull()
    ws.close()
  })
})
