import {
  type GroupPluginDto,
  type MyListingDto,
  type PluginDto,
  type PluginTrustDto,
  PROTOCOL_VERSION,
  type RunStart,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, messages, notifications, pluginTrusts, runs, teamMembers } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { setInheritedMcp } from '../src/modules/mcp/service.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

// plan 插件扩展点 S1: plugins bring MCP servers; code runs only where the machine's owner allowed that version.

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const STDIO = {
  transport: 'stdio',
  name: 'issues',
  command: ['{node}', '{pkg}/contrib/mcp/server.mjs', '--verbose'],
  env: { TRACKER_TOKEN: '${secret:TRACKER_TOKEN}', LOG: 'info' },
}
const HTTP = {
  transport: 'http',
  name: 'search',
  url: 'https://tracker.example.com/mcp',
  headers: { Authorization: 'Bearer ${secret:TRACKER_TOKEN}' },
}

const manifest = (o: Record<string, unknown> = {}) => ({
  name: 'tracker',
  version: '1.0.0',
  title: '缺陷跟踪',
  description: '查询和更新缺陷',
  category: 'tool',
  agents: ['claude', 'codex'],
  minDaemon: '0.5.0',
  secrets: ['TRACKER_TOKEN'],
  permissions: ['exec', 'network'],
  contributes: { mcp: [STDIO, HTTP] },
  ...o,
})

const file = (path: string, content: string) => ({ path, content, encoding: 'utf8' as const })
const pkg = (m: Record<string, unknown> = manifest()) => [
  file('gonggong-plugin.json', JSON.stringify(m)),
  file('contrib/mcp/server.mjs', 'console.log(1)'),
]

/** eve owns the bot and the group; mia owns the machine it runs on. */
async function world() {
  const eve = await t.seed.user({ name: '伊芙' })
  const mia = await t.seed.user({ name: '米娅' })
  const zoe = await t.seed.user({ name: '佐伊' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, eve.id))
  const group = await t.seed.group({ createdBy: eve.id, name: '缺陷群' })
  const { machine, token } = await t.seed.machine(mia.id, { name: 'mia-mbp' })
  const bot = await t.seed.bot({ ownerId: eve.id, machineId: machine.id, name: '跟踪员' })
  await t.db.insert(groupBots).values({ groupId: group.id, botId: bot.id })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
  await (await as(root)).post('/api/admin/secrets', { name: 'TRACKER_TOKEN', value: 'tracker-secret-1' })
  return { eve, mia, zoe, root, group, machine, token, bot, as }
}
type World = Awaited<ReturnType<typeof world>>

async function upload(w: World, files = pkg()) {
  const res = await (await w.as(w.root)).post<PluginDto>('/api/admin/plugins', { files })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  return res.body
}

async function daemon(token: string, features = ['plugins', 'pluginMcp']) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.9.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
      features,
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { ws, next: <T>() => box.next<T>() }
}

async function turn(w: World, conn: Awaited<ReturnType<typeof daemon>>) {
  const [m] = await t.db
    .insert(messages)
    .values({
      groupId: w.group.id,
      kind: 'user',
      authorUserId: w.eve.id,
      body: '@跟踪员 查一下',
      meta: { mentions: [w.bot.id] },
    })
    .returning()
  await triggerRuns(t.ctx, m!)
  const start = await conn.next<RunStart>()
  await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, start.runId))
  return start
}

const blocker = async (w: World, pluginId: string) => {
  const list = (await (await w.as(w.eve)).get<GroupPluginDto[]>(`/api/groups/${w.group.id}/plugins`)).body
  return list.find((p) => p.id === pluginId)?.bots[0]?.blocker
}

const trustNotes = (userId: string) =>
  t.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, 'plugin_trust')))

