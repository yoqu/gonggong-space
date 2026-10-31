import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type CreationCard,
  type CreationDraftCard,
  type GroupDesignSystemDto,
  type GroupPluginDto,
  groupDesignSystemKey,
  type MeDto,
  type MessageDto,
  PLUGIN_MAX_BYTES,
  type PluginDto,
  type PluginManifest,
  PROTOCOL_VERSION,
  type QuestionSetDto,
  type RunStart,
  type ToolCallRes,
  type WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attachments,
  groupBots,
  groupPlugins,
  machines,
  messages,
  plugins,
  pluginVersions,
  questionSets,
  runs,
  teamMembers,
} from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { BUILTIN_PLUGINS, syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { pluginBlocker } from '../src/modules/plugins/service.js'
import { buildRunStart } from '../src/modules/runs/scheduler.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const PNG = Buffer.from('fake-png-bytes').toString('base64')

type ManifestIn = Omit<Partial<PluginManifest>, 'templates' | 'designSystems' | 'inputs'> & {
  templates?: Partial<PluginManifest['templates'][number]>[]
  designSystems?: Partial<PluginManifest['designSystems'][number]>[]
  inputs?: Partial<PluginManifest['inputs'][number]>[]
}

const manifest = (o: ManifestIn = {}) => ({
  name: 'web-prototype',
  version: '1.0.0',
  title: '网页原型',
  description: '把需求做成可预览的网页原型',
  category: 'web',
  agents: ['claude', 'codex'],
  minDaemon: '0.5.0',
  entry: 'web-prototype',
  templates: [{ id: 'saas', title: 'SaaS 落地页', preview: 'previews/saas.png' }],
  designSystems: [
    {
      id: 'neutral-modern',
      title: '中性现代',
      swatches: ['#111111', '#ffffff'],
      dir: 'systems/neutral-modern',
    },
  ],
  inputs: [
    { id: 'title', label: '主标题', type: 'string', required: true },
    { id: 'tone', label: '语气', type: 'select', options: ['专业', '活泼'], default: '专业' },
    { id: 'audience', label: '目标受众', type: 'text' },
  ],
  secrets: [],
  license: 'Apache-2.0',
  ...o,
})

const skillMd = (name: string, body = 'Make a page.') =>
  `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}\n`

/** A valid folder for the manifest: entry SKILL.md, each design system's files and each template preview. */
function pkg(m: ReturnType<typeof manifest> = manifest(), body?: string) {
  return [
    { path: 'gonggong-plugin.json', content: JSON.stringify(m) },
    { path: `skills/${m.entry}/SKILL.md`, content: skillMd(m.entry, body) },
    ...m.designSystems.flatMap((d) => [
      { path: `skills/${m.entry}/${d.dir}/DESIGN.md`, content: `# ${d.title}\n` },
      { path: `skills/${m.entry}/${d.dir}/tokens.css`, content: ':root { --fg: #111; }\n' },
    ]),
    ...m.templates.flatMap((tp) =>
      tp.preview ? [{ path: tp.preview, content: PNG, encoding: 'base64' as const }] : [],
    ),
  ]
}

/** Team A: bob (team admin), eve (group admin, bot owner), mia (group member); root is a teamless sysadmin. */
async function world() {
  const bob = await t.seed.user({ name: '鲍勃' })
  const eve = await t.seed.user({ name: '伊芙' })
  const mia = await t.seed.user({ name: '米娅' })
  const zoe = await t.seed.user({ name: '佐伊' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
  const group = await t.seed.group({ createdBy: eve.id, name: '设计群', memberIds: [mia.id] })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  return { bob, eve, mia, zoe, root, team: group.teamId, group, as }
}

type World = Awaited<ReturnType<typeof world>>

const switchOn = (w: World, on = true) => saveSysParams(t.ctx, { pluginsEnabled: on }, w.root.id)

/** A connected daemon with the given version and features. */
async function daemon(token: string, o: { version?: string; features?: string[] } = {}) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: o.version ?? '0.9.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
      features: o.features ?? ['plugins'],
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { ws, next: <T>() => box.next<T>() }
}

/** A bot of eve's in the group on its own machine. */
async function groupBot(w: World, o: { name: string; agentKind?: 'claude' | 'codex' }) {
  const { machine, token } = await t.seed.machine(w.eve.id)
  const bot = await t.seed.bot({
    ownerId: w.eve.id,
    machineId: machine.id,
    name: o.name,
    agentKind: o.agentKind ?? 'claude',
  })
  await t.db.insert(groupBots).values({ groupId: w.group.id, botId: bot.id })
  return { bot, machine, token }
}

async function upload(w: World, files = pkg(), base = '/api/admin/plugins') {
  const res = await (await w.as(w.root)).post<PluginDto>(base, { files })
  expect(res.status).toBeLessThan(300)
  return res.body
}

const userMessage = async (w: World, botId: string, body = '@bot 做一版') =>
  (
    await t.db
      .insert(messages)
      .values({
        groupId: w.group.id,
        kind: 'user',
        authorUserId: w.eve.id,
        body,
        meta: { mentions: [botId] },
      })
      .returning()
  )[0]!

describe('plugin upload', () => {
  it('validates the folder: manifest, entry skill, design systems, previews, paths and size', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const bad = async (files: unknown) => (await root.post('/api/admin/plugins', { files })).body
    const m = manifest()
    const ok = pkg(m)
    const without = (path: string) => ok.filter((f) => f.path !== path)

    expect(await bad(without('gonggong-plugin.json'))).toMatchObject({ error: 'invalid' })
    expect(
      await bad([{ path: 'gonggong-plugin.json', content: '{not json' }, ...without('gonggong-plugin.json')]),
    ).toMatchObject({ error: 'invalid' })
    expect(await bad(pkg({ ...m, version: 'v1' } as never))).toMatchObject({ error: 'invalid' })
    expect(await bad(without('skills/web-prototype/SKILL.md'))).toMatchObject({ error: 'invalid' })
    expect(
      await bad([
        ...without('skills/web-prototype/SKILL.md'),
        { path: 'skills/web-prototype/SKILL.md', content: 'no frontmatter' },
      ]),
    ).toMatchObject({ error: 'invalid' })
    expect(
      await bad([
        ...without('skills/web-prototype/SKILL.md'),
        { path: 'skills/web-prototype/SKILL.md', content: skillMd('other-name') },
      ]),
    ).toMatchObject({ error: 'invalid' })
    expect(await bad(without('skills/web-prototype/systems/neutral-modern/DESIGN.md'))).toMatchObject({
      error: 'invalid',
    })
    expect(await bad(without('skills/web-prototype/systems/neutral-modern/tokens.css'))).toMatchObject({
      error: 'invalid',
    })
    expect(await bad(without('previews/saas.png'))).toMatchObject({ error: 'invalid' })
    for (const path of ['../x', '/etc/x', 'a\\b', 'a//b'])
      expect(await bad([...ok, { path, content: '' }])).toMatchObject({ error: 'invalid' })
    expect(await bad([...ok, { path: 'big.txt', content: 'a'.repeat(PLUGIN_MAX_BYTES) }])).toMatchObject({
      error: 'invalid',
    })
    expect(await t.db.select().from(plugins)).toEqual([])
  })

  it('takes a large catalogue: 80 grouped templates and 80 categorised design systems', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const n = Array.from({ length: 80 }, (_, i) => i)
    const m = manifest({
      templates: n.map((i) => ({ id: `t${i}`, title: `模板 ${i}`, group: i % 2 ? '营销网页' : '产品界面' })),
      designSystems: n.map((i) => ({
        id: `d${i}`,
        title: `设计 ${i}`,
        category: '现代极简',
        swatches: ['#111111', '#ffffff'],
        dir: `design-systems/d${i}`,
      })),
    })
    const made = await root.post<PluginDto>('/api/admin/plugins', { files: pkg(m) })
    expect(made.status).toBe(201)
    expect(made.body.manifest.templates[1]).toMatchObject({ group: '营销网页', preview: null })
    expect(made.body.manifest.designSystems).toHaveLength(80)
    expect(made.body.manifest.designSystems[0]?.category).toBe('现代极简')
  })

  it('lets the sysadmin upload platform plugins as versions, skipping identical content, and delete them', async () => {
    const w = await world()
    const root = await w.as(w.root)
    const eve = await w.as(w.eve)
    expect((await eve.get('/api/admin/plugins')).status).toBe(403)
    expect((await eve.post('/api/admin/plugins', { files: pkg() })).status).toBe(403)

    const made = await root.post<PluginDto>('/api/admin/plugins', { files: pkg() })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({
      layer: 'platform',
      revision: 1,
      updatedBy: '根',
      manifest: { name: 'web-prototype', version: '1.0.0', agents: ['claude', 'codex'] },
    })
    const same = await root.post<PluginDto>('/api/admin/plugins', { files: pkg() })
    expect(same.status).toBe(200)
    expect(same.body).toMatchObject({ id: made.body.id, revision: 1, versionId: made.body.versionId })
    const next = await root.post<PluginDto>('/api/admin/plugins', {
      files: pkg(manifest({ version: '1.1.0' })),
    })
    expect(next.body).toMatchObject({ id: made.body.id, revision: 2, manifest: { version: '1.1.0' } })
    expect(await t.db.select().from(pluginVersions)).toHaveLength(2)

    const list = await root.get<PluginDto[]>('/api/admin/plugins')
    expect(list.body.map((p) => [p.manifest.name, p.revision])).toEqual([['web-prototype', 2]])
    expect((await root.del(`/api/admin/plugins/${made.body.id}`)).status).toBe(204)
    expect((await root.get<PluginDto[]>('/api/admin/plugins')).body).toEqual([])
    expect(await t.db.select().from(pluginVersions)).toEqual([])
  })

  it('keeps team layers to team admins and group layers to group admins while plugins are on', async () => {
    const w = await world()
    const [bob, eve, mia] = [await w.as(w.bob), await w.as(w.eve), await w.as(w.mia)]
    expect((await mia.post(`/api/teams/${w.team}/plugins`, { files: pkg() })).status).toBe(403)
    expect((await bob.post<PluginDto>(`/api/teams/${w.team}/plugins`, { files: pkg() })).body).toMatchObject({
      layer: 'team',
    })
    expect((await bob.get<PluginDto[]>(`/api/teams/${w.team}/plugins`)).body).toHaveLength(1)

    const base = `/api/groups/${w.group.id}/plugins`
    expect((await eve.post(base, { files: pkg() })).status).toBe(403)
    await switchOn(w)
    expect((await mia.post(base, { files: pkg() })).status).toBe(403)
    const own = await eve.post<PluginDto>(base, { files: pkg(manifest({ name: 'poster' })) })
    expect(own.body).toMatchObject({ layer: 'group', manifest: { name: 'poster' } })
    expect((await mia.del(`${base}/${own.body.id}`)).status).toBe(403)
    expect((await eve.del(`${base}/${own.body.id}`)).status).toBe(204)
  })

  it('serves a plugin file to readers of its layer, sandboxed', async () => {
    const w = await world()
    const outsider = await t.seed.user({ name: '外人', teamId: null })
    const team = await (await w.as(w.bob)).post<PluginDto>(`/api/teams/${w.team}/plugins`, { files: pkg() })
    const url = `/api/plugins/${team.body.id}/files/previews/saas.png`
    const res = await t.app.inject({ url, headers: { cookie: await t.seed.cookie(w.mia.id) } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toBe('sandbox')
    expect(res.rawPayload.toString()).toBe('fake-png-bytes')
    const css = await t.app.inject({
      url: `/api/plugins/${team.body.id}/files/skills/web-prototype/systems/neutral-modern/tokens.css`,
      headers: { cookie: await t.seed.cookie(w.mia.id) },
    })
    expect(css.body).toContain('--fg')
    const other = { cookie: await t.seed.cookie(outsider.id) }
    expect((await t.app.inject({ url, headers: other })).statusCode).toBe(404)
    expect((await t.app.inject({ url })).statusCode).toBe(401)
    const missing = `/api/plugins/${team.body.id}/files/previews/none.png`
    expect(
      (await t.app.inject({ url: missing, headers: { cookie: await t.seed.cookie(w.mia.id) } })).statusCode,
    ).toBe(404)
  })
})

describe('built-in plugins', () => {
  /** A built-in folder holding pkg() as `web-prototype`. */
  function builtinDir(files = pkg()) {
    const root = mkdtempSync(join(tmpdir(), 'gg-builtin-'))
    for (const f of files) {
      const full = join(root, 'web-prototype', f.path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, 'encoding' in f ? Buffer.from(f.content, 'base64') : f.content)
    }
    return root
  }

  it('installs the repo built-ins on the platform layer, each a valid plugin', async () => {
    await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
    const rows = await t.db.select().from(plugins)
    expect(rows.map((r) => [r.scope, r.name, r.updatedBy]).sort()).toEqual([
      ['platform', 'slides', null],
      ['platform', 'web-prototype', null],
    ])
  })

  it('syncs at startup: new version only when the folder changed; no upload or delete over it', async () => {
    const w = await world()
    const root = await w.as(w.root)
    await syncBuiltinPlugins(t.ctx, builtinDir())
    await syncBuiltinPlugins(t.ctx, builtinDir())
    let [p] = (await root.get<PluginDto[]>('/api/admin/plugins')).body
    expect(p).toMatchObject({ builtin: true, revision: 1, updatedBy: null })
    await syncBuiltinPlugins(t.ctx, builtinDir(pkg(manifest({ version: '1.1.0' }))))
    ;[p] = (await root.get<PluginDto[]>('/api/admin/plugins')).body
    expect(p).toMatchObject({ builtin: true, revision: 2, manifest: { version: '1.1.0' } })

    expect((await root.del(`/api/admin/plugins/${p!.id}`)).status).toBe(403)
    expect((await root.post('/api/admin/plugins', { files: pkg() })).status).toBe(403)
    // A team or group may still override it by name.
    await switchOn(w)
    expect((await (await w.as(w.bob)).post(`/api/teams/${w.team}/plugins`, { files: pkg() })).status).toBe(
      201,
    )
  })
})

describe('group plugins', () => {
  it('lists nothing and refuses switches while the master switch is off', async () => {
    const w = await world()
    const p = await upload(w)
    const eve = await w.as(w.eve)
    expect((await eve.get(`/api/groups/${w.group.id}/plugins`)).body).toEqual([])
    expect((await eve.put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })).status).toBe(403)
  })

  it('reports the master switch to every account so group settings can offer the 插件 tab', async () => {
    const w = await world()
    const mia = await w.as(w.mia)
    expect((await mia.get<MeDto>('/api/me')).body.pluginsEnabled).toBe(false)
    await switchOn(w)
    expect((await mia.get<MeDto>('/api/me')).body.pluginsEnabled).toBe(true)
  })

  it('merges platform, team and group plugins by name, off until a group admin turns one on', async () => {
    const w = await world()
    await switchOn(w)
    const platform = await upload(w)
    await upload(w, pkg(manifest({ name: 'deck', category: 'deck' })))
    const team = (
      await (
        await w.as(w.bob)
      ).post<PluginDto>(`/api/teams/${w.team}/plugins`, {
        files: pkg(manifest({ version: '2.0.0' })),
      })
    ).body
    const [eve, mia] = [await w.as(w.eve), await w.as(w.mia)]
    const base = `/api/groups/${w.group.id}/plugins`
    await eve.post(base, { files: pkg(manifest({ name: 'poster', category: 'poster' })) })

    const list = async () => (await mia.get<GroupPluginDto[]>(base)).body
    expect(
      (await list()).map((p) => [p.manifest.name, p.layer, p.manifest.version, p.enabledInGroup]),
    ).toEqual([
      ['deck', 'platform', '1.0.0', false],
      ['poster', 'group', '1.0.0', false],
      ['web-prototype', 'team', '2.0.0', false],
    ])
    expect((await mia.put(`${base}/${team.id}`, { enabled: true })).status).toBe(403)
    expect((await eve.put(`${base}/${platform.id}`, { enabled: true })).status).toBe(404)
    const on = await eve.put<GroupPluginDto>(`${base}/${team.id}`, { enabled: true })
    expect(on.body).toMatchObject({ id: team.id, enabledInGroup: true })
    expect((await list()).filter((p) => p.enabledInGroup).map((p) => p.id)).toEqual([team.id])
    await eve.put(`${base}/${team.id}`, { enabled: false })
    expect((await list()).some((p) => p.enabledInGroup)).toBe(false)
    expect(await t.db.select().from(groupPlugins)).toHaveLength(1)
  })

  it('tells per bot why it cannot use a plugin: agent, offline, daemon, secret', async () => {
    const w = await world()
    await switchOn(w)
    const p = await upload(
      w,
      pkg(manifest({ agents: ['claude'], minDaemon: '0.8.0', secrets: ['FIGMA_TOKEN'] })),
    )
    const ready = await groupBot(w, { name: 'ready' })
    const codex = await groupBot(w, { name: 'codex', agentKind: 'codex' })
    await groupBot(w, { name: 'offline' })
    const old = await groupBot(w, { name: 'old' })
    const bare = await groupBot(w, { name: 'bare' })
    const sockets = [
      await daemon(ready.token),
      await daemon(codex.token),
      await daemon(old.token, { version: '0.7.9' }),
      await daemon(bare.token, { features: [] }),
    ]
    const blockers = async () =>
      Object.fromEntries(
        (await (await w.as(w.mia)).get<GroupPluginDto[]>(`/api/groups/${w.group.id}/plugins`)).body
          .find((x) => x.id === p.id)!
          .bots.map((b) => [b.botId, b.blocker]),
      )
    const named = async () => {
      const got = await blockers()
      const ids = { ready, codex, old, bare }
      return {
        ...Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, got[v.bot.id]])),
        offline: Object.values(got).filter((b) => b === 'offline').length,
      }
    }
    expect(await named()).toEqual({
      ready: 'secret',
      codex: 'agent',
      old: 'daemon',
      bare: 'daemon',
      offline: 1,
    })
    await (await w.as(w.root)).post('/api/admin/secrets', { name: 'FIGMA_TOKEN', value: 'figma-secret-1' })
    expect(await named()).toEqual({ ready: null, codex: 'agent', old: 'daemon', bare: 'daemon', offline: 1 })
    for (const s of sockets) s.ws.close()
  })

  it('checks blockers in a fixed order (unit)', () => {
    const m = PluginManifestOf({ agents: ['claude'], minDaemon: '0.8.0', secrets: ['A_KEY'] })
    const ok = {
      agentKind: 'claude',
      online: true,
      features: ['plugins'],
      daemonVersion: '0.8.0',
      env: { A_KEY: 'x' },
    }
    expect(pluginBlocker(m, ok)).toBeNull()
    expect(pluginBlocker(m, { ...ok, agentKind: 'codex', online: false })).toBe('agent')
    expect(pluginBlocker(m, { ...ok, online: false, features: [] })).toBe('offline')
    expect(pluginBlocker(m, { ...ok, features: [] })).toBe('daemon')
    expect(pluginBlocker(m, { ...ok, daemonVersion: '0.7.12' })).toBe('daemon')
    expect(pluginBlocker(m, { ...ok, daemonVersion: null })).toBe('daemon')
    expect(pluginBlocker(m, { ...ok, env: {} })).toBe('secret')
  })
})

