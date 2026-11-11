import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  type CommandCandidatesDto,
  type GroupPluginDto,
  type MessageDto,
  type PluginDto,
  PROTOCOL_VERSION,
  type RunStart,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, machines, messages, pluginVersions, runs, teamMembers } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { kitOf, pluginCommands } from '../src/modules/artifacts/kit.js'
import { syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

// plan 插件扩展点 S2: chat commands, provider presets, icons and shells declared in the manifest.

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const file = (path: string, content: string) => ({ path, content, encoding: 'utf8' as const })
const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\nDo it.\n`

const STANDUP = {
  name: 'standup',
  title: '站会小结',
  description: '按今天的消息写站会小结',
  prompt: '按本群今天的消息写站会小结，重点：{args}',
}
const PRESET = {
  id: 'acme',
  agent: 'claude',
  name: 'Acme',
  baseUrl: 'https://api.acme.example.com/anthropic',
  model: 'acme-1',
}

const manifest = (o: Record<string, unknown> = {}) => ({
  name: 'team-kit',
  version: '1.0.0',
  title: '团队工具',
  description: '团队日常',
  category: 'tool',
  agents: ['claude', 'codex'],
  minDaemon: '0.5.0',
  entry: 'team-kit',
  icon: 'assets/icon.svg',
  contributes: { commands: [STANDUP] },
  ...o,
})
const pkg = (m: Record<string, unknown> = manifest()) => [
  file('gonggong-plugin.json', JSON.stringify(m)),
  file('skills/team-kit/SKILL.md', skillMd('team-kit')),
  file('assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
]

async function world() {
  const eve = await t.seed.user({ name: '伊芙' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, eve.id))
  const group = await t.seed.group({ createdBy: eve.id, name: '站会群' })
  const { machine, token } = await t.seed.machine(eve.id)
  const bot = await t.seed.bot({ ownerId: eve.id, machineId: machine.id, name: '助手' })
  await t.db.insert(groupBots).values({ groupId: group.id, botId: bot.id })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
  return { eve, root, group, machine, token, bot, as }
}
type World = Awaited<ReturnType<typeof world>>

const upload = async (w: World, files = pkg(), base = '/api/admin/plugins') =>
  (await w.as(w.root)).post<PluginDto & { error?: string; message?: string }>(base, { files })

async function daemon(token: string, features = ['plugins', 'pluginMcp', 'presetSync']) {
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

describe('plugin manifest', () => {
  it('checks the icon, the shell and command names, and keeps presets to the platform layer', async () => {
    const w = await world()
    const bad = async (m: Record<string, unknown>, files = pkg(m)) => (await upload(w, files)).body
    expect(await bad(manifest(), pkg().slice(0, 2))).toMatchObject({
      error: 'invalid',
      message: expect.stringContaining('assets/icon.svg'),
    })
    expect(await bad(manifest({ artifact: { kit: 'skills/team-kit/shell' } }))).toMatchObject({
      error: 'invalid',
      message: expect.stringContaining('skills/team-kit/shell/index.html'),
    })
    expect(await bad(manifest({ contributes: { commands: [{ ...STANDUP, name: 'stop' }] } }))).toMatchObject({
      error: 'invalid',
      message: expect.stringContaining('stop'),
    })
    const withPreset = pkg(manifest({ contributes: { providers: [PRESET] } }))
    const eve = await w.as(w.eve)
    const team = await eve.post(`/api/teams/${w.group.teamId}/plugins`, { files: withPreset })
    expect(team.body).toMatchObject({ error: 'invalid', message: expect.stringContaining('平台层') })
    expect(
      (await eve.post('/api/market', { teamId: w.group.teamId, visibility: 'team', files: withPreset })).body,
    ).toMatchObject({ error: 'invalid', message: expect.stringContaining('平台层') })
    const ok = await upload(w)
    expect(ok.status).toBe(201)
    expect(ok.body.manifest).toMatchObject({ icon: 'assets/icon.svg' })
  })
})

describe('plugin chat commands', () => {
  it('are offered in the group that turned the plugin on and expand into the run prompt', async () => {
    const w = await world()
    const p = (await upload(w)).body
    const eve = await w.as(w.eve)
    const candidates = async () =>
      (await eve.get<CommandCandidatesDto>(`/api/groups/${w.group.id}/candidates/commands?botId=${w.bot.id}`))
        .body.plugin
    expect(await candidates()).toEqual([])
    await eve.put(`/api/groups/${w.group.id}/plugins/${p.id}`, { enabled: true })
    expect(await candidates()).toEqual([
      { name: 'standup', hint: '按今天的消息写站会小结', plugin: '团队工具' },
    ])

    const conn = await daemon(w.token)
    const send = async (body: string) => {
      const [m] = await t.db
        .insert(messages)
        .values({
          groupId: w.group.id,
          kind: 'user',
          authorUserId: w.eve.id,
          body,
          meta: { mentions: [w.bot.id] },
        })
        .returning()
      await triggerRuns(t.ctx, m!)
      let start = await conn.next<RunStart>()
      while (start.t !== 'run.start') start = await conn.next<RunStart>()
      await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, start.runId))
      return start.prompt.text
    }
    const text = await send('@助手 /standup 进度风险')
    expect(text).toContain('@助手 /standup 进度风险')
    expect(text).toContain('[插件命令 /standup：插件「团队工具」（team-kit）]')
    expect(text).toContain('按本群今天的消息写站会小结，重点：进度风险')
    expect(text).toContain('Skill：Claude 用 team-kit:team-kit')
    expect(await send('@助手 /standups 不是它')).toBe('@助手 /standups 不是它')
  })
})

describe('provider presets', () => {
  it('reach daemons from platform plugins on connect and on change; groups do not list them', async () => {
    const w = await world()
    await syncBuiltinPlugins(t.ctx)
    const conn = await daemon(w.token)
    const first = await conn.next<{ t: string; presets: { id: string; agent: string }[] }>()
    expect(first.t).toBe('presets.sync')
    expect(first.presets.length).toBeGreaterThan(50)
    expect(first.presets.some((p) => p.id === 'kimi-coding' && p.agent === 'claude')).toBe(true)

    const mine = manifest({ name: 'acme-presets', entry: null, contributes: { providers: [PRESET] } })
    const p = (
      await upload(w, [
        file('gonggong-plugin.json', JSON.stringify(mine)),
        file('assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ])
    ).body
    const next = await conn.next<{ t: string; presets: Record<string, unknown>[] }>()
    expect(next.t).toBe('presets.sync')
    expect(next.presets.find((x) => x.id === 'acme')).toMatchObject({
      agent: 'claude',
      group: 'global',
      modelOptions: [],
      websiteUrl: null,
    })
    const eve = await w.as(w.eve)
    const list = (await eve.get<GroupPluginDto[]>(`/api/groups/${w.group.id}/plugins`)).body
    expect(list.map((x) => x.manifest.name)).not.toContain(p.manifest.name)
    expect(list.map((x) => x.manifest.name)).toEqual(['slides', 'web-prototype'])
    const shelf = async (name: string) =>
      (await eve.get<{ name: string; category: string }[]>(`/api/market?shelf=${name}`)).body.map(
        (l) => l.name,
      )
    expect((await shelf('creation')).sort()).toEqual(['slides', 'web-prototype'])
    expect(await shelf('provider')).toEqual(['provider-presets'])

    const old = await daemon((await t.seed.machine(w.eve.id)).token, ['plugins'])
    expect(await Promise.race([old.next(), new Promise((r) => setTimeout(() => r('quiet'), 300))])).toBe(
      'quiet',
    )
  })
})

const EXAMPLE = join(import.meta.dirname, '../../../examples/plugins/dashboard')
const folder = (dir: string): { path: string; content: string; encoding: 'utf8' }[] =>
  readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory()
      ? folder(join(dir, n))
      : [
          {
            path: relative(EXAMPLE, join(dir, n)),
            content: readFileSync(join(dir, n), 'utf8'),
            encoding: 'utf8' as const,
          },
        ],
  )

describe('the example dashboard plugin (a new kind of creation, no core change)', () => {
  it('uploads, is offered for creation with its icon, shell, chat command and canvas command', async () => {
    const w = await world()
    const p = await upload(w, folder(EXAMPLE))
    expect(p.status, JSON.stringify(p.body)).toBe(201)
    expect(p.body.manifest).toMatchObject({
      icon: 'assets/icon.svg',
      artifact: { kit: 'skills/dashboard/shell' },
    })
    const eve = await w.as(w.eve)
    await eve.put(`/api/groups/${w.group.id}/plugins/${p.body.id}`, { enabled: true })

    const icon = await t.app.inject({
      url: `/api/plugins/${p.body.id}/files/assets/icon.svg`,
      headers: { cookie: await t.seed.cookie(w.eve.id) },
    })
    expect(icon.statusCode).toBe(200)
    const [v] = await t.db.select().from(pluginVersions).where(eq(pluginVersions.id, p.body.versionId))
    const kit = kitOf(v!.manifest, v!.files as never)
    expect([...(kit?.keys() ?? [])].sort()).toEqual(['gg-kit.css', 'gg-kit.js', 'index.html'])
    expect((await pluginCommands(t.db, v!.id)).map((c) => [c.name, c.needsScreen])).toEqual([
      ['add-drilldown', true],
    ])
    const plugin = (
      await eve.get<CommandCandidatesDto>(`/api/groups/${w.group.id}/candidates/commands?botId=${w.bot.id}`)
    ).body.plugin
    expect(plugin).toEqual([
      { name: 'weekly-report', hint: '按本群看板写一份本周数据周报', plugin: '数据看板' },
    ])

    await daemon(w.token, ['plugins', 'pluginMcp', 'presetSync', 'artifacts'])
    await t.db.update(machines).set({ daemonVersion: '0.9.0' }).where(eq(machines.id, w.machine.id))
    const made = await eve.post<MessageDto>(`/api/groups/${w.group.id}/creations`, {
      pluginId: p.body.id,
      templateId: 'ops-overview',
      designSystemId: null,
      inputs: { prompt: '门店销售看板：销售额、客单价、复购率，给区域经理看' },
      botId: w.bot.id,
    })
    expect(made.status, JSON.stringify(made.body)).toBe(200)
    expect(made.body.card).toMatchObject({ type: 'creation', pluginTitle: '数据看板', category: 'dashboard' })
    expect(made.body.body).toContain('dashboard:dashboard')
  })
})