describe('plugin manifest with contributes.mcp', () => {
  it('takes a tools-only plugin and refuses undeclared permissions, unknown secrets and missing scripts', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const bad = async (files: unknown) => (await root.post('/api/admin/plugins', { files })).body
    expect(await bad(pkg(manifest({ permissions: ['network'] })))).toMatchObject({ error: 'invalid' })
    expect(await bad(pkg(manifest({ permissions: ['exec', 'network', 'exec'] })))).toMatchObject({
      error: 'invalid',
    })
    expect(await bad(pkg(manifest({ contributes: { mcp: [HTTP] } })))).toMatchObject({ error: 'invalid' })
    expect(await bad(pkg(manifest({ secrets: [] })))).toMatchObject({ error: 'invalid' })
    expect(
      await bad(pkg(manifest({ contributes: { mcp: [STDIO, { ...HTTP, name: 'issues' }] } }))),
    ).toMatchObject({ error: 'invalid' })
    expect(await bad(pkg().filter((f) => f.path !== 'contrib/mcp/server.mjs'))).toMatchObject({
      error: 'invalid',
      message: expect.stringContaining('contrib/mcp/server.mjs'),
    })
    // Templates need the entry skill.
    expect(await bad(pkg(manifest({ templates: [{ id: 'a', title: 'A' }] })))).toMatchObject({
      error: 'invalid',
    })
    const p = await upload(w)
    expect(p.manifest).toMatchObject({ entry: null, permissions: ['exec', 'network'] })
    expect(p.manifest.contributes.mcp.map((c) => c.name)).toEqual(['issues', 'search'])
  })
})

describe('plugin MCP servers in run.start', () => {
  it('runs code only with 插件代码 on and the machine owner’s consent to that version', async () => {
    const w = await world()
    const p = await upload(w)
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const conn = await daemon(w.token)

    expect(await blocker(w, p.id)).toBe('code')
    expect((await turn(w, conn)).plugins).toEqual([])

    await saveSysParams(t.ctx, { pluginCodeEnabled: true }, w.root.id)
    expect(await blocker(w, p.id)).toBe('trust')
    expect((await turn(w, conn)).plugins).toEqual([])
    expect((await turn(w, conn)).plugins).toEqual([])
    // One request for mia, the machine's owner, however many turns wanted it; nothing for eve.
    const [note, ...more] = await trustNotes(w.mia.id)
    expect(more).toEqual([])
    expect(note!.payload).toMatchObject({
      machineId: w.machine.id,
      pluginTitle: '缺陷跟踪',
      version: '1.0.0',
    })
    expect(await trustNotes(w.eve.id)).toEqual([])

    const eve = await w.as(w.eve)
    const mia = await w.as(w.mia)
    const base = `/api/machines/${w.machine.id}/plugin-trusts`
    expect((await eve.get(base)).status).toBe(403)
    const [trust] = (await mia.get<PluginTrustDto[]>(base)).body
    expect(trust).toMatchObject({
      pluginName: 'tracker',
      versionId: p.versionId,
      status: 'pending',
      permissions: ['exec', 'network'],
    })
    expect((await eve.put(`${base}/${trust!.id}`, { allow: true })).status).toBe(403)
    expect((await mia.put(`${base}/${trust!.id}`, { allow: true })).status).toBe(200)
    expect((await trustNotes(w.mia.id))[0]!.resolvedAt).not.toBeNull()
    expect(await blocker(w, p.id)).toBeNull()

    const start = await turn(w, conn)
    expect(start.plugins).toEqual([
      {
        name: 'tracker',
        versionId: p.versionId,
        digest: expect.any(String),
        mcp: [
          {
            transport: 'stdio',
            name: 'tracker-issues',
            command: '{node}',
            args: ['{pkg}/contrib/mcp/server.mjs', '--verbose'],
            env: { TRACKER_TOKEN: 'tracker-secret-1', LOG: 'info' },
          },
          {
            transport: 'http',
            name: 'tracker-search',
            url: 'https://tracker.example.com/mcp',
            headers: { Authorization: 'Bearer tracker-secret-1' },
          },
        ],
      },
    ])
    // Secret values are not stored with the run.
    const [row] = await t.db.select().from(runs).where(eq(runs.id, start.runId))
    expect(JSON.stringify(row!.plugins)).not.toContain('tracker-secret-1')

    // A group override by name turns one server off, as for inherited MCP servers.
    await setInheritedMcp(t.ctx, w.group.id, 'tracker-issues', false, w.eve.id)
    expect((await turn(w, conn)).plugins[0]!.mcp.map((c) => c.name)).toEqual(['tracker-search'])

    // A new version asks again; revoking asks again too.
    const v2 = await upload(w, pkg(manifest({ version: '1.1.0' })))
    expect(await blocker(w, p.id)).toBe('trust')
    expect((await turn(w, conn)).plugins).toEqual([])
    expect(await trustNotes(w.mia.id)).toHaveLength(2)
    const trusts = (await mia.get<PluginTrustDto[]>(base)).body
    const next = trusts.find((x) => x.versionId === v2.versionId)!
    expect((await mia.put(`${base}/${next.id}`, { allow: false })).status).toBe(200)
    expect(await blocker(w, p.id)).toBe('trust')
    expect((await turn(w, conn)).plugins).toEqual([])
    expect(await trustNotes(w.mia.id)).toHaveLength(2)
    expect((await mia.del(`${base}/${next.id}`)).status).toBe(204)
    expect(await t.db.select().from(pluginTrusts).where(eq(pluginTrusts.id, next.id))).toEqual([])
  })

  it('needs no consent for http-only plugins, and leaves MCP plugins out on daemons without pluginMcp', async () => {
    const w = await world()
    const http = manifest({ permissions: ['network'], contributes: { mcp: [HTTP] } })
    const p = await upload(w, [file('gonggong-plugin.json', JSON.stringify(http))])
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const old = await daemon(w.token, ['plugins'])
    expect(await blocker(w, p.id)).toBe('daemon')
    expect((await turn(w, old)).plugins).toEqual([])
    old.ws.close()
    const conn = await daemon(w.token)
    expect(await blocker(w, p.id)).toBeNull()
    const [ref] = (await turn(w, conn)).plugins
    expect(ref!.mcp.map((c) => c.name)).toEqual(['tracker-search'])
    expect(await t.db.select().from(pluginTrusts)).toEqual([])
  })
})