const PluginManifestOf = (o: ManifestIn) => manifest(o) as unknown as PluginManifest

describe('plugins in run.start', () => {
  it('sends enabled plugins only to bots that can use them, and serves their files to those machines', async () => {
    const w = await world()
    await switchOn(w)
    await (await w.as(w.root)).post('/api/admin/secrets', { name: 'FIGMA_TOKEN', value: 'figma-secret-1' })
    const web = await upload(w, pkg(manifest({ agents: ['claude'], minDaemon: '0.8.0' })))
    const keyed = await upload(w, pkg(manifest({ name: 'keyed', secrets: ['FIGMA_TOKEN'] })))
    const missing = await upload(w, pkg(manifest({ name: 'missing', secrets: ['NO_SUCH_KEY'] })))
    const idle = await upload(w, pkg(manifest({ name: 'idle' })))
    const eve = await w.as(w.eve)
    for (const p of [web, keyed, missing])
      await eve.put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })

    const startOf = async (o: Parameters<typeof groupBot>[1], d: Parameters<typeof daemon>[1] = {}) => {
      const b = await groupBot(w, o)
      const conn = await daemon(b.token, d)
      await triggerRuns(t.ctx, await userMessage(w, b.bot.id))
      const start = await conn.next<RunStart>()
      return { ...b, conn, start }
    }
    const ready = await startOf({ name: 'ready' })
    expect(ready.start.plugins).toEqual([
      { name: 'keyed', versionId: keyed.versionId, digest: expect.any(String) },
      { name: 'web-prototype', versionId: web.versionId, digest: expect.any(String) },
    ])
    const [row] = await t.db.select().from(runs).where(eq(runs.id, ready.start.runId))
    expect(row!.plugins).toEqual(ready.start.plugins)
    expect((await startOf({ name: 'codex', agentKind: 'codex' })).start.plugins.map((p) => p.name)).toEqual([
      'keyed',
    ])
    expect((await startOf({ name: 'old' }, { version: '0.7.0' })).start.plugins.map((p) => p.name)).toEqual([
      'keyed',
    ])
    const bare = await startOf({ name: 'bare' }, { features: [] })
    expect(bare.start.plugins).toEqual([])

    const get = (versionId: string, token: string) =>
      t.app.inject({ url: `/api/daemon/plugins/${versionId}`, headers: { authorization: `Bearer ${token}` } })
    const served = await get(web.versionId, ready.token)
    expect(served.statusCode).toBe(200)
    expect(served.json().files.map((f: { path: string }) => f.path)).toContain('gonggong-plugin.json')
    expect((await get(web.versionId, bare.token)).statusCode).toBe(403)
    expect((await get(idle.versionId, ready.token)).statusCode).toBe(403)
    expect((await get(missing.versionId, ready.token)).statusCode).toBe(403)
    expect((await get('00000000-0000-0000-0000-000000000000', ready.token)).statusCode).toBe(404)
    expect((await get(web.versionId, 'nope')).statusCode).toBe(401)
    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, ready.start.runId))
    expect((await get(web.versionId, ready.token)).statusCode).toBe(403)
  })

  it('sends no plugins while the master switch is off; run.start is otherwise unchanged', async () => {
    const w = await world()
    await switchOn(w)
    const p = await upload(w)
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const { bot } = await groupBot(w, { name: 'ready' })
    await t.db.update(machines).set({ daemonVersion: '0.9.0' })
    await triggerRuns(t.ctx, await userMessage(w, bot.id))
    const [run] = await t.db.select().from(runs).where(eq(runs.botId, bot.id))
    const build = () =>
      t.db.transaction(
        async (tx) => (await buildRunStart(tx, bot, run!, false, new Date(0), ['plugins'])).msg,
      )

    const on = await build()
    expect(on.plugins.map((x) => x.name)).toEqual(['web-prototype'])
    expect(on.bot.systemPrompt).toContain('本群启用了创作插件：web-prototype')
    expect(on.bot.systemPrompt).toContain('creation_propose')
    expect(on.hiddenTools).not.toContain('plugin_catalog')
    await switchOn(w, false)
    const off = await build()
    expect(off.plugins).toEqual([])
    expect(off.bot.systemPrompt).not.toContain('创作插件')
    expect(off.hiddenTools).toEqual(expect.arrayContaining(['plugin_catalog', 'creation_propose']))
    expect({
      ...on,
      plugins: [],
      hiddenTools: off.hiddenTools,
      bot: { ...on.bot, systemPrompt: off.bot.systemPrompt },
    }).toEqual(off)
    await t.db.delete(plugins)
    expect(await build()).toEqual(off)
  })
})

describe('creations', () => {
  async function creationWorld() {
    const w = await world()
    await switchOn(w)
    const p = await upload(w)
    const eve = await w.as(w.eve)
    await eve.put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const ready = await groupBot(w, { name: '小原' })
    const conn = await daemon(ready.token)
    const req = {
      pluginId: p.id,
      templateId: 'saas',
      designSystemId: 'neutral-modern',
      inputs: { title: '共工 · AI 团队工作区', audience: '研发团队' },
      directions: true,
      botId: ready.bot.id,
    }
    return { ...w, p, ready, conn, req, url: `/api/groups/${w.group.id}/creations` }
  }

  it('posts a creation card @-ing the bot as the requester, with the agent instructions as body', async () => {
    const w = await creationWorld()
    const mia = await w.as(w.mia)
    const seen: WebEvent[] = []
    t.ctx.bus.attach(w.eve.id, (e) => seen.push(e))
    const form = new FormData()
    form.set('groupId', w.group.id)
    form.set('file', new Blob(['brief'], { type: 'text/plain' }), 'brief.txt')
    const up = await fetch(t.url('/api/uploads'), {
      method: 'POST',
      headers: { cookie: await t.seed.cookie(w.mia.id) },
      body: form,
    })
    expect(up.status).toBeLessThan(300)
    const fileId = ((await up.json()) as { id: string }).id

    const res = await mia.post<MessageDto>(w.url, { ...w.req, attachmentIds: [fileId] })
    expect(res.status).toBe(200)
    const m = res.body
    expect(m).toMatchObject({ kind: 'user', authorId: w.mia.id, mentions: [w.ready.bot.id] })
    expect(m.attachments.map((a) => a.id)).toEqual([fileId])
    expect(m.card).toEqual({
      type: 'creation',
      pluginId: w.p.id,
      pluginTitle: '网页原型',
      category: 'web',
      pluginVersion: '1.0.0',
      template: { id: 'saas', title: 'SaaS 落地页' },
      designSystem: { id: 'neutral-modern', title: '中性现代', swatches: ['#111111', '#ffffff'] },
      inputs: [
        { label: '主标题', value: '共工 · AI 团队工作区' },
        { label: '语气', value: '专业' },
        { label: '目标受众', value: '研发团队' },
      ],
      directions: true,
      botId: w.ready.bot.id,
      botName: '小原',
    })
    for (const s of [
      '@小原',
      'web-prototype:web-prototype',
      'web-prototype-web-prototype',
      'saas',
      'systems/neutral-modern/DESIGN.md',
      'tokens.css',
      '主标题：共工 · AI 团队工作区',
      '语气：专业',
      'design/<slug>/index.html',
      'preview_static',
    ])
      expect(m.body).toContain(s)
    expect(m.body).toMatch(/先出 2–3 个视觉方向：是/)

    const start = await w.conn.next<RunStart>()
    expect(start.prompt.text).toBe(m.body)
    expect(start.prompt.attachments.map((a) => a.id)).toEqual([fileId])
    expect(start.plugins.map((p) => p.name)).toEqual(['web-prototype'])
    const [row] = await t.db.select().from(attachments).where(eq(attachments.id, fileId))
    expect(row!.messageId).toBe(m.id)
    expect(seen.some((e) => e.t === 'message.new' && e.message.card?.type === 'creation')).toBe(true)
    const timeline = await mia.get<{ messages: MessageDto[] }>(`/api/groups/${w.group.id}/timeline`)
    expect(timeline.body.messages.find((x) => x.id === m.id)?.card).toEqual(m.card)
    w.conn.ws.close()
  })

  it('checks the switch, the plugin, the template, the design system, the inputs and the bot', async () => {
    const w = await creationWorld()
    const mia = await w.as(w.mia)
    const outsider = await t.seed.user({ name: '路人' })
    const status = async (patch: Record<string, unknown>, as = mia) =>
      (await as.post(w.url, { ...w.req, ...patch })).status

    expect(await status({}, await w.as(outsider))).toBe(404)
    expect(await status({ templateId: 'nope' })).toBe(400)
    expect(await status({ templateId: null })).toBe(400)
    expect(await status({ designSystemId: 'nope' })).toBe(400)
    expect(await status({ inputs: { audience: 'x' } })).toBe(400)
    expect(await status({ inputs: { title: '  ' } })).toBe(400)
    expect(await status({ inputs: { title: 'x', tone: '冷淡' } })).toBe(400)
    expect(await status({ inputs: { title: true } })).toBe(400)
    const stranger = await t.seed.bot({ ownerId: w.eve.id, name: 'stranger' })
    expect(await status({ botId: stranger.id })).toBe(404)
    const codex = await groupBot(w, { name: 'codex', agentKind: 'codex' })
    await t.db.update(pluginVersions).set({ manifest: PluginManifestOf({ agents: ['claude'] }) })
    expect(await status({ botId: codex.bot.id })).toBe(409)
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${w.p.id}`, { enabled: false })
    expect(await status({})).toBe(409)
    await switchOn(w, false)
    expect(await status({})).toBe(403)
    expect(await t.db.select().from(messages).where(eq(messages.groupId, w.group.id))).toEqual([])
    w.conn.ws.close()
  })
})

describe('per-template steps', () => {
  /** A wireframe template asking only for the title and bringing its own look. */
  const wire = manifest({
    templates: [
      { id: 'saas', title: 'SaaS 落地页', preview: 'previews/saas.png' },
      { id: 'wire', title: '线框图', inputs: ['title'], designSystem: false },
    ],
  })

  it('checks template input ids on upload', async () => {
    const w = await world()
    const bad = manifest({ templates: [{ id: 'wire', title: '线框图', inputs: ['nope'] }] })
    const res = await (await w.as(w.root)).post('/api/admin/plugins', { files: pkg(bad) })
    expect(res.status).toBe(400)
  })

  it("asks only the template's inputs and no design system when it brings its own look", async () => {
    const w = await world()
    await switchOn(w)
    const p = await upload(w, pkg(wire))
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const { bot, token } = await groupBot(w, { name: '小原' })
    const conn = await daemon(token)
    const mia = await w.as(w.mia)
    const url = `/api/groups/${w.group.id}/creations`
    const req = {
      pluginId: p.id,
      templateId: 'wire',
      designSystemId: null,
      inputs: { title: '后台', audience: '运营' },
      botId: bot.id,
    }
    expect((await mia.post(url, { ...req, designSystemId: 'neutral-modern' })).status).toBe(400)
    const res = await mia.post<MessageDto>(url, req)
    expect(res.status).toBe(200)
    const card = res.body.card as CreationCard
    expect(card.designSystem).toBeNull()
    expect(card.inputs).toEqual([{ label: '主标题', value: '后台' }])
    expect(res.body.body).not.toContain('DESIGN.md')
    conn.ws.close()
  })
})

describe('group design systems and 自动', () => {
  const MD =
    '---\nname: 麓湖夜航\ncolors:\n  primary: "#155332"\n  surface: "#FFFFFF"\n---\n\n# 夜航\n按钮用湖绿。\n'
  const composer = manifest({
    composer: { prompt: 'prompt' },
    inputs: [
      { id: 'prompt', label: '需求', type: 'text', required: true },
      { id: 'device', label: '设备', type: 'select', options: ['小程序', '手机 App'], default: '小程序' },
    ],
    designSystems: [
      {
        id: 'neutral-modern',
        title: '中性现代',
        description: '黑白灰',
        swatches: ['#111111', '#ffffff'],
        dir: 'systems/neutral-modern',
      },
      {
        id: 'warm',
        title: '暖纸',
        description: '米色纸感',
        swatches: ['#8A4B2A', '#F7F1E6'],
        dir: 'systems/warm',
      },
    ],
  })

  async function dsWorld() {
    const w = await world()
    await switchOn(w)
    const p = await upload(w, pkg(composer))
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const ready = await groupBot(w, { name: '小原' })
    const conn = await daemon(ready.token)
    const base = `/api/groups/${w.group.id}/design-systems`
    const req = {
      pluginId: p.id,
      templateId: 'saas',
      designSystemId: 'auto',
      inputs: { prompt: '滴滴打船：乘客叫船、船长接单' },
      botId: ready.bot.id,
    }
    return { ...w, p, ready, conn, base, req, url: `/api/groups/${w.group.id}/creations` }
  }

  it('lets members import, list and delete them; only the importer or an admin deletes', async () => {
    const w = await dsWorld()
    const mia = await w.as(w.mia)
    const res = await mia.post<GroupDesignSystemDto>(w.base, { designMd: MD })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      groupId: w.group.id,
      title: '麓湖夜航',
      swatches: ['#155332', '#FFFFFF'],
      designMd: MD.trim(),
      url: null,
      repo: null,
      createdBy: w.mia.id,
    })
    const site = await mia.post<GroupDesignSystemDto>(w.base, { url: 'https://www.example.com/shop' })
    expect(site.body).toMatchObject({ title: 'www.example.com', swatches: [], designMd: null })
    const repo = await mia.post<GroupDesignSystemDto>(w.base, { repo: 'https://github.com/acme/ui-kit.git' })
    expect(repo.body.title).toBe('ui-kit')
    expect((await mia.post(w.base, {})).status).toBe(400)

    const list = await (await w.as(w.eve)).get<GroupDesignSystemDto[]>(w.base)
    expect(list.body.map((d) => d.title)).toEqual(['ui-kit', 'www.example.com', '麓湖夜航'])
    const outsider = await w.as(await t.seed.user({ name: '路人' }))
    expect((await outsider.get(w.base)).status).toBe(404)
    expect((await outsider.post(w.base, { designMd: MD })).status).toBe(404)

    expect((await outsider.del(`${w.base}/${res.body.id}`)).status).toBe(404)
    const mine = (
      await (await w.as(w.eve)).post<GroupDesignSystemDto>(w.base, { url: 'https://eve.example' })
    ).body
    expect((await mia.del(`${w.base}/${mine.id}`)).status).toBe(403)
    const eve = await w.as(w.eve)
    expect((await eve.del(`${w.base}/${site.body.id}`)).status).toBe(204)
    expect((await mia.del(`${w.base}/${res.body.id}`)).status).toBe(204)
    expect((await mia.del(`${w.base}/nope`)).status).toBe(404)
    expect((await eve.get<GroupDesignSystemDto[]>(w.base)).body.map((d) => d.title)).toEqual([
      'eve.example',
      'ui-kit',
    ])
    await switchOn(w, false)
    expect((await mia.get(w.base)).status).toBe(403)
    w.conn.ws.close()
  })

  it('hands an imported DESIGN.md, site or repository to the agent as the design source', async () => {
    const w = await dsWorld()
    const mia = await w.as(w.mia)
    const ds = (await mia.post<GroupDesignSystemDto>(w.base, { designMd: MD })).body
    const res = await mia.post<MessageDto>(w.url, { ...w.req, designSystemId: groupDesignSystemKey(ds.id) })
    expect(res.status).toBe(200)
    expect((res.body.card as CreationCard).designSystem).toEqual({
      id: `group:${ds.id}`,
      title: '麓湖夜航',
      swatches: ['#155332', '#FFFFFF'],
    })
    expect(res.body.body).toContain('本群导入的设计系统「麓湖夜航」')
    expect(res.body.body).toContain('按钮用湖绿。')
    expect(res.body.body).not.toContain('systems/neutral-modern')
    expect(res.body.body).toContain('需求：滴滴打船')

    const site = (
      await mia.post<GroupDesignSystemDto>(w.base, { url: 'https://example.com', repo: 'acme/ui' })
    ).body
    const res2 = await mia.post<MessageDto>(w.url, {
      ...w.req,
      designSystemId: groupDesignSystemKey(site.id),
    })
    expect(res2.body.body).toContain('参考网站：https://example.com')
    expect(res2.body.body).toContain('参考仓库：acme/ui')

    const elsewhere = await t.seed.group({ createdBy: w.eve.id, name: '别的群' })
    const foreign = (
      await (
        await w.as(w.eve)
      ).post<GroupDesignSystemDto>(`/api/groups/${elsewhere.id}/design-systems`, { designMd: MD })
    ).body
    expect(
      (await mia.post(w.url, { ...w.req, designSystemId: groupDesignSystemKey(foreign.id) })).status,
    ).toBe(400)
    expect((await mia.post(w.url, { ...w.req, designSystemId: 'group:nope' })).status).toBe(400)
    w.conn.ws.close()
  })

  it('lets the agent pick a preset for 自动', async () => {
    const w = await dsWorld()
    const res = await (await w.as(w.mia)).post<MessageDto>(w.url, w.req)
    expect(res.status).toBe(200)
    expect((res.body.card as CreationCard).designSystem).toEqual({
      id: 'auto',
      title: '自动选择',
      swatches: [],
    })
    for (const s of [
      '按需求从 skill 目录下的预设里挑',
      'systems/neutral-modern',
      '中性现代：黑白灰',
      'systems/warm',
      '暖纸：米色纸感',
    ])
      expect(res.body.body).toContain(s)
    w.conn.ws.close()
  })
})

describe('creation from the chat', () => {
  async function chatWorld(m = manifest()) {
    const w = await world()
    await switchOn(w)
    const p = await upload(w, pkg(m))
    await (await w.as(w.eve)).put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    const { bot, token } = await groupBot(w, { name: '小原' })
    const conn = await daemon(token)
    const trigger = await userMessage(w, bot.id, '@小原 做个落地页')
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.group.id,
        botId: bot.id,
        triggerMessageId: trigger.id,
        originUserId: w.eve.id,
        status: 'running',
      })
      .returning()
    const call = async (name: string, args: unknown) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${run!.id}/tools/${name}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { arguments: args },
      })
      expect(res.statusCode).toBe(200)
      return res.json<ToolCallRes>()
    }
    const draftOf = async (res: ToolCallRes) => {
      const id = /id：([0-9a-f-]{36})/.exec(res.text)?.[1] as string
      const [m] = await t.db.select().from(messages).where(eq(messages.id, id))
      return { id, m: m!, card: (m!.meta as { card: CreationDraftCard }).card }
    }
    return { ...w, p, bot, conn, call, draftOf }
  }

  it('plugin_catalog lists the enabled plugins and one plugin in detail', async () => {
    const w = await chatWorld()
    const list = await w.call('plugin_catalog', {})
    expect(list.isError).toBe(false)
    expect(list.text).toContain('web-prototype（网页原型）')
    expect(list.text).toContain('模板 1 个，设计系统 1 套；可用')
    const one = await w.call('plugin_catalog', { plugin: 'web-prototype' })
    for (const s of [
      'saas｜SaaS 落地页',
      'neutral-modern｜中性现代',
      'title｜主标题｜string｜必填',
      'tone｜语气',
    ])
      expect(one.text).toContain(s)
    expect((await w.call('plugin_catalog', { plugin: 'nope' })).isError).toBe(true)
    await switchOn(w, false)
    expect((await w.call('plugin_catalog', {})).text).toContain('插件功能未开启')
    w.conn.ws.close()
  })

  it("offers 自动 and the group's imported design systems for a prompt-first plugin", async () => {
    const w = await chatWorld(
      manifest({
        composer: { prompt: 'prompt' },
        inputs: [{ id: 'prompt', label: '需求', type: 'text', required: true }],
      }),
    )
    const ds = (
      await (
        await w.as(w.mia)
      ).post<GroupDesignSystemDto>(`/api/groups/${w.group.id}/design-systems`, {
        url: 'https://example.com',
      })
    ).body
    const one = await w.call('plugin_catalog', { plugin: 'web-prototype' })
    for (const s of ['也可以用 auto', `group:${ds.id}｜example.com｜https://example.com`])
      expect(one.text).toContain(s)
    const res = await w.call('creation_propose', {
      plugin: 'web-prototype',
      template: 'saas',
      inputs: { prompt: '打船' },
    })
    expect(res.isError).toBe(false)
    expect((await w.draftOf(res)).card.designSystem).toMatchObject({ id: 'auto' })
    w.conn.ws.close()
  })

  it('creation_propose posts a pending card a member starts, edits or drops', async () => {
    const w = await chatWorld()
    const seen: WebEvent[] = []
    t.ctx.bus.attach(w.mia.id, (e) => seen.push(e))
    const res = await w.call('creation_propose', {
      plugin: 'web-prototype',
      template: 'saas',
      inputs: { audience: '研发团队' },
      note: '落地页用 SaaS 模板最合适',
    })
    expect(res.isError).toBe(false)
    expect(res.text).toContain('在那之前不要出稿')
    expect(res.text).toContain('主标题')
    const d = await w.draftOf(res)
    expect(d.m.kind).toBe('event')
    expect(d.card).toMatchObject({
      type: 'creation-draft',
      status: 'pending',
      template: { id: 'saas' },
      designSystem: { id: 'neutral-modern' },
      inputs: [
        { label: '语气', value: '专业' },
        { label: '目标受众', value: '研发团队' },
      ],
      missing: ['主标题'],
      note: '落地页用 SaaS 模板最合适',
      botId: w.bot.id,
      by: null,
    })

    // 开始 (after filling 主标题 in the panel) starts it as the member and marks the card.
    const mia = await w.as(w.mia)
    const url = `/api/groups/${w.group.id}/creations`
    const req = {
      pluginId: w.p.id,
      templateId: 'saas',
      designSystemId: 'neutral-modern',
      inputs: { title: '共工', audience: '研发团队' },
      botId: w.bot.id,
      fromDraft: d.id,
    }
    const started = await mia.post<MessageDto>(url, req)
    expect(started.status).toBe(200)
    expect(started.body.authorId).toBe(w.mia.id)
    const after = await w.draftOf(res)
    expect(after.card).toMatchObject({ status: 'started', by: '米娅', creationId: started.body.id })
    expect(
      seen.some(
        (e) => e.t === 'message.edited' && e.message.id === d.id && e.message.card?.type === 'creation-draft',
      ),
    ).toBe(true)
    expect((await mia.post(url, req)).status).toBe(409)

    // 不用了
    const other = await w.call('creation_propose', { plugin: 'web-prototype', template: 'saas' })
    const o = await w.draftOf(other)
    const dismiss = `/api/groups/${w.group.id}/creation-drafts/${o.id}/dismiss`
    const outsider = await t.seed.user({ name: '路人' })
    expect((await (await w.as(outsider)).post(dismiss, {})).status).toBe(404)
    expect((await mia.post(dismiss, {})).status).toBe(204)
    expect((await w.draftOf(other)).card).toMatchObject({ status: 'dismissed', by: '米娅' })
    expect((await mia.post(dismiss, {})).status).toBe(409)
    expect(
      (await mia.post(`/api/groups/${w.group.id}/creation-drafts/${started.body.id}/dismiss`, {})).status,
    ).toBe(404)
    w.conn.ws.close()
  })

  it('creation_propose refuses what a creation would: unknown template, bad values, a bot that cannot use it', async () => {
    const w = await chatWorld()
    const refused = async (args: Record<string, unknown>) =>
      (await w.call('creation_propose', { plugin: 'web-prototype', template: 'saas', ...args })).isError
    expect(await refused({ template: 'nope' })).toBe(true)
    expect(await refused({ template: undefined })).toBe(true)
    expect(await refused({ inputs: { tone: '冷淡' } })).toBe(true)
    expect(await refused({ plugin: 'nope' })).toBe(true)
    await t.db.update(pluginVersions).set({ manifest: PluginManifestOf({ agents: ['codex'] }) })
    expect(await refused({})).toBe(true)
    expect(
      (await t.db.select().from(messages).where(eq(messages.groupId, w.group.id))).filter(
        (m) => m.kind === 'event',
      ),
    ).toEqual([])
    w.conn.ws.close()
  })
})