describe('plugins that run code in the market', () => {
  it('stay in their team and are installed only at a pinned version', async () => {
    const w = await world()
    const bob = await t.seed.user({ name: '鲍勃' })
    await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
    const eve = await w.as(w.eve)
    const teamId = w.group.teamId
    const publish = (visibility: string, files = pkg()) =>
      eve.post<{ listing: MyListingDto }>('/api/market', { teamId, visibility, files })
    const refused = { error: 'invalid', message: expect.stringContaining('团队内可见') }
    expect((await publish('public')).body).toMatchObject(refused)
    expect(
      (await eve.post('/api/market/preflight', { teamId, visibility: 'public', files: pkg() })).body,
    ).toMatchObject(refused)
    const made = await publish('team')
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    const { listing } = made.body
    expect((await eve.patch(`/api/market/${listing.id}`, { visibility: 'public' })).body).toMatchObject(
      refused,
    )
    // An http-only plugin runs nothing on the machine: it may go public.
    const http = manifest({ name: 'search', permissions: ['network'], contributes: { mcp: [HTTP] } })
    expect((await publish('public', [file('gonggong-plugin.json', JSON.stringify(http))])).status).toBe(201)

    const version = `/api/market/${listing.id}/versions/${listing.latest.id}`
    expect((await eve.post(`${version}/submit`, { changelog: '首版' })).status).toBe(200)
    expect((await (await w.as(bob)).post(`${version}/review`, { approve: true })).status).toBe(204)
    const install = `/api/groups/${w.group.id}/installs/${listing.id}`
    expect((await eve.put(install, { enabled: true })).body).toMatchObject({
      error: 'invalid',
      message: expect.stringContaining('固定版本'),
    })
    expect((await eve.put(install, { enabled: true, pinVersionId: listing.latest.id })).status).toBe(200)
  })
})