describe('leanings', () => {
  async function pending(w: World) {
    const { bot } = await groupBot(w, { name: 'asker' })
    const m = await userMessage(w, bot.id)
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.group.id,
        botId: bot.id,
        triggerMessageId: m.id,
        originUserId: w.eve.id,
        triggerUserId: w.eve.id,
        status: 'awaiting_answer',
      })
      .returning()
    const [set] = await t.db
      .insert(questionSets)
      .values({
        runId: run!.id,
        requestId: 'r1',
        questions: [
          { id: 'q1', type: 'single', title: '选哪个方向？', options: ['A', 'B'], recommended: 0 },
          { id: 'q2', type: 'text', title: '还有吗？', options: [], recommended: null },
        ],
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()
    return { run: run!, set: set!, url: `/api/runs/${run!.id}/questions/${set!.id}/leanings` }
  }

  it('toggles a member’s leaning on an option and pushes the card with names', async () => {
    const w = await world()
    const q = await pending(w)
    const seen: WebEvent[] = []
    t.ctx.bus.attach(w.eve.id, (e) => seen.push(e))
    const [mia, zoeOut, eve] = [await w.as(w.mia), await w.as(w.zoe), await w.as(w.eve)]

    const first = await mia.post<QuestionSetDto>(q.url, { questionId: 'q1', choice: 1 })
    expect(first.status).toBe(200)
    expect(first.body.leanings).toEqual([{ questionId: 'q1', choice: 1, userId: w.mia.id, name: '米娅' }])
    await eve.post(q.url, { questionId: 'q1', choice: 1 })
    const pushed = seen.filter((e) => e.t === 'run.updated')
    expect(pushed.at(-1)).toMatchObject({
      run: { questions: [{ id: q.set.id, leanings: [{ name: '米娅' }, { name: '伊芙' }] }] },
    })
    const off = await mia.post<QuestionSetDto>(q.url, { questionId: 'q1', choice: 1 })
    expect(off.body.leanings.map((l) => l.name)).toEqual(['伊芙'])

    expect((await zoeOut.post(q.url, { questionId: 'q1', choice: 0 })).status).toBe(404)
    expect((await mia.post(q.url, { questionId: 'q1', choice: 2 })).status).toBe(400)
    expect((await mia.post(q.url, { questionId: 'q2', choice: 0 })).status).toBe(400)
    expect((await mia.post(q.url, { questionId: 'nope', choice: 0 })).status).toBe(400)
    await t.db.update(questionSets).set({ status: 'answered' }).where(eq(questionSets.id, q.set.id))
    expect((await mia.post(q.url, { questionId: 'q1', choice: 0 })).status).toBe(409)
  })
})
